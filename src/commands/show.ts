import { relative } from 'node:path';
import {
  ageInDays,
  currentVersion,
  decisionLine,
  formatAge,
  readingMinutes,
  supersessionChain,
} from '../core/digest.ts';
import type { AdrNode, Relation } from '../core/types.ts';
import { parseInline, truncateToWidth, visibleWidth, wrapSpans } from '../render/inline.ts';
import { renderMarkdown } from '../render/markdown.ts';
import { paintAll, statusBadge, theme } from '../render/theme.ts';
import type { CommandContext } from './context.ts';

export interface ShowOptions {
  /** Print only the header and the decision line. */
  summary?: boolean;
  /** Print link destinations under the text. */
  urls?: boolean;
  /** Restrict the body to these section keys. */
  sections?: string[];
}

export function renderShow(
  context: CommandContext,
  adr: AdrNode,
  options: ShowOptions = {},
): string[] {
  const width = context.width;
  const out: string[] = [];

  out.push(...renderHeader(context, adr));
  out.push('');

  const decision = decisionLine(adr);
  if (decision) {
    // The lead paragraph is the whole point of the tool: one sentence, before any
    // context, answering "what was decided".
    out.push(...wrapSpans([{ text: decision }], width, '  ', paintAll(theme.bold)));
    out.push('');
  }

  if (options.summary) {
    out.push(...renderRelations(context, adr, width));
    return out;
  }

  out.push(theme.rule('─'.repeat(width)));

  const body = options.sections?.length ? selectSections(adr, options.sections) : adr.content;
  out.push(...renderMarkdown(body, { width, showUrls: options.urls, skipTitle: true }));

  const relations = renderRelations(context, adr, width);
  if (relations.length > 0) {
    out.push('');
    out.push(theme.rule('─'.repeat(width)));
    out.push(...relations);
  }

  return out;
}

/* --------------------------------------------------------------------- header */

function renderHeader(context: CommandContext, adr: AdrNode): string[] {
  const width = context.width;
  const out: string[] = [];

  const number = adr.numberLabel ? theme.dim(`ADR ${adr.numberLabel}`) : theme.dim('ADR');
  const title = theme.h1(adr.title);
  const heading = `${number}  ${title}`;

  out.push(
    ...wrapSpans(
      [{ text: `${adr.numberLabel ? `ADR ${adr.numberLabel}  ` : ''}${adr.title}` }],
      width,
      '',
      paintAll(theme.h1),
    ),
  );
  out.push(theme.rule('═'.repeat(Math.min(width, visibleWidth(heading)))));

  // Metadata reads as a single line where it fits, because a four-line header
  // pushes the actual decision below the fold.
  const facts: string[] = [statusBadge(adr.status)];
  if (adr.date) facts.push(theme.dim(`${adr.date} (${formatAge(ageInDays(adr, context.now))})`));
  facts.push(theme.dim(`~${readingMinutes(adr)} min`));
  if (adr.inbound.length > 0) {
    facts.push(theme.dim(`cited by ${adr.inbound.length}`));
  }
  if (adr.author) facts.push(theme.dim(adr.author));

  out.push(facts.join(theme.dim('  ·  ')));
  out.push(theme.dim(relative(process.cwd(), adr.path)));

  // A status line that carries prose ("Accepted. Scope narrowed by TCK-1042")
  // holds real information the badge throws away.
  if (adr.statusRaw && adr.statusRaw.length > 24) {
    out.push('');
    out.push(
      ...wrapSpans(parseInline(adr.statusRaw), width, '  ', (span) =>
        span.href ? theme.link : theme.meta,
      ),
    );
  }

  const current = currentVersion(adr, context.corpus.byId);
  if (current.id !== adr.id) {
    out.push('');
    out.push(theme.warn(`⚠ Superseded. Current thinking: ${label(current)}`));
  }

  return out;
}

/* ------------------------------------------------------------------ relations */

