import { sectionKey, stripInline } from './parse.ts';
import type { AdrNode, Section } from './types.ts';

/**
 * The single sentence that answers "what did we decide?".
 *
 * Authors put the decision in a `## Decision` section, so that is the source of
 * truth. The hard part is that the section rarely *opens* with the decision:
 * it opens with a sub-heading, a bolded label, or a lead-in fragment. So this
 * walks the section's sentences and returns the first one that reads like a
 * statement rather than a signpost.
 */
export function decisionLine(adr: AdrNode): string | null {
  const decision = findSection(adr, ['decision', 'decisions', 'the decision', 'outcome']);
  const source = decision ?? findSection(adr, ['summary', 'context', 'problem']);
  const body = source ? source.body : adr.body;

  return firstStatement(stripStructure(body)) ?? firstSentence(stripInline(body)) ?? null;
}

/**
 * The first sentence that carries actual content. Rejects, in order of how often
 * they show up in real ADRs:
 *
 * - bolded pseudo-headings — `**Error policy.**` on its own line
 * - fragments too short to say anything
 * - bare cross-references and metadata restatements
 */
function firstStatement(text: string): string | null {
  for (const raw of splitSentences(text)) {
    const bareBold = /^(\*\*|__)(.+?)\1[.:]?$/s.exec(raw.trim());
    if (bareBold) continue; // the whole sentence is one bold run: a label, not a decision

    const plain = stripInline(raw).replace(/\s+/g, ' ').trim();
    if (plain.length < 25) continue;
    if (/^(see|see also|cf\.?|as above|as below|n\/?a)\b/i.test(plain)) continue;

    return truncate(plain, 220);
  }
  return null;
}

/** Split prose into sentences, keeping abbreviations and decimals intact. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(*_[])|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * How many other records point at this one. In a large corpus this is the most
 * useful reading signal available: the decisions everything else cites are the
 * ones a newcomer has to understand first.
 */
export function influence(adr: AdrNode): number {
  return adr.inbound.length;
}

/** Records nothing points at and which point at nothing — often stale or forgotten. */
export function isOrphan(adr: AdrNode): boolean {
  return adr.inbound.length === 0 && adr.outbound.length === 0;
}

/** Rough reading time in minutes, at 220 words per minute, floored at 1. */
export function readingMinutes(adr: AdrNode): number {
  return Math.max(1, Math.round(adr.wordCount / 220));
}

/** Whole days between `date` and now, or null when the record is undated. */
export function ageInDays(adr: AdrNode, now: Date): number | null {
  if (!adr.date) return null;
  const then = Date.parse(`${adr.date}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

export function formatAge(days: number | null): string {
  if (days === null) return '—';
  if (days < 1) return 'today';
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/**
 * Follow `superseded-by` edges to the record that currently holds. Cycles are
 * broken rather than followed, since a mutual supersession is a lint finding not
 * a traversal problem.
 */
export function currentVersion(adr: AdrNode, byId: Map<string, AdrNode>): AdrNode {
  const seen = new Set<string>([adr.id]);
  let node = adr;
  while (node.supersededBy) {
    const next = byId.get(node.supersededBy);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    node = next;
  }
  return node;
}

/** The chain of records this one replaced, oldest first. */
export function supersessionChain(adr: AdrNode, byId: Map<string, AdrNode>): AdrNode[] {
  const chain: AdrNode[] = [];
  const seen = new Set<string>([adr.id]);
  const queue = [...adr.supersedes];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (!node) continue;
    chain.push(node);
    queue.push(...node.supersedes);
  }

  return chain.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

/* ------------------------------------------------------------------- internals */

export function findSection(adr: AdrNode, keys: string[]): Section | undefined {
  const wanted = keys.map(sectionKey);
  for (const key of wanted) {
    const exact = adr.sections.find((s) => s.key === key);
    if (exact?.body.trim()) return exact;
  }
  for (const key of wanted) {
    const prefixed = adr.sections.find((s) => s.key.startsWith(`${key} `) && s.body.trim());
    if (prefixed) return prefixed;
  }
  return undefined;
}

/** Drop fenced code, tables, and list markers so sentence extraction sees prose. */
function stripStructure(body: string): string {
  const lines = body.split('\n');
  const kept: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*\|/.test(line)) continue; // table row
    if (/^\s{0,3}#{1,6}\s/.test(line)) continue; // nested heading
    kept.push(line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''));
  }

  return kept.join('\n').trim();
}

export function firstSentence(text: string): string | null {
  const normalised = text.replace(/\s+/g, ' ').trim();
  if (!normalised) return null;

  // Avoid splitting on abbreviations and decimals that commonly appear in ADRs.
  const match = /^(.{15,}?[.!?])(?=\s+[A-Z(]|$)/.exec(normalised);
  const sentence = match?.[1] ?? normalised;

  return truncate(sentence.replace(/\s+/g, ' ').trim(), 220);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
