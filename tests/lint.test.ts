import { describe, expect, it } from 'vitest';
import { lintCorpus, lintExitCode } from '../src/commands/lint.ts';
import { corpusOf } from './fixtures.ts';

const adr = (n: string, title: string, status = 'Accepted', extra = ''): string =>
  `# ${n}. ${title}\n\nDate: 2026-01-01\n\n## Status\n\n${status}\n\n## Context\n\nWhy.\n\n## Decision\n\nA decision statement long enough to be extracted.\n${extra}`;

function rules(corpus: ReturnType<typeof corpusOf>['corpus'], all = false): string[] {
  return lintCorpus(corpus, { all }).map((f) => f.rule);
}

describe('lint', () => {
  it('reports duplicate numbers as errors', () => {
    const { corpus } = corpusOf(['0005-a.md', adr('5', 'A')], ['0005-b.md', adr('5', 'B')]);
    const findings = lintCorpus(corpus);
    const duplicate = findings.find((f) => f.rule === 'duplicate-number');
    expect(duplicate?.severity).toBe('error');
    expect(lintExitCode(findings)).toBe(1);
  });

  it('flags a record that reads live but is superseded elsewhere', () => {
    const { corpus } = corpusOf(
      ['0060-old.md', adr('60', 'Old')],
      ['0088-new.md', adr('88', 'New', 'Accepted. Supersedes [ADR-0060](0060-old.md).')],
    );
    expect(rules(corpus)).toContain('stale-status');
  });

  it('flags a superseded record with no identifiable replacement', () => {
    const { corpus } = corpusOf([
      '0021-gone.md',
      adr('21', 'Gone', 'Superseded — see [TCK-1023](https://example.test/TCK-1023)'),
    ]);
    expect(rules(corpus)).toContain('superseded-without-target');
  });

  it('flags a mutual supersession as an error', () => {
    const { corpus } = corpusOf(
      ['0001-a.md', adr('1', 'A', 'Superseded by [ADR-0002](0002-b.md)')],
      ['0002-b.md', adr('2', 'B', 'Superseded by [ADR-0001](0001-a.md)')],
    );
    const findings = lintCorpus(corpus);
    expect(findings.find((f) => f.rule === 'supersession-cycle')?.severity).toBe('error');
  });

  it('does not flag partial supersession as stale', () => {
    const { corpus } = corpusOf(
      [
        '0027-a.md',
        adr(
          '27',
          'A',
          'Accepted. Shapes superseded by [ADR-0026](0026-b.md). Envelope remains in force.',
        ),
      ],
      ['0026-b.md', adr('26', 'B')],
    );
    expect(rules(corpus)).not.toContain('stale-status');
  });

  it('reports an unrecognised status', () => {
    const { corpus } = corpusOf(['0003-c.md', adr('3', 'C', 'Ratified on a Tuesday')]);
    expect(rules(corpus)).toContain('no-status');
  });

  it('reports a missing date', () => {
    const { corpus } = corpusOf([
      '0004-d.md',
      '# 4. D\n\n## Status\n\nAccepted\n\n## Decision\n\nA long enough decision statement here.\n',
    ]);
    expect(rules(corpus)).toContain('no-date');
  });

  it('keeps informational checks behind --all', () => {
    const { corpus } = corpusOf(['0001-lonely.md', adr('1', 'Lonely')]);
    expect(rules(corpus)).not.toContain('orphan');
    expect(rules(corpus, true)).toContain('orphan');
  });

  it('reports numbering gaps only as notes', () => {
    const { corpus } = corpusOf(['0001-a.md', adr('1', 'A')], ['0005-e.md', adr('5', 'E')]);
    const gap = lintCorpus(corpus, { all: true }).find((f) => f.rule === 'number-gap');
    expect(gap?.severity).toBe('info');
    expect(gap?.detail?.[0]).toBe('0002, 0003, 0004');
  });

  it('exits zero when only warnings and notes are present', () => {
    const { corpus } = corpusOf(['0001-a.md', adr('1', 'A', 'Ratified on a Tuesday')]);
    expect(lintExitCode(lintCorpus(corpus, { all: true }))).toBe(0);
  });

  it('reports a clean corpus with no findings', () => {
    const { corpus } = corpusOf(
      ['0001-a.md', adr('1', 'A', 'Accepted', '\n## Related\n\n- [B](0002-b.md)\n')],
      ['0002-b.md', adr('2', 'B', 'Accepted', '\n## Related\n\n- [A](0001-a.md)\n')],
    );
    expect(lintCorpus(corpus, { all: true })).toHaveLength(0);
  });
});
