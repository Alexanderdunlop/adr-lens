import { describe, expect, it } from 'vitest';
import { diffHtml } from '../src/web/htmldiff.ts';

/** The text a browser would show, so a mark can be checked without matching markup. */
const text = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('diffHtml', () => {
  it('leaves identical fragments alone', () => {
    const html = '<p>Money is carried as integer minor units.</p>';
    expect(diffHtml(html, html)).toEqual({ before: html, after: html, precise: true });
  });

  it('marks only the word that changed', () => {
    const before = '<p>one bad tenant could delay everyone else until morning</p>';
    const after = '<p>one bad tenant could delay everybody else until morning</p>';

    const diff = diffHtml(before, after);

    expect(diff.before).toContain('<del class="w">everyone</del>');
    expect(diff.after).toContain('<ins class="w">everybody</ins>');
    expect(diff.before).not.toContain('<del class="w">one');
  });

  it('shows nothing when a paragraph is only re-wrapped', () => {
    // The section comparison normalises whitespace before reaching here, but the
    // token stream must agree: whitespace runs match each other, not words.
    const before = '<p>We adopt a single-pass settlement model built on Lambda and SQS.</p>';
    const after = '<p>We adopt a single-pass settlement model built on Lambda and SQS.</p>';
    expect(diffHtml(before, after).before).not.toContain('<del');
  });

  it('keeps both renderings readable, marks aside', () => {
    const before = '<h2>Status</h2>\n<p>Proposed</p>';
    const after = '<h2>Status</h2>\n<p>Accepted</p>';

    const diff = diffHtml(before, after);

    expect(text(diff.before)).toBe(text(before));
    expect(text(diff.after)).toBe(text(after));
  });

  it('never wraps a tag in a mark', () => {
    const before = '<p>a</p>';
    const after = '<p>a</p><p>b</p>';

    const diff = diffHtml(before, after);

    expect(diff.after).not.toMatch(/<(ins|del) class="w">\s*</);
    // Every mark opened is closed, so the fragment can be injected as-is.
    expect((diff.after.match(/<ins class="w">/g) ?? []).length).toBe(
      (diff.after.match(/<\/ins>/g) ?? []).length,
    );
  });

  it('marks an added sentence without touching the ones around it', () => {
    const before = '<p>First. Third.</p>';
    const after = '<p>First. Second. Third.</p>';

    const diff = diffHtml(before, after);

    // The inserted run carries its own trailing space, which is honest: that
    // space is new too. What matters is that the sentences around it are clean.
    expect(diff.after).toMatch(/<ins class="w">Second\.\s*<\/ins>/);
    expect(diff.after).toMatch(/^<p>First\. <ins/);
    expect(diff.after).toMatch(/<\/ins>Third\.<\/p>$/);
    expect(diff.before).not.toContain('<del');
  });

  it('gives up precision rather than memory on a very large section', () => {
    const before = `<p>${Array.from({ length: 4000 }, (_, i) => `w${i}`).join(' ')}</p>`;
    const after = `<p>${Array.from({ length: 4000 }, (_, i) => `x${i}`).join(' ')}</p>`;

    const diff = diffHtml(before, after);

    expect(diff.precise).toBe(false);
    expect(diff.before).toBe(before);
    expect(diff.after).toBe(after);
  });
});
