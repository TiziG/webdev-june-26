import type {
  ActionResult,
  ClientState,
  Difficulty,
  Direction,
  GameConfig,
  GameView,
  LastMove,
  LoginResult,
  MoveOutcome,
  RankingEntry,
  Tile,
} from '../../shared/types.js';
import { DIFFICULTIES, DIRECTIONS } from '../../shared/types.js';
import { MAPS, tileKey, type GameMap } from './maps.js';

const RESULT_VALID_MS = 5_000;
const RESULT_INVALID_MS = 10_000;
const MIN_TURN_SECONDS = 3;
const MAX_TURN_SECONDS = 1200;
const MAX_NAME_LENGTH = 16;

const DELTAS: Record<Direction, Tile> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

interface Player {
  /** Normalized (lowercase) name, used as identity so reconnects reclaim the slot. */
  key: string;
  displayName: string;
  isAdmin: boolean;
  socketId: string | null;
}

interface ActiveGame {
  map: GameMap;
  config: GameConfig;
  phase: 'thinking' | 'move-result' | 'won';
  figure: Tile;
  stepped: Tile[];
  attempt: number;
  currentPlayer: string | null; // player key
  lastMove: LastMove | null;
  /** Lava tiles hit in any attempt of this game — stepping into these again is avoidable. */
  discoveredLava: Set<string>;
  /** Avoidable mistakes per player key. */
  mistakes: Map<string, number>;
  phaseEndsAt: number | null;
  phaseDurationMs: number | null;
  timer: NodeJS.Timeout | null;
}

export interface RoomHooks {
  /** Called after every state mutation; wire this to a broadcast. */
  onChange: () => void;
  /** Called when a player got kicked, with their socket id (if connected). */
  onKicked: (socketId: string) => void;
}

export class GameRoom {
  private readonly adminKey: string;
  private readonly hooks: RoomHooks;
  private readonly players = new Map<string, Player>();
  private readonly bySocket = new Map<string, string>();
  private game: ActiveGame | null = null;

  constructor(adminName: string, hooks: RoomHooks) {
    this.adminKey = adminName.trim().toLowerCase();
    this.hooks = hooks;
  }

  login(socketId: string, rawName: string): LoginResult {
    const displayName = rawName.trim().replace(/\s+/g, ' ');
    if (displayName.length < 1 || displayName.length > MAX_NAME_LENGTH) {
      return { ok: false, error: `Name must be 1–${MAX_NAME_LENGTH} characters` };
    }
    const key = displayName.toLowerCase();
    const existing = this.players.get(key);
    if (existing?.socketId) {
      return { ok: false, error: 'This name is already taken' };
    }

    // Drop a previous identity of this socket (e.g. login screen re-submitted).
    this.detachSocket(socketId);

    const player: Player = existing ?? {
      key,
      displayName,
      isAdmin: key === this.adminKey,
      socketId: null,
    };
    player.socketId = socketId;
    this.players.set(key, player);
    this.bySocket.set(socketId, key);
    this.hooks.onChange();
    return { ok: true, name: player.displayName, isAdmin: player.isAdmin };
  }

  disconnect(socketId: string): void {
    if (this.detachSocket(socketId)) this.hooks.onChange();
    // If the disconnected player is the current player, the turn timer simply
    // runs out (failed attempt) — the admin can kick them to free the rotation.
  }

  move(socketId: string, direction: Direction): void {
    const g = this.game;
    const key = this.bySocket.get(socketId);
    if (!g || g.phase !== 'thinking' || !key || key !== g.currentPlayer) return;
    if (!DIRECTIONS.includes(direction)) return;
    this.resolveMove(direction);
  }

