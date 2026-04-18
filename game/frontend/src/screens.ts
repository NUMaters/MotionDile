import type { AnimationClip, Group } from 'three';
import { getEl } from './utils';
import { FLAT_WORLD_MODE, FALLBACK_PLAYER_COLOR } from './config';
import { getGameRules } from './game-rules';
import { mountVotePreviews, disposeVotePreviews } from './vote-previews';
import { resolveDisplayName } from './player-names';
import { IC } from './icons';
import { spawnResultConfetti, clearResultConfetti } from './result-confetti';

export type ScreenName = 'home' | 'tutorial' | 'matchmaking' | 'game-hud' | 'voting' | 'results' | 'none';

const screenIds: Record<Exclude<ScreenName, 'none'>, string> = {
  'home': 'screen-home',
  'tutorial': 'screen-tutorial',
  'matchmaking': 'screen-matchmaking',
  'game-hud': 'screen-game-hud',
  'voting': 'screen-voting',
  'results': 'screen-results',
};

let currentScreen: ScreenName = 'none';

export function showScreen(name: ScreenName): void {
  if (name === 'home') disposeVotePreviews();
  if (name !== 'results') clearResultConfetti();
  for (const [key, id] of Object.entries(screenIds)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (key === name) {
      el.classList.remove('hidden');
      el.style.display = '';
    } else {
      el.classList.add('hidden');
    }
  }
  if (name !== 'matchmaking') {
    setMatchmakingPipMode(false);
  }
  currentScreen = name;
  (window as unknown as Record<string, unknown>).__currentScreen = name;
}

export function getCurrentScreen(): ScreenName {
  return currentScreen;
}

// ─── Tutorial（実際のUIに近いデモ付き） ───
const jumpNote = FLAT_WORLD_MODE
  ? 'ジャンプ：画面を<strong>素早く2回タップ</strong>'
  : '（このマップではジャンプはありません）';

const tutorialPagesHtml: string[] = [
  `
  <h2>${IC.gamepad(22)} 歩く・走る</h2>
  <p class="tut-lead">ジョイスティック</p>
  <div class="tut-demo tut-demo-joystick" aria-hidden="true">
    <div class="tut-run-ring"></div>
    <div class="tut-joy-base"></div>
    <div class="tut-joy-thumb"></div>
  </div>
  <p class="tut-body">指で<strong>なぞって</strong>ワニを動かそう。<br>外側のリングまで<strong>大きく倒す</strong>とダッシュ！</p>
  `,
  `
  <h2>${IC.eye(22)} 見まわす</h2>
  <p class="tut-lead">カメラを正面に戻すボタン</p>
  <div class="tut-demo tut-demo-look">
    <button type="button" class="tut-look-fake" tabindex="-1" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
  </div>
  <p class="tut-body">スマホを<strong>傾けて</strong>周りを見渡せる。
  <br>気持ち悪くなったらボタンをタップ！</p>
  `,
  `
  <h2>${IC.zap(22)} ジャンプ・顎の操作</h2>
  <p class="tut-body">${jumpNote}</p>
  <p class="tut-body">口の開き：<strong>手をかざして開閉する</strong></p>
  <p class="tut-body">顎の操作：<strong>手をかざして上下左右に動かす</strong></p>
  `,
  `
  <h2>${IC.swords(22)} ゲームのルール</h2>
  <p class="tut-body">ゲーム開始時に<strong>行動ミッション</strong>が表示されます。<br><strong>皆と違う動きをしている敵ワニ</strong>を探そう！</p>
  `,
  `
  <h2>${IC.search(22)} Agentのヒント</h2>
  <p class="tut-body">15秒ごとに<strong>Agent</strong>から、敵ワニの<strong>行動パターン</strong>や<strong>位置</strong>のヒントが届くよ。</p>
  `,
  `
  <h2>${IC.vote(22)} 投票</h2>
  <p class="tut-body">ミッションと<strong>違う動きをしていた</strong>プレイヤーに投票！<br>いちばん票を集めた人が本当の敵ワニなら<strong>市民チームの勝ち</strong>！</p>
  `,
];

