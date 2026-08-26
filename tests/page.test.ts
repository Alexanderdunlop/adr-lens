import { parseHTML } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCorpus } from '../src/core/corpus.ts';
import { renderPage } from '../src/web/page.ts';
import { parse } from './fixtures.ts';

const NOW = new Date('2026-08-26T00:00:00Z');

const RECORDS: Array<[string, string]> = [
  [
    '0002-model.md',
    `# 2. Forward-only execution model

Date: 2026-03-02

## Status

Accepted. Scope narrowed by [TCK-1042](https://example.test/TCK-1042); the rest remains in force.

## Context

The service orchestrates runs across queues.

## Decision

We adopt a **single-pass settlement model** built on Lambda and SQS.

| Option | Verdict |
|---|---|
| Step Functions | rejected |
| Lambda + SQS | chosen |

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

> **Superseded in part by [ADR-0065](0065-gate.md):** the id scheme changed.
`,
  ],
  [
    '0054-hashed-id.md',
    `# 54. Hashed invoice id

Date: 2026-04-01

## Status

Superseded by [ADR-0065](0065-gate.md)

## Decision

Hash the tenant id and customer id together to form the invoice id.
`,
  ],
  [
    '0065-gate.md',
    `# 65. Single-store idempotency gate

Date: 2026-05-01

## Status

Accepted. **Supersedes [ADR-0054](0054-hashed-id.md)**.

## Decision

### One run per grain

\`buildInvoiceId\` produces a **period-independent composite id**.

## Related

- [plan](../plans/2026-04-12-003-rollout-plan.md)
`,
  ],
];

let doc: ReturnType<typeof parseHTML>['document'];
let html: string;

beforeAll(() => {
  const corpus = buildCorpus(RECORDS.map(([name, raw]) => parse(raw, name)));
  html = renderPage(corpus, { scope: 'billing-service', now: NOW });
  doc = parseHTML(html).document;
});

