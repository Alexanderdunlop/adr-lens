import type { Corpus } from '../core/corpus.ts';
import type { Change, CorpusDiff, RecordDiff, RelationChange } from '../core/diff.ts';
import type { RevRange } from '../core/git.ts';
import { maskCodeFences, sectionKey } from '../core/parse.ts';
import type { AdrNode, RelationKind, Status } from '../core/types.ts';
import { escapeHtml, renderHtml } from '../render/html.ts';
import { buildModel, type WebRecord } from './data.ts';
import { DIFF_SCRIPT } from './diff-script.ts';
import { DIFF_STYLES } from './diff-styles.ts';
import { diffHtml } from './htmldiff.ts';
import { STYLES } from './styles.ts';

export interface DiffPageOptions {
  scope: string;
  title?: string;
  now?: Date;
}

const STATUS_LABELS: Record<Status, string> = {
  accepted: 'Accepted',
  proposed: 'Proposed',
  rejected: 'Rejected',
  deprecated: 'Deprecated',
  superseded: 'Superseded',
  unknown: 'No status',
};

const RELATION_TEXT: Record<RelationKind, string> = {
  supersedes: 'supersedes',
  'superseded-by': 'superseded by',
  'supersedes-in-part': 'partly supersedes',
  'superseded-in-part-by': 'partly superseded by',
  amends: 'amends',
  'amended-by': 'amended by',
  related: 'related to',
};

const FIELD_ORDER: Record<Change['field'], number> = {
  status: 0,
  decision: 1,
  relations: 2,
  sections: 3,
  title: 4,
  number: 5,
  path: 6,
  date: 7,
  author: 8,
  wording: 9,
};

/**
 * The whole comparison as one self-contained page: the change list on the left,
 * the two renderings of a record side by side on the right.
 *
 * It shares the reading page's stylesheet and its markdown renderer, so a record
 * under review looks exactly as it will once merged — which is the point. A
 * reviewer should not have to read a decision as raw markdown in one window and
 * as a document in another.
 */