let tutPage = 0;

function advanceTutorialPage(): void {
  tutPage = (tutPage + 1) % tutorialPagesHtml.length;
}

function tutorialPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function dotRowHtml(): string {
  return tutorialPagesHtml
    .map((_, i) => `<div class="tut-dot${i === tutPage ? ' active' : ''}"></div>`)
    .join('');
}

function syncStandaloneTutorialDots(): void {
  const tutDotsEl = document.getElementById('tut-dots');
  if (tutDotsEl) tutDotsEl.innerHTML = dotRowHtml();
  const homeDots = document.querySelector('#home-tut-inline .home-tut-dots');
  if (homeDots) homeDots.innerHTML = dotRowHtml();
}

function playSlideEnter(inner: HTMLElement | null): void {
  if (!inner || tutorialPrefersReducedMotion()) return;
  inner.classList.remove('tut-enter-run', 'tut-enter-initial', 'tut-slide-out');
  inner.classList.add('tut-enter-initial');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      inner.classList.remove('tut-enter-initial');
      inner.classList.add('tut-enter-run');
    });
  });
}

function renderHomeTutorialInline(enterAfterMount: boolean): void {
  const el = document.getElementById('home-tut-inline');
  if (!el) return;
  const html = tutorialPagesHtml[tutPage] ?? '';
  const n = tutorialPagesHtml.length;
  const dots = dotRowHtml();
  el.innerHTML = `
    <div class="home-tut-tap-area tut-panel home-tut-panel" role="button" tabindex="0" aria-label="遊び方 ${tutPage + 1} / ${n}。タップで次のページへ">
      <div class="home-tut-slide-viewport">
        <div class="tut-page-inner">${html}</div>
      </div>
      <div class="home-tut-footer">
        <div class="tut-dots home-tut-dots">${dots}</div>
        <p class="home-tut-hint">タップで次へ</p>
      </div>
    </div>`;
  if (enterAfterMount) {
    playSlideEnter(el.querySelector('.tut-page-inner'));
  }
}

function renderTutorialPanelContent(enterAfterMount: boolean): void {
  const contentEl = getEl<HTMLElement>('tut-content');
  const pageHtml = tutorialPagesHtml[tutPage] ?? '';
  contentEl.innerHTML = `<div class="tut-panel tut-panel--slide"><div class="tut-slide-viewport-full"><div class="tut-page-inner">${pageHtml}</div></div></div>`;
  if (enterAfterMount) {
    playSlideEnter(contentEl.querySelector('.tut-page-inner'));
  }
}

function renderAllTutorialViews(enterHome: boolean, enterTutorial: boolean): void {
  renderHomeTutorialInline(enterHome);
  renderTutorialPanelContent(enterTutorial);
  syncStandaloneTutorialDots();
}

function runHomeTutorialSlideAdvance(): void {
  if (tutorialPrefersReducedMotion()) {
    advanceTutorialPage();
    renderAllTutorialViews(false, false);
    return;
  }
  const inner = document.querySelector('#home-tut-inline .tut-page-inner') as HTMLElement | null;
  if (!inner) {
    advanceTutorialPage();
    renderAllTutorialViews(false, false);
    return;
  }
  inner.classList.remove('tut-enter-run', 'tut-enter-initial');
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    advanceTutorialPage();
    renderAllTutorialViews(true, false);
  };
  inner.classList.add('tut-slide-out');
  inner.addEventListener(
    'transitionend',
    (ev) => {
      if (ev.target !== inner) return;
      finish();
    },
    { once: true },
  );
}

