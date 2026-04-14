import type { AnimationClip, Group } from 'three';
import { getEl } from './utils';
import { FLAT_WORLD_MODE } from './config';
import { mountVotePreviews, disposeVotePreviews } from './vote-previews';
import { resolveDisplayName } from './player-names';
import { IC } from './icons';

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
  ? 'ジャンプ：画面の空いている所を<strong>素早く2回タップ</strong>'
  : '（このマップではジャンプはありません）';

const tutorialPagesHtml: string[] = [
  `
  <h2>${IC.gamepad(22)} 歩く・走る</h2>
  <p class="tut-lead">左下の丸いコントローラーがジョイスティックです</p>
  <div class="tut-demo tut-demo-joystick" aria-hidden="true">
    <div class="tut-run-ring"></div>
    <div class="tut-joy-base"></div>
    <div class="tut-joy-thumb"></div>
  </div>
  <p class="tut-body">指で<strong>なぞって</strong>ワニを動かそう。<br>外側のリングまで<strong>大きく倒す</strong>とダッシュ！</p>
  `,
  `
  <h2>${IC.eye(22)} 見まわす</h2>
  <p class="tut-lead">左の丸いボタンでカメラを正面に戻せるよ</p>
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
  <p class="tut-body">口の開き：<strong>カメラに手をかざして開閉する</strong></p>
  <p class="tut-body">顎の操作：<strong>カメラに手をかざして上下左右に動かす</strong></p>
  `,
  `
  <h2>${IC.swords(22)} ゲームのルール</h2>
  <p class="tut-body">プレイヤーの中に<strong>敵ワニが1匹</strong>います。<br>30秒のあいだに<strong>見た目や動き</strong>を覚えて、投票で当てよう！</p>
  `,
  `
  <h2>${IC.search(22)} Agentのヒント</h2>
  <p class="tut-body">10秒ごとに<strong>Agent</strong>から、敵ワニの<strong>だいたいの場所</strong>や<strong>歩き／走り</strong>のヒントが届くよ。</p>
  `,
  `
  <h2>${IC.vote(22)} 投票</h2>
  <p class="tut-body">ゲームが終わったら<strong>ワニの見た目</strong>を思い出して投票！いちばん票を集めた人が本当の敵ワニなら<strong>市民チームの勝ち</strong>！</p>
  `,
];

let tutPage = 0;

function advanceTutorialPage(): void {
  tutPage = (tutPage + 1) % tutorialPagesHtml.length;
}

function renderHomeTutorialInline(): void {
  const el = document.getElementById('home-tut-inline');
  if (!el) return;
  const html = tutorialPagesHtml[tutPage] ?? '';
  const n = tutorialPagesHtml.length;
  const dots = tutorialPagesHtml
    .map((_, i) => `<div class="tut-dot${i === tutPage ? ' active' : ''}"></div>`)
    .join('');
  el.innerHTML = `
    <div class="home-tut-tap-area tut-panel home-tut-panel" role="button" tabindex="0" aria-label="遊び方 ${tutPage + 1} / ${n}。タップで次のページへ">
      <div class="tut-page-inner">${html}</div>
      <div class="home-tut-footer">
        <div class="tut-dots home-tut-dots">${dots}</div>
        <p class="home-tut-hint">タップで次へ</p>
      </div>
    </div>`;
}

