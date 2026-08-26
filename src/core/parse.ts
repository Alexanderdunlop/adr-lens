import { basename } from 'node:path';
import { normaliseStatus } from './status.ts';
import type { Link, ParsedAdr, RawRef, RawRelation, RelationKind, Section } from './types.ts';

const FENCE = /^\s{0,3}(```+|~~~+)/;
const ATX_HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Title prefixes that encode the record's number rather than its subject:
 * `# 2. Thing`, `# ADR-001: Thing`, `# ADR 12 — Thing`, `# 0002 - Thing`.
 */
const TITLE_NUMBER_PREFIXES: readonly RegExp[] = [
  /^ADR[-\s_]?(\d+)\s*[:.\-–—]\s*/i,
  /^(\d+)\s*[.:]\s+/,
  /^(\d+)\s*[-–—]\s+/,
];

export interface ParseOptions {
  /** Corpus-relative id to assign, defaults to the file's basename. */
  id?: string;
  path?: string;
}

export function parseAdr(raw: string, options: ParseOptions = {}): ParsedAdr {
  const path = options.path ?? options.id ?? 'unknown.md';
  const id = options.id ?? basename(path);
  const warnings: string[] = [];

  const { frontmatter, body: afterFrontmatter, offset } = stripFrontmatter(raw);
  const lines = afterFrontmatter.split('\n');
  const codeMask = maskCodeFences(lines);

  const heading = findTitleHeading(lines, codeMask);
  const rawTitle = heading?.text ?? '';
  const { number: titleNumber, title } = splitTitleNumber(rawTitle);

  const fileNumber = numberFromFilename(basename(path));
  const number = fileNumber?.value ?? titleNumber ?? null;
  const numberLabel = fileNumber?.label ?? (titleNumber === null ? null : String(titleNumber));

  if (!heading) warnings.push('No level-1 heading — title inferred from filename.');
  if (fileNumber && titleNumber !== null && fileNumber.value !== titleNumber) {
    warnings.push(
      `Filename number (${fileNumber.value}) disagrees with title number (${titleNumber}).`,
    );
  }

  const bodyStart = heading ? heading.index + 1 : 0;
  const body = lines.slice(bodyStart).join('\n');

  const sections = extractSections(lines, codeMask, bodyStart, offset);
  const preamble = lines.slice(
    bodyStart,
    sections[0]?.line ? sections[0].line - offset - 1 : undefined,
  );

  const statusRaw =
    firstNonEmpty(sectionBody(sections, 'status')) ??
    fieldValue(preamble, 'status') ??
    fieldValue(lines, 'status') ??
    frontmatter.status ??
    null;

  const date =
    normaliseDate(fieldValue(preamble, 'date') ?? fieldValue(lines, 'date') ?? frontmatter.date) ??
    null;

  const author =
    fieldValue(preamble, 'author') ??
    fieldValue(preamble, 'authors') ??
    fieldValue(preamble, 'deciders') ??
    frontmatter.author ??
    frontmatter.deciders ??
    null;

  if (!statusRaw) warnings.push('No status found.');
  if (!date) warnings.push('No date found.');

  const links = extractLinks(afterFrontmatter, lines, codeMask, sections, offset);
  const rawRelations = extractRelations(statusRaw, sections, lines, codeMask);

  const titleFallback = title || humaniseFilename(basename(path));

  return {
    id,
    path,
    number,
    numberLabel,
    title: titleFallback,
    status: normaliseStatus(statusRaw),
    statusRaw: statusRaw?.trim() ?? null,
    date,
    author: author?.trim() ?? null,
    sections,
    links,
    rawRelations,
    raw,
    body,
    content: stripMetadataPreamble(body),
    wordCount: countWords(body),
    warnings,
  };
}

/* ------------------------------------------------------------------ frontmatter */

interface Frontmatter {
  status?: string;
  date?: string;
  author?: string;
  deciders?: string;
  [key: string]: string | undefined;
}

function stripFrontmatter(raw: string): {
  frontmatter: Frontmatter;
  body: string;
  offset: number;
} {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, body: raw, offset: 0 };

  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end === -1) return { frontmatter: {}, body: raw, offset: 0 };

  const frontmatter: Frontmatter = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2]!.trim().replace(/^["']|["']$/g, '');
    if (value) frontmatter[match[1]!.toLowerCase()] = value;
  }

  return { frontmatter, body: lines.slice(end + 1).join('\n'), offset: end + 1 };
}