const RELATION_LABELS: Record<Relation['kind'], string> = {
  supersedes: 'Supersedes',
  'superseded-by': 'Superseded by',
  'supersedes-in-part': 'Supersedes in part',
  'superseded-in-part-by': 'Superseded in part by',
  amends: 'Amends',
  'amended-by': 'Amended by',
  related: 'Related',
};

/** Most-consequential relations first — supersession before mere relatedness. */
const RELATION_ORDER: Relation['kind'][] = [
  'superseded-by',
  'superseded-in-part-by',
  'supersedes',
  'supersedes-in-part',
  'amended-by',
  'amends',
  'related',
];

function renderRelations(context: CommandContext, adr: AdrNode, width: number): string[] {
  const out: string[] = [];
  const byId = context.corpus.byId;

  const grouped = new Map<Relation['kind'], AdrNode[]>();
  const add = (kind: Relation['kind'], target: AdrNode): void => {
    const list = grouped.get(kind) ?? [];
    if (!list.some((n) => n.id === target.id)) list.push(target);
    grouped.set(kind, list);
  };

  // Both what this record says about others and what others say about it — an
  // author usually writes only one side of a supersession.
  for (const relation of [...adr.relations, ...adr.mirrored]) {
    const target = byId.get(relation.targetId);
    if (target) add(relation.kind, target);
  }

  for (const node of supersessionChain(adr, byId)) add('supersedes', node);

  const stated = new Set([...adr.relations, ...adr.mirrored].map((r) => r.targetId));

  // Records that cite this one are the most useful navigation the tool offers:
  // they are the consequences of this decision, written by other people.
  const citedBy = adr.inbound
    .map((id) => byId.get(id))
    .filter((n): n is AdrNode => n !== undefined)
    .filter((n) => !stated.has(n.id));

  // RELATION_ORDER runs strongest-first, so a record already listed under
  // supersession is not repeated under the weaker "Related".
  const shown = new Set<string>();

  for (const kind of RELATION_ORDER) {
    const targets = (grouped.get(kind) ?? []).filter((target) => !shown.has(target.id));
    if (targets.length === 0) continue;
    out.push('');
    out.push(theme.h3(RELATION_LABELS[kind]));
    for (const target of targets) {
      shown.add(target.id);
      out.push(`  ${bullet(target, width - 2)}`);
    }
  }

  const remaining = citedBy.filter((target) => !shown.has(target.id));
  if (remaining.length > 0) {
    out.push('');
    out.push(theme.h3(`Cited by (${remaining.length})`));
    for (const target of remaining) out.push(`  ${bullet(target, width - 2)}`);
  }

  return out;
}

function bullet(adr: AdrNode, width: number): string {
  const prefix = `${theme.bullet('•')} ${theme.dim((adr.numberLabel ?? '—').padStart(4))} `;
  const paint = adr.supersededBy ? theme.strike : (s: string) => s;
  return prefix + paint(truncateToWidth(adr.title, Math.max(10, width - 8)));
}

function label(adr: AdrNode): string {
  return adr.numberLabel ? `ADR ${adr.numberLabel} — ${adr.title}` : adr.title;
}

/* ------------------------------------------------------------------- sections */

function selectSections(adr: AdrNode, keys: string[]): string {
  const wanted = keys.map((k) => k.toLowerCase().trim());
  const matched = adr.sections.filter((section) =>
    wanted.some((key) => section.key === key || section.key.startsWith(`${key} `)),
  );

  // Section bodies include their subsections, so a match on both `## Decision`
  // and a `### ` inside it would print the nested content twice. Keep only the
  // outermost matches.
  const chosen = matched.filter(
    (section) =>
      !matched.some(
        (other) =>
          other !== section && other.line < section.line && other.endLine >= section.endLine,
      ),
  );

  if (chosen.length === 0) return `_No sections matched: ${keys.join(', ')}_`;

  return chosen
    .map((section) => `${'#'.repeat(section.depth)} ${section.title}\n\n${section.body}`)
    .join('\n\n');
}
