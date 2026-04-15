<template>
  <div class="game-shell">
    <canvas id="game-canvas" />

    <div id="compass" class="hidden">
      <svg viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="25" fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.3)" stroke-width="1" />
        <g class="compass-needle">
          <polygon points="26,6 22,28 26,25 30,28" fill="#e74c3c" />
          <polygon points="26,46 22,28 26,31 30,28" fill="#ccc" />
        </g>
        <text x="26" y="10" text-anchor="middle" fill="#e74c3c" font-size="7" font-weight="bold">N</text>
      </svg>
    </div>

    <div id="loading">
      <h1>WaniAR</h1>
      <div class="bar"><div id="load-bar" class="bar-fill" /></div>
      <p id="load-text">読み込み中…</p>
    </div>

    <div id="hud"><span id="hud-text" /></div>

    <!-- Home Screen -->
    <div id="screen-home" class="screen-overlay hidden">
      <div class="home-stack">
        <div class="home-title">WaniAR</div>
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
        <div class="matchmaking-pip-bar">
          <span class="matchmaking-pip-hint">縮小するとマップを動かしながら待機できます</span>
          <button
            id="btn-matchmaking-pip"
            type="button"
            class="btn-matchmaking-pip"
            aria-pressed="false"
            title="待機パネルを縮小"
          >
            <span id="icon-matchmaking-pip" class="lucide-slot" aria-hidden="true" />
            <span id="label-matchmaking-pip">縮小表示</span>
          </button>
        </div>
        <div id="match-icon" style="color:#58d68d;" />
        <div class="match-label">プレイヤー待機中</div>
        <div id="match-count" class="match-count">0 / 10</div>
        <div id="match-player-list" />
        <div id="match-countdown" class="match-countdown" />
        <button id="btn-matchmaking-home" type="button">ホームに戻る</button>
      </div>
    </div>

    <!-- Game HUD (transparent overlay) -->
    <div id="screen-game-hud" class="screen-overlay hidden">
      <div id="game-timer">30</div>
      <div id="game-role-badge" />
    </div>
    <div id="hint-popup" role="status" aria-live="polite">
      <div class="hint-popup-card">
        <div class="hint-popup-badge"><span id="hint-icon" aria-hidden="true" /> Agent からの情報</div>
        <p id="hint-popup-body"></p>
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
    <div id="screen-results" class="screen-overlay hidden">
      <div id="result-title" class="result-title" />
      <div id="result-enemy" class="result-enemy" />
      <div id="result-detail" class="result-detail" />
      <button id="btn-back-home" type="button">ホームに戻る</button>
    </div>

    <div id="cam-preview">
      <video id="cam-video" autoplay playsinline muted />
      <canvas id="cam-overlay" />
    </div>

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
