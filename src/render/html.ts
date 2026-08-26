import type { Align, Block, ListItem } from './blocks.ts';
import { splitBlocks } from './blocks.ts';
import { parseInline, type Span } from './inline.ts';

export interface HtmlOptions {
  /**
   * Rewrite a link destination. Return null to leave the text unlinked — used
   * for local paths that point at files the reader has no access to.
   */
  resolveLink?: (href: string) => { href: string; internal: boolean } | null;
  /** Skip the document's own level-1 heading; the page renders its own title. */
  skipTitle?: boolean;
  /** Offset applied to heading levels, so `##` in a record becomes `<h3>`. */
  headingOffset?: number;
  /** Prefix for generated heading ids, keeping them unique across records. */
  idPrefix?: string;
}

/** Render markdown to a self-contained HTML fragment. */
export function renderHtml(markdown: string, options: HtmlOptions = {}): string {
  const blocks = splitBlocks(markdown.replace(/\r\n?/g, '\n'));
  const out: string[] = [];
  let skippedTitle = false;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;

    if (block.kind === 'heading' && block.depth === 1 && options.skipTitle && !skippedTitle) {
      skippedTitle = true;
      continue;
    }

    out.push(emit(block, options));
  }

  return out.filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------- escaping */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a value destined for an attribute, rejecting scheme-based injection. */
function escapeAttr(value: string): string {
  return escapeHtml(value);
}

/**
 * Only these schemes may become an `href`. A record that links to
 * `javascript:` — whether by mistake or by someone editing a shared repo — must
 * not become a live handler in a page other people open.
 */