export function renderDiffPage(
  diff: CorpusDiff,
  base: Corpus,
  head: Corpus,
  range: RevRange,
  options: DiffPageOptions,
): string {
  const now = options.now ?? new Date();
  const model = buildModel(head, { scope: options.scope, now });
  const slugs = new Map(model.records.map((record) => [record.id, record.slug]));

  const panes = diff.records.map((record) => renderChangePane(record, base, head, range, slugs));
  const title = options.title ?? `${range.baseLabel} → ${range.headLabel} · decisions`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
${STYLES}
${DIFF_STYLES}
</style>
</head>
<body>
<div class="app" id="app" data-view="register" data-mode="changes">
${renderRail(diff, model, range)}
<main class="reader" id="reader">
  <div class="reader-inner wide" id="reader-inner">
${renderOverview(diff, range)}
  </div>
</main>
<template id="tpl-changes">
${panes.join('\n')}
</template>
<template id="tpl-records">
${model.records.map((record) => renderRecordPane(record)).join('\n')}
</template>
</div>
<script>
window.__ADR_DIFF = ${jsonScript(clientModel(diff, model))};
${DIFF_SCRIPT}
</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ the client */

interface ClientEntry {
  slug: string;
  numberLabel: string;
  title: string;
  status: Status;
  /** `changed` records only: the loudest thing that happened, in a few words. */
  summary: string;
  significance: string;
  kind: string;
  haystack: string;
}

function clientModel(
  diff: CorpusDiff,
  model: ReturnType<typeof buildModel>,
): { changes: ClientEntry[]; records: ClientEntry[] } {
  const bySlug = new Map(model.records.map((record) => [record.id, record]));

  return {
    changes: diff.records.map((record) => {
      const web = bySlug.get(record.id);
      return {
        slug: paneSlug(record),
        numberLabel: record.numberLabel ?? '—',
        title: record.title,
        status: web?.status ?? 'unknown',
        summary: summarise(record),
        significance: record.significance,
        kind: record.kind,
        haystack: `${record.numberLabel ?? ''} ${record.title} ${summarise(record)}`.toLowerCase(),
      };
    }),
    records: model.records.map((record) => ({
      slug: record.slug,
      numberLabel: record.numberLabel,
      title: record.title,
      status: record.status,
      summary: record.gistText ?? '',
      significance: '',
      kind: record.replacedBy ? 'replaced' : '',
      haystack: record.haystack,
    })),
  };
}

/** One line saying what happened, for the list on the left. */
function summarise(record: RecordDiff): string {
  if (record.kind === 'added') return 'new record';
  if (record.kind === 'removed') return 'deleted';

  const parts: string[] = [];
  for (const change of [...record.changes].sort(
    (a, b) => FIELD_ORDER[a.field] - FIELD_ORDER[b.field],
  )) {
    switch (change.field) {
      case 'status':
        if (change.before !== change.after) {
          parts.push(
            `${STATUS_LABELS[change.before].toLowerCase()} → ${STATUS_LABELS[change.after].toLowerCase()}`,
          );
        }
        break;
      case 'decision':
        parts.push('decision rewritten');
        break;
      case 'relations':
        for (const edge of change.added)
          parts.push(`now ${RELATION_TEXT[edge.kind]} ${edge.targetLabel}`);
        break;
      case 'sections':
        if (change.removed.length > 0) parts.push(`lost ${change.removed.join(', ')}`);
        break;
      case 'path':
        parts.push('renamed');
        break;
      case 'wording':
        parts.push(
          `${change.sections.length} section${change.sections.length === 1 ? '' : 's'} reworded`,
        );
        break;
      default:
        break;
    }
  }

  return parts.slice(0, 2).join(' · ') || 'changed';
}

function paneSlug(record: RecordDiff): string {
  return (record.numberLabel ? `adr-${record.numberLabel}` : record.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ------------------------------------------------------------------------ rail */

function renderRail(
  diff: CorpusDiff,
  model: ReturnType<typeof buildModel>,
  range: RevRange,
): string {
  return `<aside class="rail">
  <div class="rail-head">
    <div class="brand">
      <h1>Review</h1>
      <span class="scope">${escapeHtml(range.baseLabel)} → ${escapeHtml(range.headLabel)}</span>
    </div>
    <div class="modes" id="modes" role="group" aria-label="What to list">
      <button class="mode" type="button" data-mode="changes" aria-pressed="true">Changes <span class="n">${diff.records.length}</span></button>
      <button class="mode" type="button" data-mode="records" aria-pressed="false">All records <span class="n">${model.records.length}</span></button>
    </div>
    <div class="search-wrap">
      <input class="search" id="q" type="search" placeholder="Search…" autocomplete="off" aria-label="Search" />
    </div>
  </div>
  <div class="register" id="register" role="list"></div>
</aside>`;
}

function renderOverview(diff: CorpusDiff, range: RevRange): string {
  const c = diff.counts;
  const tiles = [
    { v: String(c.added), k: 'added', cls: 'accepted' },
    { v: String(c.changed), k: 'changed', cls: '' },
    { v: String(c.removed), k: 'removed', cls: 'superseded' },
    { v: String(c.unchanged), k: 'untouched', cls: '' },
  ]
    .map(
      (tile) =>
        `<div class="tile"><div class="v ${tile.cls}">${escapeHtml(tile.v)}</div><span class="k">${escapeHtml(tile.k)}</span></div>`,
    )
    .join('');

  const lede =
    diff.records.length === 0
      ? 'No decision record changed between these revisions.'
      : `${c.significant} of these change what a decision says or whether it still holds. The rest are renames, added sections, and wording.`;

  return `    <section class="overview-body">
      <div class="rec-head">
        <p class="eyebrow"><span class="rec-no">${escapeHtml(range.baseLabel)} → ${escapeHtml(range.headLabel)}</span></p>
        <h2 class="rec-title">What changed about the decisions</h2>
        <p class="lede">${escapeHtml(lede)}</p>
      </div>
      <div class="tiles">${tiles}</div>
      <p class="section-note">Pick a record on the left to see the two versions side by side. Changed
      passages are marked — <del class="w">removed</del> on the left, <ins class="w">added</ins> on
      the right.</p>
    </section>`;
}

/* ---------------------------------------------------------------- change panes */

function renderChangePane(
  record: RecordDiff,
  base: Corpus,
  head: Corpus,
  range: RevRange,
  slugs: Map<string, string>,
): string {
  const beforeNode = base.byId.get(record.previousId ?? record.id) ?? null;
  const afterNode = record.kind === 'removed' ? null : (head.byId.get(record.id) ?? null);

  const badge =
    record.kind === 'added'
      ? '<span class="dbadge new">NEW</span>'
      : record.kind === 'removed'
        ? '<span class="dbadge gone">REMOVED</span>'
        : '';

  return `<section data-slug="${paneSlug(record)}">
      <button class="back" type="button" data-back>← All changes</button>
      <div class="rec-head">
        <p class="eyebrow"><span class="rec-no">ADR ${escapeHtml(record.numberLabel ?? '—')}</span><span>${escapeHtml(dirOf(record.id))}</span><span class="weight ${record.significance}">${record.significance}</span></p>
        <h2 class="rec-title">${escapeHtml(record.title)}${badge}</h2>
      </div>
      ${renderSummary(record)}
      ${renderSplit(record, beforeNode, afterNode, range, slugs)}
    </section>`;
}

/** The semantic reading of the change: the same rows the terminal prints. */
function renderSummary(record: RecordDiff): string {
  const rows: string[] = [];
  const changes = [...record.changes].sort((a, b) => FIELD_ORDER[a.field] - FIELD_ORDER[b.field]);
  const closing = closingEdge(changes);

  if (record.snapshot) {
    rows.push(row('Status', state(record.snapshot.status)));
    if (record.snapshot.decision) rows.push(row('Decision', escapeHtml(record.snapshot.decision)));
    if (record.snapshot.relations.length > 0) {
      rows.push(row('Relations', record.snapshot.relations.map(edgeText).join(', ')));
    }
  }

  for (const change of changes) {
    rows.push(...renderChangeRow(change, closing));
    if (change.field === 'status' && record.decisionHeld) {
      rows.push(row('Decision', '<span class="muted">unchanged</span>'));
    }
  }

  if (record.decisionHeld && !changes.some((change) => change.field === 'status')) {
    rows.push(row('Decision', '<span class="muted">unchanged</span>'));
  }

  return `<div class="dsummary">${rows.join('')}</div>`;
}

function renderChangeRow(change: Change, closing: RelationChange | null): string[] {
  switch (change.field) {
    case 'status':
      if (change.before === change.after) {
        return [
          row(
            'Status',
            `${state(change.after)} <span class="muted">now “${escapeHtml(flatten(change.afterRaw ?? ''))}”</span>`,
          ),
        ];
      }
      return [
        row(
          'Status',
          `${state(change.before)} <span class="arrow">→</span> ${state(change.after)}${
            closing ? ` by ${escapeHtml(closing.targetLabel)}` : ''
          }`,
        ),
      ];
    case 'decision':
      return [
        row(
          'Decision',
          `${change.after ? escapeHtml(change.after) : '<span class="muted">none stated</span>'}${
            change.before ? `<span class="was">was: ${escapeHtml(change.before)}</span>` : ''
          }`,
        ),
      ];
    case 'relations': {
      const parts = [
        ...change.added
          .filter(
            (edge) => !closing || edge.kind !== closing.kind || edge.targetId !== closing.targetId,
          )
          .map((edge) => `now ${edgeText(edge)}`),
        ...change.removed.map((edge) => `<s>no longer ${edgeText(edge)}</s>`),
      ];
      return parts.length > 0 ? [row('Relations', parts.join(', '))] : [];
    }
    case 'sections':
      return [
        row(
          'Sections',
          [
            ...change.removed.map(
              (name) => `<span class="gone">removed ${escapeHtml(name)}</span>`,
            ),
            ...change.added.map((name) => `<span class="new">added ${escapeHtml(name)}</span>`),
          ].join(', '),
        ),
      ];
    case 'title':
      return [
        row(
          'Title',
          `${escapeHtml(change.before)} <span class="arrow">→</span> ${escapeHtml(change.after)}`,
        ),
      ];
    case 'number':
      return [
        row(
          'Number',
          `${escapeHtml(change.beforeLabel ?? '—')} <span class="arrow">→</span> ${escapeHtml(change.afterLabel ?? '—')}`,
        ),
      ];
    case 'path':
      return [
        row(
          'Renamed',
          `<span class="muted">${escapeHtml(baseName(change.before))}</span> <span class="arrow">→</span> <code>${escapeHtml(baseName(change.after))}</code>`,
        ),
      ];
    case 'wording':
      return [
        row(
          'Wording',
          `<span class="muted">${escapeHtml(change.sections.join(', '))} reworded</span>`,
        ),
      ];
    default:
      return [
        row(
          change.field === 'date' ? 'Date' : 'Author',
          `<span class="muted">${escapeHtml(change.before ?? '—')} → ${escapeHtml(change.after ?? '—')}</span>`,
        ),
      ];
  }
}

function closingEdge(changes: Change[]): RelationChange | null {
  const relations = changes.find((c) => c.field === 'relations');
  const moved = changes.some(
    (c) => c.field === 'status' && c.before !== c.after && c.after === 'superseded',
  );
  if (relations?.field !== 'relations' || !moved) return null;
  const closing = relations.added.filter(
    (edge) => edge.kind === 'superseded-by' || edge.kind === 'superseded-in-part-by',
  );
  return closing.length === 1 ? closing[0]! : null;
}

/* ----------------------------------------------------------------- split panes */

/**
 * The two renderings, aligned section by section so the eye can travel across
 * rather than hunt. Sections that did not move are still shown: a decision read
 * without its context is how a reviewer approves the wrong thing.
 */
function renderSplit(
  record: RecordDiff,
  before: AdrNode | null,
  after: AdrNode | null,
  range: RevRange,
  slugs: Map<string, string>,
): string {
  const oldSections = before ? splitSections(before, `old-${paneSlug(record)}`, slugs) : [];
  const newSections = after ? splitSections(after, `new-${paneSlug(record)}`, slugs) : [];

  const rows = alignKeys(oldSections, newSections).map((key) => {
    const oldSection = oldSections.find((s) => s.key === key);
    const newSection = newSections.find((s) => s.key === key);

    if (oldSection && newSection) {
      if (normalise(oldSection.text) === normalise(newSection.text)) {
        return splitRow('same', oldSection.html, newSection.html);
      }
      const marked = diffHtml(oldSection.html, newSection.html);
      return splitRow('changed', marked.before, marked.after);
    }

    if (newSection) return splitRow('added', '', newSection.html);
    return splitRow('removed', oldSection?.html ?? '', '');
  });

  const headings = `<div class="dhead">
      <div class="dside old"><span class="rev">${escapeHtml(range.baseLabel)}</span>${before ? statusPill(before) : '<span class="muted">did not exist</span>'}</div>
      <div class="dside new"><span class="rev">${escapeHtml(range.headLabel)}</span>${after ? statusPill(after) : '<span class="muted">deleted</span>'}</div>
    </div>`;

  return `<div class="dsplit" data-split>
      ${headings}
      ${rows.join('\n      ')}
    </div>`;
}

function splitRow(kind: string, oldHtml: string, newHtml: string): string {
  const empty = '<p class="dempty">—</p>';
  return `<div class="drow ${kind}">
        <div class="dcell old"><article class="prose">${oldHtml || empty}</article></div>
        <div class="dcell new"><article class="prose">${newHtml || empty}</article></div>
      </div>`;
}

/** Section keys in an order that keeps matching sections opposite each other. */
function alignKeys(
  oldSections: Array<{ key: string }>,
  newSections: Array<{ key: string }>,
): string[] {
  const oldKeys = oldSections.map((s) => s.key);
  const newKeys = newSections.map((s) => s.key);
  const order: string[] = [];
  let i = 0;
  let j = 0;

  while (i < oldKeys.length || j < newKeys.length) {
    const o = oldKeys[i];
    const n = newKeys[j];

    if (o !== undefined && n !== undefined && o === n) {
      order.push(o);
      i++;
      j++;
    } else if (n !== undefined && !oldKeys.includes(n)) {
      order.push(n); // added on the new side
      j++;
    } else if (o !== undefined && !newKeys.includes(o)) {
      order.push(o); // gone from the new side
      i++;
    } else if (n !== undefined) {
      order.push(n);
      j++;
    } else if (o !== undefined) {
      order.push(o);
      i++;
    }
  }

  return [...new Set(order)];
}

interface RenderedSection {
  key: string;
  title: string;
  html: string;
  /** Plain markdown, for deciding whether the section moved at all. */
  text: string;
}

/**
 * Split a record into its outermost sections and render each one.
 *
 * Rendered per section rather than as one document because the two sides have to
 * line up: the unit a reviewer compares is "the Decision section", not "line 34".
 * Fences are masked first, so a `##` inside a code block never opens a section.
 */
function splitSections(
  adr: AdrNode,
  idPrefix: string,
  slugs: Map<string, string>,
): RenderedSection[] {
  const lines = adr.content.split('\n');
  const masked = maskCodeFences(lines);

  const heads: Array<{ index: number; depth: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue;
    const match = /^(#{2,6})\s+(.*)$/.exec(lines[i]!);
    if (match) heads.push({ index: i, depth: match[1]!.length, title: match[2]!.trim() });
  }

  const depth = heads.length > 0 ? Math.min(...heads.map((h) => h.depth)) : 0;
  const tops = heads.filter((h) => h.depth === depth);

  const resolve = (href: string) => resolveLink(href, adr, slugs);
  const render = (markdown: string): string =>
    renderHtml(markdown, { idPrefix, skipTitle: true, resolveLink: resolve });

  const sections: RenderedSection[] = [];

  const preamble = lines
    .slice(0, tops[0]?.index ?? lines.length)
    .join('\n')
    .trim();
  if (preamble) {
    sections.push({ key: '', title: '', html: render(preamble), text: preamble });
  }

  for (let t = 0; t < tops.length; t++) {
    const start = tops[t]!.index;
    const end = tops[t + 1]?.index ?? lines.length;
    const markdown = lines.slice(start, end).join('\n').trim();
    sections.push({
      key: sectionKey(tops[t]!.title) || `section-${t}`,
      title: tops[t]!.title,
      html: render(markdown),
      text: markdown,
    });
  }

  return sections;
}

/* ---------------------------------------------------------------- record panes */

/** A single record, for the "All records" mode. Reading, not reviewing. */
function renderRecordPane(record: WebRecord): string {
  const meta = [
    `<span class="state ${record.status}"><span class="dot ${record.status}"></span>${escapeHtml(record.statusLabel)}</span>`,
    record.dateLong ? `<span>${escapeHtml(record.dateLong)}</span>` : '',
    `<span>${record.minutes} min read</span>`,
    record.citedBy > 0 ? `<span>referenced by ${record.citedBy}</span>` : '',
  ]
    .filter(Boolean)
    .join('');

  return `<section data-slug="${record.slug}">
      <button class="back" type="button" data-back>← All records</button>
      <div class="rec-head">
        <p class="eyebrow"><span class="rec-no">ADR ${escapeHtml(record.numberLabel)}</span><span>${escapeHtml(record.group)}</span></p>
        <h2 class="rec-title">${escapeHtml(record.title)}</h2>
        <div class="rec-meta">${meta}</div>
      </div>
      ${record.gist ? `<div class="glance"><span class="k">The decision</span><p class="decision">${record.gist}</p></div>` : ''}
      <article class="prose">
${record.bodyHtml}
      </article>
    </section>`;
}

/* ------------------------------------------------------------------ small bits */

function row(label: string, value: string): string {
  return `<div class="drowline"><span class="k">${escapeHtml(label)}</span><span class="v">${value}</span></div>`;
}

function state(status: Status): string {
  return `<span class="state ${status}"><span class="dot ${status}"></span>${escapeHtml(STATUS_LABELS[status])}</span>`;
}

function statusPill(adr: AdrNode): string {
  return `<span class="state ${adr.status}"><span class="dot ${adr.status}"></span>${escapeHtml(STATUS_LABELS[adr.status])}</span>`;
}

function edgeText(edge: RelationChange): string {
  return `${RELATION_TEXT[edge.kind]} ${escapeHtml(edge.targetLabel)}`;
}

function resolveLink(
  href: string,
  from: AdrNode,
  slugs: Map<string, string>,
): { href: string; internal: boolean } | null {
  if (/^(?:https?:|mailto:)/i.test(href)) return { href, internal: false };
  if (href.startsWith('#')) return null;

  const link = from.links.find((l) => l.href === href);
  if (link?.targetId) {
    const slug = slugs.get(link.targetId);
    if (slug) return { href: `#/records/${slug}`, internal: true };
  }

  // References written without a path, and links whose target moved between the
  // two revisions, still resolve by filename.
  const name = href.split('#')[0]!.split('/').pop() ?? '';
  for (const [id, slug] of slugs) {
    if (name && id.endsWith(`/${name}`)) return { href: `#/records/${slug}`, internal: true };
  }

  return null;
}

function dirOf(id: string): string {
  const parts = id.split('/');
  parts.pop();
  return parts.join('/') || '.';
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function flatten(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 90 ? `${collapsed.slice(0, 89)}…` : collapsed;
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function jsonScript(model: unknown): string {
  return JSON.stringify(model)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
