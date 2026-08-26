import { dirname } from 'node:path';
import type { Corpus } from '../core/corpus.ts';
import { currentVersion, decisionLine, readingMinutes } from '../core/digest.ts';
import type { AdrNode, RelationKind, Status } from '../core/types.ts';
import { headingId, renderHtml, renderInlineHtml } from '../render/html.ts';

/** One record, flattened into everything the page needs to show it. */
export interface WebRecord {
  id: string;
  slug: string;
  number: number | null;
  numberLabel: string;
  title: string;
  status: Status;
  statusLabel: string;
  /** Free-text status, rendered inline, when it says more than the label. */
  statusProse: string | null;
  date: string | null;
  /** `2026-06-04`, or an em dash when undated. Aligns in a column. */
  dateLabel: string;
  /** `4 June 2026`, for the record header where there is room. */
  dateLong: string | null;
  author: string | null;
  minutes: number;
  words: number;
  /** The one-sentence decision, as HTML. */
  gist: string | null;
  /** Plain-text decision, for searching. */
  gistText: string | null;
  /** `ADR-0009 Title (accepted, 2026-04-18)`, for a commit message or a ticket. */
  citation: string;
  /** The record exactly as written, for pasting somewhere that renders markdown. */
  source: string;
  group: string;
  citedBy: number;
  bodyHtml: string;
  /** Fully superseded — the record is no longer current. */
  replacedBy: { slug: string; label: string } | null;
  /** Where the thinking ended up, when this record was replaced. */
  currentSlug: string | null;
  relations: WebRelationGroup[];
  /** Lowercased haystack for client-side filtering. */
  haystack: string;
}

export interface WebRelationGroup {
  kind: RelationKind | 'cited-by';
  label: string;
  entries: Array<{
    slug: string;
    numberLabel: string;
    title: string;
    status: Status;
    superseded: boolean;
  }>;
}

export interface WebChain {
  entries: Array<{ slug: string; numberLabel: string; current: boolean }>;
  title: string;
}

export interface WebModel {
  scope: string;
  records: WebRecord[];
  groups: Array<{ name: string; count: number }>;
  statusCounts: Array<{ status: Status; label: string; count: number }>;
  totals: { records: number; current: number; words: number; minutes: number };
  mostCited: Array<{
    slug: string;
    numberLabel: string;
    title: string;
    status: Status;
    citedBy: number;
    gist: string | null;
  }>;
  chains: WebChain[];
  generatedAt: string;
}

const STATUS_LABELS: Record<Status, string> = {
  accepted: 'Accepted',
  proposed: 'Proposed',
  rejected: 'Rejected',
  deprecated: 'Deprecated',
  superseded: 'Superseded',
  unknown: 'No status',
};

const RELATION_LABELS: Record<RelationKind | 'cited-by', string> = {
  'superseded-by': 'Replaced by',
  'superseded-in-part-by': 'Partly replaced by',
  supersedes: 'Replaces',
  'supersedes-in-part': 'Partly replaces',
  'amended-by': 'Amended by',
  amends: 'Amends',
  related: 'Related',
  'cited-by': 'Referenced by',
};

/** Strongest relation first, so the reader learns the record's fate before its neighbours. */
const RELATION_ORDER: Array<RelationKind | 'cited-by'> = [
  'superseded-by',
  'superseded-in-part-by',
  'supersedes',
  'supersedes-in-part',
  'amended-by',
  'amends',
  'related',
  'cited-by',
];

export interface BuildOptions {
  scope: string;
  /** Fixed timestamp so the same corpus produces the same page. */
  now: Date;
}