function runFullTutorialSlideAdvance(): void {
  if (tutorialPrefersReducedMotion()) {
    advanceTutorialPage();
    renderAllTutorialViews(false, false);
    return;
  }
  const inner = document.querySelector('#tut-content .tut-page-inner') as HTMLElement | null;
  if (!inner) {
    advanceTutorialPage();
    renderAllTutorialViews(false, false);
    return;
  }
  inner.classList.remove('tut-enter-run', 'tut-enter-initial');
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    advanceTutorialPage();
    renderAllTutorialViews(false, true);
  };
  inner.classList.add('tut-slide-out');
  inner.addEventListener(
    'transitionend',
    (ev) => {
      if (ev.target !== inner) return;
      finish();
    },
    { once: true },
  );
}

export function initTutorial(): void {
  const tutScreen = getEl<HTMLElement>('screen-tutorial');
  const homeTutEl = document.getElementById('home-tut-inline');

  tutScreen.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.id === 'btn-tut-back' || target.closest('#btn-tut-back')) return;
    runFullTutorialSlideAdvance();
  });

  getEl<HTMLElement>('btn-tut-back').addEventListener('click', (e) => {
    e.stopPropagation();
    tutPage = 0;
    showScreen('home');
    renderAllTutorialViews(false, false);
  });

  if (homeTutEl) {
    homeTutEl.addEventListener('click', () => {
      runHomeTutorialSlideAdvance();
    });
  }

  renderAllTutorialViews(false, false);
}

// ─── Matchmaking ───
let matchCountdownInterval: number | null = null;
let matchmakingPip = false;
/** `updateMatchmaking` 直近の `countdownEnd`（PiP トグル時に待機文を同期するため） */
let lastMatchmakingCountdownEnd: number | null = null;

/** 待機画面を PiP 風に縮小（背景透過・ゲーム操作可能） */
export function setMatchmakingPipMode(pip: boolean): void {
  const root = document.getElementById('screen-matchmaking');
  const btn = document.getElementById('btn-matchmaking-pip') as HTMLButtonElement | null;
  const iconSlot = document.getElementById('icon-matchmaking-pip');
  if (!root) return;
  matchmakingPip = pip;
  root.classList.toggle('matchmaking-pip', pip);
  if (!lastMatchmakingCountdownEnd) {
    const cdEl = document.getElementById('match-countdown');
    if (cdEl) cdEl.textContent = pip ? '' : `${getGameRules().minPlayers}人以上で開始カウントダウン`;
  }
  if (btn) {
    btn.setAttribute('aria-pressed', pip ? 'true' : 'false');
    btn.title = pip ? '待機パネルを拡大' : '待機パネルを縮小してワールドを操作';
    btn.setAttribute(
      'aria-label',
      pip ? '待機パネルを拡大して全画面表示' : '待機パネルを縮小してワールドを操作',
    );
  }
  if (iconSlot) iconSlot.innerHTML = pip ? IC.maximize(18) : IC.pip(18);
}

export function initMatchmakingPip(): void {
  const btn = document.getElementById('btn-matchmaking-pip');
  const iconSlot = document.getElementById('icon-matchmaking-pip');
  if (iconSlot) iconSlot.innerHTML = IC.pip(18);
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    setMatchmakingPipMode(!matchmakingPip);
  });
}

export function updateMatchmaking(playerCount: number, countdownEnd: number | null): void {
  lastMatchmakingCountdownEnd = countdownEnd;
  const maxP = getGameRules().maxPlayers;
  const minP = getGameRules().minPlayers;
  const countText = `${playerCount} / ${maxP}`;
  const countEl = document.getElementById('match-count');
  const countPipEl = document.getElementById('match-count-pip');
  const cdEl = document.getElementById('match-countdown');
  const homeBtn = document.getElementById('btn-matchmaking-home') as HTMLButtonElement | null;
  if (countEl) countEl.textContent = countText;
  if (countPipEl) countPipEl.textContent = countText;

  if (matchCountdownInterval != null) {
    window.clearInterval(matchCountdownInterval);
    matchCountdownInterval = null;
  }

  if (countdownEnd && cdEl) {
    matchCountdownInterval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((countdownEnd - Date.now()) / 1000));
      cdEl.textContent = remaining > 0 ? `開始まで ${remaining}秒` : '開始中...';
      if (homeBtn) {
        const lockLastSec = Math.min(10, getGameRules().matchCountdownSec);
        const locked = remaining > 0 && remaining <= lockLastSec;
        homeBtn.disabled = locked;
        homeBtn.style.opacity = locked ? '0.3' : '';
        homeBtn.style.pointerEvents = locked ? 'none' : '';
      }
      if (remaining <= 0 && matchCountdownInterval != null) {
        window.clearInterval(matchCountdownInterval);
        matchCountdownInterval = null;
      }
    }, 200);
  } else if (cdEl) {
    cdEl.textContent = matchmakingPip ? '' : `${minP}人以上で開始カウントダウン`;
    if (homeBtn) {
      homeBtn.disabled = false;
      homeBtn.style.opacity = '';
      homeBtn.style.pointerEvents = '';
    }
  }
}

