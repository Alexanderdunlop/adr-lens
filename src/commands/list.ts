import { dirname } from 'node:path';
import { compareAdrs } from '../core/corpus.ts';
import { ageInDays, decisionLine, formatAge, readingMinutes } from '../core/digest.ts';
import type { AdrNode } from '../core/types.ts';
import { padToWidth, truncateToWidth, visibleWidth } from '../render/inline.ts';
import { statusGlyph, theme } from '../render/theme.ts';
import type { CommandContext } from './context.ts';

export type SortKey = 'number' | 'influence' | 'date' | 'title' | 'length';

export interface ListOptions {
  sort?: SortKey;
  /** Show the extracted decision line beneath each row. */
  verbose?: boolean;
  limit?: number;
  /** Group rows by the directory they came from. */
  group?: boolean;
}

/**
 * The list view is the tool's front door, so it optimises for triage rather than
 * completeness: status, age, and how many other records cite this one — the three
 * things that decide whether you need to open it.
 */
export function renderList(
  context: CommandContext,
  adrs: AdrNode[],
  options: ListOptions = {},
): string[] {
  if (adrs.length === 0) return [theme.dim('No matching decision records.')];

  const sorted = sortAdrs(adrs, options.sort ?? 'number');
  const shown = options.limit ? sorted.slice(0, options.limit) : sorted;

  const numberWidth = Math.max(3, ...shown.map((a) => visibleWidth(a.numberLabel ?? '—')));
  const refsWidth = Math.max(4, ...shown.map((a) => visibleWidth(String(a.inbound.length))));
  const ageWidth = Math.max(
    3,
    ...shown.map((a) => visibleWidth(formatAge(ageInDays(a, context.now)))),
  );

  // number + glyph + refs + age + separators
  const chrome = numberWidth + 2 + refsWidth + ageWidth + 8;
  const titleWidth = Math.max(20, context.width - chrome);

  const out: string[] = [];
  const groups = options.group ? groupByDir(shown) : new Map([['', shown]]);

  out.push(header(numberWidth, titleWidth, refsWidth, ageWidth));

  for (const [dir, rows] of groups) {
    if (dir) {
      out.push('');
      out.push(theme.h3(dir) + theme.dim(` (${rows.length})`));
    }
    for (const adr of rows) {
      out.push(row(context, adr, numberWidth, titleWidth, refsWidth, ageWidth));
      if (options.verbose) {
        const line = decisionLine(adr);
        if (line) {
          const indent = ' '.repeat(numberWidth + 3);
          out.push(
            indent + theme.dim(truncateToWidth(line, Math.max(20, context.width - indent.length))),
          );
        }
      }
    }
  }

  if (options.limit && sorted.length > options.limit) {
    out.push('');
    out.push(theme.dim(`… ${sorted.length - options.limit} more (raise --limit to see them)`));
  }

  return out;
}

function header(
  numberWidth: number,
  titleWidth: number,
  refsWidth: number,
  ageWidth: number,
): string {
  const parts = [
    theme.dim(padToWidth('#', numberWidth)),
    ' ',
    theme.dim(padToWidth('', 1)),
    ' ',
    theme.dim(padToWidth('Title', titleWidth)),
    '  ',
    theme.dim(padToWidth('refs', refsWidth)),
    '  ',
    theme.dim(padToWidth('age', ageWidth)),
  ];
  return `${parts.join('')}\n${theme.rule('─'.repeat(Math.min(120, numberWidth + titleWidth + refsWidth + ageWidth + 8)))}`;
}

function row(
  context: CommandContext,
  adr: AdrNode,
  numberWidth: number,
  titleWidth: number,
  refsWidth: number,
  ageWidth: number,
): string {
  const number = padToWidth(theme.dim(adr.numberLabel ?? '—'), numberWidth);
  const glyph = statusGlyph(adr.status);

  // A superseded record is still worth listing — it explains history — but it
  // should never read as current, so the title is struck through.
  const paint = adr.supersededBy || adr.status === 'superseded' ? theme.strike : (s: string) => s;
  const title = padToWidth(paint(truncateToWidth(adr.title, titleWidth)), titleWidth);

  const refs = adr.inbound.length;
  const refsCell = padToWidth(
    refs === 0 ? theme.dim('·') : refs >= 5 ? theme.bold(String(refs)) : String(refs),
    refsWidth,
  );
  const age = padToWidth(theme.dim(formatAge(ageInDays(adr, context.now))), ageWidth);

  return `${number} ${glyph} ${title}  ${refsCell}  ${age}`;
}

export function sortAdrs(adrs: AdrNode[], key: SortKey): AdrNode[] {
  const copy = [...adrs];
  switch (key) {
    case 'influence':
      return copy.sort((a, b) => b.inbound.length - a.inbound.length || compareAdrs(a, b));
    case 'date':
      return copy.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || compareAdrs(a, b));
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'length':
      return copy.sort((a, b) => b.wordCount - a.wordCount || compareAdrs(a, b));
    default:
      return copy.sort(compareAdrs);
  }
}

function groupByDir(adrs: AdrNode[]): Map<string, AdrNode[]> {
  const groups = new Map<string, AdrNode[]>();
  for (const adr of adrs) {
    const key = dirname(adr.id);
    const list = groups.get(key) ?? [];
    list.push(adr);
    groups.set(key, list);
  }
  return new Map([...groups].sort((a, b) => a[0].localeCompare(b[0])));
}

/** A compact one-line summary used by `stats` and the TUI footer. */
export function summariseCorpus(adrs: AdrNode[]): string {
  const total = adrs.length;
  const live = adrs.filter((a) => !a.supersededBy && a.status !== 'superseded').length;
  const words = adrs.reduce((sum, a) => sum + a.wordCount, 0);
  const minutes = adrs.reduce((sum, a) => sum + readingMinutes(a), 0);

  return theme.dim(
    `${total} records · ${live} current · ${words.toLocaleString('en-GB')} words · ~${minutes} min to read all`,
  );
}
