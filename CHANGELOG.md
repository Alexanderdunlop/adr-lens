# adr-lens

## 0.4.0

### Minor Changes

- [#18](https://github.com/Alexanderdunlop/adr-lens/pull/18) [`dfda3fc`](https://github.com/Alexanderdunlop/adr-lens/commit/dfda3fcfe04ac7039e9ff0fa78e7e4311aefd60e) Thanks [@Alexanderdunlop](https://github.com/Alexanderdunlop)! - Each record on the generated page can now be shared on its own, rather than by
  sending the whole page and asking someone to find ADR-0009 in it. Four controls
  sit with the record's header: `Copy link` (the hash route already identifies a
  record), `Copy markdown` (the record's source, for pasting into Slack, a ticket,
  or a review), `Copy citation` (`ADR-0009 Single-store idempotency gate (accepted,
2026-04-18)`), and `Download PDF`. Where the async clipboard is unavailable — a
  page served over plain HTTP is not a secure context — a selection copy is used
  instead, and a failure says so rather than doing nothing quietly.

  `Download PDF` writes a file in one click, without the print dialog: that dialog
  is aimed at a printer, buries "Save as PDF" in a destination menu, and cannot be
  driven from a button. No browser exposes an API that saves a PDF, so the page now
  carries its own writer — which works offline, from `file://`, with no dependency.

  The output is a real document rather than a picture of one: selectable, searchable
  text, tens of kB per record, set in the PDF base-14 faces so nothing has to be
  embedded. Headings, lists, tables, code, and quotes all carry across. External
  URLs are spelled out in the text, since a link in an emailed PDF is not
  necessarily clickable, while in-page routes are not — `ADR-0009` already says
  what the route would. Tables never split a row and repeat their header across a
  page break; long code lines and URLs wrap rather than being cut at the edge. Each
  page is numbered and footed with the service and record number.

  `⌘P` keeps its own stylesheet: no register, no controls, the state and date at the
  top, and black-on-white even when the reader had the dark theme on. The overview
  prints as a one-page summary of the corpus.

  There is no "download markdown" button, deliberately: it would hand you a file
  you already have, by way of a file manager.

  On the bundled 13-record example page this costs 88 kB → 152 kB raw and 18 kB →
  36 kB gzipped: about 13 kB for the markdown behind `Copy markdown`, which scales
  with the corpus, and about 32 kB for the PDF writer and its font metrics, which
  is fixed no matter how many records there are.

## 0.3.0

### Minor Changes

- [#16](https://github.com/Alexanderdunlop/adr-lens/pull/16) [`8190aad`](https://github.com/Alexanderdunlop/adr-lens/commit/8190aad9589f40ac6cbe8c20dafa3c0084879f7f) Thanks [@Alexanderdunlop](https://github.com/Alexanderdunlop)! - `adr-lens web --serve` serves the page from a small localhost server and pushes a
  reload over server-sent events whenever a rebuild finishes, so saving a record
  updates the tab instead of waiting for a manual refresh. It implies `--watch`,
  prints its URL, falls back to a free port when 4230 is taken (`--port` to pick
  one), and shuts down cleanly on ctrl-c.

  The server is additive: the page is still written to disk, and the reload client
  exists only in the copy served over HTTP, so the file you commit or send to
  someone is the same self-contained page as before.

  Reloading now also restores your position on the overview, not just inside a
  record.

## 0.2.0

### Minor Changes

- [#11](https://github.com/Alexanderdunlop/adr-lens/pull/11) [`184ca34`](https://github.com/Alexanderdunlop/adr-lens/commit/184ca340dbc989b1df6b5d4735e1130753be7299) Thanks [@Alexanderdunlop](https://github.com/Alexanderdunlop)! - `adr-lens web --watch` rebuilds the page whenever a record changes, so you can
  leave it open while writing a decision. Filesystem bursts collapse into one
  rebuild, editor scratch files are ignored, and a failed rebuild reports on the
  status line instead of ending the session. The page now restores your scroll
  position on reload, so refreshing after a save lands you where you were reading.

- [#11](https://github.com/Alexanderdunlop/adr-lens/pull/11) [`184ca34`](https://github.com/Alexanderdunlop/adr-lens/commit/184ca340dbc989b1df6b5d4735e1130753be7299) Thanks [@Alexanderdunlop](https://github.com/Alexanderdunlop)! - The web register sorts newest first, with a toggle for number or citation order,
  and shows absolute dates (`2026-06-04` in the list, `2 March 2026` in the record
  header) instead of relative age. Undated records always sort last.

  A status hard-wrapped across several lines is now read as a whole paragraph
  rather than truncated at the first line break.

  Adds an `examples/billing-service` corpus of 13 invented records, so the tool can
  be tried without a repo of your own.
