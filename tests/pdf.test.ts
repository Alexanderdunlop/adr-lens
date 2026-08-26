import { parseHTML } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCorpus } from '../src/core/corpus.ts';
import { renderPage } from '../src/web/page.ts';
import { PDF_SCRIPT } from '../src/web/pdf.ts';
import { glyphWidth } from '../src/web/pdf-metrics.ts';
import { parse } from './fixtures.ts';

const NOW = new Date('2026-08-26T00:00:00Z');

const RECORD = `# 9. Single-store idempotency gate

Date: 2026-04-18

## Status

Accepted. Scope narrowed by [TCK-1042](https://tracker.example.test/TCK-1042); the rest holds.

## Context

The service settles invoices in batches, and a retry must not double-charge.

- **Scale** — thousands of tenants a night
- **Reliability** — safe under duplicate delivery

## Decision

\`buildInvoiceId\` produces a period-independent composite id.

| Property | Before | After |
|---|---|---|
| Blast radius | whole batch | one invoice |
| Restart cost | full replay | the failed message |

\`\`\`ts
const key = hash(tenantId + ':' + invoicePeriod);
\`\`\`

> An em dash — a curly quote's apostrophe — and an arrow → all have to survive.

## Consequences

See [ADR-0002](0002-earlier.md) for what this replaced.
`;

const EARLIER = `# 2. Earlier decision

Date: 2026-01-22

## Status

Superseded by [ADR-0009](0009-gate.md)

## Decision

The thing we used to do.
`;

interface PdfApi {
  build(section: unknown): Uint8Array;
  encode(text: string): number[];
  literal(text: string): string;
  widthOf(run: { font: string; size: number; tracking?: number }, text: string): number;
  wrap(
    runs: Array<{ text: string; run: { font: string; size: number } }>,
    maxWidth: number,
  ): Array<Array<{ text: string }>>;
}

let pdf: PdfApi;
let doc: ReturnType<typeof parseHTML>['document'];

/** The rendered record sections, as the page ships them inside its template. */
function section(fragment: string) {
  const template = doc.querySelector('#tpl-records');
  const inner = parseHTML(
    `<!doctype html><html><body>${template?.innerHTML}</body></html>`,
  ).document;
  const found = [...inner.querySelectorAll('[data-slug]')].find((s) =>
    s.getAttribute('data-slug')?.includes(fragment),
  );
  if (!found) throw new Error(`no record matching ${fragment}`);
  return found;
}

beforeAll(() => {
  const corpus = buildCorpus([parse(RECORD, '0009-gate.md'), parse(EARLIER, '0002-earlier.md')]);
  doc = parseHTML(renderPage(corpus, { scope: 'billing-service', now: NOW })).document;

  const win: { __adrPdf?: PdfApi } = {};
  new Function('window', 'document', PDF_SCRIPT)(win, doc);
  if (!win.__adrPdf) throw new Error('the pdf script exposed no api');
  pdf = win.__adrPdf;
});

