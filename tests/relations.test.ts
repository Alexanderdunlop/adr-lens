import { describe, expect, it } from 'vitest';
import { normaliseStatus } from '../src/core/status.ts';
import { corpusOf } from './fixtures.ts';

const stub = (n: string, title: string, status = 'Accepted'): string =>
  `# ${n}. ${title}\n\nDate: 2026-01-01\n\n## Status\n\n${status}\n\n## Decision\n\nWe decided something specific and long enough to read.\n`;

describe('status normalisation', () => {
  it.each([
    ['Accepted', 'accepted'],
    ['accepted ✅', 'accepted'],
    ['Proposed', 'proposed'],
    ['Rejected', 'rejected'],
    ['Deprecated', 'deprecated'],
    ['Superseded by ADR-0099', 'superseded'],
    ['**Accepted**', 'accepted'],
    ['Proposed → Accepted', 'accepted'],
    ['', 'unknown'],
    ['Ratified on a Tuesday', 'unknown'],
  ])('reads %j as %s', (raw, expected) => {
    expect(normaliseStatus(raw)).toBe(expected);
  });

  it('keeps a record accepted when its status only mentions superseding others', () => {
    // `Supersedes X` and `Superseded by X` share a stem but mean the opposite.
    expect(normaliseStatus('Accepted. Supersedes ADR-0034.')).toBe('accepted');
    expect(normaliseStatus('Supersedes ADR-0034')).toBe('accepted');
  });

  it('keeps a record accepted when superseded only in part', () => {
    expect(normaliseStatus('Superseded in part by ADR-0065')).toBe('accepted');
    expect(normaliseStatus('Partially superseded by ADR-0065')).toBe('accepted');
  });
});

describe('supersession direction', () => {
  it('resolves `Superseded by` forwards', () => {
    const { byNumber } = corpusOf(
      ['0011-old.md', stub('11', 'Old', 'Superseded by [ADR-0018](0018-new.md)')],
      ['0018-new.md', stub('18', 'New')],
    );
    expect(byNumber(11).supersededBy).toBe('docs/adrs/0018-new.md');
    expect(byNumber(18).supersedes).toContain('docs/adrs/0011-old.md');
  });

  it('resolves `Supersedes` backwards and mirrors it', () => {
    const { byNumber } = corpusOf(
      ['0054-old.md', stub('54', 'Old')],
      ['0065-new.md', stub('65', 'New', 'Accepted. **Supersedes [ADR-0054](0054-old.md)**.')],
    );
    expect(byNumber(65).supersedes).toContain('docs/adrs/0054-old.md');
    expect(byNumber(54).supersededBy).toBe('docs/adrs/0065-new.md');
  });

  it('resolves a bare `ADR-nn` reference with no link', () => {
    const { byNumber } = corpusOf(
      ['0030-old.md', stub('30', 'Old', 'Superseded by ADR-0034')],
      ['0034-new.md', stub('34', 'New')],
    );
    expect(byNumber(30).supersededBy).toBe('docs/adrs/0034-new.md');
  });
});