export function updateMatchmakingPlayers(players: { displayName: string; color: string }[]): void {
  const listEl = document.getElementById('match-player-list');
  if (!listEl) return;
  listEl.innerHTML = players
    .map((p) => {
      const name = p.displayName || 'プレイヤー';
      const dot = `<span class="match-player-dot" style="background:${escapeHtml(p.color || FALLBACK_PLAYER_COLOR)}"></span>`;
      return `<div class="match-player-item">${dot}<span class="match-player-name">${escapeHtml(name)}</span></div>`;
    })
    .join('');
}

// ─── Game HUD ───
let gameTimerInterval: number | null = null;
let playerRole: 'citizen' | 'enemy' = 'citizen';

function clearAgentHintDanmaku(): void {
  document.getElementById('agent-hint-danmaku')?.replaceChildren();
}

export function startGameHud(gameEnd: number, role: string, theme?: string): void {
  playerRole = role === 'enemy' ? 'enemy' : 'citizen';
  showScreen('game-hud');
  clearAgentHintDanmaku();

  const timerEl = document.getElementById('game-timer');
  const badgeEl = document.getElementById('game-role-badge');

  if (badgeEl) {
    const themeText = theme || '周囲を見ながら自由に動こう';
    badgeEl.innerHTML = `${IC.target(15)} <strong>${escapeHtml(themeText)}</strong>`;
    badgeEl.className = 'role-theme';
  }

  if (gameTimerInterval != null) window.clearInterval(gameTimerInterval);
  gameTimerInterval = window.setInterval(() => {
    const remaining = Math.max(0, Math.ceil((gameEnd - Date.now()) / 1000));
    if (timerEl) timerEl.textContent = String(remaining);
    if (remaining <= 0 && gameTimerInterval != null) {
      window.clearInterval(gameTimerInterval);
      gameTimerInterval = null;
    }
  }, 200);
}

/** Agent ヒントをテーマ表示の下へ弾幕のように横スクロールで表示 */
export function showHint(text: string): void {
  const container = document.getElementById('agent-hint-danmaku');
  if (!container || !text.trim()) return;

  const row = document.createElement('div');
  row.className = 'agent-danmaku-row';
  const span = document.createElement('span');
  span.className = 'agent-danmaku-text';
  span.textContent = text;
  row.appendChild(span);
  container.appendChild(row);

  requestAnimationFrame(() => {
    const cw = row.clientWidth;
    const tw = span.offsetWidth;
    if (tw === 0) {
      row.remove();
      return;
    }
    const speedPps = 88;
    const dist = cw + tw;
    const sec = Math.min(28, Math.max(7, dist / speedPps));
    const anim = span.animate(
      [
        { transform: `translateX(${cw}px)` },
        { transform: `translateX(${-tw}px)` },
      ],
      { duration: sec * 1000, easing: 'linear', fill: 'forwards' },
    );
    anim.onfinish = () => {
      row.remove();
    };
  });
}

