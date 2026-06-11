/**
 * End-to-end smoke test against a running server (default http://localhost:8080).
 * Plays a full game over real sockets with real timings, so it takes ~1 minute.
 *
 *   npm run dev:server   (or npm start after a build)
 *   npm run smoke
 */
import { io, type Socket } from 'socket.io-client';
import type {
  ClientState,
  ClientToServerEvents,
  Direction,
  LoginResult,
  MoveOutcome,
  ServerToClientEvents,
} from '../shared/types.js';

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;

const URL = process.env.SMOKE_URL ?? 'http://localhost:8080';
const latest = new Map<Sock, ClientState>();
const waiters = new Set<() => void>();
const socksByName = new Map<string, Sock>();
let lavaLeak: string | null = null;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function connect(): Sock {
  const s: Sock = io(URL, { forceNew: true });
  s.on('state', (st) => {
    latest.set(s, st);
    if (st.game && st.game.lavaTiles !== null && st.phase !== 'won') {
      // The only legitimate pre-win reveal: the single just-stepped-on lava
      // tile during a lava move-result in easy/no-history mode.
      const legit =
        st.phase === 'move-result' &&
        st.game.lastMove?.outcome === 'lava' &&
        (st.game.difficulty === 'easy' || st.game.difficulty === 'no-history') &&
        st.game.lavaTiles.length === 1;
      if (!legit) lavaLeak = `lava leaked to clients in phase ${st.phase} (${st.game.lavaTiles.length} tiles)`;
    }
    for (const w of [...waiters]) w();
  });
  return s;
}

function login(s: Sock, name: string): Promise<LoginResult> {
  return new Promise((resolve) => s.emit('login', name, resolve));
}

function waitFor(s: Sock, pred: (st: ClientState) => boolean, what: string, timeoutMs = 15_000): Promise<ClientState> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const st = latest.get(s);
      if (st && pred(st)) {
        waiters.delete(check);
        clearTimeout(t);
        resolve(st);
      }
    };
    const t = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(`TIMEOUT waiting for: ${what}`));
    }, timeoutMs);
    waiters.add(check);
    check();
  });
}

const ok = (msg: string) => console.log(`  ✓ ${msg}`);

async function playMove(admin: Sock, dir: Direction, expected: MoveOutcome): Promise<string> {
  const st = await waitFor(admin, (s) => s.phase === 'thinking', 'thinking phase');
  const current = st.game!.currentPlayerName!;
  const sock = socksByName.get(current.toLowerCase());
  assert(sock, `current player ${current} has a socket`);
  sock.emit('move', dir);
  const after = await waitFor(admin, (s) => s.phase === 'move-result' || s.phase === 'won', 'move result');
  const lm = after.game!.lastMove!;
  assert(lm.outcome === expected, `move ${dir}: expected ${expected}, got ${lm.outcome}`);
  assert(lm.direction === dir, `lastMove.direction is ${dir}`);
  ok(`${current} moved ${dir} → ${expected}`);
  return current;
}

