import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { NetPlayerState, RoomSnapshot, RemotePlayer, MovePayload, WsMessage } from './types';
import { GAME_API_BASE, GAME_WS_BASE, roomIdFromUrl, CLIP_NAMES, MOVE_SEND_INTERVAL } from './config';
import { applyServerGameRules, getGameRules, type GameRulesState } from './game-rules';
import { smoothToward } from './utils';
import { scene } from './scene';
import { composeNeckDeltaQuaternion } from './neck-sync';
import { tintModel, setLocomotionWeights } from './character';
import { setMultiplayerStatus } from './hud';
import {
  showScreen, getCurrentScreen,
  updateMatchmaking, updateMatchmakingPlayers, startGameHud, showHint,
  startVoting, showResults, setVoteCallback, setVoteExtendRequestCallback,
  applyVoteExtendServerPayload, updateVotingDeadlineFromServer, getPlayerRole,
  applyVoteLockFromServer,
} from './screens';
import { setPlayerDisplayNamesFromSnapshot, setPlayerDisplayName, getJoinDisplayName, resolveDisplayName } from './player-names';
import {
  createNameLabel, autoPositionLabel, updateNameLabelText, setNameLabelAccent,
} from './name-labels';
import { getWorldLandmarks } from './world';

/** 参加中の部屋。空のときは未解決（次回 `resolve` で決定）。ゲーム終了・離脱時にクリアし URL からも `room` を外す */
let activeRoomId = roomIdFromUrl;

/** `cleanup` 直前にいた部屋。次回 `resolve`（自動検索時）で除外し、別の待機ルームへ入る */
let excludeRoomAfterLeave: string | null = null;

/** アドレスバーから `room` クエリを除き `/` のままにする（共有用 `?room=` だけのときはクエリごと消える） */
function stripRoomQueryFromUrl(): void {
  const u = new URL(window.location.href);
  if (!u.searchParams.has('room')) return;
  u.searchParams.delete('room');
  const q = u.searchParams.toString();
  const next = u.pathname + (q ? `?${q}` : '') + u.hash;
  history.replaceState(null, '', next);
}

export function getActiveRoomId(): string {
  return activeRoomId;
}

const remoteNeckDeltaQuat = new THREE.Quaternion();

let gameSocket: WebSocket | null = null;
let wsReconnectTimer: number | null = null;
/** `cleanup()` 等で閉じたときは `close` イベントで自動再接続しない（未参加のままゲームが進むのを防ぐ） */
let manualWsClose = false;
/** 「ゲーム参加」から `leaveRoom`／切断まで true。未参加時は WS メッセージを無視 */
let multiplayerSessionActive = false;
let lastMoveSentAt = 0;
const remotePlayers = new Map<string, RemotePlayer>();

let remoteModelTemplate: THREE.Group | null = null;
let remoteAnimationClips: THREE.AnimationClip[] = [];

let localModel: THREE.Object3D | null = null;
/** 最後に `tintModel` へ渡した hex（サーバの `color` と一致していれば再ティント不要） */
let lastAppliedLocalTintHex = '';
export let localPlayerColor = '';

const playerId = (() => {
  const key = 'waniar:player-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const generated = `p-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, generated);
  return generated;
})();

export function getPlayerId(): string { return playerId; }

/** モデルと色が揃ったときに呼ぶ。色が変わった場合のみ `tintModel` する */
export function applyLocalPlayerColorTint(): void {
  if (!localModel || !localPlayerColor) return;
  if (lastAppliedLocalTintHex === localPlayerColor) return;
  tintModel(localModel, localPlayerColor);
  lastAppliedLocalTintHex = localPlayerColor;
}

/** 後方互換: 現在の `localPlayerColor` へティント済みなら true */
export function isLocalModelTinted(): boolean {
  return localPlayerColor !== '' && lastAppliedLocalTintHex === localPlayerColor;
}

export function setLocalModel(m: THREE.Object3D): void {
  localModel = m;
  applyLocalPlayerColorTint();
}

export function setRemoteModelTemplate(template: THREE.Group, clips: THREE.AnimationClip[]): void {
  remoteModelTemplate = template;
  remoteAnimationClips = clips;
  refreshRemoteVisualsAfterModelLoaded();
}

/** 投票画面のワニプレビュー用（モデル読み込み後のみ有効） */
export function getVotePreviewModel(): { template: THREE.Group; clips: THREE.AnimationClip[] } | null {
  if (!remoteModelTemplate) return null;
  return { template: remoteModelTemplate, clips: remoteAnimationClips };
}

