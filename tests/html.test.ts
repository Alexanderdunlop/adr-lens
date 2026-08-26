import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { escapeHtml, renderHtml, renderInlineHtml } from '../src/render/html.ts';

/** Parse a fragment so assertions can be made against real DOM structure. */
function dom(html: string) {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
}

describe('escaping', () => {
  it('escapes the characters that break markup', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
  });

  it('escapes text inside rendered blocks', () => {
    const html = renderHtml('A paragraph with <b>raw tags</b> & an ampersand.\n');
    expect(html).not.toContain('<b>');
    expect(dom(html).querySelector('p')?.textContent).toContain('<b>raw tags</b>');
  });

  it('escapes code block contents', () => {
    const html = renderHtml('```html\n<img onerror="x">\n```\n');
    const code = dom(html).querySelector('code');
    expect(code?.textContent).toBe('<img onerror="x">');
    expect(dom(html).querySelector('img')).toBeNull();
  });
});

describe('inline', () => {
  it('emits semantic tags', () => {
    const doc = dom(renderInlineHtml('**bold**, *italic*, `code`, ~~gone~~'));
    expect(doc.querySelector('strong')?.textContent).toBe('bold');
    expect(doc.querySelector('em')?.textContent).toBe('italic');
    expect(doc.querySelector('code')?.textContent).toBe('code');
    expect(doc.querySelector('s')?.textContent).toBe('gone');
  });

  it('does not parse markup inside inline code', () => {
    const doc = dom(renderInlineHtml('`**not bold**`'));
    expect(doc.querySelector('strong')).toBeNull();
    expect(doc.querySelector('code')?.textContent).toBe('**not bold**');
  });

  it('keeps emphasis inside a link and marks it external', () => {
    const doc = dom(renderInlineHtml('[**strong** link](https://example.test/x)'));
    const anchor = doc.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.test/x');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor?.querySelector('strong')?.textContent).toBe('strong');
  });

  it('rewrites a link through the resolver', () => {
    const doc = dom(
      renderInlineHtml('see [ADR-65](0065-gate.md)', {
        resolveLink: () => ({ href: '#/0065-gate', internal: true }),
      }),
    );
    const anchor = doc.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('#/0065-gate');
    expect(anchor?.getAttribute('target')).toBeNull();
  });

  it('unlinks a destination the resolver rejects', () => {
    const doc = dom(
      renderInlineHtml('see [a plan](../plans/thing.md)', { resolveLink: () => null }),
    );
    expect(doc.querySelector('a')).toBeNull();
    expect(doc.querySelector('.dead-link')?.textContent).toBe('a plan');
  });

  it('refuses a javascript: destination even if the resolver allows it', () => {
    // A record is just a file in a shared repo; it must not be able to inject a
    // handler into a page other people open.
    const doc = dom(
      renderInlineHtml('[click](javascript:alert(1))', {
        resolveLink: (href) => ({ href, internal: false }),
      }),
    );
    expect(doc.querySelector('a')).toBeNull();
    expect(doc.querySelector('.dead-link')).not.toBeNull();
  });
});

describe('blocks', () => {
  it('offsets heading levels and gives them ids', () => {
    const doc = dom(renderHtml('## Context\n\nText.\n', { headingOffset: 1, idPrefix: 'r1' }));
    const heading = doc.querySelector('h3');
    expect(heading?.textContent).toBe('Context');
    expect(heading?.getAttribute('id')).toBe('r1-context');
  });

  it('nests lists by indentation', () => {
    const doc = dom(renderHtml('- one\n  - nested\n- two\n'));
    const top = doc.querySelector('ul');
    expect(top?.children).toHaveLength(2);
    expect(top?.querySelector('li ul li')?.textContent).toBe('nested');
  });

  it('renders ordered lists as ol', () => {
    const doc = dom(renderHtml('1. first\n2. second\n'));
    expect(doc.querySelector('ol')?.children).toHaveLength(2);
  });

  it('renders a table with a header row inside a scroll container', () => {
    const doc = dom(renderHtml('| A | B |\n|---|--:|\n| 1 | 2 |\n| 3 | 4 |\n'));
    expect(doc.querySelector('.table-scroll table')).not.toBeNull();
    expect(doc.querySelectorAll('thead th')).toHaveLength(2);
    expect(doc.querySelectorAll('tbody tr')).toHaveLength(2);
    // Right alignment from `--:` must survive.
    expect(doc.querySelectorAll('thead th')[1]?.getAttribute('style')).toContain('right');
  });

  it('emits mermaid fences as a mermaid pre so the runtime can draw them', () => {
    const doc = dom(renderHtml('```mermaid\nflowchart TD\n  A --> B\n```\n'));
    const pre = doc.querySelector('pre.mermaid');
    expect(pre?.textContent).toContain('flowchart TD');
    expect(doc.querySelector('code')).toBeNull();
  });

  it('labels other fences with their language', () => {
    const doc = dom(renderHtml('```ts\nconst x = 1;\n```\n'));
    expect(doc.querySelector('.code-lang')?.textContent).toBe('ts');
    expect(doc.querySelector('code')?.getAttribute('class')).toBe('language-ts');
  });

  it('renders a blockquote as blocks, not one flat line', () => {
    const doc = dom(renderHtml('> **Superseded in part by ADR-0065.**\n>\n> Second paragraph.\n'));
    expect(doc.querySelectorAll('blockquote p')).toHaveLength(2);
    expect(doc.querySelector('blockquote strong')).not.toBeNull();
  });

  it('skips the document title when asked', () => {
    const doc = dom(renderHtml('# The Title\n\n## Context\n\nBody.\n', { skipTitle: true }));
    expect(doc.querySelector('h1')).toBeNull();
    expect(doc.querySelector('h2')?.textContent).toBe('Context');
  });

  it('renders a horizontal rule', () => {
    expect(dom(renderHtml('---\n')).querySelector('hr')).not.toBeNull();
  });
});
