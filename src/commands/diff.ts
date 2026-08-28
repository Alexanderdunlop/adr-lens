import { basename } from 'node:path';
import type { Change, CorpusDiff, RecordDiff, RelationChange } from '../core/diff.ts';
import type { RevRange } from '../core/git.ts';
import type { RelationKind, Status } from '../core/types.ts';
import type { Painter } from '../render/inline.ts';
import {
  padToWidth,
  parseInline,
  truncateToWidth,
  visibleWidth,
  wrapSpans,
} from '../render/inline.ts';
import { ansiPaint, paintAll, STATUS_STYLE, theme } from '../render/theme.ts';

/** The label column, sized so every field name fits without wrapping the value. */
const LABEL_WIDTH = 10;
const INDENT = '  ';

/**
 * Field order within a record: what the decision is now, then whether it still
 * holds, then how it is filed. Wording last, because it is the thing the reader
 * came here to *not* have to wade through.
 */
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

export interface DiffRenderOptions {
  width: number;
}

export function renderDiff(
  diff: CorpusDiff,
  range: RevRange,
  options: DiffRenderOptions,
): string[] {
  const width = options.width;
  const out: string[] = [];

  out.push(theme.dim(`${range.baseLabel} → ${range.headLabel}`));

  if (diff.records.length === 0) {
    out.push('');
    out.push(theme.ok('✓ No decision records changed.'));
    if (diff.counts.unchanged > 0) {
      out.push(theme.dim(`  ${plural(diff.counts.unchanged, 'record')} compared.`));
    }
    return out;
  }

  for (const record of diff.records) {
    out.push('');
    out.push(renderHeader(record, width));
    out.push(...renderBody(record, width));
  }

  out.push('');
  out.push(theme.rule('─'.repeat(width)));
  out.push(renderSummary(diff));
  return out;
}

/* --------------------------------------------------------------------- record */

function renderHeader(record: RecordDiff, width: number): string {
  const badge = badgeFor(record);
  const label = referenceOf(record);
  const room = width - visibleWidth(label) - 2 - (badge ? visibleWidth(badge) + 1 : 0);
  const title = truncateToWidth(record.title, Math.max(12, room));
  const left = `${theme.h3(label)}  ${title}`;

  if (!badge) return left;
  const pad = Math.max(1, width - visibleWidth(left) - visibleWidth(badge));
  return `${left}${' '.repeat(pad)}${badge}`;
}

function badgeFor(record: RecordDiff): string | null {
  if (record.kind === 'added') return theme.ok('NEW');
  if (record.kind === 'removed') return theme.error('REMOVED');
  return null;
}

function renderBody(record: RecordDiff, width: number): string[] {
  if (record.kind === 'added' || record.kind === 'removed') {
    return renderSnapshot(record, width);
  }

  // A record whose every change is wording collapses to a single line. This is
  // the case the command exists to make cheap to skip past.
  if (record.significance === 'minor') {
    const summary = record.changes.map(describeMinor).filter(Boolean).join(' · ');
    return [`${INDENT}${theme.dim(summary || 'reworded')}`];
  }

  const lines: string[] = [];
  const changes = [...record.changes].sort((a, b) => FIELD_ORDER[a.field] - FIELD_ORDER[b.field]);

  // The record went superseded *and* gained the edge saying by what. One line
  // carries both, so the edge is not repeated on the relations line below — but
  // only when there is a status line to carry it. A record superseded by another
  // record's edit never changes its own status text, and the edge is the whole
  // finding: absorbing it into a line that is not printed would lose it.
  const supersededBy = changes.some(isSupersessionStatus) ? closingEdge(changes) : null;

  for (const change of changes) {
    lines.push(...renderChange(change, supersededBy, width));

    // Directly under the status line, where it answers the question that line
    // raises: the record's standing moved — did what it says move with it?
    if (change.field === 'status' && record.decisionHeld) {
      lines.push(field('Decision', theme.dim('unchanged')));
    }
  }

  if (record.decisionHeld && !changes.some((change) => change.field === 'status')) {
    lines.push(field('Decision', theme.dim('unchanged')));
  }

  return lines;
}

function renderSnapshot(record: RecordDiff, width: number): string[] {
  const snapshot = record.snapshot;
  if (!snapshot) return [];

  const lines: string[] = [];
  const was = record.kind === 'removed' ? `${theme.dim('was ')}` : '';
  lines.push(field('Status', `${was}${statusText(snapshot.status)}`));

  if (snapshot.decision) {
    lines.push(...wrapped('Decision', snapshot.decision, width));
  }
  if (snapshot.relations.length > 0) {
    lines.push(...wrapped('Relations', snapshot.relations.map(edgeText).join(', '), width));
  }
  return lines;
}