async function main(): Promise<void> {
  console.log(`smoke test against ${URL}`);

  // --- login -------------------------------------------------------------
  const admin = connect();
  const alice = connect();
  const bob = connect();

  const adminRes = await login(admin, 'admin');
  assert(adminRes.ok && adminRes.isAdmin, 'admin login recognized as admin');
  const aliceRes = await login(alice, 'Alice');
  assert(aliceRes.ok && !aliceRes.isAdmin, 'Alice logs in as normal player');
  const bobRes = await login(bob, 'Bob');
  assert(bobRes.ok, 'Bob logs in');
  socksByName.set('alice', alice).set('bob', bob);
  ok('admin + 2 players logged in');

  const dupe = connect();
  const dupeRes = await login(dupe, 'alice');
  assert(!dupeRes.ok, 'duplicate name rejected');
  dupe.disconnect();
  ok('duplicate username rejected');

  await waitFor(admin, (s) => s.players.length === 3, '3 players in lobby');

  // --- config validation ---------------------------------------------------
  const bad = await new Promise<{ ok: boolean }>((resolve) =>
    admin.emit('admin:start', { mapId: 'warmup', turnSeconds: 1, difficulty: 'easy' }, resolve),
  );
  assert(!bad.ok, 'turnSeconds=1 rejected');
  const notAdmin = await new Promise<{ ok: boolean }>((resolve) =>
    alice.emit('admin:start', { mapId: 'warmup', turnSeconds: 5, difficulty: 'easy' }, resolve),
  );
  assert(!notAdmin.ok, 'non-admin cannot start');
  ok('config + permission validation works');

  // --- game on the warmup map (3×4) ---------------------------------------
  // Layout (top first):  .LG / ... / L.. / S.L
  const started = await new Promise<{ ok: boolean }>((resolve) =>
    admin.emit('admin:start', { mapId: 'warmup', turnSeconds: 4, difficulty: 'easy' }, resolve),
  );
  assert(started.ok, 'game starts');
  let st = await waitFor(admin, (s) => s.phase === 'thinking', 'first thinking phase');
  assert(st.game!.figure!.x === 0 && st.game!.figure!.y === 0, 'figure starts bottom-left');
  assert(st.game!.attempt === 1, 'attempt 1');
  ok('game started, figure at start');

  // Expected avoidable mistakes per player (off-board + repeated lava only).
  const expectedMistakes = new Map<string, number>([
    ['Alice', 0],
    ['Bob', 0],
  ]);
  const bump = (name: string) => expectedMistakes.set(name, expectedMistakes.get(name)! + 1);

  bump(await playMove(admin, 'left', 'off-board')); // off the board: always avoidable
  st = await waitFor(admin, (s) => s.phase === 'thinking' && s.game!.attempt === 2, 'attempt 2 after off-board');
  assert(st.game!.figure!.x === 0 && st.game!.figure!.y === 0, 'figure reset to start');
  ok('failed attempt resets the figure (10s)');

  await playMove(admin, 'right', 'valid');
  await playMove(admin, 'right', 'lava'); // (2,0): first lava contact, NOT avoidable
  st = latest.get(admin)!;
  assert(st.game!.lavaTiles?.length === 1 && st.game!.lavaTiles[0].x === 2 && st.game!.lavaTiles[0].y === 0, 'stepped-on lava tile revealed during result');
  assert(st.game!.figure?.x === 2 && st.game!.figure?.y === 0, 'figure shown on the lava tile during result');
  st = await waitFor(admin, (s) => s.phase === 'thinking' && s.game!.attempt === 3, 'attempt 3 after lava');
  assert(st.game!.lavaTiles === null, 'lava hidden again when next attempt starts');
  ok('lava step revealed during result, hidden afterwards');

  await playMove(admin, 'right', 'valid');
  bump(await playMove(admin, 'right', 'lava')); // same lava tile again: avoidable
  st = await waitFor(admin, (s) => s.phase === 'thinking' && s.game!.attempt === 4, 'attempt 4');
  ok('repeated lava counted as avoidable mistake');

  // Winning path: R U U R U
  await playMove(admin, 'right', 'valid');
  await playMove(admin, 'up', 'valid');
  await playMove(admin, 'up', 'valid');
  await playMove(admin, 'right', 'valid');
  await playMove(admin, 'up', 'won');
  st = await waitFor(admin, (s) => s.phase === 'won', 'won phase');
  assert(st.game!.lavaTiles !== null && st.game!.lavaTiles.length === 3, 'lava revealed on win (3 tiles)');
  const ranking = st.game!.ranking;
  assert(ranking && ranking.length === 2, 'ranking has both players');
  for (const r of ranking!) {
    assert(r.mistakes === expectedMistakes.get(r.name), `${r.name} has ${expectedMistakes.get(r.name)} mistakes (got ${r.mistakes})`);
  }
  assert(ranking![0].mistakes <= ranking![1].mistakes, 'ranking sorted by fewest mistakes');
  ok(`game won, lava revealed, ranking correct (${ranking!.map((r) => `${r.name}:${r.mistakes}`).join(', ')})`);

  admin.emit('admin:end');
  await waitFor(admin, (s) => s.phase === 'lobby', 'back to lobby');
  ok('admin ended the game → lobby');

  // --- no-context filtering + timeout ---------------------------------------
  const started2 = await new Promise<{ ok: boolean }>((resolve) =>
    admin.emit('admin:start', { mapId: 'warmup', turnSeconds: 3, difficulty: 'no-context' }, resolve),
  );
  assert(started2.ok, 'second game starts');
  st = await waitFor(alice, (s) => s.phase === 'thinking', 'thinking (no-context)');
  assert(st.game!.figure === null, 'figure hidden in no-context');
  assert(st.game!.steppedTiles.length === 0, 'stepped tiles hidden in no-context');
  st = await waitFor(admin, (s) => s.phase === 'move-result', 'timeout result', 10_000);
  assert(st.game!.lastMove!.outcome === 'timeout', 'timeout outcome');
  assert(st.game!.lastMove!.direction === null, 'timeout has no direction');
  ok('no-context filtering + turn timeout work');

  // --- kick ------------------------------------------------------------------
  const bobKicked = new Promise<void>((resolve) => bob.once('kicked', () => resolve()));
  admin.emit('admin:kick', 'Bob');
  await bobKicked;
  await waitFor(admin, (s) => s.players.length === 2, 'Bob removed from lobby');
  ok('kick works');

  admin.emit('admin:end');
  await waitFor(admin, (s) => s.phase === 'lobby', 'lobby after end');

  assert(!lavaLeak, lavaLeak ?? '');
  console.log('\nALL SMOKE TESTS PASSED');
  admin.disconnect();
  alice.disconnect();
  bob.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