function isValidSnapshot(payload: unknown): payload is RoomSnapshot {
  if (!payload || typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;
  return typeof obj.roomId === 'string'
    && typeof obj.version === 'number'
    && Array.isArray(obj.players);
}

function createRemoteProxyRoot(): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.08, 0.14, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xfb8c00, roughness: 0.55, metalness: 0.08 }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.y = 0.11;
  root.add(body);

  const direction = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.6, metalness: 0.05 }),
  );
  direction.rotation.x = Math.PI / 2;
  direction.position.set(0, 0.11, 0.14);
  direction.castShadow = true;
  root.add(direction);
  return root;
}

function createRemoteModelRoot(): { root: THREE.Group; mixer: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction> } | null {
  if (!remoteModelTemplate) return null;
  const root = cloneSkinned(remoteModelTemplate) as THREE.Group;
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  const mixer = new THREE.AnimationMixer(root);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const clip of remoteAnimationClips) {
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.play();
    action.setEffectiveWeight(0);
    actions[clip.name] = action;
  }
  if (actions.Idle) actions.Idle.setEffectiveWeight(1);
  if (actions.TailWag) actions.TailWag.setEffectiveWeight(0);

  return { root, mixer, actions };
}

function getRemoteHead(root: THREE.Group): { headBone: THREE.Object3D | null; headBaseQuat: THREE.Quaternion | null } {
  const head = root.getObjectByName('head') ?? null;
  return {
    headBone: head,
    headBaseQuat: head ? head.quaternion.clone() : null,
  };
}

function animToLocoParams(name: string): { speed: number; runBlend: number } {
  const base = name.replace('_MouthOpen', '');
  if (base.startsWith('Run')) return { speed: 1, runBlend: 1 };
  if (base.startsWith('Walk')) return { speed: 0.5, runBlend: 0 };
  return { speed: 0, runBlend: 0 };
}

function applyRemoteLocomotion(remote: RemotePlayer) {
  if (!remote.mixer) return;
  const { speed, runBlend } = animToLocoParams(remote.desiredAnimation);
  setLocomotionWeights(speed, remote.smoothMouthOpenness, runBlend, remote.actions);
}

function makeRemotePlayer(player: NetPlayerState): RemotePlayer {
  const remoteModel = createRemoteModelRoot();
  const root = remoteModel?.root ?? createRemoteProxyRoot();
  const remoteHead = remoteModel ? getRemoteHead(root) : { headBone: null, headBaseQuat: null };

  if (player.color && remoteModel) tintModel(root, player.color);

  const ib = player.idleBob ?? 0;
  root.position.set(player.x, player.y + ib, player.z);
  root.rotation.y = player.rotationY;
  root.rotation.x = player.idlePitch ?? 0;
  root.rotation.z = player.idleRoll ?? 0;
  scene.add(root);

  const displayName = (player.displayName?.trim()) || resolveDisplayName(player.playerId);
  const nameLabel = createNameLabel(displayName, player.color || undefined);
  root.add(nameLabel);
  root.updateMatrixWorld(true);
  autoPositionLabel(nameLabel, root);

  const remote: RemotePlayer = {
    root,
    targetPos: new THREE.Vector3(player.x, player.y, player.z),
    targetYaw: player.rotationY,
    targetNeckYaw: player.neckYaw ?? 0,
    targetNeckPitch: player.neckPitch ?? 0,
    targetIdleBob: player.idleBob ?? 0,
    targetIdlePitch: player.idlePitch ?? 0,
    targetIdleRoll: player.idleRoll ?? 0,
    smoothIdleBob: player.idleBob ?? 0,
    smoothIdlePitch: player.idlePitch ?? 0,
    smoothIdleRoll: player.idleRoll ?? 0,
    prevIdleBob: ib,
    smoothNeckYaw: 0,
    smoothNeckPitch: 0,
    headBone: remoteHead.headBone,
    headBaseQuat: remoteHead.headBaseQuat,
    desiredAnimation: player.animation || 'Idle',
    targetMouthOpenness: player.mouthOpenness ?? 0,
    smoothMouthOpenness: player.mouthOpenness ?? 0,
    actions: remoteModel?.actions ?? {},
    mixer: remoteModel?.mixer ?? null,
    isProxy: !remoteModel,
    color: player.color || '',
    nameLabel,
    displayName,
  };
  applyRemoteLocomotion(remote);
  return remote;
}