describe('document', () => {
  it('is a complete standalone document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(doc.querySelector('title')?.textContent).toBe('billing-service · decisions');
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(doc.querySelector('style')?.textContent).toContain('--paper');
  });

  it('references no external resources, since the CSP blocks them', () => {
    expect(doc.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
    expect(doc.querySelectorAll('script[src]')).toHaveLength(0);
    expect(html).not.toMatch(/https?:\/\/[^"')\s]+\.(?:css|js|woff2?)/);
  });

  it('defines both themes, with the explicit toggle able to win', () => {
    const css = doc.querySelector('style')?.textContent ?? '';
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain(':root[data-theme="light"]');
  });

  it('respects reduced motion', () => {
    expect(doc.querySelector('style')?.textContent).toContain('prefers-reduced-motion');
  });
});

describe('client payload', () => {
  it('parses, and carries one entry per record', () => {
    const match = /window\.__ADR = (.+);\n/.exec(html);
    expect(match).not.toBeNull();
    const model = JSON.parse(match![1]!.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>'));
    expect(model.records).toHaveLength(3);
    expect(model.records.map((r: { numberLabel: string }) => r.numberLabel)).toEqual([
      '0002',
      '0054',
      '0065',
    ]);
  });

  it('escapes angle brackets so record prose cannot close the script tag', () => {
    const payload = /window\.__ADR = (.+);\n/.exec(html)![1]!;
    expect(payload).not.toContain('</script');
    expect(payload).not.toMatch(/<[a-z/]/i);
  });

  it('omits the rendered body, which the markup already holds', () => {
    const payload = /window\.__ADR = (.+);\n/.exec(html)![1]!;
    expect(payload).not.toContain('bodyHtml');
    expect(payload).toContain('haystack');
  });
});

describe('register', () => {
  it('leaves the list to the client but ships the container', () => {
    expect(doc.querySelector('#register')).not.toBeNull();
    expect(doc.querySelector('#q')).not.toBeNull();
  });

  it('offers the three sort orders, defaulting to newest', () => {
    const sorts = [...doc.querySelectorAll('#sorts [data-sort]')];
    expect(sorts.map((el) => el.getAttribute('data-sort'))).toEqual(['newest', 'number', 'cited']);
    const pressed = sorts.filter((el) => el.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.getAttribute('data-sort')).toBe('newest');
  });

  it('offers an all, current, and per-status filter', () => {
    const filters = [...doc.querySelectorAll('#filters [data-filter]')].map((el) =>
      el.getAttribute('data-filter'),
    );
    expect(filters).toContain('all');
    expect(filters).toContain('current');
    expect(filters).toContain('status:superseded');
  });
});

describe('overview', () => {
  it('leads with counts of what is current versus replaced', () => {
    const text = doc.querySelector('.overview-body')?.textContent ?? '';
    expect(text).toContain('3 decision records');
    expect(text).toContain('2 of them still describe how the system works');
  });

  it('ranks the most-referenced record first', () => {
    const first = doc.querySelector('.ranked button');
    expect(first?.textContent).toContain('0065');
  });

  it('shows the supersession chain ending at the current record', () => {
    const chain = doc.querySelector('.chain');
    const links = [...(chain?.querySelectorAll('.link') ?? [])];
    expect(links.map((l) => l.textContent)).toEqual(['0054', '0065']);
    expect(links[1]?.getAttribute('class')).toContain('current');
  });
});

describe('a record', () => {
  function record(slugFragment: string) {
    const template = doc.querySelector('#tpl-records');
    const inner = parseHTML(
      `<!doctype html><html><body>${template?.innerHTML}</body></html>`,
    ).document;
    const sections = [...inner.querySelectorAll('[data-slug]')];
    const found = sections.find((s) => s.getAttribute('data-slug')?.includes(slugFragment));
    if (!found) throw new Error(`no record matching ${slugFragment}`);
    return found;
  }

  it('opens with the decision, before any prose', () => {
    const glance = record('0002').querySelector('.glance .decision');
    expect(glance?.textContent).toContain('single-pass settlement model');
  });

  it('states status, an absolute date, and reading time', () => {
    const meta = record('0002').querySelector('.rec-meta')?.textContent ?? '';
    expect(meta).toContain('Accepted');
    // A spelled-out date, not "5mo ago" — the reader is placing it in time.
    expect(meta).toContain('2 March 2026');
    expect(meta).not.toMatch(/ago/);
    expect(meta).toMatch(/min read/);
  });

  it('warns clearly when a record has been fully replaced', () => {
    const notice = record('0054').querySelector('.notice.replaced');
    expect(notice?.textContent).toContain('no longer how the system works');
    expect(notice?.querySelector('a')?.getAttribute('href')).toContain('0065');
  });

  it('marks partial supersession differently, and does not call it dead', () => {
    const section = record('0002');
    expect(section.querySelector('.notice.replaced')).toBeNull();
    expect(section.querySelector('.notice.partial')?.textContent).toContain('Partly replaced');
  });

  it('keeps the status prose when it says more than the badge', () => {
    expect(record('0002').querySelector('.status-prose')?.textContent).toContain('TCK-1042');
  });

  it('drops the status prose when it is just the label', () => {
    expect(record('0054').querySelector('.status-prose')).toBeNull();
  });

  it('renders tables and mermaid diagrams from the body', () => {
    const section = record('0002');
    expect(section.querySelector('.table-scroll table')).not.toBeNull();
    expect(section.querySelector('pre.mermaid')?.textContent).toContain('flowchart TD');
  });

  it('turns sibling references into in-page routes', () => {
    const links = [...record('0054').querySelectorAll('a.rec-link')];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute('href')).toMatch(/^#\//);
  });

  it('opens external references in a new tab, safely', () => {
    const external = record('0002').querySelector('a.ext-link');
    expect(external?.getAttribute('href')).toBe('https://example.test/TCK-1042');
    expect(external?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('unlinks a local path that is not a record', () => {
    const section = record('0065');
    expect(section.textContent).toContain('plan');
    const hrefs = [...section.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.some((href) => href?.includes('rollout-plan'))).toBe(false);
  });

  it('lists relations strongest-first without repeating a record', () => {
    const groups = [...record('0002').querySelectorAll('.rel-group h2')].map((h) => h.textContent);
    expect(groups[0]).toBe('Partly replaced by');

    const slugs = [...record('0002').querySelectorAll('.rel[data-goto]')].map((b) =>
      b.getAttribute('data-goto'),
    );
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('gives every record a back control for the one-column layout', () => {
    expect(record('0002').querySelector('[data-back]')).not.toBeNull();
  });
});
