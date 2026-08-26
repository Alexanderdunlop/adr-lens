import { type Corpus, loadCorpus } from '../core/corpus.ts';
import { type SearchFilters, search } from '../core/search.ts';
import type { AdrNode, Status } from '../core/types.ts';

export interface CommandContext {
  corpus: Corpus;
  /** Columns available for output. */
  width: number;
  /** Fixed "now" so output is stable within a single invocation. */
  now: Date;
}

export interface GlobalFlags {
  root: string;
  width?: number;
  status?: Status[];
  dir?: string;
  liveOnly?: boolean;
  maxDepth?: number;
  json?: boolean;
  noColor?: boolean;
}

export async function createContext(flags: GlobalFlags): Promise<CommandContext> {
  const corpus = await loadCorpus(flags.root, { maxDepth: flags.maxDepth });
  return {
    corpus,
    width: resolveWidth(flags.width),
    now: new Date(),
  };
}

export function resolveWidth(override?: number): number {
  if (override && override > 0) return override;
  const columns = process.stdout.columns;
  // Cap the measure at 100 columns: prose stops being readable much past that,
  // and ADRs are almost entirely prose.
  return Math.min(100, Math.max(60, columns ?? 80));
}

/** Apply the global filters, returning records in corpus order. */
export function filtered(context: CommandContext, flags: GlobalFlags, query?: string): AdrNode[] {
  const filters: SearchFilters = {};
  if (query) filters.query = query;
  if (flags.status) filters.status = flags.status;
  if (flags.dir) filters.dir = flags.dir;
  if (flags.liveOnly) filters.liveOnly = true;

  return search(context.corpus.adrs, filters).map((r) => r.adr);
}

/**
 * Resolve a user-supplied reference to a single record. Accepts a number
 * (`34`), an id or path fragment (`0034-dlq`), or a title substring.
 */
export function resolveOne(corpus: Corpus, reference: string): AdrNode | AdrNode[] {
  const needle = reference.trim().toLowerCase();
  if (!needle) return [];

  const exactId = corpus.adrs.filter((a) => a.id.toLowerCase() === needle);
  if (exactId.length === 1) return exactId[0]!;

  const asNumber = /^(?:adr[-\s_]?)?0*(\d{1,5})$/.exec(needle);
  if (asNumber) {
    const number = Number.parseInt(asNumber[1]!, 10);
    const matches = corpus.adrs.filter((a) => a.number === number);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) return matches;
  }

  const byPath = corpus.adrs.filter((a) => a.id.toLowerCase().includes(needle));
  if (byPath.length === 1) return byPath[0]!;

  const byTitle = corpus.adrs.filter((a) => a.title.toLowerCase().includes(needle));
  if (byTitle.length === 1) return byTitle[0]!;

  const combined = [...new Set([...byPath, ...byTitle])];
  return combined;
}
