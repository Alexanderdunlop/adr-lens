---
"adr-lens": minor
---

`adr-lens web --watch` rebuilds the page whenever a record changes, so you can
leave it open while writing a decision. Filesystem bursts collapse into one
rebuild, editor scratch files are ignored, and a failed rebuild reports on the
status line instead of ending the session. The page now restores your scroll
position on reload, so refreshing after a save lands you where you were reading.
