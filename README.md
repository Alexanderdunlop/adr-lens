# adr-lens

Make architecture decision records readable.

ADRs are easy to write and hard to read. Once a service has eighty of them, the
corpus stops being documentation and becomes an archive: you cannot tell which
decisions still hold, which were quietly replaced, or which three you actually
need before touching the code.

`adr-lens` reads a directory of ADRs and answers the questions you actually have.

```
adr-lens web --open        # a readable web page for the whole corpus
adr-lens map               # where do I start?
adr-lens list --live       # what is currently true?
adr-lens show 65           # read one, with its citations
adr-lens browse            # explore interactively
adr-lens lint              # what is broken or stale?
```

## Install

```sh
npx adr-lens web --open      # no install
npm install -g adr-lens      # or keep it around
```

Requires Node 24+.

Everything runs on your machine and reads your local files. Nothing is uploaded,
and there is no server or account involved — which is the point, since ADRs
usually live in private repos. The page it writes is a single file with no
external requests, so where that file goes afterwards is entirely your choice:
open it locally, commit it, or host it.

## What it does

**Finds your records without configuration.** It walks the tree looking for
directories named `adr`, `adrs`, `decisions`, `decision-records`,
`architecture-decisions`, or `architecture-decision-records`, and skips
`node_modules` and friends. Point it at one repo or at a folder full of them.

**Parses the formats people actually use.** The adr-tools layout (`# 2. Title`
with a `## Status` section), the bold-field layout (`# ADR-001: Title` with
`**Status:** Accepted`), and YAML frontmatter all work. Status is normalised from
free text, so `Accepted`, `accepted ✅`, and `Proposed → Accepted` all land in the
same place.

**Extracts the decision.** Every listing can show one sentence answering "what
did we decide?", lifted from the `## Decision` section — skipping the sub-headings
and bolded pseudo-labels that decision sections tend to open with.

**Builds the citation graph.** Cross-references between records become a graph,
so `adr-lens map` can lead with the most-cited decisions. In a corpus of ninety
records, the handful everything else cites is the reading list.

**Distinguishes partial supersession.** "Superseded in part by ADR-0065" is not
the same as "Superseded by ADR-0065" — the first record is still in force. Both
phrasings are recognised, along with `supersedes parts of`, `partially superseded
by`, and the pattern where a status names what died and adds that the rest
"remains in force". Relations are mirrored, so only one side has to say it.

## Commands

### `web` — the readable page

Writes the whole corpus as **one self-contained HTML file**: no build step, no
server, no external requests. Open it from disk, commit it, or publish it.

```sh
adr-lens web --open                 # write <scope>-decisions.html and open it
adr-lens web -o docs/decisions.html
adr-lens web -C ~/code --open       # every repo under a directory, grouped
```

The page has two halves:

- **The register** — every record as one row: number, status, title, and the
  one-sentence decision. Type to filter across titles, decisions, and body text;
  filter to *current only* or by status. `/` focuses the search, `j`/`k` step
  through results.
- **The reading view** — the decision stated once, up front, before any context.
  Then the record itself: proper measure and line-height, tables that scroll in
  their own container, mermaid diagrams drawn as diagrams, and cross-references
  as links you can click. Replaced records say so at the top and point at what
  replaced them; partly-replaced records say *that* instead, because they are
  still in force.

It adapts to light and dark, collapses to one column on a phone, and needs no
network. A 100-record corpus is about 2 MB.

### `map` — where to start

Leads with the most-cited records, then supersession chains, then the records
nothing references.

```
$ adr-lens map -C ../billing-service

Decision map
════════════
42 records · 37 current · 48,010 words · ~218 min to read all

By status
  ● Accepted      34  ██████████████████████████████
  ◐ Proposed       3  ███
  ⊘ Superseded     5  ████

Start here — most cited
  These are the decisions everything else builds on.

   14 ← ● 0002 Idempotent batch settlement
        We adopt a single-pass settlement model built on Lambda + SQS.
    9 ← ● 0024 Single-store idempotency gate
        buildInvoiceId(tenantId, customerId, periodId?) produces a …

Supersession chains
  Where the thinking changed. Read the last one.

  0007 → 0012 → 0031  Retry conflicting writes
  0019 → 0024        Single-store idempotency gate
```

