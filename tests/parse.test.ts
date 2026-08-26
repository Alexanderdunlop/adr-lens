import { describe, expect, it } from 'vitest';
import { maskCodeFences, parseAdr } from '../src/core/parse.ts';
import { ADR_TOOLS, BOLD_FIELDS, parse, SUBHEADING_FIRST } from './fixtures.ts';

describe('title and number', () => {
  it('splits a leading number out of an adr-tools title', () => {
    const adr = parse(ADR_TOOLS, '0002-settlement.md');
    expect(adr.title).toBe('Idempotent batch settlement');
    expect(adr.number).toBe(2);
    expect(adr.numberLabel).toBe('0002');
  });

  it('splits an `ADR-001:` prefix out of the title', () => {
    const adr = parse(BOLD_FIELDS, '001-formatter.md');
    expect(adr.title).toBe('Adopt a single formatter');
    expect(adr.number).toBe(1);
  });

  it('prefers the filename number and warns when the title disagrees', () => {
    const adr = parse('# 7. Mismatched\n\n## Status\n\nAccepted\n', '0009-mismatched.md');
    expect(adr.number).toBe(9);
    expect(adr.warnings.some((w) => w.includes('disagrees'))).toBe(true);
  });

  it('falls back to the filename when there is no heading', () => {
    const adr = parse('Just some prose.\n', '0012-no-heading-here.md');
    expect(adr.title).toBe('No heading here');
    expect(adr.warnings.some((w) => w.includes('No level-1 heading'))).toBe(true);
  });
});

describe('metadata', () => {
  it('reads a bare `Date:` line and a prose status', () => {
    const adr = parse(ADR_TOOLS, '0002-settlement.md');
    expect(adr.date).toBe('2026-03-02');
    expect(adr.status).toBe('accepted');
    expect(adr.statusRaw).toMatch(/^Accepted\. Scope narrowed/);
  });

  it('reads bold field lines', () => {
    const adr = parse(BOLD_FIELDS, '001-formatter.md');
    expect(adr.status).toBe('proposed');
    expect(adr.date).toBe('2026-02-10');
    expect(adr.author).toBe('Engineering Team');
  });

  it('reads YAML frontmatter', () => {
    const adr = parse(
      '---\nstatus: Rejected\ndate: 2026-01-05\ndeciders: Platform\n---\n\n# 3. Thing\n\nBody.\n',
      '0003-thing.md',
    );
    expect(adr.status).toBe('rejected');
    expect(adr.date).toBe('2026-01-05');
    expect(adr.author).toBe('Platform');
  });

  it('strips a metadata-only preamble from content but keeps real prose', () => {
    const withFields = parse(BOLD_FIELDS, '001-formatter.md');
    expect(withFields.body).toContain('**Status:** Proposed');
    expect(withFields.content).not.toContain('**Status:** Proposed');
    expect(withFields.content.trimStart()).toMatch(/^## Context/);

    const withProse = parse(
      '# 4. Thing\n\nThis opening paragraph is not metadata.\n\n## Context\n\nMore.\n',
      '0004-thing.md',
    );
    expect(withProse.content).toContain('This opening paragraph is not metadata.');
  });
});

describe('sections', () => {
  it('includes nested subsections in a section body', () => {
    const adr = parse(SUBHEADING_FIRST, '0065-gate.md');
    const decision = adr.sections.find((s) => s.key === 'decision');
    // Without this, `## Decision` followed straight by `### ...` reads as empty
    // and every summary falls through to the Context section.
    expect(decision?.body).toContain('One run per grain');
    expect(decision?.body).toContain('period-independent composite id');
  });

  it('ends a section at the next same-or-shallower heading', () => {
    const adr = parse(ADR_TOOLS, '0002-settlement.md');
    const context = adr.sections.find((s) => s.key === 'context');
    expect(context?.body).toContain('Options considered');
    expect(context?.body).not.toContain('single-pass settlement model');
  });

  it('records section line ranges', () => {
    const adr = parse(ADR_TOOLS, '0002-settlement.md');
    for (const section of adr.sections) {
      expect(section.endLine).toBeGreaterThan(section.line);
    }
  });
});

describe('code fences', () => {
  it('masks fenced regions', () => {
    const mask = maskCodeFences(['before', '```ts', '## not a heading', '```', 'after']);
    expect(mask).toEqual([false, true, true, true, false]);
  });

  it('does not treat headings inside code as sections', () => {
    const adr = parse(
      '# 5. Thing\n\n## Real\n\n```md\n## Fake heading\n```\n\nDone.\n',
      '0005-thing.md',
    );
    expect(adr.sections.map((s) => s.title)).toEqual(['Real']);
  });

  it('does not extract links from inside code', () => {
    const adr = parse(
      '# 6. Thing\n\n```md\n[link](0001-other.md)\n```\n\nReal [link](0002-other.md).\n',
      '0006-thing.md',
    );
    expect(adr.links.map((l) => l.href)).toEqual(['0002-other.md']);
  });
});

describe('links', () => {
  it('captures text, href, and the section it appeared in', () => {
    const adr = parse(ADR_TOOLS, '0002-settlement.md');
    const link = adr.links[0]!;
    expect(link.text).toBe('TCK-1042');
    expect(link.href).toBe('https://example.test/TCK-1042');
    expect(link.section).toBe('Status');
  });

  it('terminates on a line with several links', () => {
    // A shared global regex plus a `String.replace` in the loop body used to
    // reset lastIndex and spin forever here.
    const adr = parseAdr('# 1. T\n\n[a](1-a.md) and [b](2-b.md) and [c](3-c.md).\n', {
      id: 'x.md',
    });
    expect(adr.links.map((l) => l.href)).toEqual(['1-a.md', '2-b.md', '3-c.md']);
  });
});
