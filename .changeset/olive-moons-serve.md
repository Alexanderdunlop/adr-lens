---
"adr-lens": minor
---

`adr-lens web --serve` serves the page from a small localhost server and pushes a
reload over server-sent events whenever a rebuild finishes, so saving a record
updates the tab instead of waiting for a manual refresh. It implies `--watch`,
prints its URL, falls back to a free port when 4230 is taken (`--port` to pick
one), and shuts down cleanly on ctrl-c.

The server is additive: the page is still written to disk, and the reload client
exists only in the copy served over HTTP, so the file you commit or send to
someone is the same self-contained page as before.

Reloading now also restores your position on the overview, not just inside a
record.
