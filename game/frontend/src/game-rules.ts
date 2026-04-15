import { GAME_RULES } from './config';

export type GameRulesState = {
  maxPlayers: number;
  minPlayers: number;
  gameDurationSec: number;
  matchCountdownSec: number;
  voteDurationSec: number;
  hintIntervalSec: number;
  resultDurationSec: number;
};

let state: GameRulesState = { ...GAME_RULES };

/** ビルド時の既定に戻す（起動時に一度呼ぶ） */
export function resetGameRulesFromConfig(): void {
  state = { ...GAME_RULES };
}

/** WebSocket `game_state.rules` でサーバと同期 */
export function applyServerGameRules(rules: Partial<GameRulesState> | undefined): void {
  if (!rules || typeof rules !== 'object') return;
  const next = { ...state };
  const n = (k: keyof GameRulesState, v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1) next[k] = Math.floor(v);
  };
  n('maxPlayers', rules.maxPlayers);
  n('minPlayers', rules.minPlayers);
  n('gameDurationSec', rules.gameDurationSec);
  n('matchCountdownSec', rules.matchCountdownSec);
  n('voteDurationSec', rules.voteDurationSec);
  n('hintIntervalSec', rules.hintIntervalSec);
  n('resultDurationSec', rules.resultDurationSec);
  if (next.minPlayers > next.maxPlayers) {
    next.maxPlayers = next.minPlayers;
  }
  state = next;
}

export function getGameRules(): Readonly<GameRulesState> {
  return state;
}
