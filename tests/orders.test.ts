import { describe, expect, it } from 'vitest';
import { buildCorpus } from '../src/core/corpus.ts';
import { buildModel, buildOrders, toClientModel } from '../src/web/data.ts';
import { parse } from './fixtures.ts';

const NOW = new Date('2026-08-26T00:00:00Z');

/** `date` omitted entirely produces an undated record. */
const rec = (n: string, date: string | null, cites: string[] = []): string =>
  [
    `# ${n}. Record ${n}`,
    '',
    ...(date ? [`Date: ${date}`, ''] : []),
    '## Status',
    '',
    'Accepted',
    '',
    '## Decision',
    '',
    `A decision long enough to be extracted as a sentence.${cites
      .map((c) => ` See [ADR-${c}](${c}-record-${c}.md).`)
      .join('')}`,
    '',
  ].join('\n');

function model(...files: Array<[string, string]>) {
  const corpus = buildCorpus(files.map(([name, raw]) => parse(raw, name)));
  return buildModel(corpus, { scope: 'demo', now: NOW });
}

function numbersIn(
  files: Array<[string, string]>,
  key: 'newest' | 'number' | 'cited',
): Array<number | null> {
  const m = model(...files);
  return buildOrders(m.records)[key].map((i) => m.records[i]!.number);
}

const FILES: Array<[string, string]> = [
  ['0001-record-0001.md', rec('1', '2026-01-10')],
  ['0002-record-0002.md', rec('2', '2026-06-01', ['0001', '0003'])],
  ['0003-record-0003.md', rec('3', '2026-03-15', ['0001'])],
  ['0004-record-0004.md', rec('4', null)],
];

describe('sort orders', () => {
  it('orders by number ascending', () => {
    expect(numbersIn(FILES, 'number')).toEqual([1, 2, 3, 4]);
  });

  it('orders newest first', () => {
    expect(numbersIn(FILES, 'newest')).toEqual([2, 3, 1, 4]);
  });

  it('puts undated records last, never first', () => {
    // A missing date is not a claim to be recent.
    const order = numbersIn(FILES, 'newest');
    expect(order[order.length - 1]).toBe(4);
  });

  it('orders by citation count, most cited first', () => {
    // 0001 is cited twice, 0003 once, the rest not at all.
    expect(numbersIn(FILES, 'cited').slice(0, 2)).toEqual([1, 3]);
  });

  it('breaks ties by number so the order is total', () => {
    const sameDay: Array<[string, string]> = [
      ['0007-record-0007.md', rec('7', '2026-05-05')],
      ['0003-record-0003.md', rec('3', '2026-05-05')],
      ['0005-record-0005.md', rec('5', '2026-05-05')],
    ];
    expect(numbersIn(sameDay, 'newest')).toEqual([3, 5, 7]);
    expect(numbersIn(sameDay, 'cited')).toEqual([3, 5, 7]);
  });

  it('includes every record exactly once in every order', () => {
    const m = model(...FILES);
    const orders = buildOrders(m.records);
    for (const key of ['newest', 'number', 'cited'] as const) {
      expect([...orders[key]].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    }
  });
});

describe('dates', () => {
  it('labels the register with an ISO date and the header with a long one', () => {
    const m = model(...FILES);
    const first = m.records.find((r) => r.number === 2)!;
    expect(first.dateLabel).toBe('2026-06-01');
    expect(first.dateLong).toBe('1 June 2026');
  });

  it('formats every month without relying on the machine locale', () => {
    const m = model(
      ['0001-record-0001.md', rec('1', '2026-01-31')],
      ['0002-record-0002.md', rec('2', '2026-12-09')],
    );
    expect(m.records[0]!.dateLong).toBe('31 January 2026');
    expect(m.records[1]!.dateLong).toBe('9 December 2026');
  });

  it('shows an em dash for an undated record rather than a guess', () => {
    const m = model(...FILES);
    const undated = m.records.find((r) => r.number === 4)!;
    expect(undated.dateLabel).toBe('—');
    expect(undated.dateLong).toBeNull();
  });

  it('carries the orders and ISO labels into the client payload', () => {
    const client = toClientModel(model(...FILES));
    expect(Object.keys(client.orders).sort()).toEqual(['cited', 'newest', 'number']);
    expect(client.records.map((r) => r.dateLabel)).toContain('2026-06-01');
    // Relative age is gone from the web surface entirely.
    expect(JSON.stringify(client)).not.toMatch(/"age"/);
  });
});