function upgradeRemoteVisualIfReady(remote: RemotePlayer) {
  if (!remote.isProxy || !remoteModelTemplate) return;
  const remoteModel = createRemoteModelRoot();
  if (!remoteModel) return;

  scene.remove(remote.root);
  remote.root = remoteModel.root;
  remote.actions = remoteModel.actions;
  remote.mixer = remoteModel.mixer;
  remote.isProxy = false;
  if (remote.color) tintModel(remote.root, remote.color);
  const remoteHead = getRemoteHead(remote.root);
  remote.headBone = remoteHead.headBone;
  remote.headBaseQuat = remoteHead.headBaseQuat;
  remote.smoothNeckYaw = 0;
  remote.smoothNeckPitch = 0;
  remote.root.position.copy(remote.targetPos);
  remote.root.position.y += remote.smoothIdleBob;
  remote.prevIdleBob = remote.smoothIdleBob;
  remote.root.rotation.y = remote.targetYaw;
  remote.root.rotation.x = remote.smoothIdlePitch;
  remote.root.rotation.z = remote.smoothIdleRoll;

  if (remote.nameLabel) {
    remote.root.add(remote.nameLabel as THREE.Object3D);
    remote.root.updateMatrixWorld(true);
    autoPositionLabel(remote.nameLabel as import('three/examples/jsm/renderers/CSS2DRenderer.js').CSS2DObject, remote.root);
  }

  scene.add(remote.root);
  applyRemoteLocomotion(remote);
}

function refreshRemoteVisualsAfterModelLoaded() {
  for (const remote of remotePlayers.values()) {
    upgradeRemoteVisualIfReady(remote);
  }
}

function disposeRemotePlayer(remote: RemotePlayer) {
  if (remote.mixer) remote.mixer.stopAllAction();
  if (remote.nameLabel) {
    const el = (remote.nameLabel as { element?: HTMLElement }).element;
    el?.remove();
  }
  scene.remove(remote.root);
}

/** 接続切断・HMR 時など、リモートのメッシュと CSS2D ラベルをすべて除去する */
export function clearRemotePlayers(): void {
  for (const [id, remote] of remotePlayers) {
    disposeRemotePlayer(remote);
    remotePlayers.delete(id);
  }
}

function removeRemotePlayer(playerID: string) {
  const remote = remotePlayers.get(playerID);
  if (!remote) return;
  disposeRemotePlayer(remote);
  remotePlayers.delete(playerID);
}

function applyRoomSnapshot(snapshot: RoomSnapshot) {
  setPlayerDisplayNamesFromSnapshot(snapshot.players);

  const aliveIDs = new Set<string>();

  for (const p of snapshot.players) {
    if (p.playerId === playerId) {
      if (p.color) {
        localPlayerColor = p.color;
        applyLocalPlayerColorTint();
      }
      continue;
    }
    aliveIDs.add(p.playerId);
    let remote = remotePlayers.get(p.playerId);
    if (!remote) {
      remote = makeRemotePlayer(p);
      remotePlayers.set(p.playerId, remote);
    } else {
      if (p.color && p.color !== remote.color) {
        remote.color = p.color;
        if (!remote.isProxy) tintModel(remote.root, remote.color);
      }
      upgradeRemoteVisualIfReady(remote);
    }
    remote.targetPos.set(p.x, p.y, p.z);
    remote.targetYaw = p.rotationY;
    remote.targetNeckYaw = p.neckYaw ?? 0;
    remote.targetNeckPitch = p.neckPitch ?? 0;
    remote.targetIdleBob = p.idleBob ?? 0;
    remote.targetIdlePitch = p.idlePitch ?? 0;
    remote.targetIdleRoll = p.idleRoll ?? 0;
    remote.desiredAnimation = p.animation || 'Idle';
    remote.targetMouthOpenness = p.mouthOpenness ?? 0;
    const nextName = (p.displayName?.trim()) || resolveDisplayName(p.playerId);
    if (nextName !== remote.displayName) {
      remote.displayName = nextName;
      if (remote.nameLabel) updateNameLabelText(remote.nameLabel as never, nextName, p.color);
    }
    if (p.color && remote.nameLabel) {
      setNameLabelAccent(remote.nameLabel, p.color);
    }
    applyRemoteLocomotion(remote);
  }

  for (const id of remotePlayers.keys()) {
    if (!aliveIDs.has(id)) removeRemotePlayer(id);
  }

  setMultiplayerStatus(`部屋: ${snapshot.roomId} 同期中 ${snapshot.players.length}人`);
}

