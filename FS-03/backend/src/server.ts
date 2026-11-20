import http from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app';
import { env } from './config/env';
import { registerChat } from './realtime/chat';

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true },
});
registerChat(io);

server.listen(env.PORT, () => {
  console.log(`[api] listening on :${env.PORT} (${env.NODE_ENV})`);
});

const shutdown = () => {
  io.close();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
