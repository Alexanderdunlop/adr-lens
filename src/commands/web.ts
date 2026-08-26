import { writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { Corpus } from '../core/corpus.ts';
import { renderPage } from '../web/page.ts';

export interface WebOptions {
  /** Where to write the file. */
  out: string;
  /** Label shown in the page header; inferred from the corpus when omitted. */
  scope?: string;
  now?: Date;
}

export interface WebResult {
  path: string;
  bytes: number;
  records: number;
  /**
   * The page that was just written. Held so `--serve` can hand out the current
   * build without reading back the file it wrote a moment ago — and without
   * racing the next write.
   */
  html: string;
}

/** Write the whole corpus out as one self-contained HTML file. */
export async function writeSite(
  corpus: Corpus,
  root: string,
  options: WebOptions,
): Promise<WebResult> {
  const html = renderPage(corpus, {
    scope: options.scope ?? inferScope(root),
    ...(options.now ? { now: options.now } : {}),
  });

  const path = resolve(options.out);
  await writeFile(path, html, 'utf8');

  return { path, bytes: Buffer.byteLength(html, 'utf8'), records: corpus.adrs.length, html };
}

/**
 * Name the page after the directory the scan started from.
 *
 * Deriving it from where the records were *found* looks smarter and is worse:
 * a monorepo whose records sit in `packages/engine/docs/adr` would be titled
 * "engine". The scan root is what the reader asked about, and when the tool is
 * run inside a repo — the normal case — that is the repo's own name.
 */
function inferScope(root: string): string {
  return basename(resolve(root)) || 'decisions';
}

/** Default output filename for a corpus, e.g. `billing-service-decisions.html`. */
export function defaultOutputName(root: string): string {
  return `${inferScope(root)}-decisions.html`;
}

/* ----------------------------------------------------------------- watching */

export interface WatchHandle {
  /** Stop watching and release the file watchers. */
  close(): void;
}

export interface WatchOptions extends WebOptions {
  /** Quiet period before rebuilding, in milliseconds. */
  debounceMs?: number;
  /** Called after each successful write. */
  onBuild?: (result: WebResult) => void;
  /** Called when a rebuild throws, instead of crashing the watcher. */
  onError?: (error: Error) => void;
}

/**
 * Write the page, then rewrite it whenever a record changes.
 *
 * The whole corpus is reloaded on every rebuild rather than patching the record
 * that changed. Adding one record alters the citation graph, the supersession
 * chains, and the "most cited" ranking for every other record, so a partial
 * update would be wrong more often than it was fast — and a full reload of a
 * hundred records takes well under a second.
 */
export async function watchSite(
  root: string,
  options: WatchOptions,
): Promise<{ handle: WatchHandle; initial: WebResult }> {
  const { watch } = await import('node:fs');
  const { loadCorpus } = await import('../core/corpus.ts');
  const { createDebouncer, isRelevantChange } = await import('./watch.ts');

  const rebuild = async (): Promise<void> => {
    try {
      const corpus = await loadCorpus(root);
      const result = await writeSite(corpus, root, options);
      options.onBuild?.(result);
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const corpus = await loadCorpus(root);
  const initial = await writeSite(corpus, root, options);

  const debouncer = createDebouncer(() => {
    void rebuild();
  }, options.debounceMs ?? 150);

  const watchers = corpus.dirs.map((dir) =>
    watch(dir.path, { recursive: true }, (_event, filename) => {
      if (isRelevantChange(filename, options.out)) debouncer.trigger();
    }),
  );

  return {
    initial,
    handle: {
      close(): void {
        debouncer.cancel();
        for (const watcher of watchers) watcher.close();
      },
    },
  };
}

/**
 * The directories being watched. Exposed so the CLI can say what it is watching,
 * and so it can warn that a *new* ADR directory needs a restart to be picked up.
 */
export async function watchedDirs(root: string): Promise<string[]> {
  const { loadCorpus } = await import('../core/corpus.ts');
  const corpus = await loadCorpus(root);
  return corpus.dirs.map((d) => d.path);
}