async function resolveLobbyIfNeeded(): Promise<void> {
  const payload: { preferredRoomId: string; excludeRoomId?: string } = {
    preferredRoomId: activeRoomId,
  };
  // 自動検索（preferred 空）のときだけ、直前に退室した部屋を除外して別の待機ルームへ
  if (!activeRoomId && excludeRoomAfterLeave) {
    payload.excludeRoomId = excludeRoomAfterLeave;
  }
  const res = await fetch(`${GAME_API_BASE}/rooms/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`resolve failed: HTTP ${res.status}`);
  const data = await res.json() as { ok?: boolean; roomId?: string; redirected?: boolean; reason?: string };
  if (!data.ok || !data.roomId) throw new Error('resolve: invalid response');
  activeRoomId = data.roomId;
  excludeRoomAfterLeave = null;
  stripRoomQueryFromUrl();
  if (data.redirected) {
    const r = data.reason || '';
    if (r === 'game_in_progress') {
      setMultiplayerStatus(`対戦中のため待機ルーム「${activeRoomId}」へ移動しました`);
    } else if (r === 'auto_existing' || r === 'auto_create') {
      setMultiplayerStatus(`部屋「${activeRoomId}」に参加します`);
    }
  }
}

export async function joinRoom(): Promise<void> {
  const res = await fetch(`${GAME_API_BASE}/rooms/${encodeURIComponent(activeRoomId)}/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, displayName: getJoinDisplayName() }),
  });
  if (!res.ok) throw new Error(`join failed: HTTP ${res.status}`);
  const payload = await res.json() as { snapshot?: unknown };
  if (payload.snapshot && isValidSnapshot(payload.snapshot)) {
    const me = payload.snapshot.players.find(p => p.playerId === playerId);
    if (import.meta.env.DEV) console.log(`[joinRoom] myColor=${me?.color}, model=${!!localModel}, playerId=${playerId}`);
    if (me?.color) {
      localPlayerColor = me.color;
      applyLocalPlayerColorTint();
    }
    applyRoomSnapshot(payload.snapshot);
  }
}

export async function leaveRoom(): Promise<void> {
  if (!activeRoomId) return;
  try {
    await fetch(`${GAME_API_BASE}/rooms/${encodeURIComponent(activeRoomId)}/players/${encodeURIComponent(playerId)}`, {
      method: 'DELETE',
      keepalive: true,
    });
  } catch {
    // ページ離脱時の失敗は許容する
  }
}