### `list` — triage

One line per record: number, status, title, inbound citations, age. Superseded
titles are struck through.

```sh
adr-lens list                        # everything, by number
adr-lens list --live --sort influence -V   # what's current, most-cited first, with decisions
adr-lens list retry                  # only records matching "retry"
adr-lens list -s proposed            # only proposed
adr-lens list -g                     # grouped by source directory
```

### `show` — read one

Renders a single record to the terminal: headings, wrapped prose, lists, tables,
code blocks, and blockquotes — plus its relations and everything that cites it.

```sh
adr-lens show 65                     # by number
adr-lens show idempotency-gate       # by filename fragment
adr-lens show 65 --summary           # header and decision line only
adr-lens show 65 --sections decision,consequences
adr-lens show 65 -u                  # print link destinations
```

### `browse` — explore

An interactive two-pane browser: filterable list on the left, rendered record on
the right.

| key | action |
| --- | --- |
| `↑ ↓` / `j k` | move between records |
| `space` / `b` | page down / up |
| `g` / `G` | first / last |
| `enter` | focus the record pane |
| `tab` | switch pane |
| `esc` | back to the list |
| `/` | filter — type, `enter` to keep, `esc` to drop |
| `c` | clear the filter |
| `s` | cycle status filter |
| `L` | toggle current-only |
| `x` | jump to a related record |
| `[` `]` | back / forward through jumps |
| `e` | open in `$EDITOR` |
| `?` | key help |
| `q` | quit |

### `lint` — audit

Exits non-zero only on errors, so it is safe in CI.

| rule | severity | what it catches |
| --- | --- | --- |
| `duplicate-number` | error | two records claiming the same number in one directory |
| `broken-link` | error | a local link pointing at a file that does not exist |
| `supersession-cycle` | error | two records superseding each other |
| `dangling-reference` | warn | a supersession naming a record that cannot be found |
| `stale-status` | warn | reads as accepted, but another record supersedes it |
| `superseded-without-target` | warn | marked superseded with no identifiable replacement |
| `no-status` | warn | missing or unrecognised status |
| `no-date` | info | no date |
| `number-gap` | info | gaps in numbering — usually a deleted record |
| `missing-section` | info | no `## Context` or `## Decision` |
| `orphan` | info | cites nothing and is cited by nothing |

```sh
adr-lens lint          # errors and warnings
adr-lens lint --all    # include informational checks
adr-lens lint --json   # machine-readable
```

### `search` — rank by relevance

```sh
adr-lens search retry counter    # every term must match
adr-lens search 34               # exact number match ranks first
```

## Options

```
-C, --root <path>    directory to search (default: cwd)
    --depth <n>      how deep to look for ADR directories (default 6)
-d, --dir <text>     only records whose path contains <text>
-s, --status <list>  accepted, proposed, rejected, deprecated, superseded, unknown
    --live           hide superseded records
-w, --width <n>      columns to render into (default: terminal width, capped at 100)
    --sort <key>     number | influence | date | title | length
-n, --limit <n>      show at most n records
-V, --verbose        add the decision line under each row (list)
-g, --group          group by source directory (list)
-u, --urls           print link destinations (show)
    --summary        header and decision line only (show)
    --sections <l>   comma-separated section names (show)
    --top <n>        entries per section (map)
-a, --all            include informational findings (lint)
    --json           machine-readable output
    --no-color       disable colour
```

## Programmatic use

The core carries no terminal concerns, so it can back other surfaces — a web
view, an editor plugin, or an MCP server exposing the corpus to an agent.

```ts
import { loadCorpus, decisionLine, lintCorpus } from 'adr-lens';

const corpus = await loadCorpus('./');

for (const adr of corpus.adrs) {
  console.log(adr.number, adr.status, decisionLine(adr));
}

const findings = lintCorpus(corpus, { all: true });
```

`loadCorpus` returns records with resolved relations, inbound and outbound
citations, and full-supersession fields. `renderMarkdown` is exported separately
if you want the terminal renderer without the CLI.

## Development

```sh
pnpm install
pnpm dev map -C ../some-repo   # run from source
pnpm test                      # vitest
pnpm check-types               # tsc --noEmit
pnpm lint                      # biome
pnpm build                     # tsdown → dist/
```

## Licence

MIT
