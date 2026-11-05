import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createHttpServer } from '../src/server.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const T0 = 1_700_000_000_000;

function recorder() {
  const calls = [];
  return {
    calls,
    run: (action) => calls.push(action),
    stopAll: () => calls.push({ type: 'stopAll' }),
  };
}

let clock = T0;
let effects;
let app;
let server;
let base;
let origin;

function post(route, body, headers = {}) {
  return fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Raw request so tests can send headers fetch refuses to forge (Host) or unnormalized paths. */
function raw(method, rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path: rawPath, headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  effects = recorder();
  app = createApp({ now: () => clock, effects, overlay: null, persist: null });
  server = createHttpServer({ app, publicDir: PUBLIC_DIR });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  origin = `http://localhost:${port}`;
});

after(async () => {
  app.shutdown();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('static files', () => {
  test('serves the app page', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  });

  test('refuses path traversal', async () => {
    assert.equal(await raw('GET', '/%2e%2e/package.json'), 404);
    assert.equal(await raw('GET', '/../package.json'), 404);
  });

  test('returns 404 for unknown files', async () => {
    assert.equal((await fetch(`${base}/nope.txt`)).status, 404);
  });
});

describe('request guards', () => {
  test('rejects a foreign Host header (DNS rebinding)', async () => {
    assert.equal(await raw('GET', '/api/state', { host: 'evil.example:80' }), 403);
  });

  test('rejects cross-site posts', async () => {
    const res = await post('/api/phone', { onPhone: true }, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
  });

  test('requires JSON bodies', async () => {
    const res = await post('/api/phone', 'onPhone=true', { 'content-type': 'text/plain' });
    assert.equal(res.status, 415);
  });

  test('rejects malformed JSON', async () => {
    const res = await post('/api/start', '{nope');
    assert.equal(res.status, 400);
  });

  test('rejects oversized bodies', async () => {
    const res = await post('/api/confess', { text: 'x'.repeat(20_000) });
    assert.equal(res.status, 413);
  });

  test('returns 404 for unknown API routes', async () => {
    assert.equal((await post('/api/nope', {})).status, 404);
  });
});

describe('session flow', () => {
  test('reports idle before a session starts', async () => {
    const body = await (await fetch(`${base}/api/state`)).json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'idle');
  });

  test('refuses phone toggles with no session running', async () => {
    assert.equal((await post('/api/phone', { onPhone: true })).status, 409);
  });

  test('validates the start form', async () => {
    const res = await post('/api/start', { studyMinutes: 0 });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /minutes/i);
  });

  test('starts, escalates, and stays locked inside the radius', async () => {
    const start = await (await post('/api/start', { studyMinutes: 25 })).json();
    assert.equal(start.data.status, 'running');

    await post('/api/location', { lat: 34.0224, lng: -118.2851, accuracy: 10 });
    const on = await (await post('/api/phone', { onPhone: true })).json();
    assert.equal(on.data.phone.onPhone, true);

    for (let i = 0; i < 70 * 4; i += 1) {
      clock += 250;
      app.step();
    }
    assert.ok(effects.calls.some((a) => a.type === 'tick'), 'ticking started by 70 s');

    const locked = await post('/api/stop', {});
    assert.equal(locked.status, 409);
    assert.match((await locked.json()).error, /walk/i);
  });

  test('takes a confession only when it matches', async () => {
    const res = await post('/api/confess', { text: 'nope' });
    assert.equal(res.status, 200);
  });

  test('unlocks Stop after simulating a walk out of the radius', async () => {
    await post('/api/phone', { onPhone: false });
    const demo = await (await post('/api/demo', { simulatedM: 75, speed: 6 })).json();
    assert.equal(demo.data.canStop, true);
    const stopped = await (await post('/api/stop', {})).json();
    assert.equal(stopped.data.status, 'done');
    assert.equal(stopped.data.summary.endedEarly, true);
  });

  test('resets to idle after a finished session', async () => {
    const res = await (await post('/api/reset', {})).json();
    assert.equal(res.data.status, 'idle');
  });
});

describe('rules', () => {
  test('publishes the ladder and radius for the page', async () => {
    const body = await (await fetch(`${base}/api/rules`)).json();
    assert.equal(body.data.ladder.length, 12);
    assert.equal(body.data.radiusM, 50);
    assert.equal(body.data.levelMs, 30_000);
  });
});

describe('live updates', () => {
  test('streams snapshots as server-sent events', async () => {
    const res = await fetch(`${base}/events`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /^data: \{/);
    await reader.cancel();
  });
});
