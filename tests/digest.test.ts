import { describe, expect, it } from 'vitest';
import { currentVersion, decisionLine, formatAge, readingMinutes } from '../src/core/digest.ts';
import { ADR_TOOLS, corpusOf, NESTED_DECISION, SUBHEADING_FIRST } from './fixtures.ts';

describe('decisionLine', () => {
  it('lifts the decision from the Decision section', () => {
    const { byNumber } = corpusOf(['0002-settlement.md', ADR_TOOLS]);
    expect(decisionLine(byNumber(2))).toBe(
      'We adopt a single-pass settlement model built on Lambda + SQS.',
    );
  });

  it('skips a bolded pseudo-heading in favour of the real statement', () => {
    const { byNumber } = corpusOf(['0034-archive.md', NESTED_DECISION]);
    const line = decisionLine(byNumber(34));
    expect(line).toMatch(/^Replace the four dedicated retry handlers/);
    expect(line).not.toContain('Error policy');
  });

  it('reaches into a subsection when the Decision section opens with one', () => {
    const { byNumber } = corpusOf(['0065-gate.md', SUBHEADING_FIRST]);
    const line = decisionLine(byNumber(65));
    expect(line).toContain('period-independent composite id');
  });

  it('falls back to the Context section when there is no Decision', () => {
    const { byNumber } = corpusOf([
      '0009-thing.md',
      '# 9. Thing\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n\n## Context\n\nThe queue backs up under load and we need to explain why.\n',
    ]);
    expect(decisionLine(byNumber(9))).toMatch(/^The queue backs up under load/);
  });

  it('returns null when there is nothing to say', () => {
    const { byNumber } = corpusOf(['0010-empty.md', '# 10. Empty\n']);
    expect(decisionLine(byNumber(10))).toBeNull();
  });

  it('ignores tables and code when picking a sentence', () => {
    const { byNumber } = corpusOf([
      '0011-table.md',
      '# 11. Table\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n\n## Decision\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nWe will adopt the second option for all new services.\n',
    ]);
    expect(decisionLine(byNumber(11))).toBe(
      'We will adopt the second option for all new services.',
    );
  });
});

describe('currentVersion', () => {
  const stub = (n: string, status: string): string =>
    `# ${n}. Thing ${n}\n\nDate: 2026-01-01\n\n## Status\n\n${status}\n\n## Decision\n\nA decision statement long enough to be extracted.\n`;

  it('follows a supersession chain to the end', () => {
    const { byNumber, corpus } = corpusOf(
      ['0011-a.md', stub('11', 'Superseded by [ADR-0010](0010-b.md)')],
      ['0010-b.md', stub('10', 'Superseded by [ADR-0018](0018-c.md)')],
      ['0018-c.md', stub('18', 'Accepted')],
    );
    expect(currentVersion(byNumber(11), corpus.byId).number).toBe(18);
  });

  it('stops rather than looping on a mutual supersession', () => {
    const { byNumber, corpus } = corpusOf(
      ['0001-a.md', stub('1', 'Superseded by [ADR-0002](0002-b.md)')],
      ['0002-b.md', stub('2', 'Superseded by [ADR-0001](0001-a.md)')],
    );
    expect(() => currentVersion(byNumber(1), corpus.byId)).not.toThrow();
  });
});

describe('formatting', () => {
  it.each([
    [null, '—'],
    [0, 'today'],
    [3, '3d'],
    [21, '3w'],
    [90, '3mo'],
    [1095, '3.0y'],
  ])('formats an age of %j as %s', (days, expected) => {
    expect(formatAge(days)).toBe(expected);
  });

  it('never reports a reading time under one minute', () => {
    const { byNumber } = corpusOf(['0001-tiny.md', '# 1. Tiny\n\nHi.\n']);
    expect(readingMinutes(byNumber(1))).toBe(1);
  });
});
