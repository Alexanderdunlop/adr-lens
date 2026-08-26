import { basename, extname, resolve } from 'node:path';

/**
 * Whether a changed path should trigger a rebuild.
 *
 * Editors do not write files the way you would expect: they write
 * `.thing.md.swp`, or write `thing.md~` then rename over the target, or drop a
 * `.DS_Store` in the directory. Rebuilding on all of that is noise, and
 * rebuilding on the output file we just wrote is an infinite loop.
 */
export function isRelevantChange(path: string | null | undefined, outputPath?: string): boolean {
  if (!path) return false;

  const name = basename(path);
  if (!name) return false;

  // Never react to our own output.
  if (outputPath && resolve(path) === resolve(outputPath)) return false;

  // Editor scratch and OS metadata.
  if (name.startsWith('.')) return false;
  if (name.endsWith('~')) return false;
  if (/\.(?:swp|swx|tmp|temp|orig|rej|bak)$/i.test(name)) return false;
  // Vim/Emacs atomic-save intermediates such as `4913` or `#thing.md#`.
  if (/^#.*#$/.test(name)) return false;
  if (/^\d+$/.test(name)) return false;

  return extname(name).toLowerCase() === '.md';
}

export interface Debouncer {
  /** Note that something changed; the callback fires once the burst settles. */
  trigger(): void;
  /** Stop any pending run. */
  cancel(): void;
}

/**
 * Collapse a burst of filesystem events into one run.
 *
 * A single save can produce several events (write, rename, attribute change),
 * and a multi-file operation such as `git checkout` produces hundreds. Waiting
 * for quiet is the difference between one rebuild and two hundred.
 */
export function createDebouncer(
  run: () => void,
  waitMs: number,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
  unschedule: (handle: unknown) => void = (h) => clearTimeout(h as never),
): Debouncer {
  let handle: unknown = null;

  return {
    trigger(): void {
      if (handle !== null) unschedule(handle);
      handle = schedule(() => {
        handle = null;
        run();
      }, waitMs);
    },
    cancel(): void {
      if (handle !== null) unschedule(handle);
      handle = null;
    },
  };
}

/** A single-line status, so a long watch session does not scroll away. */
export interface StatusLine {
  update(text: string): void;
  /** Finish the current line, so later output starts cleanly. */
  done(): void;
}

export function createStatusLine(stream: {
  write(text: string): unknown;
  isTTY?: boolean;
  columns?: number;
}): StatusLine {
  // Without a TTY (a log file, a CI job) carriage returns are noise, so each
  // update becomes its own line instead.
  if (!stream.isTTY) {
    return {
      update(text) {
        stream.write(`${text}\n`);
      },
      done() {},
    };
  }

  let dirty = false;
  const width = stream.columns ?? 80;

  return {
    update(text) {
      const line = text.length > width - 1 ? `${text.slice(0, width - 2)}…` : text;
      stream.write(`\r\u001B[2K${line}`);
      dirty = true;
    },
    done() {
      if (dirty) stream.write('\n');
      dirty = false;
    },
  };
}

/** `11:59:04` — a timestamp for a status line, in local time. */
export function clockTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