/* ---------------------------------------------------------------- code fencing */

/**
 * Returns a parallel array marking which lines sit inside a fenced code block.
 * Headings and links inside code samples must not be treated as structure.
 */
export function maskCodeFences(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = FENCE.exec(line);
    if (fence === null && match) {
      fence = match[1]!.slice(0, 1).repeat(3);
      mask[i] = true;
      continue;
    }
    if (fence !== null) {
      mask[i] = true;
      if (match && match[1]!.startsWith(fence)) fence = null;
    }
  }

  return mask;
}

/* --------------------------------------------------------------------- headings */

function findTitleHeading(
  lines: string[],
  mask: boolean[],
): { text: string; index: number } | null {
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    const match = ATX_HEADING.exec(lines[i]!);
    if (match && match[1]!.length === 1) {
      return { text: stripInline(match[2]!.trim()), index: i };
    }
    // A setext title (`Title` followed by `=====`) is rare but cheap to support.
    if (/^=+\s*$/.test(lines[i]!) && i > 0 && lines[i - 1]!.trim()) {
      return { text: stripInline(lines[i - 1]!.trim()), index: i };
    }
  }
  return null;
}

function extractSections(
  lines: string[],
  mask: boolean[],
  from: number,
  offset: number,
): Section[] {
  const heads: Array<{ title: string; depth: number; index: number }> = [];

  for (let i = from; i < lines.length; i++) {
    if (mask[i]) continue;
    const match = ATX_HEADING.exec(lines[i]!);
    if (!match || match[1]!.length < 2) continue;
    heads.push({
      title: stripInline(match[2]!.trim().replace(/\s*#+\s*$/, '')),
      depth: match[1]!.length,
      index: i,
    });
  }

  return heads.map((head, i) => {
    // A section runs until the next heading at the same or shallower depth, so a
    // `## Decision` whose content starts with `### ...` still has a body. Ending
    // at the *next* heading of any depth would make such sections read as empty.
    let end = lines.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j]!.depth <= head.depth) {
        end = heads[j]!.index;
        break;
      }
    }

    return {
      title: head.title,
      key: sectionKey(head.title),
      depth: head.depth,
      body: lines
        .slice(head.index + 1, end)
        .join('\n')
        .trim(),
      line: head.index + offset + 1,
      endLine: end + offset + 1,
    };
  });
}

export function sectionKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sectionBody(sections: Section[], key: string): string | null {
  const exact = sections.find((s) => s.key === key);
  if (exact) return exact.body;
  const prefixed = sections.find((s) => s.key.startsWith(`${key} `));
  return prefixed?.body ?? null;
}

/* ------------------------------------------------------------------ field lines */

/** Reads `Date: 2026-01-01`, `**Status:** Accepted`, `- Status: Accepted`. */
function fieldValue(lines: string[], field: string): string | null {
  const pattern = new RegExp(
    `^\\s*(?:[-*]\\s*)?(?:\\*\\*|__)?${field}(?:\\*\\*|__)?\\s*:\\s*(.+)$`,
    'i',
  );
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) {
      const value = match[1]!.trim().replace(/\*\*/g, '').trim();
      if (value) return value;
    }
  }
  return null;
}

const METADATA_FIELDS =
  /^\s*(?:[-*]\s*)?(?:\*\*|__)?(?:status|date|author|authors|deciders|decider|owner|owners|tags|version|informed|consulted|driver|supersedes|superseded[-\s]by|related|reviewers?)(?:\*\*|__)?\s*:/i;

/**
 * Drop the run of `Key: value` lines at the top of a body. Stops at the first
 * line that is neither blank nor a known field, so a genuine opening paragraph
 * is never mistaken for metadata.
 */
