/**
 * Drives the native overlay helper (native/Overlay.swift). The helper draws over every app and
 * display; this module compiles it if needed, streams it frames as JSON lines, and turns its
 * stdout lines (the floating off button, the confession box) into events.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const HEARTBEAT_MS = 1000;
const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 1500;

/**
 * Compile the helper when the binary is missing or older than its source.
 * @returns {{ ok: true, binary: string } | { ok: false, error: string }}
 */
export function buildOverlay(root) {
  const source = path.join(root, 'native', 'Overlay.swift');
  const binary = path.join(root, '.build', 'anchor-overlay');
  const fresh = fs.existsSync(binary) && fs.statSync(binary).mtimeMs >= fs.statSync(source).mtimeMs;
  if (fresh) return { ok: true, binary };
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  const result = spawnSync('swiftc', ['-O', '-swift-version', '5', source, '-o', binary], { encoding: 'utf8' });
  if (result.error) return { ok: false, error: `swiftc is not available (${result.error.message})` };
  if (result.status !== 0) return { ok: false, error: result.stderr.trim().split('\n').slice(0, 8).join('\n') };
  return { ok: true, binary };
}

/**
 * @param {{
 *   root: string,
 *   fontsDir: string,
 *   onEvent: (event: { e: string, text?: string }) => void,
 *   log: ReturnType<typeof import('./log.js').createLogger>,
 * }} options
 */
export function createOverlay({ root, fontsDir, onEvent, log }) {
  let child = null;
  let available = false;
  let stopping = false;
  let restarts = 0;
  let lastLine = '';
  let lastSentAt = 0;

  function handleLine(line) {
    try {
      const event = JSON.parse(line);
      if (event.e === 'ready') {
        available = true;
        restarts = 0;
        log.info('Screen overlay is running on every display.');
        return;
      }
      onEvent(event);
    } catch (error) {
      log.error(`Overlay sent something unreadable: ${line.slice(0, 120)}`, error);
    }
  }

  function launch(binary) {
    child = spawn(binary, [fontsDir], { stdio: ['pipe', 'pipe', 'inherit'] });
    child.on('error', (error) => log.error('Overlay helper failed to start', error));
    child.stdin.on('error', () => {
      /* helper exited mid-write; the exit handler restarts it */
    });
    readline.createInterface({ input: child.stdout }).on('line', handleLine);
    child.on('exit', (code) => {
      available = false;
      child = null;
      lastLine = '';
      if (stopping) return;
      if (restarts >= MAX_RESTARTS) {
        log.error(`Overlay helper keeps exiting (code ${code}); continuing without it.`);
        return;
      }
      restarts += 1;
      setTimeout(() => !stopping && launch(binary), RESTART_DELAY_MS);
    });
  }

  return Object.freeze({
    start() {
      const built = buildOverlay(root);
      if (!built.ok) {
        log.error(`Screen overlay unavailable, effects stay inside the browser tab.\n${built.error}`);
        return false;
      }
      launch(built.binary);
      return true;
    },

    /** Send a frame when it changes, and at least once a second so the helper's watchdog stays fed. */
    send(frame) {
      if (!child?.stdin.writable) return;
      const line = JSON.stringify(frame);
      const now = Date.now();
      if (line === lastLine && now - lastSentAt < HEARTBEAT_MS) return;
      lastLine = line;
      lastSentAt = now;
      child.stdin.write(`${line}\n`);
    },

    isAvailable: () => available,

    stop() {
      stopping = true;
      child?.stdin.end();
      child?.kill();
    },
  });
}