export function initTutorial(): void {
  const contentEl = getEl<HTMLElement>('tut-content');
  const dotsEl = getEl<HTMLElement>('tut-dots');
  const tutScreen = getEl<HTMLElement>('screen-tutorial');
  const homeTutEl = document.getElementById('home-tut-inline');

  function render() {
    const pageHtml = tutorialPagesHtml[tutPage] ?? '';
    contentEl.innerHTML = `<div class="tut-panel"><div class="tut-page-inner">${pageHtml}</div></div>`;
    dotsEl.innerHTML = tutorialPagesHtml
      .map((_, i) => `<div class="tut-dot${i === tutPage ? ' active' : ''}"></div>`)
      .join('');
    renderHomeTutorialInline();
  }

  tutScreen.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.id === 'btn-tut-back' || target.closest('#btn-tut-back')) return;
    advanceTutorialPage();
    render();
  });

  getEl<HTMLElement>('btn-tut-back').addEventListener('click', (e) => {
    e.stopPropagation();
    tutPage = 0;
    showScreen('home');
    render();
  });

  if (homeTutEl) {
    homeTutEl.addEventListener('click', () => {
      advanceTutorialPage();
      render();
    });
  }

  render();
}

// ─── Matchmaking ───
let matchCountdownInterval: number | null = null;
let matchmakingPip = false;

/** 待機画面を PiP 風に縮小（背景透過・ゲーム操作可能） */
export function setMatchmakingPipMode(pip: boolean): void {
  const root = document.getElementById('screen-matchmaking');
  const btn = document.getElementById('btn-matchmaking-pip') as HTMLButtonElement | null;
  const label = document.getElementById('label-matchmaking-pip');
  const iconSlot = document.getElementById('icon-matchmaking-pip');
  if (!root) return;
  matchmakingPip = pip;
  root.classList.toggle('matchmaking-pip', pip);
  if (btn) {
    btn.setAttribute('aria-pressed', pip ? 'true' : 'false');
    btn.title = pip ? '待機パネルを拡大' : '待機パネルを縮小してワールドを操作';
  }
  if (label) label.textContent = pip ? '拡大表示' : '縮小表示';
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
  const countEl = document.getElementById('match-count');
  const cdEl = document.getElementById('match-countdown');
  const homeBtn = document.getElementById('btn-matchmaking-home') as HTMLButtonElement | null;
  if (countEl) countEl.textContent = `${playerCount} / 10`;

  if (matchCountdownInterval != null) {
    window.clearInterval(matchCountdownInterval);
    matchCountdownInterval = null;
  }

  if (countdownEnd && cdEl) {
    matchCountdownInterval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((countdownEnd - Date.now()) / 1000));
      cdEl.textContent = remaining > 0 ? `開始まで ${remaining}秒` : '開始中...';
      if (homeBtn) {
        const locked = remaining > 0 && remaining <= 10;
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
    cdEl.textContent = '3人以上で開始カウントダウン';
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
      const dot = `<span class="match-player-dot" style="background:${escapeHtml(p.color || '#58a6ff')}"></span>`;
      return `<div class="match-player-item">${dot}<span class="match-player-name">${escapeHtml(name)}</span></div>`;
    })
    .join('');
}

// ─── Game HUD ───
let gameTimerInterval: number | null = null;
let playerRole: 'citizen' | 'enemy' = 'citizen';

