import { FIRST_CODE, FONT_WIDTHS, INDEX_OFFSET } from './pdf-metrics.ts';

/**
 * A PDF writer, small enough to live inside the page.
 *
 * Why write one at all: no browser exposes an api that saves a PDF, so the only
 * built-in route is the print dialog — which is aimed at a printer, asks the
 * reader to find the "Save as PDF" destination, and cannot be scripted. Sending
 * one decision to someone should be one click.
 *
 * Why not a library: jsPDF or pdf-lib would add a few hundred kB to a page whose
 * whole premise is being one small self-contained file, and the html-to-canvas
 * route rasterises the text, which loses selection, search, and sharpness.
 *
 * What makes it small: the base-14 fonts, which every reader already has, so
 * nothing is embedded and a decision comes out as a few kB of real, selectable
 * text. The cost is that this file has to know their metrics to wrap a line —
 * hence pdf-metrics.ts — and is limited to WinAnsi, so anything outside it is
 * transliterated rather than dropped.
 *
 * The document is built by walking the *rendered* record in the page rather than
 * re-parsing its markdown. That keeps core's block parser from being duplicated
 * here in a second, drifting dialect, and means the PDF says exactly what the
 * reader is looking at.
 */

const BODY = String.raw`
(function () {
  var METRICS = "__METRICS__";
  var FIRST = __FIRST__;
  var OFFSET = __OFFSET__;

  /* ------------------------------------------------------------- encoding */

  /* CP1252 slots for the punctuation that real prose uses. */
  var WINANSI = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
    0x017E: 0x9E, 0x0178: 0x9F
  };

  /*
   * Characters with no WinAnsi slot at all. Spelling them out beats dropping
   * them: an arrow is load-bearing in a supersession chain, and a record that
   * reads "A B" where it meant "A -> B" is worse than one that looks plain.
   */
  var SPELLED = {
    0x2192: '->', 0x2190: '<-', 0x2194: '<->', 0x21D2: '=>', 0x21D0: '<=',
    0x2264: '<=', 0x2265: '>=', 0x2260: '!=', 0x2248: '~', 0x2261: '=',
    0x2011: '-', 0x2212: '-', 0x2010: '-', 0x00A0: ' ', 0x2007: ' ',
    0x2009: ' ', 0x200A: ' ', 0x202F: ' ', 0x2005: ' ', 0x2713: '[x]',
    0x2717: '[ ]', 0x25A0: '-', 0x25CF: '-', 0x2500: '-', 0x2502: '|',
    0x2026: '...', 0x2318: 'Cmd', 0x21B5: '<-'
  };

  /** Text to WinAnsi bytes. */
  function encode(text) {
    var out = [];
    var value = String(text === null || text === undefined ? '' : text);
    for (var i = 0; i < value.length; i++) {
      var cp = value.charCodeAt(i);
      if (cp <= 0xff) { out.push(cp); continue; }
      if (WINANSI[cp] !== undefined) { out.push(WINANSI[cp]); continue; }
      var spelled = SPELLED[cp];
      if (spelled) {
        for (var j = 0; j < spelled.length; j++) out.push(spelled.charCodeAt(j));
        continue;
      }
      out.push(0x3f);
    }
    return out;
  }

  function glyph(font, code) {
    var table = METRICS[font];
    if (!table || code < FIRST || code > 255) return 0;
    var index = table.indices.charCodeAt(code - FIRST) - OFFSET;
    var width = table.palette[index];
    return width === undefined ? 0 : width;
  }

  /** Width of a string in points. */
  function widthOf(run, text) {
    var bytes = encode(text);
    var total = 0;
    for (var i = 0; i < bytes.length; i++) total += glyph(run.font, bytes[i]);
    return (total * run.size) / 1000 + (run.tracking || 0) * bytes.length;
  }

  /** A PDF literal string: the three reserved bytes escaped, the rest octal. */
  function literal(text) {
    var bytes = encode(text);
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
      else if (b < 32 || b > 126) out += '\\' + ('00' + b.toString(8)).slice(-3);
      else out += String.fromCharCode(b);
    }
    return out;
  }

  /* ----------------------------------------------------------------- fonts */

  var FONT_IDS = {
    'Times-Roman': 'F1', 'Times-Bold': 'F2', 'Times-Italic': 'F3',
    'Helvetica': 'F4', 'Helvetica-Bold': 'F5', 'Courier': 'F6'
  };

  /* There is no bold-italic among the six, so bold wins — it is the emphasis
     that carries meaning in a decision record. */
  var VARIANTS = {
    'Times-Roman': { bold: 'Times-Bold', italic: 'Times-Italic' },
    'Times-Bold': { bold: 'Times-Bold', italic: 'Times-Bold' },
    'Times-Italic': { bold: 'Times-Bold', italic: 'Times-Italic' },
    'Helvetica': { bold: 'Helvetica-Bold', italic: 'Helvetica' },
    'Helvetica-Bold': { bold: 'Helvetica-Bold', italic: 'Helvetica-Bold' },
    'Courier': { bold: 'Courier', italic: 'Courier' }
  };

  function variant(run, kind) {
    var family = VARIANTS[run.font];
    var next = family ? family[kind] : run.font;
    return style(run, { font: next || run.font });
  }

  function style(run, changes) {
    var out = { font: run.font, size: run.size, grey: run.grey, tracking: run.tracking };
    for (var key in changes) out[key] = changes[key];
    return out;
  }

  /* ------------------------------------------------------------- geometry */

  /* A4. Margins leave room for the footer, which is the one thing a printed
     decision needs that the screen does not: which page of how many. */
  var PAGE_W = 595.28;
  var PAGE_H = 841.89;
  var ML = 56;
  var MR = 56;
  var MT = 50;
  var MB = 62;
  var WIDTH = PAGE_W - ML - MR;

  var INK = 0;
  var SOFT = 0.25;
  var MUTED = 0.42;
  var FAINT = 0.55;
  var RULE = 0.72;

  var BODY_SIZE = 10.5;
  var BODY_LEAD = 15;

  function doc() {
    return { pages: [], ops: null, y: 0 };
  }

  function newPage(d) {
    d.ops = [];
    d.pages.push(d.ops);
    d.y = PAGE_H - MT;
    resetState(d);
  }

  /*
   * Font, size, tracking and fill colour are graphics state: they survive BT/ET
   * and only need re-stating when they change. Tracking that per page turns a
   * document that repeated four operators for every word into one that states
   * them a few dozen times. Each page is its own content stream, so the cache
   * has to be dropped whenever the stream being written to changes.
   */
  function resetState(d) {
    d.font = null;
    d.size = null;
    d.tracking = null;
    d.grey = null;
  }

  function op(d, text) {
    d.ops.push(text);
  }

  /** Move down without starting a page: leading space never opens one. */
  function space(d, amount) {
    d.y -= amount;
  }

  /** Ensure the given height fits before the bottom margin. */
  function need(d, height) {
    if (d.y - height < MB) { newPage(d); return true; }
    return false;
  }

  function num(value) {
    return (Math.round(value * 100) / 100).toString();
  }

  function drawText(d, x, y, run, text) {
    if (text === '') return;

    var grey = run.grey === undefined ? INK : run.grey;
    var font = FONT_IDS[run.font];
    var tracking = run.tracking || 0;
    var parts = ['BT'];

    if (d.font !== font || d.size !== run.size) {
      parts.push('/' + font + ' ' + num(run.size) + ' Tf');
      d.font = font;
      d.size = run.size;
    }
    if (d.tracking !== tracking) {
      parts.push(num(tracking) + ' Tc');
      d.tracking = tracking;
    }
    if (d.grey !== grey) {
      parts.push(num(grey) + ' ' + num(grey) + ' ' + num(grey) + ' rg');
      d.grey = grey;
    }

    parts.push(num(x) + ' ' + num(y) + ' Td (' + literal(text) + ') Tj ET');
    op(d, parts.join(' '));
  }

  function drawRule(d, x1, y, x2, grey, weight) {
    op(
      d,
      num(weight) + ' w ' + num(grey) + ' ' + num(grey) + ' ' + num(grey) + ' RG ' +
        num(x1) + ' ' + num(y) + ' m ' + num(x2) + ' ' + num(y) + ' l S'
    );
  }

  function drawBox(d, x, y, w, h, grey, weight) {
    op(
      d,
      num(weight) + ' w ' + num(grey) + ' ' + num(grey) + ' ' + num(grey) + ' RG ' +
        num(x) + ' ' + num(y) + ' ' + num(w) + ' ' + num(h) + ' re S'
    );
  }

  /* ------------------------------------------------------------- wrapping */

  /** Break one over-long word — a url, an identifier — at the margin. */
  function hardWrap(text, run, maxWidth) {
    var pieces = [];
    var current = '';
    for (var i = 0; i < text.length; i++) {
      var next = current + text.charAt(i);
      if (current !== '' && widthOf(run, next) > maxWidth) {
        pieces.push(current);
        current = text.charAt(i);
      } else {
        current = next;
      }
    }
    if (current !== '') pieces.push(current);
    return pieces.length > 0 ? pieces : [''];
  }

  /**
   * Greedy line breaking over styled runs. Returns an array of lines, each an
   * array of { text, run } pieces, so a line can mix faces — bold inside a
   * sentence, a url in mono after a link.
   */
  function wrap(runs, maxWidth) {
    var tokens = [];
    for (var r = 0; r < runs.length; r++) {
      var parts = String(runs[r].text).split(/(\s+)/);
      for (var p = 0; p < parts.length; p++) {
        if (parts[p] === '') continue;
        tokens.push({
          text: /^\s+$/.test(parts[p]) ? ' ' : parts[p],
          run: runs[r].run,
          space: /^\s+$/.test(parts[p])
        });
      }
    }

    var lines = [];
    var line = [];
    var used = 0;

    function trimTrailing() {
      while (line.length > 0 && line[line.length - 1].space) {
        used -= widthOf(line[line.length - 1].run, line[line.length - 1].text);
        line.pop();
      }
    }

    for (var t = 0; t < tokens.length; t++) {
      var token = tokens[t];
      var w = widthOf(token.run, token.text);

      if (token.space) {
        if (line.length === 0) continue;
        line.push(token);
        used += w;
        continue;
      }

      if (w > maxWidth) {
        trimTrailing();
        if (line.length > 0) { lines.push(line); line = []; used = 0; }
        var pieces = hardWrap(token.text, token.run, maxWidth);
        for (var q = 0; q < pieces.length - 1; q++) {
          lines.push([{ text: pieces[q], run: token.run }]);
        }
        var tail = pieces[pieces.length - 1];
        line = [{ text: tail, run: token.run }];
        used = widthOf(token.run, tail);
        continue;
      }

      if (used + w > maxWidth && line.length > 0) {
        trimTrailing();
        lines.push(line);
        line = [];
        used = 0;
      }

      line.push(token);
      used += w;
    }

    trimTrailing();
    if (line.length > 0) lines.push(line);
    return lines;
  }

  /** Draw wrapped lines, breaking pages as needed. */
  function flow(d, lines, x, leading, firstLeading) {
    for (var i = 0; i < lines.length; i++) {
      need(d, leading);
      d.y -= i === 0 && firstLeading !== undefined ? firstLeading : leading;
      var cx = x;
      for (var j = 0; j < lines[i].length; j++) {
        var piece = lines[i][j];
        drawText(d, cx, d.y, piece.run, piece.text);
        cx += widthOf(piece.run, piece.text);
      }
    }
  }

  function paragraph(d, runs, x, maxWidth, leading) {
    flow(d, wrap(runs, maxWidth), x, leading);
  }

  /* --------------------------------------------------------- inline runs */

  function push(out, text, run) {
    if (text === '') return;
    out.push({ text: text, run: run });
  }

  var EXTERNAL = /^(?:https?:|mailto:)/i;

  /**
   * Turn a rendered element's children into styled runs.
   *
   * External destinations are spelled out after the link text, since a link in a
   * PDF someone was emailed is not necessarily clickable and never guessable.
   * In-page routes are not: "#/0009-single-store-idempotency-gate" tells a reader
   * nothing that the link text "ADR-0009" has not already told them.
   */
  function inlineRuns(node, base, out) {
    out = out || [];
    var kids = node.childNodes || [];

    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];

      if (kid.nodeType === 3) {
        push(out, String(kid.textContent).replace(/\s+/g, ' '), base);
        continue;
      }
      if (kid.nodeType !== 1) continue;

      var tag = String(kid.tagName || '').toLowerCase();

      if (tag === 'strong' || tag === 'b') { inlineRuns(kid, variant(base, 'bold'), out); continue; }
      if (tag === 'em' || tag === 'i') { inlineRuns(kid, variant(base, 'italic'), out); continue; }
      if (tag === 'code') {
        push(out, String(kid.textContent).replace(/\s+/g, ' '), style(base, {
          font: 'Courier',
          size: base.size * 0.88
        }));
        continue;
      }
      if (tag === 'br') { push(out, ' ', base); continue; }

      if (tag === 'a') {
        inlineRuns(kid, base, out);
        var href = kid.getAttribute ? kid.getAttribute('href') || '' : '';
        if (EXTERNAL.test(href)) {
          push(out, ' <' + href + '>', style(base, {
            font: 'Courier',
            size: base.size * 0.8,
            grey: FAINT
          }));
        }
        continue;
      }

      inlineRuns(kid, base, out);
    }

    return out;
  }

  function textRuns(text, run) {
    return [{ text: text, run: run }];
  }

  /* ------------------------------------------------------------- the body */

  function headingSize(tag) {
    if (tag === 'h2') return 12.5;
    if (tag === 'h3') return 11;
    return 9.5;
  }

  function renderProse(d, root) {
    var kids = root.children || [];
    for (var i = 0; i < kids.length; i++) renderBlock(d, kids[i]);
  }

  function renderBlock(d, el) {
    var tag = String(el.tagName || '').toLowerCase();
    var cls = el.getAttribute ? el.getAttribute('class') || '' : '';

    if (/^h[2-6]$/.test(tag)) {
      var size = headingSize(tag);
      space(d, tag === 'h2' ? 17 : 13);
      /* A heading alone at the foot of a page is a heading in the wrong place. */
      need(d, size * 1.3 + BODY_LEAD + (tag === 'h2' ? 7 : 0));
      var runs = inlineRuns(el, { font: 'Helvetica-Bold', size: size, grey: INK });
      flow(d, wrap(runs, WIDTH), ML, size * 1.3);
      if (tag === 'h2') {
        space(d, 5);
        drawRule(d, ML, d.y, ML + WIDTH, RULE, 0.5);
      }
      return;
    }

    if (tag === 'p') {
      space(d, 6);
      var base = { font: 'Times-Roman', size: BODY_SIZE, grey: SOFT };
      if (cls.indexOf('img-note') >= 0) base = style(base, { font: 'Courier', grey: FAINT, size: 9 });
      paragraph(d, inlineRuns(el, base), ML, WIDTH, BODY_LEAD);
      return;
    }

    if (tag === 'ul' || tag === 'ol') { renderList(d, el, tag === 'ol', 0); return; }
    if (tag === 'blockquote') { renderQuote(d, el); return; }
    if (tag === 'hr') {
      space(d, 12);
      need(d, 12);
      drawRule(d, ML, d.y, ML + WIDTH, RULE, 0.5);
      space(d, 4);
      return;
    }
    if (tag === 'pre') { renderCode(d, el, ''); return; }

    if (cls.indexOf('code-block') >= 0) {
      var langEl = el.querySelector ? el.querySelector('.code-lang') : null;
      var pre = el.querySelector ? el.querySelector('pre') : null;
      if (pre) renderCode(d, pre, langEl ? String(langEl.textContent) : '');
      return;
    }
    if (cls.indexOf('diagram') >= 0) {
      var diagram = el.querySelector ? el.querySelector('pre') : null;
      if (diagram) renderCode(d, diagram, 'diagram');
      return;
    }
    if (cls.indexOf('table-scroll') >= 0) {
      var table = el.querySelector ? el.querySelector('table') : null;
      if (table) renderTable(d, table);
      return;
    }

    /* An element the page grew that this writer has not been taught: take its
       text rather than silently dropping a paragraph of someone's reasoning. */
    var fallback = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (fallback !== '') {
      space(d, 6);
      paragraph(d, textRuns(fallback, { font: 'Times-Roman', size: BODY_SIZE, grey: SOFT }), ML, WIDTH, BODY_LEAD);
    }
  }

  function renderList(d, el, ordered, level) {
    var indent = 14 + level * 15;
    var items = el.children || [];
    var index = 0;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (String(item.tagName || '').toLowerCase() !== 'li') continue;
      index++;

      /* Nested lists are rendered after the item's own text, not inside it. */
      var nested = [];
      var own = { childNodes: [] };
      var kids = item.childNodes || [];
      for (var k = 0; k < kids.length; k++) {
        var tag = String(kids[k].tagName || '').toLowerCase();
        if (tag === 'ul' || tag === 'ol') nested.push(kids[k]);
        else own.childNodes.push(kids[k]);
      }

      space(d, i === 0 ? 5 : 3);
      var runs = inlineRuns(own, { font: 'Times-Roman', size: BODY_SIZE, grey: SOFT });
      var lines = wrap(runs, WIDTH - indent);
      need(d, BODY_LEAD);

      var marker = ordered ? index + '.' : '-';
      var markerRun = { font: ordered ? 'Courier' : 'Times-Roman', size: BODY_SIZE * 0.92, grey: FAINT };
      /* Marker sits on the first line's baseline, so measure before flowing. */
      var markerY = d.y - BODY_LEAD;
      drawText(d, ML + indent - (ordered ? 15 : 9), markerY, markerRun, marker);
      flow(d, lines, ML + indent, BODY_LEAD);

      for (var n = 0; n < nested.length; n++) {
        renderList(d, nested[n], String(nested[n].tagName).toLowerCase() === 'ol', level + 1);
      }
    }
    space(d, 4);
  }

  function renderQuote(d, el) {
    space(d, 8);
    var runs = inlineRuns(el, { font: 'Times-Roman', size: BODY_SIZE, grey: MUTED });
    var lines = wrap(runs, WIDTH - 16);
    var top = d.y;
    var startPage = d.pages.length;
    flow(d, lines, ML + 16, BODY_LEAD);
    /* Only rule the segment on this page; a quote that broke gets no orphan bar. */
    if (d.pages.length === startPage) {
      op(d, '1.5 w ' + num(RULE) + ' ' + num(RULE) + ' ' + num(RULE) + ' RG ' +
        num(ML + 4) + ' ' + num(top - 3) + ' m ' + num(ML + 4) + ' ' + num(d.y - 3) + ' l S');
    }
    space(d, 4);
  }

  function renderCode(d, pre, lang) {
    var source = String(pre.textContent || '').replace(/\n+$/, '');
    var run = { font: 'Courier', size: 8.4, grey: SOFT };
    var lead = 11.4;
    var pad = 7;
    var inner = WIDTH - pad * 2 - 4;

    var lines = [];
    var raw = source.split('\n');
    for (var i = 0; i < raw.length; i++) {
      var text = raw[i].replace(/\t/g, '    ');
      if (widthOf(run, text) <= inner) { lines.push(text); continue; }
      /* Wrapped continuations are indented so the real line starts stay legible. */
      var pieces = hardWrap(text, run, inner - 12);
      for (var p = 0; p < pieces.length; p++) lines.push(p === 0 ? pieces[p] : '  ' + pieces[p]);
    }

    space(d, 8);
    var height = lines.length * lead + pad * 2 + (lang ? 11 : 0);
    /* Box it when it fits on one page; a block taller than a page still prints,
       it just flows without a frame rather than being clipped by one. */
    var boxed = height <= PAGE_H - MT - MB;
    if (boxed) need(d, height);

    var top = d.y;
    if (lang) {
      d.y -= 9;
      drawText(d, ML + pad, d.y, { font: 'Helvetica', size: 6.6, grey: FAINT, tracking: 0.8 },
        String(lang).toUpperCase());
      d.y -= 3;
    }
    d.y -= pad - lead;

    for (var j = 0; j < lines.length; j++) {
      if (need(d, lead)) top = PAGE_H - MT;
      d.y -= lead;
      drawText(d, ML + pad + 2, d.y, run, lines[j]);
    }

    d.y -= pad;
    if (boxed) drawBox(d, ML, d.y, WIDTH, top - d.y, RULE, 0.5);
    space(d, 4);
  }

  /* ---------------------------------------------------------------- tables */

  function cellsOf(row) {
    var out = [];
    var kids = row.children || [];
    for (var i = 0; i < kids.length; i++) {
      var tag = String(kids[i].tagName || '').toLowerCase();
      if (tag === 'td' || tag === 'th') out.push(kids[i]);
    }
    return out;
  }

  function renderTable(d, table) {
    var headRow = table.querySelector ? table.querySelector('thead tr') : null;
    var bodyRows = [];
    var all = table.querySelectorAll ? table.querySelectorAll('tbody tr') : [];
    for (var i = 0; i < all.length; i++) bodyRows.push(all[i]);

    var headCells = headRow ? cellsOf(headRow) : [];
    var columns = headCells.length;
    for (var r = 0; r < bodyRows.length; r++) {
      columns = Math.max(columns, cellsOf(bodyRows[r]).length);
    }
    if (columns === 0) return;

    var headRun = { font: 'Helvetica-Bold', size: 8.4, grey: INK };
    var cellRun = { font: 'Helvetica', size: 8.4, grey: SOFT };
    var lead = 11.6;
    var padX = 6;
    var padY = 5;

    /* Columns take their share of the natural widths, with a floor so a narrow
       column stays readable rather than collapsing to one character per line. */
    /*
     * Two numbers per column: what it would take to set every cell on one line,
     * and the least it can have before words start breaking mid-word. Reserving
     * the second is what stops a column of identifiers rendering as
     * "tenant-001-with-a-long-identifie" and a lone "r" on the next line.
     */
    var natural = [];
    var minimum = [];
    for (var c = 0; c < columns; c++) { natural.push(0); minimum.push(padX * 2); }

    /* The leading cell of a body row is set bold, the way the page sets it, so
       it has to be measured bold too or every column is measured too narrow. */
    function runFor(index, base) {
      return index === 0 && base === cellRun ? style(base, { font: 'Helvetica-Bold', grey: INK }) : base;
    }

    function measure(cells, base) {
      for (var i = 0; i < cells.length; i++) {
        var run = runFor(i, base);
        var text = String(cells[i].textContent || '').replace(/\s+/g, ' ').trim();
        natural[i] = Math.max(natural[i], widthOf(run, text) + padX * 2);
        var words = text.split(/\s+/);
        for (var w = 0; w < words.length; w++) {
          minimum[i] = Math.max(minimum[i], widthOf(run, words[w]) + padX * 2);
        }
      }
    }
    measure(headCells, headRun);
    for (var b = 0; b < bodyRows.length; b++) measure(cellsOf(bodyRows[b]), cellRun);

    var total = 0;
    var minTotal = 0;
    for (var n = 0; n < columns; n++) { total += natural[n]; minTotal += minimum[n]; }

    /*
     * The table always spans the measure — one that stops two thirds of the way
     * across reads as broken rather than as narrow — and the slack goes to the
     * columns that asked for the most.
     */
    var widths = [];
    if (total <= WIDTH) {
      for (var k = 0; k < columns; k++) widths.push(natural[k] + (natural[k] / total) * (WIDTH - total));
    } else if (minTotal < WIDTH) {
      var appetite = 0;
      for (var a = 0; a < columns; a++) appetite += Math.max(0, natural[a] - minimum[a]);
      for (var g = 0; g < columns; g++) {
        var want = Math.max(0, natural[g] - minimum[g]);
        var share = appetite > 0 ? (want / appetite) * (WIDTH - minTotal) : (WIDTH - minTotal) / columns;
        widths.push(minimum[g] + share);
      }
    } else {
      /* Not even the longest words fit side by side; breaking them is all that
         is left, so at least keep the columns proportional. */
      for (var f = 0; f < columns; f++) widths.push((natural[f] / total) * WIDTH);
    }

    function rowLines(cells, run) {
      var perCell = [];
      var height = 1;
      for (var c = 0; c < columns; c++) {
        var cell = cells[c];
        var runs = cell ? inlineRuns(cell, runFor(c, run)) : [];
        var lines = wrap(runs, widths[c] - padX * 2);
        perCell.push(lines);
        height = Math.max(height, lines.length);
      }
      return { cells: perCell, lines: height };
    }

    var head = headCells.length > 0 ? rowLines(headCells, headRun) : null;

    function drawRow(row, bold) {
      var height = row.lines * lead + padY * 2;
      need(d, height);
      var top = d.y;
      var x = ML;
      for (var c = 0; c < columns; c++) {
        var y = top - padY;
        for (var l = 0; l < row.cells[c].length; l++) {
          y -= lead;
          var cx = x + padX;
          for (var j = 0; j < row.cells[c][l].length; j++) {
            var piece = row.cells[c][l][j];
            drawText(d, cx, y, piece.run, piece.text);
            cx += widthOf(piece.run, piece.text);
          }
        }
        x += widths[c];
      }
      d.y = top - height;
      drawRule(d, ML, d.y, ML + WIDTH, bold ? RULE : 0.85, bold ? 0.6 : 0.4);
    }

    space(d, 10);
    if (head) {
      need(d, head.lines * lead + padY * 2 + lead * 2);
      drawRule(d, ML, d.y, ML + WIDTH, RULE, 0.6);
      drawRow(head, true);
    }

    for (var row = 0; row < bodyRows.length; row++) {
      var laid = rowLines(cellsOf(bodyRows[row]), cellRun);
      /* A row is atomic, and a table that breaks repeats its header — a column
         of numbers with no heading above it is unreadable. */
      if (d.y - (laid.lines * lead + padY * 2) < MB) {
        newPage(d);
        if (head) {
          drawRule(d, ML, d.y, ML + WIDTH, RULE, 0.6);
          drawRow(head, true);
        }
      }
      drawRow(laid, false);
    }
    space(d, 6);
  }

  /* ------------------------------------------------------------ the record */

  function textOf(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  /**
   * The text of each child element, separately.
   *
   * The markup sets these apart with layout rather than punctuation, so there is
   * no whitespace between the tags to fall back on — taking textContent of the
   * parent yields "ADR 0002docs/adrs".
   */
  function partsOf(el) {
    var out = [];
    var kids = el ? el.children || [] : [];
    for (var i = 0; i < kids.length; i++) {
      var value = textOf(kids[i]);
      if (value !== '') out.push(value);
    }
    return out;
  }

  function renderHead(d, section, scope) {
    var eyebrow = partsOf(section.querySelector('.eyebrow')).join('  ·  ');
    var title = textOf(section.querySelector('.rec-title'));

    if (scope) {
      d.y -= 9;
      drawText(d, ML, d.y, { font: 'Helvetica', size: 7.2, grey: MUTED, tracking: 1.3 },
        scope.toUpperCase());
      space(d, 6);
      drawRule(d, ML, d.y, ML + WIDTH, RULE, 0.5);
    }

    if (eyebrow) {
      space(d, 20);
      drawText(d, ML, d.y, { font: 'Courier', size: 8.6, grey: MUTED }, eyebrow);
    }

    space(d, 26);
    flow(d, wrap(textRuns(title, { font: 'Times-Bold', size: 20, grey: INK }), WIDTH), ML, 24);

    var meta = partsOf(section.querySelector('.rec-meta'));
    if (meta.length > 0) {
      space(d, 19);
      drawText(d, ML, d.y, { font: 'Helvetica', size: 8.4, grey: MUTED }, meta.join('   \u00b7   '));
    }

    var notices = section.querySelectorAll('.notice');
    for (var n = 0; n < notices.length; n++) renderNotice(d, notices[n]);

    var decision = section.querySelector('.glance .decision');
    if (decision) {
      space(d, 22);
      var runs = inlineRuns(decision, { font: 'Times-Roman', size: 12, grey: INK });
      var lines = wrap(runs, WIDTH - 16);
      var top = d.y;
      drawText(d, ML + 16, d.y - 8, { font: 'Helvetica-Bold', size: 6.6, grey: MUTED, tracking: 0.9 },
        'THE DECISION');
      d.y -= 11;
      flow(d, lines, ML + 16, 16);
      op(d, '2 w ' + num(INK) + ' ' + num(INK) + ' ' + num(INK) + ' RG ' +
        num(ML + 1) + ' ' + num(top - 1) + ' m ' + num(ML + 1) + ' ' + num(d.y - 4) + ' l S');
    }

    var prose = section.querySelector('.status-prose');
    if (prose) {
      space(d, 14);
      paragraph(d, inlineRuns(prose, { font: 'Times-Roman', size: 9.4, grey: MUTED }), ML, WIDTH, 13);
    }
  }

  function renderNotice(d, notice) {
    var runs = inlineRuns(notice, { font: 'Helvetica', size: 8.6, grey: INK });
    var lines = wrap(runs, WIDTH - 20);
    var height = lines.length * 12.4 + 16;

    space(d, 16);
    need(d, height);
    var top = d.y;
    d.y -= 3;
    flow(d, lines, ML + 10, 12.4);
    d.y = top - height;
    drawBox(d, ML, d.y, WIDTH, height, INK, 0.5);
  }

  function renderRelations(d, section) {
    var groups = section.querySelectorAll('.rel-group');
    if (groups.length === 0) return;

    space(d, 26);
    need(d, 40);
    drawRule(d, ML, d.y, ML + WIDTH, RULE, 0.5);

    for (var g = 0; g < groups.length; g++) {
      var label = textOf(groups[g].querySelector('h2'));
      space(d, 15);
      need(d, 26);
      drawText(d, ML, d.y, { font: 'Helvetica-Bold', size: 6.6, grey: MUTED, tracking: 0.9 },
        label.toUpperCase());

      var entries = groups[g].querySelectorAll('.rel');
      for (var e = 0; e < entries.length; e++) {
        var numberLabel = textOf(entries[e].querySelector('.num'));
        var title = textOf(entries[e].querySelector('.label'));
        space(d, 12);
        need(d, 12);
        drawText(d, ML, d.y, { font: 'Courier', size: 8.4, grey: FAINT }, numberLabel);
        drawText(d, ML + 42, d.y, { font: 'Helvetica', size: 8.6, grey: SOFT }, title);
      }
      space(d, 4);
    }
  }

  /** The one thing paper needs that the screen does not: where you are. */
  function renderFooters(d, scope, reference) {
    for (var i = 0; i < d.pages.length; i++) {
      var ops = d.pages[i];
      var left = [scope, reference].filter(Boolean).join('  \u00b7  ');
      var right = (i + 1) + ' of ' + d.pages.length;
      var run = { font: 'Helvetica', size: 7.4, grey: FAINT };
      var saved = d.ops;
      d.ops = ops;
      resetState(d);
      drawRule(d, ML, MB - 18, ML + WIDTH, 0.85, 0.4);
      drawText(d, ML, MB - 30, run, left);
      drawText(d, ML + WIDTH - widthOf(run, right), MB - 30, run, right);
      d.ops = saved;
      resetState(d);
    }
  }

  /* ------------------------------------------------------- serialisation */

  function serialise(d) {
    var objects = [];
    function add(body) {
      objects.push(body);
      return objects.length;
    }

    var fontIds = [];
    for (var name in FONT_IDS) {
      fontIds.push({
        id: FONT_IDS[name],
        ref: add('<< /Type /Font /Subtype /Type1 /BaseFont /' + name + ' /Encoding /WinAnsiEncoding >>')
      });
    }

    var resourceParts = [];
    for (var f = 0; f < fontIds.length; f++) {
      resourceParts.push('/' + fontIds[f].id + ' ' + fontIds[f].ref + ' 0 R');
    }
    var resources = '<< /Font << ' + resourceParts.join(' ') + ' >> >>';

    var pagesRef = objects.length + 1 + d.pages.length * 2 + 1;
    var pageRefs = [];

    for (var p = 0; p < d.pages.length; p++) {
      var content = d.pages[p].join('\n');
      var streamRef = add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
      pageRefs.push(add(
        '<< /Type /Page /Parent ' + pagesRef + ' 0 R /MediaBox [0 0 ' + num(PAGE_W) + ' ' +
          num(PAGE_H) + '] /Resources ' + resources + ' /Contents ' + streamRef + ' 0 R >>'
      ));
    }

    var kids = [];
    for (var k = 0; k < pageRefs.length; k++) kids.push(pageRefs[k] + ' 0 R');
    var pages = add('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pageRefs.length + ' >>');
    var catalog = add('<< /Type /Catalog /Pages ' + pages + ' 0 R >>');

    var out = '%PDF-1.4\n';
    var offsets = [];
    for (var o = 0; o < objects.length; o++) {
      offsets.push(out.length);
      out += (o + 1) + ' 0 obj\n' + objects[o] + '\nendobj\n';
    }

    var xref = out.length;
    out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    for (var x = 0; x < offsets.length; x++) {
      out += ('0000000000' + offsets[x]).slice(-10) + ' 00000 n \n';
    }
    out += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalog +
      ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';

    return out;
  }

  function bytesOf(text) {
    var out = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  /* ------------------------------------------------------------------ api */

  /** Build a PDF for one rendered record. Returns the file's bytes. */
  function build(section) {
    var scope = textOf(section.querySelector('.print-head'));
    /* The record's own number, for the footer \u2014 not the directory beside it. */
    var reference = partsOf(section.querySelector('.eyebrow'))[0] || '';

    var d = doc();
    newPage(d);
    renderHead(d, section, scope);
    var prose = section.querySelector('.prose');
    if (prose) { space(d, 12); renderProse(d, prose); }
    renderRelations(d, section);
    renderFooters(d, scope, reference);

    return bytesOf(serialise(d));
  }

  window.__adrPdf = {
    build: build,
    bytesOf: bytesOf,
    serialise: serialise,
    wrap: wrap,
    widthOf: widthOf,
    encode: encode,
    literal: literal,
    inlineRuns: inlineRuns
  };
})();
`.trim();

/**
 * The metrics table, inlined as JSON.
 *
 * The index characters can legitimately include `<` and `>`, which are harmless
 * in a script body but not worth leaving to the HTML tokeniser's discretion.
 */
function metricsLiteral(): string {
  return JSON.stringify(FONT_WIDTHS).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export const PDF_SCRIPT = BODY.replace('"__METRICS__"', () => metricsLiteral())
  .replace('__FIRST__', String(FIRST_CODE))
  .replace('__OFFSET__', String(INDEX_OFFSET));
