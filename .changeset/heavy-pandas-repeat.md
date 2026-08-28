---
"adr-lens": minor
---

`adr-lens diff` reports what changed *about the decisions* between two revisions,
rather than which lines moved. A line diff of an ADR is close to useless in
review: change one word, re-wrap the paragraph, and twelve lines light up, none
of which say whether the decision still holds.

Both sides are read through the existing parser — the old one out of git, the new
one out of git or off disk — and compared field by field: status, the extracted
decision sentence, relations, which sections exist, title, number, path. Because
the decision sentence is extracted and whitespace-collapsed before comparison,
re-wrapping a paragraph is a no-op by construction rather than by heuristic.

Records are matched by number first and filename as a tiebreak, so a rename plus
an edit reads as one changed record rather than a deletion and an addition — and
numbers are not unique in every corpus, which is why the filename has to break
the tie. A renumbered record is still matched by title. Edges pointing at a
renamed record are translated to its new name, so a rename does not manufacture
a page of relation churn.

Every change is then weighted, so the output stays worth reading. Significant: a
status moving, a supersession gained or lost, a changed decision sentence, a
section removed. Notable: renamed, renumbered, retitled, a section added, status
prose changed under an unchanged status. Minor: reworded prose, date, author. A
record whose changes are all minor collapses to one line, which is what makes a
typo-fix PR report nothing significant.

A record superseded by *another* record's edit is reported as well. Adding
ADR-0009 that supersedes ADR-0004 changes ADR-0004's standing without touching
its file, so no diff of any kind would otherwise show it — and it is usually the
most review-relevant thing the change does.

```
adr-lens diff                    # main..HEAD
adr-lens diff main..             # against the working tree, uncommitted included
adr-lens diff origin/main...     # from where the branch diverged, as a PR shows it
adr-lens diff v1.0..v2.0         # any two revisions
adr-lens diff --json             # for CI
```

The exit code stays zero unless git could not answer: an ADR changing is not a
build failure. `--json` carries the same semantic tokens the terminal output is
built from, so a CI job branches on `significance` rather than scraping text.