function stripMetadataPreamble(body: string): string {
  const lines = body.split('\n');
  let i = 0;
  let dropped = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (METADATA_FIELDS.test(line)) {
      dropped++;
      i++;
      continue;
    }
    break;
  }

  return dropped > 0 ? lines.slice(i).join('\n') : body;
}

function firstNonEmpty(text: string | null): string | null {
  if (!text) return null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function normaliseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // `2 March 2026`, `March 2, 2026`, `02/03/2026` — fall back to Date parsing but
  // reject anything that lands on an invalid day.
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(text)) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

/* ----------------------------------------------------------------------- number */

function numberFromFilename(name: string): { value: number; label: string } | null {
  const match = /^(\d{1,5})[-_.\s]/.exec(name);
  if (!match) return null;
  return { value: Number.parseInt(match[1]!, 10), label: match[1]! };
}

function splitTitleNumber(title: string): { number: number | null; title: string } {
  for (const pattern of TITLE_NUMBER_PREFIXES) {
    const match = pattern.exec(title);
    if (match) {
      return {
        number: Number.parseInt(match[1]!, 10),
        title: title.slice(match[0].length).trim(),
      };
    }
  }
  return { number: null, title: title.trim() };
}

function humaniseFilename(name: string): string {
  const stem = name.replace(/\.md$/i, '').replace(/^\d+[-_.\s]*/, '');
  const words = stem.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/* ------------------------------------------------------------------------ links */

const MD_LINK_SOURCE = /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;

/**
 * Every scan builds its own regex rather than sharing a module-level `/g` one.
 * A shared global regex carries `lastIndex` between callers, and `String.replace`
 * resets it — which is enough to turn a nested `exec` loop into a hang.
 */
function globalPattern(source: RegExp): RegExp {
  return new RegExp(source.source, `${source.flags.replace('g', '')}g`);
}

function extractLinks(
  _full: string,
  lines: string[],
  mask: boolean[],
  sections: Section[],
  offset: number,
): Link[] {
  const links: Link[] = [];
  const pattern = globalPattern(MD_LINK_SOURCE);

  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    for (const match of lines[i]!.matchAll(pattern)) {
      links.push({
        text: stripInline(match[1]!),
        href: match[2]!,
        broken: false,
        section: sectionAtLine(sections, i + offset + 1),
      });
    }
  }

  return links;
}

function sectionAtLine(sections: Section[], line: number): string | undefined {
  let current: string | undefined;
  for (const section of sections) {
    if (section.line <= line) current = section.title;
    else break;
  }
  return current;
}

/* -------------------------------------------------------------------- relations */

const SUPERSEDED_BY = /\bsupersed(?:ed|es)?\s+(?:(?:in\s+part|partly|partially)\s+)?by\b/i;
const SUPERSEDES = /\bsupersed(?:es|ing|ed\s+the)\b/i;
const AMENDED_BY = /\b(?:amended|revised|updated|refined|narrowed|extended|clarified)\s+by\b/i;
const AMENDS = /\b(?:amends|revises|refines|narrows|extends|clarifies)\b/i;

/**
 * Qualifiers that turn a supersession into a partial one. Authors write this in
 * at least four ways, and the distinction changes whether the record is dead.
 */
const PARTIAL = /\b(?:in\s+part|partl?y|partially|parts?\s+of)\b/i;

/**
 * The other way authors write partial supersession: they name which parts died
 * and then say what survives. If a status says anything remains in force, the
 * supersession it also describes cannot have been total.
 */
