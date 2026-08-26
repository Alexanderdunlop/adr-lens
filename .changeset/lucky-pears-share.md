---
"adr-lens": minor
---

Each record on the generated page can now be shared on its own, rather than by
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
