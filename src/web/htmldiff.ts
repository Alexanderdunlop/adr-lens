/**
 * A word-level diff of two rendered HTML fragments.
 *
 * The semantic diff decides *which* sections are worth showing; this decides
 * which words inside them to point at, so a reader comparing two renderings does
 * not have to find the changed clause by eye.
 *
 * Two rules keep the output well-formed. Tags are compared but never marked — a
 * changed tag is a structural change, and wrapping `<td>` in `<del>` would produce
 * markup no browser agrees on. And a mark never spans a tag: it closes before one
 * and reopens after, so `<ins>` can never escape the element it started in.
 */

type Kind = 'tag' | 'space' | 'word';

interface Token {
  kind: Kind;
  text: string;
}

/**
 * Above this many tokens on either side the quadratic table stops being worth
 * its memory. Whole-section marking is the fallback, which is still correct —
 * just less precise.
 */
const MAX_TOKENS = 1400;

const TOKEN = /(<[^>]+>)|(\s+)|([^<\s]+)/g;

export interface HtmlDiff {
  /** The old fragment with removed words wrapped in `<del>`. */
  before: string;
  /** The new fragment with added words wrapped in `<ins>`. */
  after: string;
  /** False when the fragments were too large to compare word by word. */
  precise: boolean;
}

export function diffHtml(before: string, after: string): HtmlDiff {
  if (before === after) return { before, after, precise: true };

  const a = tokenize(before);
  const b = tokenize(after);

  // Identical ends are the overwhelming majority of two versions of a document,
  // and trimming them first is what keeps the table small enough to build.
  let head = 0;
  while (head < a.length && head < b.length && a[head]!.text === b[head]!.text) head++;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail]!.text === b[b.length - 1 - tail]!.text
  ) {
    tail++;
  }

  const prefix = a.slice(0, head);
  const suffix = a.slice(a.length - tail);
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  if (midA.length > MAX_TOKENS || midB.length > MAX_TOKENS) {
    return { before, after, precise: false };
  }

  const ops = diffTokens(midA, midB);

  return {
    before: emit(prefix) + emit(ops.before) + emit(suffix),
    after: emit(prefix) + emit(ops.after) + emit(suffix),
    precise: true,
  };
}

/* ------------------------------------------------------------------ internals */

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;

  let match = TOKEN.exec(html);
  while (match !== null) {
    if (match[1] !== undefined) tokens.push({ kind: 'tag', text: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: 'space', text: match[2] });
    else tokens.push({ kind: 'word', text: match[3]! });
    match = TOKEN.exec(html);
  }

  return tokens;
}

interface Marked {
  before: Array<Token | Mark>;
  after: Array<Token | Mark>;
}

type Mark = { kind: 'mark'; open: boolean; tag: 'ins' | 'del' };

/**
 * Longest common subsequence over the token stream, walked back into two marked
 * sequences. Whitespace participates in the match so that a changed word does not
 * drag the spaces around it into the mark.
 */
function diffTokens(a: Token[], b: Token[]): Marked {
  const n = a.length;
  const m = b.length;

  const table = new Int32Array((n + 1) * (m + 1));
  const at = (i: number, j: number): number => i * (m + 1) + j;

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] =
        a[i]!.text === b[j]!.text
          ? table[at(i + 1, j + 1)]! + 1
          : Math.max(table[at(i + 1, j)]!, table[at(i, j + 1)]!);
    }
  }

  const before: Array<Token | Mark> = [];
  const after: Array<Token | Mark> = [];
  let deleting = false;
  let inserting = false;

  const stopDelete = (): void => {
    if (deleting) before.push({ kind: 'mark', open: false, tag: 'del' });
    deleting = false;
  };
  const stopInsert = (): void => {
    if (inserting) after.push({ kind: 'mark', open: false, tag: 'ins' });
    inserting = false;
  };

  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (a[i]!.text === b[j]!.text) {
      stopDelete();
      stopInsert();
      before.push(a[i]!);
      after.push(b[j]!);
      i++;
      j++;
    } else if (table[at(i + 1, j)]! >= table[at(i, j + 1)]!) {
      push(
        before,
        a[i]!,
        'del',
        () => deleting,
        (v) => (deleting = v),
      );
      i++;
    } else {
      push(
        after,
        b[j]!,
        'ins',
        () => inserting,
        (v) => (inserting = v),
      );
      j++;
    }
  }

  while (i < n) {
    push(
      before,
      a[i]!,
      'del',
      () => deleting,
      (v) => (deleting = v),
    );
    i++;
  }
  while (j < m) {
    push(
      after,
      b[j]!,
      'ins',
      () => inserting,
      (v) => (inserting = v),
    );
    j++;
  }

  stopDelete();
  stopInsert();

  return { before, after };
}

/**
 * Add one changed token, opening and closing the mark around it. A tag closes the
 * mark rather than being wrapped: marking structure would produce markup that no
 * two browsers would agree on, and the section tint already says the block moved.
 */
function push(
  out: Array<Token | Mark>,
  token: Token,
  tag: 'ins' | 'del',
  isOpen: () => boolean,
  setOpen: (value: boolean) => void,
): void {
  if (token.kind === 'tag') {
    if (isOpen()) {
      out.push({ kind: 'mark', open: false, tag });
      setOpen(false);
    }
    out.push(token);
    return;
  }

  // A run of whitespace on its own is not worth marking, but it must stay inside
  // an open mark so the highlight reads as one block rather than a row of boxes.
  if (token.kind === 'space' && !isOpen()) {
    out.push(token);
    return;
  }

  if (!isOpen()) {
    out.push({ kind: 'mark', open: true, tag });
    setOpen(true);
  }
  out.push(token);
}

function emit(parts: Array<Token | Mark>): string {
  let html = '';
  for (const part of parts) {
    if ('kind' in part && part.kind === 'mark') {
      html += part.open ? `<${part.tag} class="w">` : `</${part.tag}>`;
    } else {
      html += (part as Token).text;
    }
  }
  return html;
}