/** A bullet or sentence whose first token is a cross-reference. */
const OPENS_WITH_REF = /^\s*(?:[-*+]\s*)?(?:\*\*|__)?(?:\[|`?ADR[-\s_]?#?\d)/i;

const REMAINS_IN_FORCE =
  /\b(?:remains?|still)\s+(?:in\s+force|valid|applicable|applies|current|stands?|holds?)\b/i;

const PARTIAL_KIND: Partial<Record<RelationKind, RelationKind>> = {
  supersedes: 'supersedes-in-part',
  'superseded-by': 'superseded-in-part-by',
};

/**
 * Relations are inferred from the sentences that state them, because ADRs record
 * supersession in prose far more often than in structured fields. Direction is
 * decided by voice: "superseded by X" points forward, "supersedes X" points back.
 */
function extractRelations(
  statusRaw: string | null,
  sections: Section[],
  lines: string[],
  mask: boolean[],
): RawRelation[] {
  const relations: RawRelation[] = [];
  const seen = new Set<string>();

  const push = (kind: RelationKind, ref: RawRef, evidence: string): void => {
    const dedupe = `${kind}:${ref.kind}:${ref.value}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    relations.push({ kind, ref, evidence: evidence.trim().slice(0, 240) });
  };

  const scanSentence = (sentence: string, hedged = false): void => {
    const refs = refsIn(sentence);
    if (refs.length === 0) return;

    // When a sentence *opens* with a reference, it is describing that record, not
    // this one: `- [ADR-0010](…) — original contract (superseded by TCK-1017)` is
    // a note about 0010's fate, and attributing it here would mark the wrong
    // record dead. Such lines contribute relatedness only.
    if (OPENS_WITH_REF.test(sentence)) return;

    // Order matters: the passive forms are more specific than the active ones.
    let kind: RelationKind | null = null;
    if (SUPERSEDED_BY.test(sentence)) kind = 'superseded-by';
    else if (SUPERSEDES.test(sentence)) kind = 'supersedes';
    else if (AMENDED_BY.test(sentence)) kind = 'amended-by';
    else if (AMENDS.test(sentence)) kind = 'amends';
    if (!kind) return;

    if (hedged || PARTIAL.test(sentence)) kind = PARTIAL_KIND[kind] ?? kind;

    for (const ref of refs) push(kind, ref, sentence);
  };

  // 1. The status line is the most authoritative place a supersession appears.
  // Partiality is judged against the whole status, not the single sentence: the
  // caveat that something survives is usually a sentence or two further on.
  const statusHedged = REMAINS_IN_FORCE.test(statusRaw ?? '');
  for (const sentence of sentences(statusRaw ?? '')) scanSentence(sentence, statusHedged);

  // 2. Explicit relation sections.
  for (const section of sections) {
    if (!/^(related|relations?|links?|see also|references?)\b/.test(section.key)) continue;
    for (const line of section.body.split('\n')) {
      const sentence = line.trim();
      if (!sentence) continue;
      scanSentence(sentence);
      // A bare bullet of links under `## Related` is a plain relation.
      for (const ref of refsIn(sentence)) push('related', ref, sentence);
    }
  }

  // 3. Anywhere else in the prose.
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    const line = lines[i]!;
    if (!/supersed|amend/i.test(line)) continue;
    for (const sentence of sentences(line)) scanSentence(sentence);
  }

  return relations;
}

const ADR_FILE_REF = /(?:^|[(\s/])((?:\d{1,5})[-_][a-z0-9][a-z0-9-_]*\.md)/i;
const ADR_NUMBER_REF = /\bADR[-\s_]?#?(\d{1,5})\b/i;

/**
 * Date-prefixed filenames (`2026-04-12-003-some-plan.md`) satisfy the ADR pattern
 * but are plans, RFCs, and meeting notes — not decision records.
 */
const DATE_PREFIXED = /^\d{4}[-_]\d{1,2}[-_]\d{1,2}/;

function refsIn(text: string): RawRef[] {
  const refs: RawRef[] = [];
  const seen = new Set<string>();

  const add = (ref: RawRef): void => {
    const key = `${ref.kind}:${ref.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const match of text.matchAll(globalPattern(ADR_FILE_REF))) {
    if (DATE_PREFIXED.test(match[1]!)) continue;
    add({ kind: 'path', value: match[1]! });
  }

  for (const match of text.matchAll(globalPattern(ADR_NUMBER_REF))) {
    add({ kind: 'number', value: String(Number.parseInt(match[1]!, 10)) });
  }

  return refs;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+(?=[A-Z([])|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------------ misc */

/** Strip inline markdown emphasis and link syntax for plain-text display. */
export function stripInline(text: string): string {
  return text
    .replace(globalPattern(MD_LINK_SOURCE), '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .trim();
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu);
  return matches?.length ?? 0;
}
