import { visibleWidth } from './inline.ts';

/**
 * Block-level markdown structure, shared by every emitter. Parsing lives here
 * rather than beside a renderer so the terminal and HTML outputs cannot drift
 * apart on what counts as a table, a list, or a fenced block.
 */
export type Block =
  | { kind: 'heading'; depth: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; items: ListItem[]; ordered: boolean }
  | { kind: 'table'; rows: string[][]; aligns: Align[] }
  | { kind: 'rule' }
  | { kind: 'blank' };

export interface ListItem {
  /** Indentation depth, 0 for top level. */
  level: number;
  marker: string;
  text: string;
  ordered: boolean;
}

export type Align = 'left' | 'right' | 'center';

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s{0,3}(```+|~~~+)\s*(\S*)/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_ROW = /^\s*\|(.*)\|?\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+\|?\s*$/;

export function splitBlocks(markdown: string): Block[] {
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
