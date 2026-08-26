# adr-lens

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
