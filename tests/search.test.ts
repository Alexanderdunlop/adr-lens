import { describe, expect, it } from 'vitest';
import { search } from '../src/core/search.ts';
import { corpusOf } from './fixtures.ts';

const adr = (n: string, title: string, body: string, status = 'Accepted'): string =>
  `# ${n}. ${title}\n\nDate: 2026-01-01\n\n## Status\n\n${status}\n\n## Decision\n\n${body}\n`;

function fixture() {
  return corpusOf(
    ['0002-retry.md', adr('2', 'Retry conflicting writes', 'We retry the transaction.')],
    ['0034-archive.md', adr('34', 'Dead-letter queue as a passive archive', 'Every error escapes the handler.')],
    [
      '0065-gate.md',
      adr('65', 'Single-store idempotency gate', 'A retry is safe because the id is stable.'),
    ],
    ['0010-old.md', adr('10', 'Legacy signal routing', 'Old thing.', 'Superseded by ADR-0018')],
    ['0018-new.md', adr('18', 'Signal fan-out policy', 'The new routing contract.')],
  );
}

describe('search', () => {
  it('returns everything when the query is empty', () => {
    const { nodes } = fixture();
    expect(search(nodes, {})).toHaveLength(5);
  });

  it('ranks an exact number match first', () => {
    const { nodes } = fixture();
    expect(search(nodes, { query: '34' })[0]!.adr.number).toBe(34);
    expect(search(nodes, { query: 'adr-65' })[0]!.adr.number).toBe(65);
  });

  it('prefers a title match over a body match', () => {
    const { nodes } = fixture();
    const results = search(nodes, { query: 'retry' });
    expect(results[0]!.adr.number).toBe(2);
    expect(results[0]!.matchedIn).toBe('title');
    expect(results.map((r) => r.adr.number)).toContain(65);
  });

  it('requires every term to match', () => {
    const { nodes } = fixture();
    expect(search(nodes, { query: 'retry transaction' }).map((r) => r.adr.number)).toEqual([2]);
    expect(search(nodes, { query: 'retry nonexistentterm' })).toHaveLength(0);
  });

  it('filters by status', () => {
    const { nodes } = fixture();
    const results = search(nodes, { status: ['superseded'] });
    expect(results.map((r) => r.adr.number)).toEqual([10]);
  });

  it('hides superseded records when asked for current thinking only', () => {
    const { nodes } = fixture();
    const numbers = search(nodes, { liveOnly: true }).map((r) => r.adr.number);
    expect(numbers).not.toContain(10);
    expect(numbers).toContain(18);
  });

  it('filters by directory fragment', () => {
    const { nodes } = fixture();
    expect(search(nodes, { dir: 'docs/adrs' })).toHaveLength(5);
    expect(search(nodes, { dir: 'other-repo' })).toHaveLength(0);
  });

  it('is case insensitive', () => {
    const { nodes } = fixture();
    expect(search(nodes, { query: 'RETRY' }).length).toBeGreaterThan(0);
  });
});