describe('partial supersession', () => {
  it('does not mark a record dead when superseded only in part', () => {
    const { byNumber } = corpusOf(
      [
        '0002-model.md',
        `# 2. Model\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n\n## Decision\n\nWe adopt a forward-only execution model for everything.\n\n> **Superseded in part by [ADR-0065](0065-gate.md):** the id scheme changed.\n`,
      ],
      ['0065-gate.md', stub('65', 'Gate')],
    );

    const model = byNumber(2);
    expect(model.supersededBy).toBeNull();
    expect(model.status).toBe('accepted');
    expect(model.relations.map((r) => r.kind)).toContain('superseded-in-part-by');
  });

  it('treats `supersedes parts of` as partial and mirrors it', () => {
    const { byNumber } = corpusOf(
      ['0027-envelope.md', stub('27', 'Envelope')],
      [
        '0026-taxonomy.md',
        stub('26', 'Taxonomy', 'Accepted (supersedes parts of [ADR 0027](0027-envelope.md))'),
      ],
    );

    expect(byNumber(26).relations.map((r) => r.kind)).toContain('supersedes-in-part');
    expect(byNumber(27).supersededBy).toBeNull();
    expect(byNumber(27).mirrored.map((r) => r.kind)).toContain('superseded-in-part-by');
  });

  it('downgrades to partial when the status says something remains in force', () => {
    const { byNumber } = corpusOf(
      [
        '0027-envelope.md',
        stub(
          '27',
          'Envelope',
          'Accepted. Payload shapes superseded by [ADR 0026](0026-taxonomy.md). Envelope contract remains in force.',
        ),
      ],
      ['0026-taxonomy.md', stub('26', 'Taxonomy')],
    );

    expect(byNumber(27).supersededBy).toBeNull();
    expect(byNumber(27).relations.map((r) => r.kind)).toContain('superseded-in-part-by');
  });

  it('lets partiality claimed by one side win over the other side', () => {
    // 0027 reads as fully superseded; 0026 says it only replaced parts.
    const { byNumber } = corpusOf(
      ['0027-envelope.md', stub('27', 'Envelope', 'Superseded by [ADR 0026](0026-taxonomy.md)')],
      [
        '0026-taxonomy.md',
        stub('26', 'Taxonomy', 'Accepted (supersedes parts of [ADR 0027](0027-envelope.md))'),
      ],
    );

    expect(byNumber(27).supersededBy).toBeNull();
    expect(byNumber(26).supersedes).not.toContain('docs/adrs/0027-envelope.md');
  });
});

describe('misattribution guards', () => {
  it('does not adopt a supersession stated about another record', () => {
    // A `## Related` bullet describing 0010's fate must not mark 0020 dead.
    const { byNumber } = corpusOf(
      [
        '0020-filters.md',
        `# 20. Filters\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n\n## Decision\n\nRemove the exists filter from every rule.\n\n## Related\n\n- [ADR-0010](0010-routing.md) — original contract (superseded by TCK-1017)\n`,
      ],
      ['0010-routing.md', stub('10', 'Routing')],
    );

    const filters = byNumber(20);
    expect(filters.supersededBy).toBeNull();
    expect(filters.relations.map((r) => r.kind)).toEqual(['related']);
  });

  it('ignores a self-reference', () => {
    const { byNumber } = corpusOf([
      '0007-self.md',
      stub('7', 'Self', 'Superseded by [ADR-0007](0007-self.md)'),
    ]);
    expect(byNumber(7).supersededBy).toBeNull();
  });

  it('does not treat a date-prefixed plan document as an ADR reference', () => {
    const { corpus } = corpusOf([
      '0002-thing.md',
      `# 2. Thing\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n\n## Decision\n\nSomething long enough to count as a statement.\n\n## Related\n\n- [plan](2026-04-12-003-fix-knockout-plan.md)\n`,
    ]);
    expect(corpus.danglingRefs).toHaveLength(0);
  });
});

describe('graph', () => {
  it('counts inbound citations', () => {
    const { byNumber } = corpusOf(
      ['0001-base.md', stub('1', 'Base')],
      [
        '0002-a.md',
        `# 2. A\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n\n## Decision\n\nBuilds on [ADR-0001](0001-base.md) in a meaningful way.\n`,
      ],
      [
        '0003-b.md',
        `# 3. B\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n\n## Decision\n\nAlso builds on [ADR-0001](0001-base.md) in a meaningful way.\n`,
      ],
    );
    expect(byNumber(1).inbound).toEqual(['docs/adrs/0002-a.md', 'docs/adrs/0003-b.md']);
    expect(byNumber(2).outbound).toEqual(['docs/adrs/0001-base.md']);
  });

  it('reports duplicate numbers in the same directory', () => {
    const { corpus } = corpusOf(
      ['0005-one.md', stub('5', 'One')],
      ['0005-two.md', stub('5', 'Two')],
    );
    expect(corpus.duplicateNumbers.get(5)).toEqual([
      'docs/adrs/0005-one.md',
      'docs/adrs/0005-two.md',
    ]);
  });
});
