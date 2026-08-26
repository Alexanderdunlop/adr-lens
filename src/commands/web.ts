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

  return { path, bytes: Buffer.byteLength(html, 'utf8'), records: corpus.adrs.length };
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
