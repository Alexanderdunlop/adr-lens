import { describe, expect, it, vi } from 'vitest';
import {
  clockTime,
  createDebouncer,
  createStatusLine,
  isRelevantChange,
} from '../src/commands/watch.ts';
import { SCRIPT } from '../src/web/script.ts';

describe('isRelevantChange', () => {
  it('accepts a record', () => {
    expect(isRelevantChange('0002-thing.md')).toBe(true);
    expect(isRelevantChange('docs/adrs/0002-thing.md')).toBe(true);
  });

  it.each([
    ['thing.txt', 'not markdown'],
    ['.DS_Store', 'OS metadata'],
    ['.0002-thing.md.swp', 'vim swap'],
    ['0002-thing.md~', 'emacs backup'],
    ['0002-thing.md.tmp', 'temp write'],
    ['#0002-thing.md#', 'emacs autosave'],
    ['4913', 'vim atomic-save probe'],
    ['0002-thing.md.orig', 'merge leftover'],
  ])('ignores %s (%s)', (name) => {
    expect(isRelevantChange(name)).toBe(false);
  });

  it('ignores a null filename, which some platforms report', () => {
    expect(isRelevantChange(null)).toBe(false);
    expect(isRelevantChange(undefined)).toBe(false);
  });

  it('never reacts to the page it just wrote', () => {
    // Writing the output into a watched directory would otherwise loop forever.
    expect(isRelevantChange('docs/adrs/out.md', 'docs/adrs/out.md')).toBe(false);
    expect(isRelevantChange('docs/adrs/other.md', 'docs/adrs/out.md')).toBe(true);
  });
});

describe('createDebouncer', () => {
  it('collapses a burst into one run', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const debouncer = createDebouncer(run, 150);

    for (let i = 0; i < 50; i++) debouncer.trigger();
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(149);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('runs again for a later, separate change', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const debouncer = createDebouncer(run, 100);

    debouncer.trigger();
    vi.advanceTimersByTime(100);
    debouncer.trigger();
    vi.advanceTimersByTime(100);

    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('cancel stops a pending run', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const debouncer = createDebouncer(run, 100);
    debouncer.trigger();
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('createStatusLine', () => {
  it('rewrites one line on a terminal', () => {
    const written: string[] = [];
    const line = createStatusLine({ write: (t) => written.push(t), isTTY: true, columns: 80 });
    line.update('first');
    line.update('second');
    line.done();

    expect(written.filter((w) => w.includes('\r'))).toHaveLength(2);
    expect(written[written.length - 1]).toBe('\n');
  });

  it('writes plain lines when there is no terminal', () => {
    const written: string[] = [];
    const line = createStatusLine({ write: (t) => written.push(t), isTTY: false });
    line.update('first');
    line.update('second');
    line.done();

    // Carriage returns in a log file are noise.
    expect(written).toEqual(['first\n', 'second\n']);
  });

  it('truncates to the terminal width so the line never wraps', () => {
    const written: string[] = [];
    const line = createStatusLine({ write: (t) => written.push(t), isTTY: true, columns: 20 });
    line.update('x'.repeat(200));
    const painted = written[0]!.replace(/^\r\[2K/, '');
    expect(painted.length).toBeLessThanOrEqual(19);
    expect(painted.endsWith('…')).toBe(true);
  });
});

describe('clockTime', () => {
  it('pads to a stable width so the status line does not jitter', () => {
    expect(clockTime(new Date(2026, 0, 1, 9, 5, 4))).toBe('09:05:04');
    expect(clockTime(new Date(2026, 0, 1, 23, 59, 59))).toBe('23:59:59');
  });
});

describe('inline script', () => {
  it('parses as JavaScript', () => {
    // A stray backtick in the script silently truncates the template literal it
    // is embedded in, producing a page that loads and then does nothing at all.
    expect(() => new Function(SCRIPT)).not.toThrow();
  });

  it('contains no backtick, which would close its own template', () => {
    expect(SCRIPT.includes(String.fromCharCode(96))).toBe(false);
  });
});
