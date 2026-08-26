import {
  padToWidth,
  parseInline,
  type Span,
  stripAnsi,
  truncateToWidth,
  visibleWidth,
  wrapSpans,
} from './inline.ts';
import { theme } from './theme.ts';

export interface RenderOptions {
  /** Total columns available. */
  width: number;
  /** Print link destinations beneath the text they belong to. */
  showUrls?: boolean;
  /** Skip the document's own level-1 heading (the caller usually renders it). */
  skipTitle?: boolean;
  /** Left margin applied to every line. */
  margin?: string;
}

/** Render markdown to an array of ANSI-styled terminal lines. */
export function renderMarkdown(markdown: string, options: RenderOptions): string[] {
  const width = Math.max(24, options.width);
  const margin = options.margin ?? '';
  const inner = Math.max(20, width - visibleWidth(margin));

  const out: string[] = [];
  const blocks = splitBlocks(markdown.replace(/\r\n?/g, '\n'));
  let skippedTitle = false;

  for (const block of blocks) {
    if (block.kind === 'heading' && block.depth === 1 && options.skipTitle && !skippedTitle) {
      skippedTitle = true;
      continue;
    }
    pushBlock(out, block, inner, options);
  }

  const trimmed = trimBlankEdges(out);
  return margin ? trimmed.map((line) => (line ? margin + line : line)) : trimmed;
}

/* --------------------------------------------------------------------- blocks */

type Block =
  | { kind: 'heading'; depth: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; items: ListItem[]; ordered: boolean }
  | { kind: 'table'; rows: string[][]; aligns: Align[] }
  | { kind: 'rule' }
  | { kind: 'blank' };

interface ListItem {
  /** Indentation depth, 0 for top level. */
  level: number;
  marker: string;
  text: string;
  ordered: boolean;
}

