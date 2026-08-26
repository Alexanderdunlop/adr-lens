import stringWidth from 'string-width';

/**
 * What a run of text *means*, not how it looks. Emitters map these to their own
 * vocabulary — ANSI escapes for the terminal, tags for HTML — so the inline
 * grammar is parsed once and rendered many ways.
 */
export interface SpanStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** An image, kept as a text placeholder rather than dropped. */
  image?: boolean;
}

/** A run of text carrying a single style. */
export interface Span {
  text: string;
  style?: SpanStyle;
  /** Set for link spans so emitters can surface the destination. */
  href?: string;
}

/** Resolves the paint function for a span. Layout stays emitter-agnostic. */
export type Painter = (span: Span) => ((text: string) => string) | undefined;

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR escape sequences is the point
const ANSI = /\u001B\[[0-9;]*m/g;

export function visibleWidth(text: string): number {
  return stringWidth(text.replace(ANSI, ''));
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** Merge a style onto a span without discarding what it already carries. */
function restyle(span: Span, style: SpanStyle): Span {
  return { ...span, style: { ...span.style, ...style } };
}

/**
 * Tokenise inline markdown into styled spans.
 *
 * For terminal output, styling is applied *after* wrapping rather than before,
 * because ANSI escape sequences have width in a string but not on screen —
 * wrapping painted text is how terminal renderers end up with ragged right edges.
 */
export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let buffer = '';
  let i = 0;

  const flush = (): void => {
    if (buffer) {
      spans.push({ text: buffer });
      buffer = '';
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    // Inline code first: its contents are literal, so nothing inside it parses.
    const code = /^(`+)([\s\S]*?)\1/.exec(rest);
    if (code) {
      flush();
      spans.push({ text: code[2]!.trim(), style: { code: true } });
      i += code[0].length;
      continue;
    }

    // Image — render as a labelled placeholder rather than dropping it silently.
    const image = /^!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (image) {
      flush();
      spans.push({
        text: `[image: ${image[1] || 'untitled'}]`,
        style: { image: true },
        href: image[2]!,
      });
      i += image[0].length;
      continue;
    }

    const link = /^\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link) {
      flush();
      const label = link[1]!;
      const href = link[2]!;
      // Nested emphasis inside link text is common, so keep the inner styles and
      // just attach the destination.
      for (const span of parseInline(label)) {
        spans.push({ ...span, href });
      }
      if (label.trim() === '') spans.push({ text: href, href });
      i += link[0].length;
      continue;
    }

    const bold = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (bold) {
      flush();
      for (const span of parseInline(bold[2]!)) {
        spans.push(restyle(span, { bold: true }));
      }
      i += bold[0].length;
      continue;
    }

    const strike = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest);
    if (strike) {
      flush();
      for (const span of parseInline(strike[1]!)) {
        spans.push(restyle(span, { strike: true }));
      }
      i += strike[0].length;
      continue;
    }

    const italic = /^(\*|_)(?=\S)([^*_\n]*?\S)\1/.exec(rest);
    if (italic) {
      flush();
      for (const span of parseInline(italic[2]!)) {
        spans.push(restyle(span, { italic: true }));
      }
      i += italic[0].length;
      continue;
    }

    // Escaped punctuation.
    if (rest.startsWith('\\') && rest.length > 1) {
      buffer += rest[1];
      i += 2;
      continue;
    }

    buffer += text[i];
    i++;
  }

  flush();
  return spans;
}

interface Word {
  text: string;
  paint?: (s: string) => string;
}

/**
 * Wrap styled spans to `width`, painting each word only once its position is
 * final. Words longer than the available width are hard-broken rather than
 * allowed to overflow, which keeps long URLs and identifiers inside the column.
 *
 * `paint` decides how a span's style becomes visible; omit it for plain text.
 */
export function wrapSpans(spans: Span[], width: number, indent = '', paint?: Painter): string[] {
  const available = Math.max(8, width - visibleWidth(indent));
  const words = toWords(spans, paint);

  const lines: string[] = [];
  let current: Word[] = [];
  let currentWidth = 0;

  const commit = (): void => {
    if (current.length === 0) return;
    lines.push(indent + current.map((w) => (w.paint ? w.paint(w.text) : w.text)).join(''));
    current = [];
    currentWidth = 0;
  };

  for (const word of words) {
    if (word.text === '\n') {
      commit();
      continue;
    }

    const wordWidth = visibleWidth(word.text);

    if (word.text === ' ') {
      // Never open a line with a space; never double one up.
      if (currentWidth === 0) continue;
      if (currentWidth + 1 > available) {
        commit();
        continue;
      }
      current.push(word);
      currentWidth += 1;
      continue;
    }

    if (wordWidth > available) {
      commit();
      for (const chunk of hardBreak(word.text, available)) {
        lines.push(indent + (word.paint ? word.paint(chunk) : chunk));
      }
      continue;
    }

    if (currentWidth + wordWidth > available) commit();
    current.push(word);
    currentWidth += wordWidth;
  }

  commit();
  return lines.length > 0 ? lines : [indent.trimEnd()];
}

function toWords(spans: Span[], paint?: Painter): Word[] {
  const words: Word[] = [];

  for (const span of spans) {
    const painter = paint?.(span);
    // Split on whitespace but keep the separators, so runs of styled text join
    // back together without losing the spaces between them.
    const parts = span.text.split(/(\n|[ \t]+)/);
    for (const part of parts) {
      if (part === '') continue;
      if (part === '\n') {
        words.push({ text: '\n' });
        continue;
      }
      if (/^[ \t]+$/.test(part)) {
        words.push({ text: ' ' });
        continue;
      }
      words.push({ text: part, paint: painter });
    }
  }

  // Trailing space before a break serves no purpose.
  while (words.length > 0 && words[words.length - 1]!.text === ' ') words.pop();

  return words;
}

function hardBreak(text: string, width: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (visibleWidth(rest) > width) {
    let take = 0;
    let taken = 0;
    while (take < rest.length && taken + visibleWidth(rest[take]!) <= width) {
      taken += visibleWidth(rest[take]!);
      take++;
    }
    chunks.push(rest.slice(0, Math.max(1, take)));
    rest = rest.slice(Math.max(1, take));
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Truncate to `width` visible columns, appending an ellipsis when it does not fit. */
export function truncateToWidth(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  if (width <= 1) return '…';

  let taken = 0;
  let out = '';
  for (const char of text) {
    const charWidth = visibleWidth(char);
    if (taken + charWidth > width - 1) break;
    out += char;
    taken += charWidth;
  }
  return `${out}…`;
}

/** Pad to `width` visible columns, ignoring any ANSI already applied. */
export function padToWidth(text: string, width: number): string {
  const deficit = width - visibleWidth(text);
  return deficit > 0 ? text + ' '.repeat(deficit) : text;
}
