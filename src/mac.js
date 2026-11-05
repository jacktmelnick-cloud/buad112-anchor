/**
 * Executes planned effects on macOS with built-in tools: afplay (sound), say (voice),
 * osascript (notifications and output volume). Every command is spawned with an argument
 * array, never through a shell. Set ANCHOR_SILENT=1 to skip sound, speech, and volume changes.
 *
 * Volume safety: the volume from before Anchor raised it is written to disk the moment it is
 * captured, so even a crash or a closed Terminal gets it put back on the next start.
 */
import { spawn, spawnSync, execFile } from 'node:child_process';
import fs from 'node:fs';

const COMMAND_TIMEOUT_MS = 4000;

/** AppleScript string literal: escapes backslashes and quotes so text can never close the string. */
export const asString = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const clampVolume = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

const READ_VOLUME = Object.freeze([
  '-e',
  'set v to get volume settings',
  '-e',
  'return ((output volume of v) as string) & "," & ((output muted of v) as string)',
]);

const setVolumeArgs = ({ level, muted }) => [
  '-e',
  `set volume output volume ${clampVolume(level)}`,
  '-e',
  `set volume ${muted ? 'with' : 'without'} output muted`,
];

function parseVolume(raw) {
  const [level, muted] = String(raw).split(',');
  return { level: clampVolume(level), muted: muted === 'true' };
}

/** Real process runner. Tests pass a fake with the same three methods. */
export const defaultRunner = Object.freeze({
  sync(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr?.trim() || `${command} exited ${result.status}`);
    return result.stdout.trim();
  },
  async(command, args) {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout: COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr).trim() || error.message));
        else resolve(String(stdout).trim());
      });
    });
  },
  launch(command, args) {
    return spawn(command, args, { stdio: 'ignore' });
  },
});

function readSaved(volumeFile) {
  const saved = JSON.parse(fs.readFileSync(volumeFile, 'utf8'));
  return { level: clampVolume(saved.level), muted: saved.muted === true };
}

function forgetFile(volumeFile) {
  try {
    fs.unlinkSync(volumeFile);
  } catch {
    /* already gone */
  }
}

/**
 * On startup: if a previous run raised the volume and never put it back, put it back now.
 * @param {{ volumeFile: string, runner?: typeof defaultRunner, log: { info: Function, error: Function } }} options
 */
export function restorePendingVolume({ volumeFile, runner = defaultRunner, log }) {
  if (!fs.existsSync(volumeFile)) return;
  try {
    const saved = readSaved(volumeFile);
    runner.sync('osascript', setVolumeArgs(saved));
    log.info(`Put your volume back to ${saved.level}${saved.muted ? ' (muted)' : ''} from the last run.`);
  } catch (error) {
    log.error('Could not restore the volume from the last run', error);
  } finally {
    forgetFile(volumeFile);
  }
}

/**
 * @param {{
 *   tickPath: string,
 *   sirenPath: string,
 *   volumeFile: string,
 *   silent?: boolean,
 *   runner?: typeof defaultRunner,
 *   log: { info: Function, error: Function },
 * }} options
 */
export function createMacEffects({ tickPath, sirenPath, volumeFile, silent = false, runner = defaultRunner, log }) {
  let sirenProcess = null;
  let sirenWanted = false;
  let speaking = null;
  /** Volume before Anchor raised it; mirrored to `volumeFile`. */
  let saved = null;
  /** Volume changes run one at a time, off the main loop. */
  let volumeQueue = Promise.resolve();

  function launch(command, args) {
    const child = runner.launch(command, args);
    child.on('error', (error) => log.error(`Could not run ${command}`, error));
    return child;
  }

  function remember(volume) {
    saved = volume;
    try {
      fs.writeFileSync(volumeFile, JSON.stringify(volume), { mode: 0o600 });
    } catch (error) {
      log.error('Could not record your volume to disk', error);
    }
  }

  function forget() {
    saved = null;
    forgetFile(volumeFile);
  }

  async function enforceFloor(floor) {
    const current = parseVolume(await runner.async('osascript', READ_VOLUME));
    if (!saved) remember(current);
    if (current.muted || current.level < floor) await runner.async('osascript', setVolumeArgs({ level: floor, muted: false }));
  }

  async function restore() {
    if (!saved) return;
    const original = saved;
    try {
      await runner.async('osascript', setVolumeArgs(original));
    } finally {
      forget();
    }
  }

  function queueVolume(floor) {
    if (silent) return;
    volumeQueue = volumeQueue
      .then(() => (floor === null ? restore() : enforceFloor(floor)))
      .catch((error) => log.error('Volume change failed', error));
  }

  function playSirenLoop() {
    sirenProcess = launch('afplay', [sirenPath]);
    sirenProcess.on('exit', () => {
      sirenProcess = null;
      if (sirenWanted) playSirenLoop();
    });
  }

  function setSiren(on) {
    sirenWanted = on && !silent;
    if (sirenWanted && !sirenProcess) playSirenLoop();
    if (!on && sirenProcess) sirenProcess.kill();
  }

  function say(text) {
    if (silent || speaking) return;
    speaking = launch('say', ['-r', '185', '--', text]);
    speaking.on('exit', () => {
      speaking = null;
    });
  }

  function notify(title, body) {
    const sound = silent ? '' : ' sound name "Funk"';
    launch('osascript', ['-e', `display notification ${asString(body)} with title ${asString(title)}${sound}`]);
  }

  return Object.freeze({
    /** @param {{ type: string, [key: string]: unknown }} action */
    run(action) {
      switch (action.type) {
        case 'tick':
          if (!silent) launch('afplay', ['-v', '1', tickPath]);
          return;
        case 'say':
          say(action.text);
          return;
        case 'notify':
          notify(action.title, action.body);
          return;
        case 'siren':
          setSiren(action.on);
          return;
        case 'volume':
          queueVolume(action.floor);
          return;
        default:
          log.error(`Unknown effect: ${action.type}`);
      }
    },

    /** Resolves when queued volume changes have finished. */
    whenIdle: () => volumeQueue,

    /** Stop every sound and put the volume back. Synchronous so it can run during process exit. */
    stopAll() {
      setSiren(false);
      speaking?.kill();
      if (!saved) return;
      const original = saved;
      try {
        runner.sync('osascript', setVolumeArgs(original));
      } catch (error) {
        log.error('Could not restore the volume; it will be restored on the next start', error);
        saved = null;
        return;
      }
      forget();
    },
  });
}
