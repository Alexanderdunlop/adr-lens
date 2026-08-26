---
"adr-lens": minor
---

The web register sorts newest first, with a toggle for number or citation order,
and shows absolute dates (`2026-06-04` in the list, `2 March 2026` in the record
header) instead of relative age. Undated records always sort last.

A status hard-wrapped across several lines is now read as a whole paragraph
rather than truncated at the first line break.

Adds an `examples/billing-service` corpus of 13 invented records, so the tool can
be tried without a repo of your own.
