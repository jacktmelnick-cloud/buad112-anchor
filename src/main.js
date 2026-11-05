/**
 * Starts Anchor: the localhost server, the 4x-a-second session loop, and the screen overlay.
 * Usage: npm start
 *   PORT=5112          port (default 5112)
 *   ANCHOR_SILENT=1    skip sound, speech, and volume changes (for testing)
 *   ANCHOR_OVERLAY=0   skip the Mac-wide overlay; the page draws effects inside the tab instead
 *   ANCHOR_DATA=dir    where the session file is saved (default ./data)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createHttpServer } from './server.js';
import { createMacEffects, restorePendingVolume } from './mac.js';
import { createOverlay } from './overlay.js';
import { createStore } from './store.js';
import { createLogger } from './log.js';
import { sirenWav, tickWav } from './audio.js';

/** 10 loop passes a second, so the fastest ticking (every ~300 ms) stays distinct. */
const LOOP_MS = 100;
const DEFAULT_PORT = 5112;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.ANCHOR_DATA ?? path.join(root, 'data'));
const log = createLogger();

function parsePort(raw) {
  const port = Number(raw ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`PORT must be 1-65535, got "${raw}"`);
  return port;
}

function writeSounds() {
  fs.mkdirSync(dataDir, { recursive: true });
  const tickPath = path.join(dataDir, 'tick.wav');
  const sirenPath = path.join(dataDir, 'siren.wav');
  fs.writeFileSync(tickPath, tickWav());
  fs.writeFileSync(sirenPath, sirenWav(1.8));
  return { tickPath, sirenPath };
}

function main() {
  if (process.platform !== 'darwin') log.error('Anchor drives macOS features; on this OS only the page will work.');
  const port = parsePort(process.env.PORT);
  const silent = process.env.ANCHOR_SILENT === '1';
  const store = createStore(path.join(dataDir, 'session.json'), log);
  const volumeFile = path.join(dataDir, 'volume-before-anchor.json');
  restorePendingVolume({ volumeFile, log });
  const effects = createMacEffects({ ...writeSounds(), volumeFile, silent, log });

  let app = null;
  const overlay = createOverlay({
    root,
    fontsDir: path.join(root, 'public', 'fonts'),
    onEvent: (event) => app?.handleOverlayEvent(event),
    log,
  });
  const useOverlay = process.env.ANCHOR_OVERLAY !== '0';
  app = createApp({
    effects,
    overlay: useOverlay ? overlay : null,
    persist: store,
    initialState: store.load(Date.now()) ?? undefined,
    log,
  });
  if (useOverlay) overlay.start();

  const server = createHttpServer({ app, publicDir: path.join(root, 'public'), log });
  const loop = setInterval(() => app.step(), LOOP_MS);

  server.on('error', (error) => {
    log.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Try PORT=5113 npm start` : 'Server error', error);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => log.info(`Anchor is running at http://localhost:${port}`));

  let closed = false;
  const shutdown = (code) => {
    if (closed) return;
    closed = true;
    clearInterval(loop);
    app.shutdown();
    server.close();
    process.exit(code);
  };
  // SIGHUP is what closing the Terminal window sends; without a handler the volume would stay up.
  ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'].forEach((signal) => process.on(signal, () => shutdown(0)));
  process.on('uncaughtException', (error) => {
    log.error('Crashed', error);
    shutdown(1);
  });
}

main();