// ─── Voting ───
let selectedVoteTarget: string | null = null;
/** 「投票する」確定後は変更不可（サーバも重複投票を拒否） */
let voteCommitted = false;
let voteTimerInterval: number | null = null;
let onVoteCallback: ((votedFor: string) => void) | null = null;
/** サーバの voteEnd（Unix ms）に合わせてタイマーを進める */
let voteEndMsRef = 0;
let onVoteExtendRequest: (() => void) | null = null;
/** 延長適用アニメーション用（false→true の遷移だけ再生） */
let voteExtendUsedPreviously = false;

function voteExtendPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 過半数により延長がサーバに適用された直後のフィードバック（カウント横の +10 が一瞬ポップ） */
function triggerVoteExtendAppliedVisual(): void {
  const pop = document.getElementById('vote-extend-pop');
  if (!pop) return;

  const finish = (): void => {
    pop.classList.remove('vote-extend-pop--play');
    pop.setAttribute('hidden', '');
    pop.setAttribute('aria-hidden', 'true');
  };

  pop.removeAttribute('hidden');
  pop.setAttribute('aria-hidden', 'false');
  void pop.offsetWidth;
  pop.classList.add('vote-extend-pop--play');

  const ms = voteExtendPrefersReducedMotion() ? 500 : 750;
  const t = window.setTimeout(finish, ms);
  const onAnimEnd = (ev: AnimationEvent): void => {
    if (ev.target !== pop) return;
    window.clearTimeout(t);
    pop.removeEventListener('animationend', onAnimEnd);
    finish();
  };
  pop.addEventListener('animationend', onAnimEnd);
}

export function setVoteCallback(cb: (votedFor: string) => void): void {
  onVoteCallback = cb;
}

export function setVoteExtendRequestCallback(cb: () => void): void {
  onVoteExtendRequest = cb;
}

function applyVoteUiLocked(votedFor: string): void {
  voteCommitted = true;
  selectedVoteTarget = votedFor;
  const listEl = document.getElementById('vote-list');
  const confirmBtn = document.getElementById('btn-vote-confirm');
  if (listEl) {
    listEl.classList.add('vote-list--locked');
    listEl.setAttribute('aria-disabled', 'true');
    listEl.querySelectorAll('.vote-card').forEach((c) => {
      const el = c as HTMLElement;
      el.classList.toggle('selected', el.dataset.pid === votedFor);
    });
  }
  if (confirmBtn) {
    confirmBtn.classList.remove('active');
    (confirmBtn as HTMLButtonElement).disabled = true;
    confirmBtn.innerHTML = `${IC.check(16)} 投票済み`;
  }
}

/** game_state の votes に自分の票が載ったとき（他端末やブロードキャスト同期用） */
export function applyVoteLockFromServer(votedForTarget: string): void {
  if (voteCommitted) return;
  if (!votedForTarget) return;
  applyVoteUiLocked(votedForTarget);
}

function majorityRequiredClient(n: number): number {
  if (n <= 0) return 1;
  return Math.floor(n / 2) + 1;
}

/** サーバから voteEnd が更新されたとき（延長適用後など） */
export function updateVotingDeadlineFromServer(voteEnd: number): void {
  voteEndMsRef = voteEnd;
}

export function applyVoteExtendServerPayload(
  payload: {
    voteEnd: number;
    voteExtendUsed: boolean;
    requestPlayerIds: string[];
    requiredCount: number;
    roundPlayerCount: number;
  },
  localPlayerId: string,
): void {
  voteEndMsRef = payload.voteEnd;
  const statusEl = document.getElementById('vote-extend-status');
  const btn = document.getElementById('btn-vote-extend') as HTMLButtonElement | null;
  if (!statusEl || !btn) return;

  const justApplied = payload.voteExtendUsed && !voteExtendUsedPreviously;
  voteExtendUsedPreviously = payload.voteExtendUsed;

  if (payload.voteExtendUsed) {
    btn.disabled = true;
    btn.textContent = '時間延長（適用済み）';
    statusEl.textContent = '';
    if (justApplied) triggerVoteExtendAppliedVisual();
    return;
  }

  const req = payload.requestPlayerIds;
  const n = req.length;
  const need = payload.requiredCount;
  if (req.includes(localPlayerId)) {
    btn.disabled = true;
    btn.textContent = '時間延長（賛成済み）';
  } else {
    btn.disabled = false;
    btn.textContent = '時間延長';
  }
  statusEl.textContent = `+10秒延長 ${n}/${need}人`;
}

