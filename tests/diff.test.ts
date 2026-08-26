import { describe, expect, it } from 'vitest';
import { buildCorpus } from '../src/core/corpus.ts';
import { type Change, type CorpusDiff, diffCorpora, type RecordDiff } from '../src/core/diff.ts';
import { parseAdr } from '../src/core/parse.ts';

interface AdrParts {
  status?: string;
  context?: string;
  decision?: string;
  consequences?: string;
}

function adr(number: string, title: string, parts: AdrParts = {}): string {
  const {
    status = 'Accepted',
    context = 'Invoices settle in nightly batches.',
    decision = 'We adopt a single-pass settlement model built on Lambda and SQS.',
    consequences = 'Batches cannot be replayed.',
  } = parts;

  return `# ${number}. ${title}

Date: 2026-01-0${number.slice(-1)}

## Status

${status}

## Context

${context}

## Decision

${decision}

## Consequences

${consequences}
`;
}

/** Build one side of a diff from `[filename, markdown]` pairs, all in one directory. */
function side(...files: Array<[string, string]>): ReturnType<typeof buildCorpus> {
  return buildCorpus(
    files.map(([name, raw]) =>
      parseAdr(raw, { id: `docs/adrs/${name}`, path: `/r/docs/adrs/${name}` }),
    ),
  );
}

/** Build one side from `[path, markdown]` pairs, for cases that span directories. */
function spread(...files: Array<[string, string]>): ReturnType<typeof buildCorpus> {
  return buildCorpus(files.map(([id, raw]) => parseAdr(raw, { id, path: `/r/${id}` })));
}

function record(diff: CorpusDiff, number: number): RecordDiff {
  const found = diff.records.find((r) => r.number === number);
  if (!found) throw new Error(`No record numbered ${number} in the diff`);
  return found;
}

function fields(record: RecordDiff): Array<Change['field']> {
  return record.changes.map((change) => change.field);
}

describe('matching records across revisions', () => {
  it('reads a rename plus a status change as one changed record', () => {
    const base = side(['0004-hashed-invoice-id.md', adr('4', 'Hashed invoice id')]);
    const head = side([
      '0004-invoice-identity.md',
      adr('4', 'Hashed invoice id', { status: 'Superseded by ADR-0009' }),
    ]);

    const diff = diffCorpora(base, head);

    expect(diff.counts).toMatchObject({ added: 0, removed: 0, changed: 1 });
    const changed = record(diff, 4);
    expect(changed.previousId).toBe('docs/adrs/0004-hashed-invoice-id.md');
    expect(changed.id).toBe('docs/adrs/0004-invoice-identity.md');
    expect(fields(changed)).toContain('status');
    expect(fields(changed)).toContain('path');
  });

  it('breaks a same-number tie by filename', () => {
    // Two directories each numbering from 1: the number alone cannot identify a record.
    const base = spread(
      ['billing/adrs/0001-retries.md', adr('1', 'Retries')],
      ['shipping/adrs/0001-labels.md', adr('1', 'Labels')],
    );
    const head = spread(
      [
        'billing/adrs/0001-retries.md',
        adr('1', 'Retries', { consequences: 'Retries are bounded.' }),
      ],
      ['shipping/adrs/0001-labels.md', adr('1', 'Labels')],
    );

    const diff = diffCorpora(base, head);

    expect(diff.counts).toMatchObject({ added: 0, removed: 0, changed: 1 });
    expect(diff.records[0]?.id).toBe('billing/adrs/0001-retries.md');
  });

  it('matches a renumbered record by title rather than reporting a delete and an add', () => {
    const base = side(['0007-currency-rounding.md', adr('7', 'Round currency at the boundary')]);
    const head = side(['0011-currency-rounding.md', adr('11', 'Round currency at the boundary')]);

    const diff = diffCorpora(base, head);

    expect(diff.counts).toMatchObject({ added: 0, removed: 0, changed: 1 });
    expect(fields(diff.records[0]!)).toContain('number');
  });

  it('reports a genuinely new record as added, not as a rename', () => {
    const base = side(['0002-settlement.md', adr('2', 'Idempotent batch settlement')]);
    const head = side(
      ['0002-settlement.md', adr('2', 'Idempotent batch settlement')],
      ['0009-idempotency-gate.md', adr('9', 'Single-store idempotency gate')],
    );

    const diff = diffCorpora(base, head);

    expect(diff.counts).toMatchObject({ added: 1, removed: 0, changed: 0, unchanged: 1 });
    expect(record(diff, 9).kind).toBe('added');
    expect(record(diff, 9).snapshot?.decision).toContain('single-pass settlement');
  });

  it('reports a deleted record as removed, with what it used to say', () => {
    const base = side(['0002-settlement.md', adr('2', 'Idempotent batch settlement')]);
    const head = side();

    const diff = diffCorpora(base, head);

    expect(diff.counts).toMatchObject({ added: 0, removed: 1 });
    expect(record(diff, 2).snapshot?.status).toBe('accepted');
  });
});

