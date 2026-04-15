<template>
  <div class="game-shell">
    <canvas id="game-canvas" />

    <div id="loading">
      <h1>Motion Dile</h1>
      <div class="bar"><div id="load-bar" class="bar-fill" /></div>
      <p id="load-text">読み込み中…</p>
    </div>

    <!-- Home Screen -->
    <div id="screen-home" class="screen-overlay hidden">
      <div class="home-stack">
        <div class="home-title">Motion Dile</div>
        <div class="home-subtitle">AR ワニ人狼ゲーム</div>
        <div id="home-tut-inline" class="home-tut-inline" aria-label="遊び方（タップで次のページ）" />
        <input
          id="player-name-input"
          class="home-name-input"
          type="text"
          maxlength="16"
          placeholder="なまえをいれてね"
          autocomplete="nickname"
          inputmode="text"
          aria-label="プレイヤー名"
        />
        <div class="home-row-btns">
          <button id="btn-join" type="button" class="home-btn">ゲーム参加</button>
        </div>
      </div>
    </div>

    <!-- Tutorial Screen -->
    <div id="screen-tutorial" class="screen-overlay hidden">
      <div id="tut-content" class="tut-page" />
      <div id="tut-dots" class="tut-dots" />
      <div class="tut-nav">タップで次へ</div>
      <button id="btn-tut-back" class="tut-back-btn" type="button">ホームに戻る</button>
    </div>

    <!-- Matchmaking Screen（縮小表示で PiP 風にワールド操作可能） -->
    <div id="screen-matchmaking" class="screen-overlay hidden">
      <div class="matchmaking-shell">
        <div class="matchmaking-top-row">
          <span id="match-count-pip" class="match-count match-count--pip-inline">0 / 10</span>
          <button
            id="btn-matchmaking-pip"
            type="button"
            class="btn-matchmaking-pip"
            aria-pressed="false"
            aria-label="待機パネルを縮小してワールドを操作"
            title="待機パネルを縮小"
          >
            <span id="icon-matchmaking-pip" class="lucide-slot" aria-hidden="true" />
          </button>
        </div>
        <div id="match-icon" style="color:#58d68d;" />
        <div class="match-label">プレイヤー待機中</div>
        <div id="match-count" class="match-count match-count--hero">0 / 10</div>
        <div id="match-player-list" />
        <div id="match-countdown" class="match-countdown" />
        <button id="btn-matchmaking-home" type="button">ホームに戻る</button>
      </div>
    </div>

    <!-- Game HUD (transparent overlay) -->
    <div id="screen-game-hud" class="screen-overlay hidden">
      <div id="game-timer">30</div>
      <div id="game-hud-banner">
        <div id="game-role-badge" />
        <div id="agent-hint-danmaku" class="agent-hint-danmaku" aria-live="polite" />
      </div>
    </div>

    <!-- Voting Screen -->
    <div id="screen-voting" class="screen-overlay hidden">
      <div class="voting-panel">
        <h2 class="voting-title"><span id="voting-icon" /> 投票タイム</h2>
        <p class="voting-lead">色つきのワニを思い出して、怪しい人に投票しよう</p>
        <div id="vote-timer" class="vote-timer">20</div>
      </div>
      <div id="vote-list" />
      <button id="btn-vote-confirm" type="button">投票する</button>
    </div>

    <!-- Results Screen -->
    <div id="screen-results" class="screen-overlay screen-results-root hidden">
      <div class="result-shell">
        <p class="result-kicker result-anim">試合結果</p>
        <div id="result-title" class="result-title result-anim" />
        <div id="result-themes" class="result-themes">
          <div id="result-theme-ally-card" class="result-theme-card result-anim">
            <span class="result-theme-badge">市民チームのミッション</span>
            <p id="result-theme-ally" class="result-theme-body" />
          </div>
          <div id="result-theme-enemy-card" class="result-theme-card result-anim">
            <span class="result-theme-badge result-theme-badge-enemy">敵ワニのミッション</span>
            <p id="result-theme-enemy" class="result-theme-body" />
          </div>
        </div>
        <div class="result-enemy-block result-anim">
          <div
            id="result-enemy-preview-mount"
            class="vote-preview-mount result-enemy-preview-mount"
            aria-hidden="true"
          />
          <div id="result-enemy" class="result-enemy" />
        </div>
        <div id="result-detail" class="result-detail result-anim" />
        <button id="btn-back-home" type="button" class="result-btn-home result-anim">ホームに戻る</button>
      </div>
    </div>

    <div id="game-compass" class="game-compass hidden" aria-hidden="true">
      <svg viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="25" fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
        <g class="compass-needle">
          <polygon points="26,6 22,28 26,25 30,28" fill="#e74c3c" />
          <polygon points="26,46 22,28 26,31 30,28" fill="#ccc" />
        </g>
        <text x="26" y="10" text-anchor="middle" fill="#e74c3c" font-size="7" font-weight="bold">N</text>
      </svg>
    </div>

    <div id="cam-preview">
      <video id="cam-video" autoplay playsinline muted />
      <canvas id="cam-overlay" />
    </div>

    <button
      id="btn-ui-layout"
      type="button"
      class="btn-ui-layout"
      aria-pressed="false"
      aria-label="操作UIを左右反転（右ジョイスティック・左上カメラ）"
      title="左右反転"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3" />
        <path d="M16 21h3a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3" />
        <line x1="12" x2="12" y1="3" y2="21" />
      </svg>
    </button>

    <button id="look-reset-btn" type="button" aria-label="視点リセット">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>

    <div id="joystick-zone">
      <div id="joystick-run-ring" aria-hidden="true" />
      <div id="joystick-base" />
      <div id="joystick-thumb" />
    </div>
  </div>
</template>

<script setup lang="ts">
import './styles/app.css';
</script>