export function startVoting(
  voteEnd: number,
  players: { playerId: string; color: string; displayName?: string }[],
  localPlayerId: string,
  preview: { template: Group; clips: AnimationClip[] } | null,
): void {
  disposeVotePreviews();
  selectedVoteTarget = null;
  voteCommitted = false;
  showScreen('voting');

  const listEl = document.getElementById('vote-list');
  const confirmBtn = document.getElementById('btn-vote-confirm');
  const timerEl = document.getElementById('vote-timer');

  const others = players.filter((p) => p.playerId !== localPlayerId);

  if (listEl) {
    listEl.classList.remove('vote-list--locked');
    listEl.removeAttribute('aria-disabled');
    listEl.innerHTML = others
      .map(
        (p) => {
          const label = (p.displayName || '').trim() || p.playerId.slice(0, 8);
          const col = p.color || FALLBACK_PLAYER_COLOR;
          return `<div class="vote-card" data-pid="${escapeHtml(p.playerId)}" data-color="${escapeHtml(col)}">
            <div class="vote-preview-mount"></div>
            <div class="vote-name">${escapeHtml(label)}</div>
          </div>`;
        },
      )
      .join('');

    listEl.onclick = (e) => {
      if (voteCommitted) return;
      const card = (e.target as HTMLElement).closest('.vote-card') as HTMLElement | null;
      if (!card) return;
      listEl.querySelectorAll('.vote-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedVoteTarget = card.dataset.pid || null;
      if (confirmBtn) {
        confirmBtn.classList.toggle('active', !!selectedVoteTarget);
        (confirmBtn as HTMLButtonElement).disabled = false;
        confirmBtn.textContent = '投票する';
      }
    };
  }

  if (confirmBtn) {
    (confirmBtn as HTMLButtonElement).disabled = true;
    confirmBtn.textContent = '投票する';
    confirmBtn.classList.remove('active');
    confirmBtn.onclick = () => {
      if (voteCommitted || !selectedVoteTarget || !onVoteCallback) return;
      const target = selectedVoteTarget;
      onVoteCallback(target);
      applyVoteUiLocked(target);
    };
  }

  if (listEl && others.length) {
    if (preview) {
      const mounts = Array.from(listEl.querySelectorAll('.vote-preview-mount')) as HTMLElement[];
      const colors = others.map((p) => p.color || FALLBACK_PLAYER_COLOR);
      mountVotePreviews(mounts, colors, preview.template, preview.clips);
    } else {
      for (const m of listEl.querySelectorAll('.vote-preview-mount')) {
        const card = m.closest('.vote-card');
        const col = (card as HTMLElement)?.dataset.color || FALLBACK_PLAYER_COLOR;
        m.innerHTML = `<div class="vote-preview-fallback" style="background:${col}"></div>`;
      }
    }
  }

  voteExtendUsedPreviously = false;
  const popReset = document.getElementById('vote-extend-pop');
  if (popReset) {
    popReset.classList.remove('vote-extend-pop--play');
    popReset.setAttribute('hidden', '');
    popReset.setAttribute('aria-hidden', 'true');
  }

  voteEndMsRef = voteEnd;
  if (voteTimerInterval != null) window.clearInterval(voteTimerInterval);
  voteTimerInterval = window.setInterval(() => {
    const remaining = Math.max(0, Math.ceil((voteEndMsRef - Date.now()) / 1000));
    if (timerEl) timerEl.textContent = `残り ${remaining}秒`;
    if (remaining <= 0 && voteTimerInterval != null) {
      window.clearInterval(voteTimerInterval);
      voteTimerInterval = null;
    }
  }, 200);

  const need = majorityRequiredClient(players.length);
  applyVoteExtendServerPayload(
    {
      voteEnd,
      voteExtendUsed: false,
      requestPlayerIds: [],
      requiredCount: need,
      roundPlayerCount: players.length,
    },
    localPlayerId,
  );

  const extBtn = document.getElementById('btn-vote-extend') as HTMLButtonElement | null;
  if (extBtn) {
    extBtn.onclick = () => {
      if (onVoteExtendRequest) onVoteExtendRequest();
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Results ───
export function showResults(
  citizensWin: boolean,
  enemyPlayerId: string,
  voteCounts: Record<string, number>,
  role: string,
  enemyColor?: string,
  preview?: { template: Group; clips: AnimationClip[] } | null,
  allyTheme?: string,
  enemyTheme?: string,
): void {
  disposeVotePreviews();

  const resultsRoot = document.getElementById('screen-results');
  resultsRoot?.classList.remove('results-revealed');

  showScreen('results');

  const titleEl = document.getElementById('result-title');
  const allyThemeEl = document.getElementById('result-theme-ally');
  const enemyThemeEl = document.getElementById('result-theme-enemy');
  const enemyEl = document.getElementById('result-enemy');
  const detailEl = document.getElementById('result-detail');
  const previewMount = document.getElementById('result-enemy-preview-mount');

  const allyText = (allyTheme ?? '').trim() || '（記録なし）';
  const enemyText = (enemyTheme ?? '').trim() || '（記録なし）';

  const youWin =
    (citizensWin && role === 'citizen') || (!citizensWin && role === 'enemy');

  if (titleEl) {
    titleEl.innerHTML = youWin
      ? `${IC.trophy(28)} 勝利！`
      : `${IC.skull(28)} 敗北...`;
    titleEl.className = `result-title result-anim ${youWin ? 'result-win' : 'result-lose'}`;
  }

  if (allyThemeEl) {
    allyThemeEl.textContent = allyText;
  }
  if (enemyThemeEl) {
    enemyThemeEl.textContent = enemyText;
  }

  if (enemyEl) {
    const en = escapeHtml(resolveDisplayName(enemyPlayerId));
    enemyEl.innerHTML = `敵ワニは「<span class="result-reveal-enemy-name">${en}</span>」でした`;
  }

  if (detailEl) {
    const outcomeClass = citizensWin ? 'result-outcome result-outcome--citizens' : 'result-outcome result-outcome--enemy';
    const outcomeLabel = citizensWin ? '市民チームの勝利' : '敵ワニの勝利';
    const rows = Object.entries(voteCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([pid, count]) => {
        const isEnemy = pid === enemyPlayerId;
        const name = escapeHtml(resolveDisplayName(pid));
        const nameClass = isEnemy ? 'result-vote-name result-vote-name--enemy' : 'result-vote-name result-vote-name--ally';
        const tagClass = isEnemy ? 'result-vote-tag result-vote-tag--enemy' : 'result-vote-tag result-vote-tag--ally';
        const tagLabel = isEnemy ? '敵' : '市民';
        return `<li class="result-vote-row"><span class="${tagClass}">${tagLabel}</span><span class="${nameClass}">${name}</span><span class="result-vote-count">${count}票</span></li>`;
      })
      .join('');
    detailEl.innerHTML = `
      <div class="${outcomeClass}">${outcomeLabel}</div>
      <p class="result-vote-heading">得票数</p>
      <ul class="result-vote-list">${rows}</ul>`;
  }

  const col = enemyColor?.trim() || FALLBACK_PLAYER_COLOR;
  if (previewMount) {
    if (preview?.template && preview.clips.length) {
      mountVotePreviews([previewMount as HTMLElement], [col], preview.template, preview.clips);
    } else {
      previewMount.innerHTML = `<div class="vote-preview-fallback" style="background:${col}">🐊</div>`;
    }
  }

  void resultsRoot?.offsetWidth;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resultsRoot?.classList.add('results-revealed');
      spawnResultConfetti(youWin);
    });
  });
}

export function getPlayerRole(): string {
  return playerRole;
}
