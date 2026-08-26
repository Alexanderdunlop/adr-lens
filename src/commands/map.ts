import { dirname } from 'node:path';
import { decisionLine, isOrphan } from '../core/digest.ts';
import type { AdrNode, Status } from '../core/types.ts';
import { truncateToWidth } from '../render/inline.ts';
import { STATUS_STYLE, statusGlyph, theme } from '../render/theme.ts';
import type { CommandContext } from './context.ts';
import { summariseCorpus } from './list.ts';

export interface MapOptions {
  /** How many of the most-cited records to list. */
  top?: number;
}

/**
 * The map answers "where do I start?" for a corpus too large to read. It leads
 * with the most-cited records, then supersession chains, then the loose ends,
 * because that is the order in which those things help a newcomer.
 */
export function renderMap(context: CommandContext, options: MapOptions = {}): string[] {
  const { adrs, byId } = context.corpus;
  const width = context.width;
  const top = options.top ?? 10;
  const out: string[] = [];

  out.push(theme.h1('Decision map'));
  out.push(theme.rule('═'.repeat(Math.min(width, 12))));
  out.push(summariseCorpus(adrs));

  if (context.corpus.dirs.length > 1) {
    out.push('');
    out.push(theme.h2('Sources'));
    for (const dir of context.corpus.dirs) {
      out.push(`  ${theme.dim(String(dir.count).padStart(4))}  ${dir.relative}`);
    }
  }

  out.push('');
  out.push(theme.h2('By status'));
  const counts = countByStatus(adrs);
  const widest = Math.max(...[...counts.values()].map((n) => n), 1);
  for (const [status, count] of counts) {
    if (count === 0) continue;
    const style = STATUS_STYLE[status];
    const bar = '█'.repeat(Math.max(1, Math.round((count / widest) * Math.min(30, width - 28))));
    out.push(
      `  ${style.paint(style.glyph)} ${style.label.padEnd(11)} ${String(count).padStart(4)}  ${style.paint(bar)}`,
    );
  }

  const cited = [...adrs]
    .filter((a) => a.inbound.length > 0)
    .sort((a, b) => b.inbound.length - a.inbound.length)
    .slice(0, top);

  if (cited.length > 0) {
    out.push('');
    out.push(theme.h2('Start here — most cited'));
    out.push(theme.dim('  These are the decisions everything else builds on.'));
    out.push('');
    for (const adr of cited) {
      out.push(
        `  ${theme.bold(String(adr.inbound.length).padStart(3))} ${theme.dim('←')} ${statusGlyph(adr.status)} ${theme.dim((adr.numberLabel ?? '—').padStart(4))} ${truncateToWidth(adr.title, Math.max(20, width - 20))}`,
      );
      const line = decisionLine(adr);
      if (line) out.push(`        ${theme.dim(truncateToWidth(line, Math.max(20, width - 10)))}`);
    }
  }

  const chains = supersessionChains(adrs, byId);
  if (chains.length > 0) {
    out.push('');
    out.push(theme.h2('Supersession chains'));
    out.push(theme.dim('  Where the thinking changed. Read the last one.'));
    out.push('');
    for (const chain of chains) {
      const rendered = chain
        .map((adr, i) => {
          const label = theme.dim(adr.numberLabel ?? '—');
          return i === chain.length - 1 ? theme.ok(adr.numberLabel ?? '—') : theme.strike(label);
        })
        .join(theme.dim(' → '));
      const last = chain[chain.length - 1]!;
      out.push(`  ${rendered}  ${truncateToWidth(last.title, Math.max(20, width - 30))}`);
    }
  }

  const loose = adrs.filter(isOrphan);
  if (loose.length > 0) {
    out.push('');
    out.push(theme.h2(`Unconnected (${loose.length})`));
    out.push(theme.dim('  Nothing cites these and they cite nothing — check they are still true.'));
    out.push('');
    for (const adr of loose.slice(0, top)) {
      out.push(
        `  ${statusGlyph(adr.status)} ${theme.dim((adr.numberLabel ?? '—').padStart(4))} ${truncateToWidth(adr.title, Math.max(20, width - 12))}`,
      );
    }
    if (loose.length > top) out.push(theme.dim(`  … ${loose.length - top} more`));
  }

  return out;
}

function countByStatus(adrs: AdrNode[]): Map<Status, number> {
  const counts = new Map<Status, number>();
  for (const status of Object.keys(STATUS_STYLE) as Status[]) counts.set(status, 0);
  for (const adr of adrs) counts.set(adr.status, (counts.get(adr.status) ?? 0) + 1);
  return counts;
}

/**
 * Collect maximal supersession chains: start from records nothing supersedes and
 * walk forward. A chain of length one is not interesting, so those are dropped.
 */
function supersessionChains(adrs: AdrNode[], byId: Map<string, AdrNode>): AdrNode[][] {
  const chains: AdrNode[][] = [];
  const visited = new Set<string>();

  const heads = adrs.filter((adr) => adr.supersededBy !== null && adr.supersedes.length === 0);

  for (const head of heads) {
    if (visited.has(head.id)) continue;

    const chain: AdrNode[] = [head];
    visited.add(head.id);
    let node = head;

    while (node.supersededBy) {
      const next = byId.get(node.supersededBy);
      if (!next || visited.has(next.id)) break;
      visited.add(next.id);
      chain.push(next);
      node = next;
    }

    if (chain.length > 1) chains.push(chain);
  }

  return chains.sort((a, b) => b.length - a.length);
}

/** Same data as `map`, shaped for `--json`. */
export function mapToJson(context: CommandContext): unknown {
  const { adrs } = context.corpus;
  return {
    sources: context.corpus.dirs.map((d) => ({ path: d.relative, count: d.count })),
    total: adrs.length,
    byStatus: Object.fromEntries(countByStatus(adrs)),
    mostCited: [...adrs]
      .sort((a, b) => b.inbound.length - a.inbound.length)
      .slice(0, 20)
      .map((a) => ({ id: a.id, number: a.number, title: a.title, citedBy: a.inbound.length })),
    orphans: adrs.filter(isOrphan).map((a) => ({ id: a.id, number: a.number, title: a.title })),
    dir: [...new Set(adrs.map((a) => dirname(a.id)))],
  };
}