  startGame(socketId: string, config: GameConfig): ActionResult {
    if (!this.isAdmin(socketId)) return { ok: false, error: 'Only the admin can start the game' };
    if (this.game) return { ok: false, error: 'A game is already running' };

    const map = MAPS.find((m) => m.id === config?.mapId);
    const turnSeconds = Math.floor(Number(config?.turnSeconds));
    const difficulty = config?.difficulty as Difficulty;
    if (!map) return { ok: false, error: 'Unknown map' };
    if (!Number.isFinite(turnSeconds) || turnSeconds < MIN_TURN_SECONDS || turnSeconds > MAX_TURN_SECONDS) {
      return { ok: false, error: `Turn time must be ${MIN_TURN_SECONDS}–${MAX_TURN_SECONDS} seconds` };
    }
    if (!DIFFICULTIES.some((d) => d.id === difficulty)) return { ok: false, error: 'Unknown difficulty' };
    if (this.candidates().length === 0) return { ok: false, error: 'No players in the lobby yet' };

    this.game = {
      map,
      config: { mapId: map.id, turnSeconds, difficulty },
      phase: 'thinking',
      figure: { x: 0, y: 0 },
      stepped: [{ x: 0, y: 0 }],
      attempt: 1,
      currentPlayer: null,
      lastMove: null,
      discoveredLava: new Set(),
      mistakes: new Map(),
      phaseEndsAt: null,
      phaseDurationMs: null,
      timer: null,
    };
    this.startThinking();
    return { ok: true };
  }

  endGame(socketId: string): void {
    if (!this.isAdmin(socketId) || !this.game) return;
    this.clearTimer();
    this.game = null;
    this.hooks.onChange();
  }

  kick(socketId: string, targetName: string): void {
    if (!this.isAdmin(socketId)) return;
    const key = String(targetName).trim().toLowerCase();
    const target = this.players.get(key);
    if (!target || target.isAdmin) return;

    this.players.delete(key);
    if (target.socketId) {
      this.bySocket.delete(target.socketId);
      this.hooks.onKicked(target.socketId);
    }

    const g = this.game;
    if (g && g.currentPlayer === key && g.phase === 'thinking') {
      // Don't punish the team for removing a stuck player: re-pick and restart
      // the turn instead of failing the attempt.
      this.clearTimer();
      this.startThinking();
    } else {
      this.hooks.onChange();
    }
  }