const SAFE_SCHEME = /^(?:https?:|mailto:|#|\/|\.{0,2}\/)/i;

function isSafeHref(href: string): boolean {
  if (SAFE_SCHEME.test(href)) return true;
  // A bare relative path with no scheme is safe; anything with a colon is not.
  return !href.includes(':');
}

/* --------------------------------------------------------------------- inline */

export function renderInlineHtml(text: string, options: HtmlOptions = {}): string {
  return parseInline(text)
    .map((span) => emitSpan(span, options))
    .join('');
}

function emitSpan(span: Span, options: HtmlOptions): string {
  const style = span.style;

  if (style?.image) {
    return `<span class="img-note">${escapeHtml(span.text)}</span>`;
  }

  let html = escapeHtml(span.text);

  // Code is a leaf: emphasis inside it is literal text, so it wraps last.
  if (style?.code) return wrapLink(`<code>${html}</code>`, span, options);

  if (style?.strike) html = `<s>${html}</s>`;
  if (style?.italic) html = `<em>${html}</em>`;
  if (style?.bold) html = `<strong>${html}</strong>`;

  return wrapLink(html, span, options);
}

function wrapLink(inner: string, span: Span, options: HtmlOptions): string {
  if (!span.href) return inner;

  // `??` would be wrong here: the resolver returns null to mean "do not link
  // this", which is exactly the value `??` would replace with the default.
  const resolved = options.resolveLink
    ? options.resolveLink(span.href)
    : { href: span.href, internal: false };

  if (!resolved || !isSafeHref(resolved.href)) {
    return `<span class="dead-link" title="${escapeAttr(span.href)}">${inner}</span>`;
  }

  const attrs = resolved.internal
    ? ` href="${escapeAttr(resolved.href)}" class="rec-link"`
    : ` href="${escapeAttr(resolved.href)}" class="ext-link" target="_blank" rel="noopener noreferrer"`;

  return `<a${attrs}>${inner}</a>`;
}

/* --------------------------------------------------------------------- blocks */

function emit(block: Block, options: HtmlOptions): string {
  switch (block.kind) {
    case 'blank':
      return '';

    case 'rule':
      return '<hr />';

    case 'heading': {
      const level = Math.min(6, block.depth + (options.headingOffset ?? 0));
      const id = headingId(block.text, options.idPrefix);
      return `<h${level} id="${escapeAttr(id)}">${renderInlineHtml(block.text, options)}</h${level}>`;
    }

    case 'paragraph':
      return `<p>${renderInlineHtml(block.text, options)}</p>`;

    case 'quote':
      // A blockquote in an ADR is nearly always a supersession or caveat note,
      // so it keeps full block rendering rather than collapsing to one line.
      return `<blockquote>${renderHtml(block.text, options)}</blockquote>`;

    case 'code':
      return emitCode(block.lang, block.lines);

    case 'list':
      return emitList(block.items, options);

    case 'table':
      return emitTable(block.rows, block.aligns, options);

    default:
      return '';
  }
}

/**
 * Mermaid fences become `<pre class="mermaid">`, which the artifact runtime
 * renders as a diagram. Every other fence stays literal text — no highlighting,
 * because a wrong highlight is worse than none.
 */
function emitCode(lang: string, lines: string[]): string {
  const body = escapeHtml(lines.join('\n'));

  if (lang.toLowerCase() === 'mermaid') {
    return `<div class="diagram"><pre class="mermaid">${body}</pre></div>`;
  }

  const cls = lang ? ` class="language-${escapeAttr(lang.toLowerCase())}"` : '';
  const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
  return `<div class="code-block">${label}<pre><code${cls}>${body}</code></pre></div>`;
}

interface ListNode {
  item: ListItem;
  children: ListNode[];
}

function emitList(items: ListItem[], options: HtmlOptions): string {
  return emitListNodes(nest(items), options);
}

/** Rebuild nesting from the flat, indentation-derived levels the parser produces. */
function nest(items: ListItem[]): ListNode[] {
  const roots: ListNode[] = [];
  const stack: ListNode[] = [];

  for (const item of items) {
    const node: ListNode = { item, children: [] };
    // Levels can jump by more than one; treat any deeper level as one step in.
    while (stack.length > 0 && stack[stack.length - 1]!.item.level >= item.level) stack.pop();

    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.children.push(node);

    stack.push(node);
  }

  return roots;
}

function emitListNodes(nodes: ListNode[], options: HtmlOptions): string {
  if (nodes.length === 0) return '';

  const ordered = nodes[0]!.item.ordered;
  const tag = ordered ? 'ol' : 'ul';

  const items = nodes
    .map((node) => {
      const text = renderInlineHtml(node.item.text, options);
      const children = emitListNodes(node.children, options);
      return `<li>${text}${children}</li>`;
    })
    .join('');

  return `<${tag}>${items}</${tag}>`;
}

/**
 * Tables get their own horizontal scroll container. ADR tables are comparison
 * matrices that are genuinely wider than a reading column, and letting one
 * scroll the whole page sideways is the classic failure.
 */
function emitTable(rows: string[][], aligns: Align[], options: HtmlOptions): string {
  if (rows.length === 0) return '';

  const columns = Math.max(...rows.map((row) => row.length));
  const cell = (row: string[], c: number): string => renderInlineHtml(row[c] ?? '', options);
  const alignAttr = (c: number): string => {
    const align = aligns[c] ?? 'left';
    return align === 'left' ? '' : ` style="text-align:${align}"`;
  };

  const head = rows[0]!;
  const headHtml = Array.from(
    { length: columns },
    (_, c) => `<th scope="col"${alignAttr(c)}>${cell(head, c)}</th>`,
  ).join('');

  const bodyHtml = rows
    .slice(1)
    .map((row) => {
      const cells = Array.from(
        { length: columns },
        (_, c) => `<td${alignAttr(c)}>${cell(row, c)}</td>`,
      ).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<div class="table-scroll"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

/* --------------------------------------------------------------------- anchors */

export function headingId(text: string, prefix?: string): string {
  const slug =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
  return prefix ? `${prefix}-${slug}` : slug;
}
