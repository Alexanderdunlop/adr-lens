import pc from 'picocolors';
import type { Status } from '../core/types.ts';
import type { Painter, Span } from './inline.ts';

/**
 * A deliberately small palette. ADRs are dense prose, and the fastest way to make
 * dense prose unreadable is to colour all of it — so colour marks *structure*
 * (headings, status, references) and body text stays default-foreground.
 */
export const theme = {
  h1: (s: string) => pc.bold(pc.white(s)),
  h2: (s: string) => pc.bold(pc.cyan(s)),
  h3: (s: string) => pc.bold(s),
  h4: (s: string) => pc.bold(pc.dim(s)),
  rule: (s: string) => pc.dim(pc.gray(s)),
  meta: (s: string) => pc.dim(s),
  code: (s: string) => pc.yellow(s),
  codeBlock: (s: string) => pc.gray(s),
  gutter: (s: string) => pc.dim(pc.cyan(s)),
  quote: (s: string) => pc.italic(pc.dim(s)),
  link: (s: string) => pc.cyan(s),
  url: (s: string) => pc.dim(pc.blue(s)),
  bullet: (s: string) => pc.cyan(s),
  tableHeader: (s: string) => pc.bold(s),
  tableBorder: (s: string) => pc.dim(pc.gray(s)),
  bold: (s: string) => pc.bold(s),
  italic: (s: string) => pc.italic(s),
  strike: (s: string) => pc.strikethrough(pc.dim(s)),
  dim: (s: string) => pc.dim(s),
  warn: (s: string) => pc.yellow(s),
  error: (s: string) => pc.red(s),
  ok: (s: string) => pc.green(s),
  highlight: (s: string) => pc.inverse(s),
} as const;

/**
 * Map a span's semantic style to terminal colour. Code and links win over
 * emphasis, because in ADR prose they carry the information — a bolded
 * identifier is still an identifier.
 */
export const ansiPaint: Painter = (span: Span) => {
  const style = span.style;

  if (style?.code) return theme.code;
  if (style?.image) return theme.dim;
  if (span.href) return theme.link;
  if (style?.strike) return theme.strike;
  if (style?.bold) return theme.bold;
  if (style?.italic) return theme.italic;
  return undefined;
};

/** A painter that forces one style over everything, for callers with their own emphasis. */
export function paintAll(paint: (text: string) => string): Painter {
  return () => paint;
}

/** Colour and glyph for each lifecycle state. */
export const STATUS_STYLE: Record<
  Status,
  { label: string; glyph: string; paint: (s: string) => string }
> = {
  accepted: { label: 'Accepted', glyph: '●', paint: pc.green },
  proposed: { label: 'Proposed', glyph: '◐', paint: pc.yellow },
  rejected: { label: 'Rejected', glyph: '✕', paint: pc.red },
  deprecated: { label: 'Deprecated', glyph: '◌', paint: pc.magenta },
  superseded: { label: 'Superseded', glyph: '⊘', paint: pc.gray },
  unknown: { label: 'Unknown', glyph: '?', paint: pc.dim },
};

export function statusBadge(status: Status, width?: number): string {
  const style = STATUS_STYLE[status];
  const text = `${style.glyph} ${style.label}`;
  const padded = width === undefined ? text : text.padEnd(width);
  return style.paint(padded);
}

export function statusGlyph(status: Status): string {
  const style = STATUS_STYLE[status];
  return style.paint(style.glyph);
}