function renderChange(
  change: Change,
  supersededBy: RelationChange | null,
  width: number,
): string[] {
  switch (change.field) {
    case 'status': {
      if (change.before === change.after) {
        // Only the prose around the status moved, so show what it now says.
        const raw = flatten(change.afterRaw ?? '');
        return [field('Status', `${statusText(change.after)}  ${theme.dim(`now “${raw}”`)}`)];
      }
      const to =
        supersededBy && change.after === 'superseded'
          ? `${statusText(change.after)} by ${supersededBy.targetLabel}`
          : statusText(change.after);
      return [field('Status', `${statusText(change.before)} ${theme.dim('→')} ${to}`)];
    }

    case 'decision': {
      const lines = change.after
        ? wrapped('Decision', change.after, width)
        : [field('Decision', theme.dim('none stated'))];
      if (change.before) {
        lines.push(...wrapped('', `was: ${change.before}`, width, paintAll(theme.dim)));
      }
      return lines;
    }

    case 'relations': {
      const parts = [
        ...change.added
          .filter((edge) => edge !== supersededBy)
          .map((edge) => `now ${edgeText(edge)}`),
        ...change.removed.map((edge) => `no longer ${edgeText(edge)}`),
      ];
      return parts.length === 0 ? [] : wrapped('Relations', parts.join(', '), width);
    }

    case 'sections': {
      const parts = [
        ...change.removed.map((name) => theme.warn(`removed ${name}`)),
        ...change.added.map((name) => `added ${name}`),
      ];
      return wrapped('Sections', parts.join(', '), width);
    }

    case 'title':
      return wrapped('Title', `${change.before} ${theme.dim('→')} ${change.after}`, width);

    case 'number':
      return [
        field(
          'Number',
          `${change.beforeLabel ?? '—'} ${theme.dim('→')} ${change.afterLabel ?? '—'}`,
        ),
      ];

    case 'path':
      return [
        field('Renamed', `${theme.dim(basename(change.before))} → ${basename(change.after)}`),
      ];

    case 'wording':
      return [field('Wording', theme.dim(describeWording(change.sections)))];

    default:
      return [
        field(
          titleCase(change.field),
          theme.dim(`${change.before ?? '—'} → ${change.after ?? '—'}`),
        ),
      ];
  }
}

/** A status line that will render the move into supersession, and so can carry the edge. */
function isSupersessionStatus(change: Change): boolean {
  return (
    change.field === 'status' && change.before !== change.after && change.after === 'superseded'
  );
}

/**
 * The added edge that explains a supersession, when there is exactly one. Any
 * more than that and the status line stays plain — "superseded by two records"
 * is a sentence for the relations line, not the headline.
 */
function closingEdge(changes: Change[]): RelationChange | null {
  const relations = changes.find((c) => c.field === 'relations');
  if (relations?.field !== 'relations') return null;
  const closing = relations.added.filter(
    (edge) => edge.kind === 'superseded-by' || edge.kind === 'superseded-in-part-by',
  );
  return closing.length === 1 ? closing[0]! : null;
}

/* --------------------------------------------------------------------- pieces */

function field(label: string, value: string): string {
  return `${INDENT}${theme.dim(padToWidth(label, LABEL_WIDTH))}${value}`;
}

/** A field whose value is long enough to need the full measure, hanging-indented. */
function wrapped(
  label: string,
  value: string,
  width: number,
  paint: Painter = ansiPaint,
): string[] {
  const indent = INDENT + ' '.repeat(LABEL_WIDTH);
  const lines = wrapSpans(parseInline(value), width, indent, paint);
  if (lines.length === 0) return [];
  const first = lines[0]!.slice(indent.length);
  lines[0] = label ? field(label, first) : `${indent}${first}`;
  return lines;
}

function statusText(status: Status): string {
  const style = STATUS_STYLE[status];
  return style.paint(style.label);
}

const RELATION_TEXT: Record<RelationKind, string> = {
  supersedes: 'supersedes',
  'superseded-by': 'superseded by',
  'supersedes-in-part': 'partly supersedes',
  'superseded-in-part-by': 'partly superseded by',
  amends: 'amends',
  'amended-by': 'amended by',
  related: 'related to',
};

function edgeText(edge: RelationChange): string {
  return `${RELATION_TEXT[edge.kind]} ${edge.targetLabel}`;
}

function describeMinor(change: Change): string {
  if (change.field === 'wording') return describeWording(change.sections);
  if (change.field === 'date' || change.field === 'author') {
    return `${change.field} ${change.before ?? '—'} → ${change.after ?? '—'}`;
  }
  return '';
}

function describeWording(sections: string[]): string {
  return `${plural(sections.length, 'section')} reworded`;
}

function referenceOf(record: RecordDiff): string {
  return record.numberLabel ? `ADR-${record.numberLabel}` : basename(record.id, '.md');
}

function renderSummary(diff: CorpusDiff): string {
  const { counts } = diff;
  const parts: string[] = [];
  if (counts.added > 0) parts.push(theme.ok(`${counts.added} added`));
  if (counts.removed > 0) parts.push(theme.error(`${counts.removed} removed`));
  if (counts.changed > 0) parts.push(`${plural(counts.changed, 'record')} changed`);

  const tail: string[] = [];
  if (counts.significant > 0) tail.push(`${counts.significant} significant`);
  if (counts.notable > 0) tail.push(`${counts.notable} notable`);
  if (counts.minor > 0) tail.push(`${counts.minor} wording only`);
  if (counts.unchanged > 0) tail.push(`${counts.unchanged} unchanged`);

  return `${parts.join(theme.dim(' · '))}  ${theme.dim(tail.join(' · '))}`.trim();
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function flatten(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 60 ? `${collapsed.slice(0, 59)}…` : collapsed;
}

/* ----------------------------------------------------------------------- json */

/**
 * The machine-readable form. The records are already plain semantic data, so this
 * only adds what a consumer cannot infer: which revisions were compared.
 */
export function diffToJson(diff: CorpusDiff, range: RevRange): Record<string, unknown> {
  return {
    base: range.baseLabel,
    head: range.headLabel,
    counts: diff.counts,
    records: diff.records.map((record) => ({
      kind: record.kind,
      significance: record.significance,
      id: record.id,
      ...(record.previousId ? { previousId: record.previousId } : {}),
      number: record.number,
      numberLabel: record.numberLabel,
      title: record.title,
      decisionHeld: record.decisionHeld,
      changes: record.changes,
      ...(record.snapshot ? { snapshot: record.snapshot } : {}),
    })),
  };
}
