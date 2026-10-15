import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

let server;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ level: 'info', message: 'shutdown started', signal }));
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  try {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await disconnectDatabase();
    clearTimeout(forceExit);
    process.exitCode = 0;
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'shutdown failed', error: error.message }));
    process.exitCode = 1;
  }
}

try {
  await connectDatabase(config.mongoUri);
  const app = createApp();
  server = createServer(app);
  server.listen(config.port, () => console.info(JSON.stringify({ level: 'info', message: 'API listening', port: config.port })));
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
} catch (error) {
  console.error(JSON.stringify({ level: 'error', message: 'startup failed', error: error.message }));
  process.exitCode = 1;
}
