# Death Hike

A one-shot multiplayer browser game for meetings/conferences. Everyone joins one
lobby on their phone; each turn a random player must move the shared figure
up/down/left/right across a grid with hidden lava tiles. Reach the top-right
tile together to win. The win screen shows a ranking by fewest avoidable
mistakes (moving off the board, or stepping into lava the group had already
discovered in an earlier attempt).

## Roles

- **Admin** — log in with the admin username (default `admin`, override with the
  `ADMIN_USERNAME` env var). Configures map, seconds per turn and difficulty,
  starts/ends the game, and can kick players (e.g. after a disconnect).
- **Players** — everyone else. Mid-game joiners enter the turn rotation
  immediately.

## Difficulty modes

| Mode | What players see |
|---|---|
| easy | grid, figure, visited tiles of the current attempt |
| no-history | grid, figure |
| no-state | grid; figure only until the first move of each attempt |
| no-context | only the grid dimensions as text |

Lava is never visible upfront (also not on the admin's screen — it is meant to
be shared). In easy/no-history mode the single lava tile that was just stepped
on is shown during the move-result phase; the full field is only revealed once
the game is won. Maps are hardcoded presets
in [server/src/maps.ts](server/src/maps.ts); each is validated at startup
(BFS) to guarantee a safe path exists.

## Development

```bash
npm install
npm run dev        # backend on :8080 + Vite dev server on :5173 (proxies the websocket)
```

Open http://localhost:5173 in several tabs; log in once as `admin`.

```bash
npm run smoke      # end-to-end test against a running server (~1 min, real timings)
npm run build      # typecheck + compile server + build frontend into dist/
npm start          # serve the built app on :8080
```

## Deployment

The top-level [Dockerfile](Dockerfile) builds a single image in which the Node
server serves the static frontend and the socket.io endpoint on one port
(`PORT`, default 8080). `GET /healthz` is available for probes.

State is in-memory only — one process, one lobby. Run a single replica; a
restart simply resets the lobby (intended for one-time use).

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP + websocket port |
| `ADMIN_USERNAME` | `admin` | Login name that gets the admin role |
