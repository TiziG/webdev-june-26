// Types shared between server and client. Keep this file free of any
// server-only data (most importantly: lava layouts are never part of the
// client state except in the `won` reveal).

export type Difficulty = 'easy' | 'no-history' | 'no-state' | 'no-context';

export const DIFFICULTIES: { id: Difficulty; label: string; hint: string }[] = [
  { id: 'easy', label: 'Easy', hint: 'Grid, figure and visited tiles of the current attempt are visible' },
  { id: 'no-history', label: 'No history', hint: 'Grid and figure are visible, visited tiles are not highlighted' },
  { id: 'no-state', label: 'No state', hint: 'Figure is only visible until the first move of each attempt' },
  { id: 'no-context', label: 'No context', hint: 'No grid at all — only its dimensions as text' },
];

export type Direction = 'up' | 'down' | 'left' | 'right';

export const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

export type MoveOutcome = 'valid' | 'won' | 'off-board' | 'lava' | 'timeout';

export type Phase = 'lobby' | 'thinking' | 'move-result' | 'won';

export interface Tile {
  x: number; // 0 = left
  y: number; // 0 = bottom
}

export interface PlayerInfo {
  name: string;
  isAdmin: boolean;
  connected: boolean;
}

export interface MapInfo {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface GameConfig {
  mapId: string;
  turnSeconds: number;
  difficulty: Difficulty;
}

export interface LastMove {
  playerName: string;
  direction: Direction | null; // null = the player did not choose in time
  outcome: MoveOutcome;
}

/** The game as a specific client is allowed to see it (difficulty-filtered). */
export interface GameView {
  width: number;
  height: number;
  difficulty: Difficulty;
  turnSeconds: number;
  attempt: number;
  figure: Tile | null;
  steppedTiles: Tile[];
  currentPlayerName: string | null;
  lastMove: LastMove | null;
  /** Epoch ms when the current phase auto-advances (turn deadline / result countdown). */
  phaseEndsAt: number | null;
  phaseDurationMs: number | null;
  /** Only revealed once the game is won. */
  lavaTiles: Tile[] | null;
}

export interface ClientState {
  phase: Phase;
  players: PlayerInfo[];
  maps: MapInfo[];
  serverNow: number;
  game: GameView | null;
}

export type LoginResult =
  | { ok: true; name: string; isAdmin: boolean }
  | { ok: false; error: string };

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface ServerToClientEvents {
  state: (state: ClientState) => void;
  kicked: () => void;
}

export interface ClientToServerEvents {
  login: (name: string, cb: (res: LoginResult) => void) => void;
  move: (direction: Direction) => void;
  'admin:start': (config: GameConfig, cb: (res: ActionResult) => void) => void;
  'admin:end': () => void;
  'admin:kick': (playerName: string) => void;
}