export function buildModel(corpus: Corpus, options: BuildOptions): WebModel {
  const slugs = assignSlugs(corpus.adrs);

  const records = corpus.adrs.map((adr) => toRecord(adr, corpus, slugs));

  const groupCounts = new Map<string, number>();
  for (const record of records) {
    groupCounts.set(record.group, (groupCounts.get(record.group) ?? 0) + 1);
  }

  const statusCounts = (Object.keys(STATUS_LABELS) as Status[])
    .map((status) => ({
      status,
      label: STATUS_LABELS[status],
      count: records.filter((r) => r.status === status).length,
    }))
    .filter((entry) => entry.count > 0);

  return {
    scope: options.scope,
    records,
    groups: [...groupCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    statusCounts,
    totals: {
      records: records.length,
      current: records.filter((r) => !r.replacedBy).length,
      words: records.reduce((sum, r) => sum + r.words, 0),
      minutes: records.reduce((sum, r) => sum + r.minutes, 0),
    },
    mostCited: [...records]
      .filter((r) => r.citedBy > 0)
      .sort((a, b) => b.citedBy - a.citedBy || (a.number ?? 0) - (b.number ?? 0))
      .slice(0, 8)
      .map((r) => ({
        slug: r.slug,
        numberLabel: r.numberLabel,
        title: r.title,
        status: r.status,
        citedBy: r.citedBy,
        gist: r.gist,
      })),
    chains: buildChains(corpus, slugs),
    generatedAt: options.now.toISOString().slice(0, 10),
  };
}

/* ---------------------------------------------------------------------- slugs */

/**
 * Stable, readable url fragments. Numbers repeat across directories, so a
 * collision falls back to including the directory.
 */
function assignSlugs(adrs: AdrNode[]): Map<string, string> {
  const slugs = new Map<string, string>();
  const taken = new Map<string, number>();

  for (const adr of adrs) {
    const base = slugify(adr.numberLabel ? `${adr.numberLabel}-${adr.title}` : adr.title).slice(
      0,
      72,
    );

    const seen = taken.get(base) ?? 0;
    taken.set(base, seen + 1);
    slugs.set(adr.id, seen === 0 ? base : `${base}-${seen + 1}`);
  }

  return slugs;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'record'
  );
}

/* --------------------------------------------------------------------- records */

function toRecord(adr: AdrNode, corpus: Corpus, slugs: Map<string, string>): WebRecord {
  const slug = slugs.get(adr.id)!;
  const gistText = decisionLine(adr);

  const bodyHtml = renderHtml(adr.content, {
    skipTitle: true,
    // `##` inside a record becomes `<h2>` in a page whose `<h1>` is the title.
    headingOffset: 0,
    idPrefix: slug,
    resolveLink: (href) => resolveLink(href, adr, corpus, slugs, slug),
  });

  const replacement = adr.supersededBy ? corpus.byId.get(adr.supersededBy) : undefined;
  const current = currentVersion(adr, corpus.byId);

  return {
    id: adr.id,
    slug,
    number: adr.number,
    numberLabel: adr.numberLabel ?? '—',
    title: adr.title,
    status: adr.status,
    statusLabel: STATUS_LABELS[adr.status],
    statusProse: statusProse(adr, corpus, slugs),
    date: adr.date,
    dateLabel: adr.date ?? '—',
    dateLong: longDate(adr.date),
    author: adr.author,
    minutes: readingMinutes(adr),
    words: adr.wordCount,
    gist: gistText ? renderInlineHtml(gistText) : null,
    gistText,
    citation: citation(adr),
    source: adr.raw,
    group: dirname(adr.id),
    citedBy: adr.inbound.length,
    bodyHtml,
    replacedBy: replacement
      ? { slug: slugs.get(replacement.id)!, label: label(replacement) }
      : null,
    currentSlug: current.id === adr.id ? null : (slugs.get(current.id) ?? null),
    relations: buildRelations(adr, corpus, slugs),
    haystack: buildHaystack(adr, gistText),
  };
}

/**
 * How a decision gets named somewhere that is not this page — a commit message,
 * a ticket, a review comment:
 *
 *     ADR-0009 Single-store idempotency gate (accepted, 2026-04-18)
 *
 * The normalised status is used rather than the raw line, because a citation
 * wants one word and `statusRaw` is often a whole sentence. An unnumbered or
 * undated record simply drops that part rather than citing an em dash.
 */
function citation(adr: AdrNode): string {
  const head = adr.numberLabel ? `ADR-${adr.numberLabel} ${adr.title}` : adr.title;
  const facts = [adr.status === 'unknown' ? null : adr.status, adr.date].filter(Boolean);

  return facts.length > 0 ? `${head} (${facts.join(', ')})` : head;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `2026-06-04` becomes `4 June 2026`. Formatted by hand rather than through
 * `toLocaleDateString`, so the same corpus renders identically on every machine
 * and the tests can assert on it.
 */
function longDate(iso: string | null): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number.parseInt(match[2]!, 10) - 1];
  if (!month) return iso;
  return `${Number.parseInt(match[3]!, 10)} ${month} ${match[1]}`;
}