describe('what counts as a change', () => {
  it('sees nothing when a paragraph is only re-wrapped', () => {
    const base = side([
      '0002-settlement.md',
      adr('2', 'Idempotent batch settlement', {
        decision: 'We adopt a single-pass settlement model built on Lambda and SQS.',
      }),
    ]);
    const head = side([
      '0002-settlement.md',
      adr('2', 'Idempotent batch settlement', {
        decision: 'We adopt a single-pass settlement\nmodel built on Lambda and SQS.',
      }),
    ]);

    const diff = diffCorpora(base, head);

    expect(diff.records).toEqual([]);
    expect(diff.counts.unchanged).toBe(1);
  });

  it('finds nothing significant in a typo fix', () => {
    const base = side([
      '0002-settlement.md',
      adr('2', 'Idempotent batch settlement', { context: 'Invoices settle in nightly bathces.' }),
    ]);
    const head = side([
      '0002-settlement.md',
      adr('2', 'Idempotent batch settlement', { context: 'Invoices settle in nightly batches.' }),
    ]);

    const diff = diffCorpora(base, head);

    expect(diff.counts.significant).toBe(0);
    expect(record(diff, 2).significance).toBe('minor');
    expect(fields(record(diff, 2))).toEqual(['wording']);
  });

  it('treats a changed decision sentence as significant', () => {
    const base = side(['0005-retries.md', adr('5', 'Retry conflicting writes')]);
    const head = side([
      '0005-retries.md',
      adr('5', 'Retry conflicting writes', {
        decision: 'We adopt a two-phase settlement model built on Step Functions.',
      }),
    ]);

    const diff = diffCorpora(base, head);

    expect(record(diff, 5).significance).toBe('significant');
    const change = record(diff, 5).changes.find((c) => c.field === 'decision');
    expect(change).toMatchObject({ significance: 'significant' });
  });

  it('reports a record superseded by someone else’s new record, untouched itself', () => {
    const base = side(['0004-hashed-invoice-id.md', adr('4', 'Hashed invoice id')]);
    const head = side(
      ['0004-hashed-invoice-id.md', adr('4', 'Hashed invoice id')],
      [
        '0009-idempotency-gate.md',
        adr('9', 'Single-store idempotency gate', {
          status: 'Accepted. Supersedes [ADR-0004](0004-hashed-invoice-id.md).',
        }),
      ],
    );

    const diff = diffCorpora(base, head);
    const old = record(diff, 4);

    expect(old.kind).toBe('changed');
    expect(old.significance).toBe('significant');
    const relations = old.changes.find((c) => c.field === 'relations');
    expect(relations).toMatchObject({
      field: 'relations',
      added: [{ kind: 'superseded-by', targetLabel: 'ADR-0009', stated: false }],
    });
  });

  it('does not invent relation churn when the target of an edge is renamed', () => {
    const base = side(
      ['0004-hashed-invoice-id.md', adr('4', 'Hashed invoice id')],
      [
        '0009-gate.md',
        adr('9', 'Gate', { status: 'Accepted. Supersedes [ADR-0004](0004-hashed-invoice-id.md).' }),
      ],
    );
    const head = side(
      ['0004-invoice-identity.md', adr('4', 'Hashed invoice id')],
      [
        '0009-gate.md',
        adr('9', 'Gate', { status: 'Accepted. Supersedes [ADR-0004](0004-invoice-identity.md).' }),
      ],
    );

    const diff = diffCorpora(base, head);

    expect(fields(record(diff, 9))).not.toContain('relations');
    expect(fields(record(diff, 4))).not.toContain('relations');
  });

  it('separates losing a section from gaining one', () => {
    const full = adr('6', 'Dead-letter queue as archive');
    const base = side(['0006-dlq.md', full]);
    const head = side(['0006-dlq.md', full.replace(/## Consequences[\s\S]*$/, '')]);

    const diff = diffCorpora(base, head);
    const change = record(diff, 6).changes.find((c) => c.field === 'sections');

    expect(change).toMatchObject({ significance: 'significant', removed: ['Consequences'] });
  });

  it('treats status prose that qualifies an unchanged status as notable, not significant', () => {
    const base = side(['0002-settlement.md', adr('2', 'Idempotent batch settlement')]);
    const head = side([
      '0002-settlement.md',
      adr('2', 'Idempotent batch settlement', {
        status: 'Accepted. Scope narrowed by TCK-1042: the legacy consumers were removed.',
      }),
    ]);

    const diff = diffCorpora(base, head);
    const change = record(diff, 2).changes.find((c) => c.field === 'status');

    expect(change).toMatchObject({
      significance: 'notable',
      before: 'accepted',
      after: 'accepted',
    });
    expect(diff.counts.significant).toBe(0);
  });

  it('does not count the status section as reworded when the status change already said so', () => {
    const base = side(['0004-hashed-invoice-id.md', adr('4', 'Hashed invoice id')]);
    const head = side([
      '0004-hashed-invoice-id.md',
      adr('4', 'Hashed invoice id', { status: 'Superseded by ADR-0009' }),
    ]);

    expect(fields(record(diffCorpora(base, head), 4))).not.toContain('wording');
  });
});

describe('ordering', () => {
  it('puts the changes worth reading first', () => {
    const base = side(
      ['0002-settlement.md', adr('2', 'Idempotent batch settlement')],
      ['0004-hashed-invoice-id.md', adr('4', 'Hashed invoice id')],
    );
    const head = side(
      [
        '0002-settlement.md',
        adr('2', 'Idempotent batch settlement', { context: 'Nightly, mostly.' }),
      ],
      [
        '0004-hashed-invoice-id.md',
        adr('4', 'Hashed invoice id', { status: 'Superseded by ADR-0009' }),
      ],
      ['0009-idempotency-gate.md', adr('9', 'Single-store idempotency gate')],
    );

    const diff = diffCorpora(base, head);

    expect(diff.records.map((r) => r.number)).toEqual([4, 9, 2]);
  });
});