/** Latin-1 text of the file, for looking inside its uncompressed streams. */
function textOf(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function unescapePdf(text: string): string {
  return text.replace(/\\([0-7]{3})|\\(.)/g, (_, octal: string, char: string) =>
    octal ? String.fromCharCode(Number.parseInt(octal, 8)) : char,
  );
}

/**
 * Every string the file draws, in order.
 *
 * Words are positioned one at a time, so a phrase never appears as a single
 * literal — reading the text back out the way a PDF viewer would is both the
 * only way to assert on content and a check that the text really is text.
 */
function pdfText(raw: string): string {
  const drawn: string[] = [];
  for (const match of raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    drawn.push(unescapePdf(match[1] ?? ''));
  }
  return drawn.join(' ').replace(/\s+/g, ' ').trim();
}

describe('the inline script', () => {
  it('parses as JavaScript', () => {
    expect(() => new Function(PDF_SCRIPT)).not.toThrow();
  });

  it('contains no backtick, which would close its own template', () => {
    expect(PDF_SCRIPT.includes(String.fromCharCode(96))).toBe(false);
  });

  it('leaves no placeholder unsubstituted', () => {
    expect(PDF_SCRIPT).not.toMatch(/__(?:METRICS|FIRST|OFFSET)__/);
  });
});

/**
 * The generated width tables are the one part of this that cannot be reasoned
 * about by reading it, so they are checked against the published Adobe AFM
 * values. If these drift, every line in every exported PDF wraps in the wrong
 * place.
 */
describe('font metrics', () => {
  const CODES = { space: 32, A: 65, M: 77, W: 87, a: 97, i: 105 };

  it('matches the published Times-Roman widths', () => {
    expect(glyphWidth('Times-Roman', CODES.space)).toBe(250);
    expect(glyphWidth('Times-Roman', CODES.A)).toBe(722);
    expect(glyphWidth('Times-Roman', CODES.M)).toBe(889);
    expect(glyphWidth('Times-Roman', CODES.a)).toBe(444);
    expect(glyphWidth('Times-Roman', CODES.i)).toBe(278);
  });

  it('matches the published Times-Bold widths', () => {
    expect(glyphWidth('Times-Bold', CODES.M)).toBe(944);
    expect(glyphWidth('Times-Bold', CODES.W)).toBe(1000);
    expect(glyphWidth('Times-Bold', CODES.a)).toBe(500);
  });

  it('matches the published Helvetica widths', () => {
    expect(glyphWidth('Helvetica', CODES.space)).toBe(278);
    expect(glyphWidth('Helvetica', CODES.A)).toBe(667);
    expect(glyphWidth('Helvetica', CODES.a)).toBe(556);
    expect(glyphWidth('Helvetica', CODES.i)).toBe(222);
  });

  it('keeps Courier monospaced', () => {
    for (const code of Object.values(CODES)) expect(glyphWidth('Courier', code)).toBe(600);
  });

  it('gives an unknown font or an out-of-range code no width', () => {
    expect(glyphWidth('Comic-Sans', CODES.A)).toBe(0);
    expect(glyphWidth('Helvetica', 31)).toBe(0);
    expect(glyphWidth('Helvetica', 999)).toBe(0);
  });
});

describe('encoding', () => {
  it('maps the punctuation prose actually uses into WinAnsi', () => {
    expect(pdf.encode('—')).toEqual([0x97]); // em dash
    expect(pdf.encode('–')).toEqual([0x96]); // en dash
    expect(pdf.encode('’')).toEqual([0x92]); // right single quote
    expect(pdf.encode('·')).toEqual([0xb7]); // middot, already Latin-1
  });

  /** An arrow is load-bearing in a supersession note; dropping it changes meaning. */
  it('spells out characters WinAnsi has no slot for', () => {
    expect(String.fromCharCode(...pdf.encode('A → B'))).toBe('A -> B');
    expect(String.fromCharCode(...pdf.encode('x ≤ y'))).toBe('x <= y');
  });

  it('falls back to a question mark rather than dropping a glyph', () => {
    expect(pdf.encode('中')).toEqual([0x3f]);
  });

  it('escapes the three bytes a PDF string cannot carry raw', () => {
    expect(pdf.literal('a(b)c\\d')).toBe('a\\(b\\)c\\\\d');
  });

  it('writes high bytes as octal, so the stream stays 7-bit safe', () => {
    expect(pdf.literal('—')).toBe('\\227');
  });
});

describe('line breaking', () => {
  const run = { font: 'Times-Roman', size: 10 };

  it('fills a line and no more', () => {
    const runs = [{ text: 'one two three four five six seven eight nine ten', run }];
    const lines = pdf.wrap(runs, 80);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const text = line.map((piece) => piece.text).join('');
      expect(pdf.widthOf(run, text)).toBeLessThanOrEqual(80);
    }
  });

  it('never leaves a leading space on a line', () => {
    const lines = pdf.wrap([{ text: 'alpha beta gamma delta epsilon', run }], 60);
    for (const line of lines) expect(line[0]?.text).not.toBe(' ');
  });

  /** A url has no spaces, so refusing to break it would overflow the margin. */
  it('breaks a single word too long for the measure', () => {
    const url = 'https://runbooks.example.test/billing/settlement/idempotency-gate#recovering';
    const lines = pdf.wrap([{ text: url, run }], 100);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l.map((p) => p.text).join('')).join('')).toBe(url);
    for (const line of lines) {
      expect(pdf.widthOf(run, line.map((p) => p.text).join(''))).toBeLessThanOrEqual(100);
    }
  });
});