/** Words that a status line spends on saying which state it is in. */
const STATUS_BOILERPLATE =
  /\b(?:accepted|proposed|rejected|deprecated|approved|adopted|draft|supersed(?:ed|es)|amended|revised|replaced|by|in|part|partly|partially|parts?|of|see|the|this|and|remains?|force|adr)\b/gi;

/**
 * Show the raw status only when it says something the page does not already
 * show. "Superseded by ADR-0065" duplicates the replaced notice and its link,
 * whereas "Accepted. Scope narrowed by TCK-1042; the rest remains in force" is
 * often the single most important sentence in the record.
 */
function statusProse(adr: AdrNode, corpus: Corpus, slugs: Map<string, string>): string | null {
  if (!adr.statusRaw) return null;

  const flat = adr.statusRaw.replace(/\s+/g, ' ').trim();

  // Reduce to the words that are neither state vocabulary nor a bare reference,
  // and keep the line only if a real clause survives.
  const substantive = flat
    .replace(/\[([^\]\n]*)\]\([^)\s]+\)/g, ' ')
    .replace(/\b[A-Z]{2,}-\d+\b/g, ' ')
    .replace(/\b\d{1,5}\b/g, ' ')
    .replace(STATUS_BOILERPLATE, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);

  if (substantive.length < 3) return null;

  return renderInlineHtml(flat, {
    resolveLink: (href) => resolveLink(href, adr, corpus, slugs),
  });
}

function buildRelations(
  adr: AdrNode,
  corpus: Corpus,
  slugs: Map<string, string>,
): WebRelationGroup[] {
  const grouped = new Map<RelationKind | 'cited-by', AdrNode[]>();
  const add = (kind: RelationKind | 'cited-by', node: AdrNode): void => {
    const list = grouped.get(kind) ?? [];
    if (!list.some((n) => n.id === node.id)) list.push(node);
    grouped.set(kind, list);
  };

  for (const relation of [...adr.relations, ...adr.mirrored]) {
    const target = corpus.byId.get(relation.targetId);
    if (target) add(relation.kind, target);
  }

  const stated = new Set([...adr.relations, ...adr.mirrored].map((r) => r.targetId));
  for (const id of adr.inbound) {
    if (stated.has(id)) continue;
    const node = corpus.byId.get(id);
    if (node) add('cited-by', node);
  }

  const shown = new Set<string>();
  const groups: WebRelationGroup[] = [];

  for (const kind of RELATION_ORDER) {
    const nodes = (grouped.get(kind) ?? []).filter((node) => !shown.has(node.id));
    if (nodes.length === 0) continue;

    for (const node of nodes) shown.add(node.id);

    groups.push({
      kind,
      label: RELATION_LABELS[kind],
      entries: nodes
        .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
        .map((node) => ({
          slug: slugs.get(node.id)!,
          numberLabel: node.numberLabel ?? '—',
          title: node.title,
          status: node.status,
          superseded: node.supersededBy !== null,
        })),
    });
  }

  return groups;
}

/**
 * Turn a link into something clickable in a single page. Sibling records become
 * in-page routes; external urls pass through; a local path that is not a record
 * (a plan, a report, a source file) is unlinked rather than left broken.
 */
function resolveLink(
  href: string,
  from: AdrNode,
  corpus: Corpus,
  slugs: Map<string, string>,
  ownSlug?: string,
): { href: string; internal: boolean } | null {
  if (/^(?:https?:|mailto:)/i.test(href)) return { href, internal: false };

  // An anchor to a heading in this same record. Heading ids are slug-prefixed to
  // stay unique across a hundred records, and the author's hand-written anchor
  // has to go through the same slug rule — GitHub keeps the double hyphen in
  // `amendment--2026-08-04`, this does not.
  if (href.startsWith('#')) {
    if (!ownSlug) return null;
    const anchor = decodeURIComponent(href.slice(1));
    if (!anchor) return null;
    return { href: `#${headingId(anchor, ownSlug)}`, internal: true };
  }

  const link = from.links.find((l) => l.href === href);
  if (link?.targetId) {
    const slug = slugs.get(link.targetId);
    if (slug) return { href: `#/${slug}`, internal: true };
  }

  // Try the bare filename, for references written without a path.
  const base = href.split('#')[0]!.split('/').pop() ?? '';
  for (const node of corpus.adrs) {
    if (node.path.endsWith(`/${base}`) && base) {
      return { href: `#/${slugs.get(node.id)}`, internal: true };
    }
  }

  return null;
}

