import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCorpus } from '../src/core/corpus.ts';
import { renderPage } from '../src/web/page.ts';
import { parse } from './fixtures.ts';

const NOW = new Date('2026-08-26T00:00:00Z');

const GATE = `# 9. Single-store idempotency gate

Date: 2026-04-18

## Status

Accepted

## Decision

\`buildInvoiceId\` produces a period-independent composite id.
`;

const ROUNDING = `# 10. Currency rounding at the boundary

Date: 2026-05-02

## Status

Accepted

## Decision

Round once, when an amount leaves the service.
`;

/**
 * Boot the page's own inline script against a stubbed browser.
 *
 * The clipboard is the one part of this page that cannot be checked by reading
 * the markup — the button has to actually be pressed — so the script is run for
 * real rather than asserted about as text. Only what the script touches is
 * stubbed; anything missing shows up as a thrown error rather than a pass.
 */
function boot(html: string) {
  const inline = /<script>\n([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!inline) throw new Error('the page emitted no inline script');

  const { document } = parseHTML(html.replace(/<script>[\s\S]*?<\/script>/, ''));

  const clipboard: string[] = [];
  const downloads: Array<{ name: string; bytes: number }> = [];
  const winEvents: Record<string, Array<() => void>> = {};
  const docEvents: Record<string, Array<(event: unknown) => void>> = {};

  const win = {
    location: { href: 'https://decisions.example.test/billing.html', hash: '' },
    navigator: {
      clipboard: {
        writeText: (text: string) => {
          clipboard.push(text);
          return Promise.resolve();
        },
      } as { writeText(text: string): Promise<void> } | undefined,
    },
    // The script guards every storage access, so the null-returning stub is
    // enough — it exercises the "nothing remembered yet" path.
    sessionStorage: { getItem: () => null, setItem: () => {} } as unknown as Storage,
    addEventListener: (type: string, fn: () => void) => {
      winEvents[type] ??= [];
      winEvents[type].push(fn);
    },
    scrollTo: () => {},
    scrollY: 0,

    // Enough of the download path to see the file that would have been saved.
    Blob: class {
      size: number;
      constructor(parts: Uint8Array[]) {
        this.size = parts[0]?.length ?? 0;
      }
    },
    URL: {
      createObjectURL: (blob: { size: number }) => `blob:${blob.size}`,
      revoked: [] as string[],
      revokeObjectURL(url: string) {
        win.URL.revoked.push(url);
      },
    },
  };

  // Intercept only `addEventListener`; everything else is the real document.
  const doc = new Proxy(document, {
    get(target, prop: string) {
      if (prop === 'addEventListener') {
        return (type: string, fn: (event: unknown) => void) => {
          docEvents[type] ??= [];
          docEvents[type].push(fn);
        };
      }
      const value = (target as unknown as Record<string, unknown>)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  // Layout and selection do not exist outside a browser; the script only uses
  // them to decide whether to scroll, and to drive the clipboard fallback.
  const element = Object.getPrototypeOf(document.createElement('div'));
  element.getBoundingClientRect = () => ({ top: 0, bottom: 0 });
  element.scrollIntoView = () => {};
  element.select = () => {};
  element.click = function click(this: {
    getAttribute(name: string): string | null;
  }) {
    const name = this.getAttribute('download');
    if (name) {
      downloads.push({
        name,
        bytes: Number((this.getAttribute('href') || '').replace('blob:', '')),
      });
    }
  };

  new Function('window', 'document', inline)(win, doc);

  const inner = () => {
    const element = document.getElementById('reader-inner');
    if (!element) throw new Error('the page emitted no reading pane');
    return element;
  };

  return {
    win,
    clipboard,
    downloads,
    document,

    open(slug: string): void {
      win.location.hash = `#/${slug}`;
      for (const fn of winEvents.hashchange ?? []) fn();
    },

    press(selector: string): void {
      const element = inner().querySelector(selector);
      if (!element) throw new Error(`no ${selector} in the open record`);
      for (const fn of docEvents.click ?? []) fn({ target: element, preventDefault() {} });
    },

    attribute(selector: string, name: string): string | null {
      return inner().querySelector(selector)?.getAttribute(name) ?? null;
    },

    status(): string {
      return inner().querySelector('[data-copy-status]')?.textContent ?? '';
    },
  };
}

/** Let the clipboard promise and its `then` settle. */
const settled = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

let page: ReturnType<typeof boot>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => fn());

  const corpus = buildCorpus([parse(GATE, '0009-gate.md'), parse(ROUNDING, '0010-rounding.md')]);
  page = boot(renderPage(corpus, { scope: 'billing-service', now: NOW }));
  page.open('0009-single-store-idempotency-gate');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sharing one record', () => {
  it('opens the record the hash names', () => {
    expect(page.document.getElementById('reader-inner')?.textContent).toContain(
      'Single-store idempotency gate',
    );
  });

  it('copies a link that points at this record, not at the reader’s own hash', async () => {
    page.press('[data-copy="link"]');
    await settled();

    expect(page.clipboard).toEqual([
      'https://decisions.example.test/billing.html#/0009-single-store-idempotency-gate',
    ]);
  });

  it('copies the record’s markdown source, not its rendered body', async () => {
    page.press('[data-copy="markdown"]');
    await settled();

    expect(page.clipboard[0]).toBe(GATE);
    expect(page.clipboard[0]).not.toContain('<p>');
  });

  it('copies a citation fit for a commit message', async () => {
    page.press('[data-copy="citation"]');
    await settled();

    expect(page.clipboard[0]).toBe('ADR-0009 Single-store idempotency gate (accepted, 2026-04-18)');
  });

  it('announces the outcome, and marks the button that was pressed', async () => {
    page.press('[data-copy="citation"]');
    await settled();

    expect(page.status()).toBe('Citation copied.');
    expect(page.attribute('[data-copy="citation"]', 'data-copied')).toBe('true');
  });

  it('marks only the last button pressed', async () => {
    page.press('[data-copy="link"]');
    await settled();
    page.press('[data-copy="citation"]');
    await settled();

    expect(page.attribute('[data-copy="link"]', 'data-copied')).toBeNull();
    expect(page.attribute('[data-copy="citation"]', 'data-copied')).toBe('true');
  });

  it('stops saying "copied" a moment later', async () => {
    page.press('[data-copy="link"]');
    await settled();
    vi.runAllTimers();

    expect(page.status()).toBe('');
    expect(page.attribute('[data-copy="link"]', 'data-copied')).toBeNull();
  });

  it('copies the record you are looking at after navigating', async () => {
    page.open('0010-currency-rounding-at-the-boundary');
    page.press('[data-copy="citation"]');
    await settled();

    expect(page.clipboard[0]).toContain('ADR-0010');
  });

  /**
   * A download, not a print dialog: the dialog aims at a printer, hides "Save as
   * PDF" in a destination menu, and cannot be driven from a button.
   */
  it('downloads a PDF named after the record', () => {
    page.press('[data-pdf]');

    expect(page.downloads).toHaveLength(1);
    expect(page.downloads[0]?.name).toBe('adr-0009-single-store-idempotency-gate.pdf');
    expect(page.downloads[0]?.bytes).toBeGreaterThan(1000);
    expect(page.status()).toBe('PDF downloaded.');
    expect(page.attribute('[data-pdf]', 'data-copied')).toBe('true');
  });

  it('names the PDF after whichever record is open', () => {
    page.open('0010-currency-rounding-at-the-boundary');
    page.press('[data-pdf]');

    expect(page.downloads[0]?.name).toBe('adr-0010-currency-rounding-at-the-boundary.pdf');
  });

  it('leaves no anchor behind in the document', () => {
    page.press('[data-pdf]');
    expect(page.document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('says so if the record cannot be laid out, rather than failing silently', () => {
    // The writer is the one part of this that could throw on odd markup.
    (page.win as unknown as { __adrPdf: { build: () => never } }).__adrPdf.build = () => {
      throw new Error('unlayoutable');
    };

    page.press('[data-pdf]');

    expect(page.downloads).toHaveLength(0);
    expect(page.status()).toBe('Could not build the PDF.');
    expect(page.attribute('[data-pdf]', 'data-copied')).toBe('failed');
  });

  /**
   * A clipboard write can sit behind a permission prompt. If the reader has
   * pressed something else by the time it lands, it must not report — the answer
   * would be attached to the wrong button.
   */
  it('drops a copy that lands after the reader pressed something else', async () => {
    const landings: Array<() => void> = [];
    page.win.navigator.clipboard = {
      writeText: () => new Promise<void>((resolve) => landings.push(resolve)),
    };

    page.press('[data-copy="link"]');
    page.press('[data-copy="citation"]');

    landings[0]?.();
    await settled();
    expect(page.attribute('[data-copy="link"]', 'data-copied')).toBeNull();

    landings[1]?.();
    await settled();
    expect(page.attribute('[data-copy="citation"]', 'data-copied')).toBe('true');
    expect(page.status()).toBe('Citation copied.');
  });
});

describe('when the async clipboard is unavailable', () => {
  /**
   * A page served over plain http is not a secure context, so
   * `navigator.clipboard` is simply absent there. The deprecated selection copy
   * is the only thing that works, and is worth keeping: the alternative is a
   * button that does nothing and says nothing.
   */
  it('falls back to a selection copy, and cleans up after itself', async () => {
    page.win.navigator.clipboard = undefined;
    let copies = 0;
    (page.document as unknown as { execCommand: () => boolean }).execCommand = () => {
      copies += 1;
      return true;
    };

    page.press('[data-copy="link"]');
    await settled();

    expect(copies).toBe(1);
    expect(page.status()).toBe('Link copied.');
    expect(page.document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('says so rather than failing silently, and still leaves no scratch node', async () => {
    page.win.navigator.clipboard = undefined;
    (page.document as unknown as { execCommand: () => boolean }).execCommand = () => {
      throw new Error('blocked');
    };

    page.press('[data-copy="link"]');
    await settled();

    expect(page.clipboard).toEqual([]);
    expect(page.status()).toBe('Could not reach the clipboard.');
    expect(page.attribute('[data-copy="link"]', 'data-copied')).toBe('failed');
    expect(page.document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
