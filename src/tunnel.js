/**
 * Phone mode: a Cloudflare quick tunnel gives the Mac's localhost an HTTPS address the phone can reach
 * (iOS only allows location over HTTPS). No account needed; the address changes every start.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

const CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', 'cloudflared'),
  '/opt/homebrew/bin/cloudflared',
  '/usr/local/bin/cloudflared',
];

function findCloudflared() {
  const onPath = (process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, 'cloudflared'));
  return [...onPath, ...CANDIDATES].find((file) => fs.existsSync(file)) ?? null;
}

/** The page the phone opens, with its key. */
export const phoneUrl = (base, token) => `${base}/phone.html?k=${encodeURIComponent(token)}`;

/**
 * @param {{ port: number, token: string, log: ReturnType<typeof import('./log.js').createLogger> }} deps
 */
export function startTunnel({ port, token, log }) {
  let base = null;
  let qrSvg = null;
  let error = null;
  const bin = findCloudflared();
  if (!bin) {
    error = 'cloudflared is not installed. See README: Phone setup.';
    log.error(`${error} The phone can't reach Anchor until it is.`);
    return { connect: () => ({ url: null, base: null, token, qrSvg: null, error }), stop() {} };
  }

  const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const scan = (chunk) => {
    const match = base ? null : String(chunk).match(TUNNEL_URL);
    if (!match) return;
    base = match[0];
    QRCode.toString(phoneUrl(base, token), { type: 'svg', margin: 1 })
      .then((svg) => {
        qrSvg = svg;
      })
      .catch((e) => log.error('Could not draw the pairing QR code', e));
    log.info(`Phone link: ${phoneUrl(base, token)}`);
    log.info(`Shortcuts base URL: ${base}   key: ${token}`);
  };
  child.stdout.on('data', scan);
  child.stderr.on('data', scan);
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      error = `cloudflared exited (${code}). Restart Anchor to get a new phone link.`;
      log.error(error);
    }
  });

  return {
    connect: () => ({ url: base && phoneUrl(base, token), base, token, qrSvg, error }),
    stop: () => child.kill(),
  };
}
