import { io, type Socket } from 'socket.io-client';
import type {
  ClientState,
  ClientToServerEvents,
  Direction,
  GameConfig,
  ServerToClientEvents,
} from '../../shared/types';
import { disposeGameView, renderGame } from './views/game';
import { renderLobby } from './views/lobby';
import { renderLogin } from './views/login';
import './style.css';

const NAME_KEY = 'lava-maze.name';

export interface Session {
  name: string;
  isAdmin: boolean;
}

export interface AppCtx {
  state: ClientState;
  self: Session;
  /** Server-synced clock for countdowns. */
  now: () => number;
  actions: {
    move: (d: Direction) => void;
    start: (c: GameConfig, cb: (error: string | null) => void) => void;
    end: () => void;
    kick: (name: string) => void;
  };
}

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();

let state: ClientState | null = null;
let self: Session | null = null;
let loginError = '';
let serverOffset = 0;

const app = document.getElementById('app')!;
const connBanner = document.getElementById('conn')!;

socket.on('connect', () => {
  connBanner.hidden = true;
  // Reclaim our slot after a reconnect or page reload.
  const saved = self?.name ?? sessionStorage.getItem(NAME_KEY);
  if (saved) doLogin(saved);
});

socket.on('disconnect', () => {
  connBanner.hidden = false;
});

socket.on('state', (s) => {
  state = s;
  serverOffset = s.serverNow - Date.now();
  render();
});

socket.on('kicked', () => {
  sessionStorage.removeItem(NAME_KEY);
  self = null;
  loginError = 'You were removed from the lobby by the admin.';
  render();
});

function doLogin(name: string): void {
  socket.emit('login', name, (res) => {
    if (res.ok) {
      self = { name: res.name, isAdmin: res.isAdmin };
      loginError = '';
      sessionStorage.setItem(NAME_KEY, res.name);
    } else {
      self = null;
      loginError = res.error;
    }
    render();
  });
}

function ctx(): AppCtx {
  return {
    state: state!,
    self: self!,
    now: () => Date.now() + serverOffset,
    actions: {
      move: (d) => socket.emit('move', d),
      start: (c, cb) => socket.emit('admin:start', c, (res) => cb(res.ok ? null : res.error)),
      end: () => socket.emit('admin:end'),
      kick: (name) => socket.emit('admin:kick', name),
    },
  };
}

function render(): void {
  disposeGameView();
  if (!self) {
    renderLogin(app, { error: loginError, onSubmit: doLogin });
    return;
  }
  if (!state) {
    app.dataset.screen = 'loading';
    app.replaceChildren();
    app.append(Object.assign(document.createElement('p'), { className: 'muted center', textContent: 'Connecting…' }));
    return;
  }
  if (state.phase === 'lobby') renderLobby(app, ctx());
  else renderGame(app, ctx());
}

render();
