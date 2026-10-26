import { startServer } from './net/server.js';

const port = Number(process.env.PORT ?? 8080);
const seed = process.env.CIVWAR_SEED !== undefined ? Number(process.env.CIVWAR_SEED) : undefined;

const server = await startServer(port, { seed });
console.log(`[civwar] WebSocket server listening on ws://localhost:${server.port}`);

const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
