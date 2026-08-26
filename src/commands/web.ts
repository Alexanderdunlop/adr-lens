import { writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
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
    scope: options.scope ?? inferScope(corpus, root),
    ...(options.now ? { now: options.now } : {}),
  });

  const path = resolve(options.out);
  await writeFile(path, html, 'utf8');

  return { path, bytes: Buffer.byteLength(html, 'utf8'), records: corpus.adrs.length };
}

/**
 * Name the page after what it actually covers: the repository when every record
 * came from one, otherwise the directory the scan started from.
 */
function inferScope(corpus: Corpus, root: string): string {
  const rootName = basename(resolve(root)) || 'decisions';

  if (corpus.dirs.length === 1) {
    const dir = corpus.dirs[0]!;
    // `docs/adrs` inside a repo is less useful than the repo's own name, so walk
    // up past the conventional docs folders.
    const parts = dir.path.split(sep).filter(Boolean);
    const conventional = new Set([
      'adr',
      'adrs',
      'decisions',
      'decision-records',
      'architecture-decisions',
      'architecture-decision-records',
      'docs',
      'doc',
    ]);

    for (let i = parts.length - 1; i >= 0; i--) {
      if (!conventional.has(parts[i]!.toLowerCase())) return parts[i]!;
    }
    return rootName;
  }

  return rootName;
}

/** Default output filename for a corpus, e.g. `billing-service-decisions.html`. */
export function defaultOutputName(corpus: Corpus, root: string): string {
  return `${inferScope(corpus, root)}-decisions.html`;
}