export function startGameHud(gameEnd: number, role: string): void {
  playerRole = role === 'enemy' ? 'enemy' : 'citizen';
  showScreen('game-hud');

  const timerEl = document.getElementById('game-timer');
  const badgeEl = document.getElementById('game-role-badge');

  if (badgeEl) {
    if (playerRole === 'enemy') {
      badgeEl.innerHTML = `${IC.shieldAlert(18)} あなたは敵ワニ！バレないように行動せよ`;
      badgeEl.className = 'role-enemy';
    } else {
      badgeEl.innerHTML = `${IC.user(18)} あなたは市民。敵ワニを見つけろ！`;
      badgeEl.className = 'role-citizen';
    }
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

export function showHint(text: string): void {
  const popup = document.getElementById('hint-popup');
  const body = document.getElementById('hint-popup-body');
  if (!popup) return;
  if (body) body.textContent = text;
  popup.classList.add('visible');
  setTimeout(() => popup.classList.remove('visible'), 4500);
}

// ─── Voting ───
let selectedVoteTarget: string | null = null;
let voteTimerInterval: number | null = null;
let onVoteCallback: ((votedFor: string) => void) | null = null;

export function setVoteCallback(cb: (votedFor: string) => void): void {
  onVoteCallback = cb;
}

export function startVoting(
  voteEnd: number,
  players: { playerId: string; color: string; displayName?: string }[],
  localPlayerId: string,
  preview: { template: Group; clips: AnimationClip[] } | null,
): void {
  disposeVotePreviews();
  selectedVoteTarget = null;
  showScreen('voting');

  const listEl = document.getElementById('vote-list');
  const confirmBtn = document.getElementById('btn-vote-confirm');
  const timerEl = document.getElementById('vote-timer');

  const others = players.filter((p) => p.playerId !== localPlayerId);

  if (listEl) {
    listEl.innerHTML = others
      .map(
        (p) => {
          const label = (p.displayName || '').trim() || p.playerId.slice(0, 8);
          const col = p.color || '#58a6ff';
          return `<div class="vote-card" data-pid="${p.playerId}" data-color="${col}">
            <div class="vote-preview-mount"></div>
            <div class="vote-name">${escapeHtml(label)}</div>
          </div>`;
        },
      )
      .join('');

    listEl.onclick = (e) => {
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
      if (selectedVoteTarget && onVoteCallback) {
        onVoteCallback(selectedVoteTarget);
        confirmBtn.classList.remove('active');
        (confirmBtn as HTMLButtonElement).disabled = true;
        confirmBtn.innerHTML = `${IC.check(16)} 投票済み`;
      }
    };
  }

  if (listEl && others.length) {
    if (preview) {
      const mounts = Array.from(listEl.querySelectorAll('.vote-preview-mount')) as HTMLElement[];
      const colors = others.map((p) => p.color || '#58a6ff');
      mountVotePreviews(mounts, colors, preview.template, preview.clips);
    } else {
      for (const m of listEl.querySelectorAll('.vote-preview-mount')) {
        const card = m.closest('.vote-card');
        const col = (card as HTMLElement)?.dataset.color || '#58a6ff';
        m.innerHTML = `<div class="vote-preview-fallback" style="background:${col}"></div>`;
      }
    }
  }

  if (voteTimerInterval != null) window.clearInterval(voteTimerInterval);
  voteTimerInterval = window.setInterval(() => {
    const remaining = Math.max(0, Math.ceil((voteEnd - Date.now()) / 1000));
    if (timerEl) timerEl.textContent = `残り ${remaining}秒`;
    if (remaining <= 0 && voteTimerInterval != null) {
      window.clearInterval(voteTimerInterval);
      voteTimerInterval = null;
    }
  }, 200);
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
): void {
  disposeVotePreviews();
  showScreen('results');

  const titleEl = document.getElementById('result-title');
  const enemyEl = document.getElementById('result-enemy');
  const detailEl = document.getElementById('result-detail');

  const youWin =
    (citizensWin && role === 'citizen') || (!citizensWin && role === 'enemy');

  if (titleEl) {
    titleEl.innerHTML = youWin
      ? `${IC.trophy(28)} 勝利！`
      : `${IC.skull(28)} 敗北...`;
    titleEl.className = `result-title ${youWin ? 'result-win' : 'result-lose'}`;
  }

  if (enemyEl) {
    enemyEl.textContent = `敵ワニは「${resolveDisplayName(enemyPlayerId)}」でした`;
  }

  if (detailEl) {
    const lines = Object.entries(voteCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([pid, count]) =>
        `${resolveDisplayName(pid)}: ${count}票${pid === enemyPlayerId ? ' ← 敵ワニ' : ''}`)
      .join('\n');
    detailEl.innerHTML = `<strong>${citizensWin ? '市民チームの勝利！' : '敵ワニの勝利！'}</strong><br><br>${lines.replace(/\n/g, '<br>')}`;
  }
}

export function getPlayerRole(): string {
  return playerRole;
}
