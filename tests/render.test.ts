import { describe, expect, it } from 'vitest';
import { parseInline, stripAnsi, visibleWidth, wrapSpans } from '../src/render/inline.ts';
import { renderMarkdown } from '../src/render/markdown.ts';

const WIDTH = 60;

function render(markdown: string, width = WIDTH): string[] {
  return renderMarkdown(markdown, { width });
}

/** Every rendered line must fit the column, ignoring escape sequences. */
function expectFits(lines: string[], width = WIDTH): void {
  for (const line of lines) {
    expect(
      visibleWidth(line),
      `line exceeds ${width} cols: ${JSON.stringify(stripAnsi(line))}`,
    ).toBeLessThanOrEqual(width);
  }
}

describe('inline parsing', () => {
  it('captures link text and href', () => {
    const spans = parseInline('see [ADR-1](0001-a.md) now');
    const link = spans.find((s) => s.href);
    expect(link?.text).toBe('ADR-1');
    expect(link?.href).toBe('0001-a.md');
  });

  it('does not parse markup inside inline code', () => {
    const spans = parseInline('use `**not bold**` here');
    expect(spans.map((s) => s.text)).toContain('**not bold**');
  });

  it('renders an image as a labelled placeholder', () => {
    const spans = parseInline('![a diagram](x.png)');
    expect(spans[0]!.text).toBe('[image: a diagram]');
  });
});

describe('wrapping', () => {
  it('wraps to the given width and never overflows', () => {
    const text = 'The quick brown fox jumps over the lazy dog and keeps on running for ages.';
    const lines = wrapSpans(parseInline(text), 30);
    expectFits(lines, 30);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('measures width after stripping styling, not before', () => {
    // Styled text carries escape bytes that have length but no columns; wrapping
    // on raw length is how terminal renderers end up ragged.
    const lines = wrapSpans(parseInline('**bold words here** and some plain text follows'), 20);
    expectFits(lines, 20);
  });

  it('hard-breaks a word longer than the column', () => {
    const long = 'a'.repeat(80);
    const lines = wrapSpans(parseInline(long), 20);
    expectFits(lines, 20);
    expect(stripAnsi(lines.join('')).replace(/\s/g, '')).toBe(long);
  });

  it('applies a hanging indent', () => {
    const lines = wrapSpans(parseInline('one two three four five six seven eight'), 20, '  ');
    for (const line of lines) expect(line.startsWith('  ')).toBe(true);
    expectFits(lines, 20);
  });
});

describe('block rendering', () => {
  it('renders headings, paragraphs, and lists within the column', () => {
    const lines = render(
      '# Title\n\n## Context\n\nSome prose that runs on for a while and needs wrapping to fit.\n\n- first item\n- second item that is quite a lot longer than the first one\n',
    );
    expectFits(lines);
    expect(stripAnsi(lines.join('\n'))).toContain('Title');
    expect(stripAnsi(lines.join('\n'))).toContain('• first item');
  });

  it('numbers ordered lists independently per level', () => {
    const text = stripAnsi(render('1. one\n2. two\n3. three\n').join('\n'));
    expect(text).toContain('1. one');
    expect(text).toContain('2. two');
    expect(text).toContain('3. three');
  });

  it('keeps a wide table inside the column', () => {
    const table = [
      '| Aspect | ESLint + Prettier | Biome |',
      '|--------|-------------------|-------|',
      '| Tools required | 2 tools plus 127 npm packages and a lot of config | 1 binary |',
      '| Speed | about 45 seconds to lint ten thousand files | under a second |',
    ].join('\n');

    const lines = render(table);
    expectFits(lines);
    expect(stripAnsi(lines.join('\n'))).toContain('Aspect');
    expect(stripAnsi(lines.join('\n'))).toContain('Biome');
  });

  it('renders a fenced code block without wrapping its contents', () => {
    const lines = render('```ts\nconst x = 1;\n```\n');
    expectFits(lines);
    expect(stripAnsi(lines.join('\n'))).toContain('const x = 1;');
  });

  it('does not treat a pipe row without a divider as a table', () => {
    const text = stripAnsi(render('| this is just prose with a pipe\n').join('\n'));
    expect(text).toContain('this is just prose with a pipe');
  });

  it('skips the document title when asked', () => {
    const lines = renderMarkdown('# The Title\n\n## Context\n\nBody.\n', {
      width: WIDTH,
      skipTitle: true,
    });
    expect(stripAnsi(lines.join('\n'))).not.toContain('The Title');
  });

  it('prints link destinations when requested', () => {
    const lines = renderMarkdown('See [the ADR](0001-a.md).\n', { width: WIDTH, showUrls: true });
    expect(stripAnsi(lines.join('\n'))).toContain('0001-a.md');
  });

  it('renders a blockquote with a gutter', () => {
    const lines = render('> Superseded in part by ADR-0065.\n');
    expectFits(lines);
    expect(stripAnsi(lines.join('\n'))).toContain('Superseded in part by ADR-0065.');
  });

  it('survives a narrow column', () => {
    const lines = render('## Heading\n\nSome text.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', 24);
    expectFits(lines, 24);
  });
});
