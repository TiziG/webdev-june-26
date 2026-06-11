/**
 * Manual-testing helper: `tsx test/bot.ts alice` joins as a player that moves
 * "right" 6s after its turn starts; `tsx test/bot.ts adminstart` joins as the
 * admin and starts a warmup game as soon as a player is in the lobby.
 */
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';

const role = process.argv[2] ?? 'alice';
const URL = process.env.SMOKE_URL ?? 'http://localhost:8080';
const s: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL);

if (role === 'alice') {
  s.on('connect', () => s.emit('login', 'Alice', (r) => console.log('login:', JSON.stringify(r))));
  let lastTurn: number | null = null;
  s.on('state', (st) => {
    if (st.phase === 'thinking' && st.game?.currentPlayerName === 'Alice' && st.game.phaseEndsAt !== lastTurn) {
      lastTurn = st.game.phaseEndsAt;
      console.log('my turn — moving right in 6s');
      setTimeout(() => s.emit('move', 'right'), 6000);
    }
  });
} else {
  s.on('connect', () => s.emit('login', 'admin', (r) => console.log('login:', JSON.stringify(r))));
  let started = false;
  s.on('state', (st) => {
    if (!started && st.phase === 'lobby' && st.players.some((p) => !p.isAdmin && p.connected)) {
      started = true;
      setTimeout(
        () =>
          s.emit('admin:start', { mapId: 'warmup', turnSeconds: 20, difficulty: 'easy' }, (r) =>
            console.log('start:', JSON.stringify(r)),
          ),
        1000,
      );
    }
  });
}