describe('a built document', () => {
  let bytes: Uint8Array;
  let raw: string;

  beforeAll(() => {
    bytes = pdf.build(section('0009'));
    raw = textOf(bytes);
  });

  it('is a PDF', () => {
    expect(raw.startsWith('%PDF-1.4\n')).toBe(true);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('has a catalog, a page tree, and at least one page', () => {
    expect(raw).toContain('/Type /Catalog');
    expect(raw).toContain('/Type /Pages');
    expect(raw).toContain('/Type /Page ');
  });

  /**
   * A wrong offset here is the difference between a file that opens and one that
   * a reader rejects outright, and it is invisible in any visual check.
   */
  it('has an xref table whose every offset lands on its object', () => {
    const startxref = /startxref\s+(\d+)/.exec(raw);
    expect(startxref).not.toBeNull();
    expect(raw.slice(Number(startxref![1])).startsWith('xref')).toBe(true);

    const table = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(raw);
    expect(table).not.toBeNull();

    const rows = table![2]!.trimEnd().split('\n');
    expect(rows).toHaveLength(Number(table![1]));
    expect(rows[0]).toBe('0000000000 65535 f ');

    rows.slice(1).forEach((row, index) => {
      const offset = Number(row.slice(0, 10));
      expect(raw.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj\\n`));
    });
  });

  it('declares the six base-14 faces, so nothing has to be embedded', () => {
    for (const face of [
      'Times-Roman',
      'Times-Bold',
      'Times-Italic',
      'Helvetica',
      'Helvetica-Bold',
      'Courier',
    ]) {
      expect(raw).toContain(`/BaseFont /${face}`);
    }
    expect(raw.match(/\/Encoding \/WinAnsiEncoding/g)).toHaveLength(6);
  });

  it('states a stream length that matches the stream', () => {
    const streams = [...raw.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];
    expect(streams.length).toBeGreaterThan(0);
    for (const [, length, body] of streams) expect(body!.length).toBe(Number(length));
  });

  it('carries the record as real text, not as a picture of one', () => {
    const text = pdfText(raw);
    expect(text).toContain('Single-store idempotency gate');
    expect(text).toContain('THE DECISION');
    expect(text).toContain('period-independent composite id');
    expect(text).toContain('Consequences');
    expect(raw).not.toContain('/Image');
  });

  it('keeps the record body in reading order', () => {
    const text = pdfText(raw);
    expect(text.indexOf('Context')).toBeLessThan(text.indexOf('Decision'));
    expect(text.indexOf('Decision')).toBeLessThan(text.indexOf('Consequences'));
  });

  it('keeps list items', () => {
    const text = pdfText(raw);
    expect(text).toContain('thousands of tenants a night');
    expect(text).toContain('safe under duplicate delivery');
  });

  it('names the scope and the record on every page, and numbers them', () => {
    const pages = raw.match(/\/Type \/Page /g)?.length ?? 0;
    expect(pages).toBeGreaterThan(0);
    for (let page = 1; page <= pages; page++) {
      expect(raw).toContain(`(${page} of ${pages})`);
    }
    expect(raw).toContain('(billing-service');
  });

  /** A link in an emailed PDF is not clickable, and a route is not guessable. */
  it('spells out an external url but not an in-page route', () => {
    expect(raw).toContain('tracker.example.test/TCK-1042');
    expect(raw).not.toContain('#/0002');
  });

  it('renders the table as text rather than skipping it', () => {
    const text = pdfText(raw);
    expect(text).toContain('Property');
    expect(text).toContain('Blast radius');
    expect(text).toContain('whole batch');
    expect(text).toContain('the failed message');
  });

  it('keeps a fenced block whole, in the mono face', () => {
    expect(raw).toContain('/F6');
    expect(pdfText(raw)).toContain("hash(tenantId + ':' + invoicePeriod);");
  });

  it('survives punctuation that has no place in WinAnsi', () => {
    const text = pdfText(raw);
    // The blockquote's arrow, spelled out rather than dropped.
    expect(text).toContain('an arrow -> all have to survive');
    // Its em dash, carried as the WinAnsi byte rather than the Unicode one.
    expect(text).toContain(String.fromCharCode(0x97));
  });
});

describe('a replaced record', () => {
  it('carries its replacement notice and its relations into the file', () => {
    const text = pdfText(textOf(pdf.build(section('0002'))));
    expect(text).toContain('no longer how the system works');
    expect(text).toContain('REPLACED BY');
    expect(text).toContain('Single-store idempotency gate');
  });
});