export function connectGameSocket(): void {
  if (gameSocket && (gameSocket.readyState === WebSocket.OPEN || gameSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = `${GAME_WS_BASE}?roomId=${encodeURIComponent(activeRoomId)}&playerId=${encodeURIComponent(playerId)}&displayName=${encodeURIComponent(getJoinDisplayName())}`;
  setMultiplayerStatus(`部屋: ${activeRoomId} 接続中`);
  const ws = new WebSocket(url);
  gameSocket = ws;

  ws.addEventListener('open', () => {
    setMultiplayerStatus(`部屋: ${activeRoomId} 接続済み`);
    const lm = getWorldLandmarks();
    if (lm.length > 0) {
      ws.send(JSON.stringify({ type: 'landmarks', payload: { landmarks: lm } }));
    }
  });

  ws.addEventListener('message', (event) => {
    if (!multiplayerSessionActive) return;
    try {
      const msg: unknown = JSON.parse(event.data as string);
      if (!msg || typeof msg !== 'object') return;
      const envelope = msg as WsMessage;
      switch (envelope.type) {
        case 'snapshot':
          if (isValidSnapshot(envelope.payload)) applyRoomSnapshot(envelope.payload);
          break;
        case 'game_state':
          handleGameState(envelope.payload as Record<string, unknown>);
          break;
        case 'game_start':
          handleGameStart(envelope.payload as Record<string, unknown>);
          break;
        case 'hint':
          handleHint(envelope.payload as Record<string, unknown>);
          break;
        case 'vote_start':
          handleVoteStart(envelope.payload as Record<string, unknown>);
          break;
        case 'vote_extend_update':
          handleVoteExtendUpdate(envelope.payload as Record<string, unknown>);
          break;
        case 'vote_result':
          handleVoteResult(envelope.payload as Record<string, unknown>);
          break;
        case 'room_closed':
          handleRoomClosed();
          break;
      }
    } catch (err) {
      console.warn('WS parse error:', err);
    }
  });

  ws.addEventListener('close', () => {
    gameSocket = null;
    if (manualWsClose) {
      manualWsClose = false;
      return;
    }
    clearRemotePlayers();
    if (!multiplayerSessionActive) return;
    setMultiplayerStatus(`部屋: ${activeRoomId} 再接続待ち`);
    if (wsReconnectTimer != null) window.clearTimeout(wsReconnectTimer);
    wsReconnectTimer = window.setTimeout(() => {
      connectGameSocket();
    }, 1500);
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

export function sendLocalMove(now: number, payload: MovePayload): void {
  if (!gameSocket || gameSocket.readyState !== WebSocket.OPEN) return;
  if (now - lastMoveSentAt < MOVE_SEND_INTERVAL) return;
  lastMoveSentAt = now;
  gameSocket.send(JSON.stringify({ type: 'move', payload }));
}

function sendVote(votedFor: string): void {
  if (!gameSocket || gameSocket.readyState !== WebSocket.OPEN) return;
  gameSocket.send(JSON.stringify({ type: 'vote', payload: { votedFor } }));
}

function sendVoteExtend(): void {
  if (!gameSocket || gameSocket.readyState !== WebSocket.OPEN) return;
  gameSocket.send(JSON.stringify({ type: 'vote_extend' }));
}

let currentRole = 'citizen';

function handleGameState(payload: Record<string, unknown>): void {
  applyServerGameRules(payload.rules as Partial<GameRulesState> | undefined);
  const phase = payload.phase as string || 'waiting';
  const playerCount = (payload.playerCount as number) || 0;
  const countdownEnd = (payload.countdownEnd as number) || 0;
  const players = (payload.players as { displayName: string; color: string }[]) || [];

  if (phase === 'voting') {
    const votes = payload.votes as Record<string, string> | undefined;
    if (votes && typeof votes[playerId] === 'string' && votes[playerId]) {
      applyVoteLockFromServer(votes[playerId]);
    }
    const ve = (payload.voteEnd as number) || 0;
    if (ve) updateVotingDeadlineFromServer(ve);
    if (payload.voteExtendUsed !== undefined || payload.voteExtendRequestPlayerIds) {
      applyVoteExtendServerPayload(
        {
          voteEnd: ve || Date.now(),
          voteExtendUsed: !!(payload.voteExtendUsed as boolean),
          requestPlayerIds: (payload.voteExtendRequestPlayerIds as string[]) || [],
          requiredCount: (payload.voteExtendRequiredCount as number) || 1,
          roundPlayerCount: playerCount,
        },
        playerId,
      );
    }
  }

  if (phase === 'waiting' || phase === 'countdown') {
    const screen = getCurrentScreen();
    if (screen === 'matchmaking') {
      updateMatchmaking(playerCount, countdownEnd || null);
      if (players.length) updateMatchmakingPlayers(players);
    }
    if (phase === 'waiting' && (screen === 'results' || screen === 'voting' || screen === 'game-hud')) {
      showScreen('home');
    }
  }
}

function handleGameStart(payload: Record<string, unknown>): void {
  const fallbackMs = getGameRules().gameDurationSec * 1000;
  const gameEnd = (payload.gameEnd as number) || Date.now() + fallbackMs;
  const role = (payload.role as string) || 'citizen';
  const theme = (payload.theme as string) || undefined;
  currentRole = role;
  startGameHud(gameEnd, role, theme);
}

function handleHint(payload: Record<string, unknown>): void {
  const text = (payload.text as string) || 'Agent: 情報を収集中...';
  showHint(text);
}

function handleVoteStart(payload: Record<string, unknown>): void {
  const voteEnd = (payload.voteEnd as number) || Date.now() + getGameRules().voteDurationSec * 1000;
  const players = (payload.players as { playerId: string; color: string; displayName?: string }[]) || [];
  for (const pl of players) {
    if (pl.displayName) setPlayerDisplayName(pl.playerId, pl.displayName);
  }
  setVoteExtendRequestCallback(sendVoteExtend);
  startVoting(voteEnd, players, playerId, getVotePreviewModel());
  setVoteCallback(sendVote);
}

function handleVoteExtendUpdate(payload: Record<string, unknown>): void {
  const voteEnd = (payload.voteEnd as number) || Date.now();
  updateVotingDeadlineFromServer(voteEnd);
  applyVoteExtendServerPayload(
    {
      voteEnd,
      voteExtendUsed: !!(payload.voteExtendUsed as boolean),
      requestPlayerIds: (payload.requestPlayerIds as string[]) || [],
      requiredCount: (payload.requiredCount as number) || 1,
      roundPlayerCount: (payload.roundPlayerCount as number) || 0,
    },
    playerId,
  );
}

function handleRoomClosed(): void {
  if (!multiplayerSessionActive) return;
  cleanup();
}

function handleVoteResult(payload: Record<string, unknown>): void {
  const enemyPlayerId = (payload.enemyPlayerId as string) || '';
  const citizensWin = (payload.citizensWin as boolean) || false;
  const voteCounts = (payload.voteCounts as Record<string, number>) || {};
  const enemyColor = (payload.enemyColor as string) || '';
  const allyTheme = (payload.allyTheme as string) || '';
  const enemyTheme = (payload.enemyTheme as string) || '';
  showResults(
    citizensWin,
    enemyPlayerId,
    voteCounts,
    currentRole,
    enemyColor,
    getVotePreviewModel(),
    allyTheme,
    enemyTheme,
  );
  cleanup();
  if (onGameEndCallback) onGameEndCallback();
}

let onGameEndCallback: (() => void) | null = null;
export function setOnGameEnd(cb: () => void): void { onGameEndCallback = cb; }

export function updateRemotePlayers(dt: number): void {
  const lerpT = 1 - Math.exp(-8 * dt);
  for (const remote of remotePlayers.values()) {
    remote.root.position.y -= remote.prevIdleBob;
    remote.root.position.lerp(remote.targetPos, lerpT);
    remote.smoothIdleBob = smoothToward(remote.smoothIdleBob, remote.targetIdleBob, dt, 14);
    remote.smoothIdlePitch = smoothToward(remote.smoothIdlePitch, remote.targetIdlePitch, dt, 10);
    remote.smoothIdleRoll = smoothToward(remote.smoothIdleRoll, remote.targetIdleRoll, dt, 10);
    remote.root.position.y += remote.smoothIdleBob;
    remote.prevIdleBob = remote.smoothIdleBob;

    remote.root.rotation.y += (remote.targetYaw - remote.root.rotation.y) * lerpT;
    remote.root.rotation.x = remote.smoothIdlePitch;
    remote.root.rotation.z = remote.smoothIdleRoll;

    remote.smoothMouthOpenness = smoothToward(remote.smoothMouthOpenness, remote.targetMouthOpenness, dt, 10);
    applyRemoteLocomotion(remote);

    if (remote.headBone && remote.headBaseQuat) {
      /** 首は動きが細かいので本体より少しだけ速く追従（Euler 順は `composeNeckDeltaQuaternion` に統一） */
      remote.smoothNeckYaw = smoothToward(remote.smoothNeckYaw, remote.targetNeckYaw, dt, 22);
      remote.smoothNeckPitch = smoothToward(remote.smoothNeckPitch, remote.targetNeckPitch, dt, 22);
      composeNeckDeltaQuaternion(remoteNeckDeltaQuat, remote.smoothNeckPitch, remote.smoothNeckYaw);
      remote.headBone.quaternion.copy(remote.headBaseQuat).multiply(remoteNeckDeltaQuat);
    }

    remote.mixer?.update(dt);
  }
}

export async function initMultiplayer(): Promise<void> {
  setMultiplayerStatus(
    activeRoomId ? `部屋: ${activeRoomId} 接続準備中` : '待機できる部屋を検索しています…',
  );
  manualWsClose = false;
  try {
    await resolveLobbyIfNeeded();
    setMultiplayerStatus(`部屋: ${activeRoomId} 参加処理中`);
    await joinRoom();
    multiplayerSessionActive = true;
    connectGameSocket();
  } catch (err) {
    multiplayerSessionActive = false;
    setMultiplayerStatus(activeRoomId ? `部屋: ${activeRoomId} 参加失敗` : '部屋への参加に失敗しました');
    console.error(err);
  }
}

export function cleanup(): void {
  multiplayerSessionActive = false;
  if (wsReconnectTimer != null) window.clearTimeout(wsReconnectTimer);
  wsReconnectTimer = null;
  manualWsClose = true;
  if (gameSocket) gameSocket.close();
  gameSocket = null;
  clearRemotePlayers();
  localPlayerColor = '';
  lastAppliedLocalTintHex = '';
  const roomJustLeft = activeRoomId;
  void leaveRoom();
  if (roomJustLeft) excludeRoomAfterLeave = roomJustLeft;
  activeRoomId = '';
  stripRoomQueryFromUrl();
  setMultiplayerStatus('未参加（次回「ゲーム参加」で部屋を検索します）');
}
