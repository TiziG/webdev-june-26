import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/types.js';
import { GameRoom } from './game.js';

const PORT = Number(process.env.PORT ?? 8080);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';

const app = express();
app.get('/healthz', (_req, res) => {
  res.send('ok');
});

// In the Docker image the built frontend lives at dist/public, two levels up
// from this file (dist/server/src). In dev the Vite dev server serves the
// frontend instead and this directory simply doesn't exist.
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
app.use(express.static(publicDir));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

const room = new GameRoom(ADMIN_USERNAME, {
  onChange: () => io.emit('state', room.clientState()),
  onKicked: (socketId) => {
    io.to(socketId).emit('kicked');
    io.in(socketId).disconnectSockets();
  },
});

io.on('connection', (socket) => {
  socket.emit('state', room.clientState());

  socket.on('login', (name, cb) => {
    if (typeof cb !== 'function') return;
    cb(room.login(socket.id, String(name ?? '')));
  });
  socket.on('move', (direction) => room.move(socket.id, direction));
  socket.on('admin:start', (config, cb) => {
    const result = room.startGame(socket.id, config);
    if (typeof cb === 'function') cb(result);
  });
  socket.on('admin:end', () => room.endGame(socket.id));
  socket.on('admin:kick', (name) => room.kick(socket.id, name));
  socket.on('disconnect', () => room.disconnect(socket.id));
});

httpServer.listen(PORT, () => {
  console.log(`lava-maze listening on :${PORT} (admin username: "${ADMIN_USERNAME}")`);
});
