/** Minimal stdout/stderr logger with timestamps. */

const stamp = () => new Date().toISOString().slice(11, 19);

const describe = (error) => (error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error ?? ''));

/**
 * @param {{ quiet?: boolean }} [options]
 */
export function createLogger({ quiet = false } = {}) {
  return Object.freeze({
    info(message) {
      if (!quiet) process.stdout.write(`[${stamp()}] ${message}\n`);
    },
    error(message, error) {
      process.stderr.write(`[${stamp()}] ${message}${error ? `: ${describe(error)}` : ''}\n`);
    },
  });
}