type Align = 'left' | 'right' | 'center';

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s{0,3}(```+|~~~+)\s*(\S*)/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_ROW = /^\s*\|(.*)\|?\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+\|?\s*$/;

function splitBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      if (blocks[blocks.length - 1]?.kind !== 'blank') blocks.push({ kind: 'blank' });
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const lang = fence[2] ?? '';
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const candidate = FENCE.exec(lines[i]!);
        if (candidate && candidate[1]!.startsWith(marker.slice(0, 3))) {
          i++;
          break;
        }
        body.push(lines[i]!);
        i++;
      }
      blocks.push({ kind: 'code', lang, lines: body });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        depth: heading[1]!.length,
        text: heading[2]!.replace(/\s*#+\s*$/, '').trim(),
      });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }

    // A table needs a header row followed by a divider; anything else that looks
    // like a pipe row is treated as ordinary text.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && isTableDivider(lines[i + 1]!)) {
      const rows: string[][] = [splitRow(line)];
      const aligns = parseAligns(lines[i + 1]!);
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      blocks.push({ kind: 'table', rows, aligns });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const match = QUOTE.exec(lines[i]!);
        if (!match) break;
        body.push(match[1]!);
        i++;
      }
      blocks.push({ kind: 'quote', text: body.join('\n').trim() });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const items: ListItem[] = [];
      let ordered = false;

      while (i < lines.length) {
        const bullet = BULLET.exec(lines[i]!);
        const numbered = ORDERED.exec(lines[i]!);
        if (!bullet && !numbered) {
          // A wrapped continuation line belongs to the previous item.
          const continuation = /^\s+\S/.test(lines[i] ?? '') && items.length > 0;
          if (continuation) {
            items[items.length - 1]!.text += ` ${lines[i]!.trim()}`;
            i++;
            continue;
          }
          break;
        }

        const [, indent, marker, text] = (bullet ?? numbered)!;
        if (numbered) ordered = true;
        items.push({
          level: Math.floor(visibleWidth(indent!.replace(/\t/g, '  ')) / 2),
          marker: marker!,
          text: text!,
          ordered: Boolean(numbered),
        });
        i++;
      }

      blocks.push({ kind: 'list', items, ordered });
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block. The
    // first line is taken unconditionally — it already failed every other block
    // test, and consuming nothing here would not advance the cursor.
    const paragraph: string[] = [line.trim()];
    i++;

    while (i < lines.length) {
      const candidate = lines[i]!;
      if (
        candidate.trim() === '' ||
        HEADING.test(candidate) ||
        FENCE.test(candidate) ||
        RULE.test(candidate) ||
        QUOTE.test(candidate) ||
        BULLET.test(candidate) ||
        ORDERED.test(candidate) ||
        TABLE_ROW.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate.trim());
      i++;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

function isTableDivider(line: string): boolean {
  return TABLE_DIVIDER.test(line) && line.includes('-') && line.includes('|');
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function parseAligns(divider: string): Align[] {
  return splitRow(divider).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

/* -------------------------------------------------------------------- emitting */

function pushBlock(out: string[], block: Block, width: number, options: RenderOptions): void {
  switch (block.kind) {
    case 'blank':
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      return;

    case 'rule':
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      out.push(theme.rule('─'.repeat(width)));
      out.push('');
      return;

    case 'heading': {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      const text = plain(block.text);
      if (block.depth === 1) {
        out.push(theme.h1(truncateToWidth(text, width)));
        out.push(theme.rule('═'.repeat(Math.min(width, Math.max(12, visibleWidth(text))))));
      } else if (block.depth === 2) {
        // A rule that runs to the right margin gives the eye a hard section break,
        // which is what makes a 3000-word ADR skimmable.
        const label = theme.h2(truncateToWidth(text, width - 4));
        const fill = Math.max(0, width - visibleWidth(text) - 1);
        out.push(`${label} ${theme.rule('─'.repeat(fill))}`);
      } else if (block.depth === 3) {
        out.push(theme.h3(truncateToWidth(text, width)));
      } else {
        out.push(theme.h4(truncateToWidth(text, width)));
      }
      out.push('');
      return;
    }

    case 'paragraph': {
      const spans = parseInline(block.text);
      out.push(...wrapSpans(spans, width));
      appendUrls(out, spans, width, options);
      return;
    }

    case 'quote': {
      const gutter = theme.gutter('▏ ');
      for (const line of renderMarkdown(block.text, { ...options, width: width - 2, margin: '' })) {
        out.push(line ? gutter + theme.quote(line) : gutter.trimEnd());
      }
      return;
    }

    case 'code': {
      const label = block.lang ? theme.meta(` ${block.lang} `) : '';
      out.push(
        theme.tableBorder('┌─') +
          label +
          theme.tableBorder('─'.repeat(Math.max(0, width - 2 - visibleWidth(label)))),
      );
      for (const line of block.lines) {
        const expanded = line.replace(/\t/g, '  ');
        out.push(theme.tableBorder('│ ') + theme.codeBlock(truncateToWidth(expanded, width - 2)));
      }
      out.push(theme.tableBorder(`└${'─'.repeat(Math.max(1, width - 1))}`));
      return;
    }

    case 'list':
      pushList(out, block.items, width, options);
      return;

    case 'table':
      pushTable(out, block.rows, block.aligns, width);
      return;

    default:
      return;
  }
}

const BULLETS = ['•', '◦', '▪', '·'];

function pushList(out: string[], items: ListItem[], width: number, options: RenderOptions): void {
  const counters = new Map<number, number>();

  for (const item of items) {
    const level = Math.min(item.level, 3);
    const indent = '  '.repeat(level);

    let marker: string;
    if (item.ordered) {
      const next = (counters.get(level) ?? 0) + 1;
      counters.set(level, next);
      // Deeper levels restart, so clear anything below this one.
      for (const key of [...counters.keys()]) if (key > level) counters.delete(key);
      marker = theme.bullet(`${next}.`);
    } else {
      counters.delete(level);
      marker = theme.bullet(BULLETS[level] ?? '·');
    }

    const prefix = `${indent}${marker} `;
    const hanging = ' '.repeat(visibleWidth(`${indent}${stripAnsi(marker)} `));
    const spans = parseInline(item.text);
    const lines = wrapSpans(spans, width - visibleWidth(hanging));

    out.push(prefix + (lines[0] ?? ''));
    for (const line of lines.slice(1)) out.push(hanging + line);
    appendUrls(out, spans, width, options, hanging);
  }
}

/**
 * Render a table by fitting columns to their content, then shrinking the widest
 * columns until the whole thing fits. ADR tables are usually comparison matrices
 * where the first column is short labels and the rest is prose, so proportional
 * shrinking of the widest column preserves the most readable layout.
 */
function pushTable(out: string[], rows: string[][], aligns: Align[], width: number): void {
  if (rows.length === 0) return;

  const columnCount = Math.max(...rows.map((row) => row.length));
  const cells = rows.map((row) =>
    Array.from({ length: columnCount }, (_, c) => plain(row[c] ?? '')),
  );

  const natural = Array.from({ length: columnCount }, (_, c) =>
    Math.max(3, ...cells.map((row) => visibleWidth(row[c] ?? ''))),
  );

  // 3 columns cost `│ a │ b │ c │` — 4 borders plus 2 pad per column.
  const chrome = columnCount * 3 + 1;
  const widths = fitColumns(natural, Math.max(columnCount * 4, width - chrome));

  const border = (left: string, mid: string, right: string): string =>
    theme.tableBorder(left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right);

  out.push(border('┌', '┬', '┐'));

  // Each cell wraps independently, so a row is as tall as its tallest cell.
  const renderRow = (row: string[], header: boolean): void => {
    const wrapped = row.map((cell, c) => {
      const paint = header ? theme.tableHeader : undefined;
      const spans: Span[] = paint
        ? parseInline(cell).map((s) => ({ ...s, paint: s.paint ?? paint }))
        : parseInline(cell);
      return cell.trim() === '' ? [''] : wrapSpans(spans, widths[c]!);
    });

    const height = Math.max(1, ...wrapped.map((lines) => lines.length));
    for (let line = 0; line < height; line++) {
      const parts = wrapped.map((lines, c) =>
        alignCell(lines[line] ?? '', widths[c]!, aligns[c] ?? 'left'),
      );
      out.push(
        `${theme.tableBorder('│')} ${parts.join(` ${theme.tableBorder('│')} `)} ${theme.tableBorder('│')}`,
      );
    }
  };

  renderRow(cells[0]!, true);
  out.push(border('├', '┼', '┤'));
  for (const row of cells.slice(1)) renderRow(row, false);
  out.push(border('└', '┴', '┘'));
}

function alignCell(text: string, width: number, align: Align): string {
  const deficit = width - visibleWidth(text);
  if (deficit <= 0) return truncateToWidth(text, width);
  if (align === 'right') return ' '.repeat(deficit) + text;
  if (align === 'center') {
    const left = Math.floor(deficit / 2);
    return ' '.repeat(left) + text + ' '.repeat(deficit - left);
  }
  return padToWidth(text, width);
}

/** Shrink the widest column repeatedly until the total fits the budget. */
function fitColumns(natural: number[], budget: number): number[] {
  const widths = [...natural];
  let total = widths.reduce((sum, w) => sum + w, 0);

  while (total > budget) {
    let widest = 0;
    for (let i = 1; i < widths.length; i++) {
      if (widths[i]! > widths[widest]!) widest = i;
    }
    if (widths[widest]! <= 6) break; // every column has hit its floor
    const shrink = Math.max(1, Math.min(widths[widest]! - 6, total - budget));
    widths[widest] = widths[widest]! - shrink;
    total -= shrink;
  }

  return widths;
}

/* ---------------------------------------------------------------------- helpers */

function appendUrls(
  out: string[],
  spans: Span[],
  width: number,
  options: RenderOptions,
  indent = '',
): void {
  if (!options.showUrls) return;

  const seen = new Set<string>();
  for (const span of spans) {
    if (!span.href || seen.has(span.href)) continue;
    seen.add(span.href);
    out.push(...wrapSpans([{ text: `↳ ${span.href}`, paint: theme.url }], width, `${indent}  `));
  }
}

/** Collapse whitespace and strip markdown that has no terminal equivalent. */
function plain(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;
  return lines.slice(start, end);
}