function label(adr: AdrNode): string {
  return adr.numberLabel ? `${adr.numberLabel} · ${adr.title}` : adr.title;
}

/**
 * The text the client search runs over. Body prose is included — finding the one
 * record that mentions a queue name is the whole point — but fenced code and
 * markdown punctuation are stripped, which cuts the payload substantially
 * without losing anything anyone searches for.
 */
function buildHaystack(adr: AdrNode, gist: string | null): string {
  const prose = adr.content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/\[([^\]\n]*)\]\([^)\s]+\)/g, '$1')
    .replace(/[#*_>|`~-]+/g, ' ');

  return [adr.numberLabel, adr.title, gist, dirname(adr.id), prose]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The projection handed to the browser. The rendered body, relations, and status
 * prose all live in the page's markup already, so shipping them again as JSON
 * would double the file for nothing.
 *
 * `source` is the exception, and a deliberate one: "copy as markdown" cannot be
 * satisfied from the rendered body, so the markdown has to travel. On the
 * bundled example corpus it costs about 13 kB against an 88 kB page, and it
 * compresses against the rendered body it duplicates — roughly 3 kB gzipped.
 */
export interface ClientRecord {
  slug: string;
  numberLabel: string;
  title: string;
  status: Status;
  group: string;
  citedBy: number;
  dateLabel: string;
  minutes: number;
  gistText: string | null;
  citation: string;
  source: string;
  replaced: boolean;
  haystack: string;
}

export type SortKey = 'newest' | 'number' | 'cited';

export interface ClientModel {
  scope: string;
  records: ClientRecord[];
  groups: Array<{ name: string; count: number }>;
  /**
   * Record indices in each sort order, computed here rather than in the browser
   * so the ordering rules are covered by tests.
   */
  orders: Record<SortKey, number[]>;
}

export function toClientModel(model: WebModel): ClientModel {
  return {
    scope: model.scope,
    groups: model.groups,
    orders: buildOrders(model.records),
    records: model.records.map((record) => ({
      slug: record.slug,
      numberLabel: record.numberLabel,
      title: record.title,
      status: record.status,
      group: record.group,
      citedBy: record.citedBy,
      dateLabel: record.dateLabel,
      minutes: record.minutes,
      gistText: record.gistText,
      citation: record.citation,
      source: record.source,
      replaced: record.replacedBy !== null,
      haystack: record.haystack,
    })),
  };
}

/**
 * The three orders the register offers.
 *
 * An undated record always sorts last, never first: a missing date is not a
 * claim to be recent. Ties fall back to number so the order is total and the
 * page renders identically for the same corpus.
 */
export function buildOrders(records: WebRecord[]): Record<SortKey, number[]> {
  const index = records.map((_, i) => i);
  const byNumber = (a: number, b: number): number =>
    (records[a]!.number ?? Number.MAX_SAFE_INTEGER) -
    (records[b]!.number ?? Number.MAX_SAFE_INTEGER);

  return {
    number: [...index].sort(byNumber),

    newest: [...index].sort((a, b) => {
      const da = records[a]!.date;
      const db = records[b]!.date;
      if (da && db) return db.localeCompare(da) || byNumber(a, b);
      if (da) return -1;
      if (db) return 1;
      return byNumber(a, b);
    }),

    cited: [...index].sort((a, b) => records[b]!.citedBy - records[a]!.citedBy || byNumber(a, b)),
  };
}

/* ---------------------------------------------------------------------- chains */

function buildChains(corpus: Corpus, slugs: Map<string, string>): WebChain[] {
  const chains: WebChain[] = [];
  const visited = new Set<string>();

  const heads = corpus.adrs.filter(
    (adr) => adr.supersededBy !== null && adr.supersedes.length === 0,
  );

  for (const head of heads) {
    if (visited.has(head.id)) continue;

    const nodes: AdrNode[] = [head];
    visited.add(head.id);
    let node = head;

    while (node.supersededBy) {
      const next = corpus.byId.get(node.supersededBy);
      if (!next || visited.has(next.id)) break;
      visited.add(next.id);
      nodes.push(next);
      node = next;
    }

    if (nodes.length < 2) continue;

    chains.push({
      entries: nodes.map((n, i) => ({
        slug: slugs.get(n.id)!,
        numberLabel: n.numberLabel ?? '—',
        current: i === nodes.length - 1,
      })),
      title: nodes[nodes.length - 1]!.title,
    });
  }

  return chains.sort((a, b) => b.entries.length - a.entries.length);
}