  clientState(): ClientState {
    return {
      phase: this.game ? this.game.phase : 'lobby',
      players: [...this.players.values()]
        .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.displayName.localeCompare(b.displayName))
        .map((p) => ({ name: p.displayName, isAdmin: p.isAdmin, connected: p.socketId !== null })),
      maps: MAPS.map((m) => ({ id: m.id, name: m.name, width: m.width, height: m.height })),
      serverNow: Date.now(),
      game: this.game ? this.gameView() : null,
    };
  }

  // --- internals ---------------------------------------------------------

  private gameView(): GameView {
    const g = this.game!;
    const d = g.config.difficulty;
    const revealed = g.phase === 'won';
    const movedThisAttempt = g.stepped.length > 1;
    const showFigure = revealed || d === 'easy' || d === 'no-history' || (d === 'no-state' && !movedThisAttempt);
    const showStepped = revealed || d === 'easy';

    let figure = showFigure ? { ...g.figure } : null;
    let lavaTiles: Tile[] | null = null;
    if (revealed) {
      lavaTiles = [...g.map.lava].map((k) => {
        const [x, y] = k.split(',').map(Number);
        return { x, y };
      });
    } else if (
      g.phase === 'move-result' &&
      g.lastMove?.outcome === 'lava' &&
      g.lastMove.direction !== null &&
      (d === 'easy' || d === 'no-history')
    ) {
      // Show the lava tile that was just stepped on, with the figure on it,
      // for the duration of the move-result phase only. g.figure is still the
      // pre-move position, so the stepped-on tile is one move in lastMove's
      // direction.
      const delta = DELTAS[g.lastMove.direction];
      const hit = { x: g.figure.x + delta.x, y: g.figure.y + delta.y };
      lavaTiles = [hit];
      figure = hit;
    }

    return {
      width: g.map.width,
      height: g.map.height,
      difficulty: d,
      turnSeconds: g.config.turnSeconds,
      attempt: g.attempt,
      figure,
      steppedTiles: showStepped ? g.stepped.map((t) => ({ ...t })) : [],
      currentPlayerName: g.currentPlayer ? (this.players.get(g.currentPlayer)?.displayName ?? null) : null,
      lastMove: g.lastMove,
      phaseEndsAt: g.phaseEndsAt,
      phaseDurationMs: g.phaseDurationMs,
      lavaTiles,
      ranking: revealed ? this.buildRanking() : null,
    };
  }

  private buildRanking(): RankingEntry[] {
    const g = this.game!;
    return this.candidates()
      .map((p) => ({ name: p.displayName, mistakes: g.mistakes.get(p.key) ?? 0 }))
      .sort((a, b) => a.mistakes - b.mistakes || a.name.localeCompare(b.name));
  }

  private candidates(): Player[] {
    // Everyone in the lobby except the admin takes part in the rotation,
    // disconnected players included — the admin kicks them if the group is stuck.
    return [...this.players.values()].filter((p) => !p.isAdmin);
  }

  private startThinking(): void {
    const g = this.game;
    if (!g) return;
    const candidates = this.candidates();
    if (candidates.length === 0) {
      // Everyone got kicked — nothing left to play, return to lobby.
      this.game = null;
      this.hooks.onChange();
      return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const ms = g.config.turnSeconds * 1000;
    g.phase = 'thinking';
    g.currentPlayer = pick.key;
    g.phaseEndsAt = Date.now() + ms;
    g.phaseDurationMs = ms;
    g.timer = setTimeout(() => this.resolveMove(null), ms);
    this.hooks.onChange();
  }

  /** direction === null means the turn timer expired. */
  private resolveMove(direction: Direction | null): void {
    const g = this.game;
    if (!g || g.phase !== 'thinking') return;
    this.clearTimer();

    const moverKey = g.currentPlayer;
    const moverName = (moverKey && this.players.get(moverKey)?.displayName) || 'Someone';
    const addMistake = () => {
      if (moverKey) g.mistakes.set(moverKey, (g.mistakes.get(moverKey) ?? 0) + 1);
    };
    let outcome: MoveOutcome;
    if (direction === null) {
      outcome = 'timeout';
    } else {
      const target = { x: g.figure.x + DELTAS[direction].x, y: g.figure.y + DELTAS[direction].y };
      if (target.x < 0 || target.y < 0 || target.x >= g.map.width || target.y >= g.map.height) {
        outcome = 'off-board';
        addMistake(); // leaving the board is always avoidable
      } else if (g.map.lava.has(tileKey(target))) {
        outcome = 'lava';
        // Only lava the group already discovered in an earlier attempt counts
        // as avoidable; first contact is legitimate exploration.
        if (g.discoveredLava.has(tileKey(target))) addMistake();
        else g.discoveredLava.add(tileKey(target));
      } else {
        g.figure = target;
        g.stepped.push(target);
        outcome = target.x === g.map.width - 1 && target.y === g.map.height - 1 ? 'won' : 'valid';
      }
    }

    g.lastMove = { playerName: moverName, direction, outcome };
    g.currentPlayer = null;

    if (outcome === 'won') {
      g.phase = 'won';
      g.phaseEndsAt = null;
      g.phaseDurationMs = null;
    } else {
      const ms = outcome === 'valid' ? RESULT_VALID_MS : RESULT_INVALID_MS;
      g.phase = 'move-result';
      g.phaseEndsAt = Date.now() + ms;
      g.phaseDurationMs = ms;
      g.timer = setTimeout(() => {
        if (outcome !== 'valid') {
          // Failed attempt: figure returns to start, history resets.
          g.figure = { x: 0, y: 0 };
          g.stepped = [{ x: 0, y: 0 }];
          g.attempt += 1;
        }
        this.startThinking();
      }, ms);
    }
    this.hooks.onChange();
  }

  private isAdmin(socketId: string): boolean {
    const key = this.bySocket.get(socketId);
    return key !== undefined && this.players.get(key)?.isAdmin === true;
  }

  private detachSocket(socketId: string): boolean {
    const key = this.bySocket.get(socketId);
    if (key === undefined) return false;
    this.bySocket.delete(socketId);
    const player = this.players.get(key);
    if (player && player.socketId === socketId) player.socketId = null;
    return true;
  }

  private clearTimer(): void {
    if (this.game?.timer) {
      clearTimeout(this.game.timer);
      this.game.timer = null;
    }
  }
}
