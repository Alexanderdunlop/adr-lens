/**
 * The page's visual system.
 *
 * An ADR corpus is a ledger of changes of mind, so the design leans on the
 * vocabulary of a register: mono record numbers with tabular figures, hairline
 * rules between entries, and a status treatment that is the loudest thing on the
 * page — because "is this still true?" is the question every reader arrives with.
 *
 * Neutrals carry a slight green bias so they sit under the petrol accent rather
 * than reading as default grey. Semantic status colours are deliberately kept
 * off the accent hue so state never competes with interaction.
 */
export const STYLES = `
:root {
  color-scheme: light;

  --paper:      #f6f7f5;
  --surface:    #ffffff;
  --surface-2:  #eef0ec;
  --ink:        #171b1a;
  --ink-soft:   #3a423f;
  --muted:      #5c6360;
  --faint:      #8d938f;
  --rule:       #dcdfd9;
  --rule-soft:  #e8eae5;
  --accent:     #1f4e5f;
  --accent-ink: #163c49;
  --accent-wash:#e4edf0;

  --accepted:   #3f6b3a;
  --proposed:   #8a6a18;
  --rejected:   #8c3a32;
  --deprecated: #6b4a7a;
  --superseded: #8d938f;

  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, Cambria, serif;
  --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;

  --measure: 68ch;
  --rail: 25rem;
  --step--1: 0.8125rem;
  --step-0:  1rem;
  --step-1:  1.1875rem;
  --step-2:  1.4375rem;
  --step-3:  1.8125rem;
  --step-4:  2.25rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --paper:      #141716;
    --surface:    #191d1c;
    --surface-2:  #222725;
    --ink:        #e8ebe7;
    --ink-soft:   #c6ccc7;
    --muted:      #98a09b;
    --faint:      #6d7571;
    --rule:       #2c322f;
    --rule-soft:  #232827;
    --accent:     #7fbdd0;
    --accent-ink: #a3d3e2;
    --accent-wash:#1d2c31;

    --accepted:   #7fb377;
    --proposed:   #d4a843;
    --rejected:   #d97b70;
    --deprecated: #b48fc4;
    --superseded: #6d7571;
  }
}

/* The viewer's own toggle must win over the OS preference, in both directions. */
:root[data-theme="light"] {
  color-scheme: light;
  --paper: #f6f7f5; --surface: #ffffff; --surface-2: #eef0ec;
  --ink: #171b1a; --ink-soft: #3a423f; --muted: #5c6360; --faint: #8d938f;
  --rule: #dcdfd9; --rule-soft: #e8eae5;
  --accent: #1f4e5f; --accent-ink: #163c49; --accent-wash: #e4edf0;
  --accepted: #3f6b3a; --proposed: #8a6a18; --rejected: #8c3a32;
  --deprecated: #6b4a7a; --superseded: #8d938f;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #141716; --surface: #191d1c; --surface-2: #222725;
  --ink: #e8ebe7; --ink-soft: #c6ccc7; --muted: #98a09b; --faint: #6d7571;
  --rule: #2c322f; --rule-soft: #232827;
  --accent: #7fbdd0; --accent-ink: #a3d3e2; --accent-wash: #1d2c31;
  --accepted: #7fb377; --proposed: #d4a843; --rejected: #d97b70;
  --deprecated: #b48fc4; --superseded: #6d7571;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: var(--step-0);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}

/* ----------------------------------------------------------------- app shell */

.app {
  display: grid;
  grid-template-columns: var(--rail) minmax(0, 1fr);
  min-height: 100vh;
}

/* ---------------------------------------------------------------- the register */

.rail {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rule);
  background: var(--surface);
  height: 100vh;
  position: sticky;
  top: 0;
}

.rail-head {
  padding: 1.25rem 1.25rem 0.875rem;
  border-bottom: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.brand h1 {
  margin: 0;
  font-family: var(--sans);
  font-size: var(--step-0);
  font-weight: 650;
  letter-spacing: -0.01em;
}

.brand .scope {
  font-family: var(--mono);
  font-size: var(--step--1);
  color: var(--muted);
}

.corpus-stats {
  font-size: var(--step--1);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.search-wrap { position: relative; display: flex; }

.search {
  width: 100%;
  font: inherit;
  font-size: var(--step-0);
  padding: 0.5rem 0.625rem 0.5rem 1.75rem;
  border: 1px solid var(--rule);
  border-radius: 3px;
  background: var(--paper);
  color: var(--ink);
}

.search::placeholder { color: var(--faint); }

.search-wrap::before {
  content: "/";
  position: absolute;
  left: 0.625rem;
  top: 50%;
  transform: translateY(-50%);
  font-family: var(--mono);
  color: var(--faint);
  pointer-events: none;
}

.filters { display: flex; flex-wrap: wrap; gap: 0.3125rem; }

.chip {
  font: inherit;
  font-size: var(--step--1);
  font-family: var(--sans);
  padding: 0.1875rem 0.5rem;
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
}

.chip:hover { border-color: var(--faint); color: var(--ink); }

.chip[aria-pressed="true"] {
  background: var(--accent-wash);
  border-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 550;
}

.chip .n { font-variant-numeric: tabular-nums; color: var(--faint); }
.chip[aria-pressed="true"] .n { color: var(--accent-ink); }

.sorts {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.sorts-label {
  font-family: var(--mono);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--faint);
  margin-right: 0.25rem;
}

.sort {
  font: inherit;
  font-size: var(--step--1);
  padding: 0.125rem 0.375rem;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.sort:hover { color: var(--ink); background: var(--surface-2); }

.sort[aria-pressed="true"] {
  color: var(--accent-ink);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--accent);
}

.register {
  overflow-y: auto;
  flex: 1;
  padding-bottom: 2rem;
}

.group-label {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface-2);
  border-bottom: 1px solid var(--rule);
  padding: 0.375rem 1.25rem;
  font-family: var(--mono);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

/* An entry is a row in a ledger: number, state, what was decided. */
.entry {
  display: grid;
  grid-template-columns: 2.75rem minmax(0, 1fr);
  gap: 0 0.625rem;
  width: 100%;
  text-align: left;
  padding: 0.625rem 1.25rem;
  border: 0;
  border-bottom: 1px solid var(--rule-soft);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.entry:hover { background: var(--surface-2); }

.entry[aria-current="true"] {
  background: var(--accent-wash);
  box-shadow: inset 3px 0 0 var(--accent);
}

.entry .num {
  font-family: var(--mono);
  font-size: var(--step--1);
  font-variant-numeric: tabular-nums;
  color: var(--faint);
  padding-top: 0.0625rem;
}

.entry[aria-current="true"] .num { color: var(--accent-ink); }

.entry .title {
  font-size: var(--step-0);
  font-weight: 500;
  line-height: 1.35;
  display: flex;
  align-items: baseline;
  gap: 0.4375rem;
}

.entry .title .label { min-width: 0; }

.entry.is-superseded .title .label {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
  text-decoration-color: var(--faint);
  color: var(--muted);
}

.entry .gist {
  grid-column: 2;
  font-size: var(--step--1);
  color: var(--muted);
  line-height: 1.4;
  margin-top: 0.1875rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.entry .foot {
  grid-column: 2;
  margin-top: 0.3125rem;
  display: flex;
  gap: 0.625rem;
  font-size: 0.75rem;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

/* The date is a fixed-width column, so dates line up down the register. */
.entry .foot .d { font-family: var(--mono); }

/* State reads as form, not just colour: a filled dot for live, a ring for not. */
.dot {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  transform: translateY(-0.0625rem);
}

.dot.accepted   { background: var(--accepted); }
.dot.proposed   { background: var(--proposed); box-shadow: inset 0 0 0 2px var(--surface); border: 1px solid var(--proposed); }
.dot.rejected   { background: var(--rejected); }
.dot.deprecated { background: var(--deprecated); }
.dot.superseded { background: transparent; border: 1.5px solid var(--superseded); }
.dot.unknown    { background: transparent; border: 1.5px dashed var(--faint); }

.empty {
  padding: 2rem 1.25rem;
  color: var(--muted);
  font-size: var(--step--1);
}

/* ------------------------------------------------------------------- reading */

.reader { min-width: 0; }

.reader-inner {
  max-width: var(--measure);
  margin: 0 auto;
  padding: 3.5rem 2rem 6rem;
}

.rec-head { display: flex; flex-direction: column; gap: 0.875rem; }

.eyebrow {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  font-family: var(--mono);
  font-size: var(--step--1);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.eyebrow .rec-no { color: var(--accent-ink); font-weight: 600; letter-spacing: 0.02em; }

.rec-title {
  margin: 0;
  font-family: var(--serif);
  font-size: var(--step-4);
  line-height: 1.15;
  font-weight: 600;
  letter-spacing: -0.015em;
  text-wrap: balance;
}

.rec-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.875rem;
  font-size: var(--step--1);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-weight: 550;
  letter-spacing: 0.01em;
}

.state.accepted   { color: var(--accepted); }
.state.proposed   { color: var(--proposed); }
.state.rejected   { color: var(--rejected); }
.state.deprecated { color: var(--deprecated); }
.state.superseded { color: var(--superseded); }
.state.unknown    { color: var(--faint); }

/* Share controls: available, never the loudest thing in the header. */
.rec-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.125rem;
}

.act {
  font: inherit;
  font-size: var(--step--1);
  padding: 0.1875rem 0.5rem;
  border: 1px solid var(--rule);
  border-radius: 3px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.act:hover { border-color: var(--faint); color: var(--ink); background: var(--surface); }
.act:active { background: var(--surface-2); }

.act[data-copied="true"] {
  border-color: var(--accepted);
  color: var(--accepted);
  background: color-mix(in srgb, var(--accepted) 8%, var(--surface));
}

.act[data-copied="failed"] {
  border-color: var(--rejected);
  color: var(--rejected);
}

.act-status {
  font-size: var(--step--1);
  color: var(--muted);
}

/* A letterhead for the printed sheet; the screen already says what this is. */
.print-head { display: none; }

/* The at-a-glance block: the decision, before any prose. */
.glance {
  margin: 2rem 0 0;
  padding: 1.125rem 1.25rem;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-left: 3px solid var(--accent);
  border-radius: 2px;
}

.glance .k {
  font-family: var(--mono);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  display: block;
  margin-bottom: 0.4375rem;
}

.glance .decision {
  margin: 0;
  font-family: var(--serif);
  font-size: var(--step-1);
  line-height: 1.5;
  color: var(--ink);
}

.notice {
  margin: 1rem 0 0;
  padding: 0.875rem 1rem;
  border-radius: 2px;
  font-size: var(--step--1);
  line-height: 1.5;
  border: 1px solid;
}

.notice.replaced {
  background: color-mix(in srgb, var(--rejected) 8%, var(--surface));
  border-color: color-mix(in srgb, var(--rejected) 35%, var(--rule));
  color: var(--ink-soft);
}

.notice.partial {
  background: color-mix(in srgb, var(--proposed) 10%, var(--surface));
  border-color: color-mix(in srgb, var(--proposed) 35%, var(--rule));
  color: var(--ink-soft);
}

.notice strong { font-weight: 650; }
.notice a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 2px; }

.status-prose {
  margin: 1rem 0 0;
  font-size: var(--step--1);
  color: var(--muted);
  line-height: 1.55;
}

/* ------------------------------------------------------------- record prose */

.prose {
  margin-top: 2.5rem;
  font-family: var(--serif);
  font-size: var(--step-1);
  line-height: 1.65;
  color: var(--ink-soft);
}

.prose > * + * { margin-top: 1.15em; }

.prose h2, .prose h3, .prose h4, .prose h5, .prose h6 {
  font-family: var(--sans);
  color: var(--ink);
  line-height: 1.25;
  text-wrap: balance;
  letter-spacing: -0.005em;
}

.prose h2 {
  font-size: var(--step-2);
  font-weight: 600;
  margin-top: 2.5em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--rule);
}

.prose h3 { font-size: var(--step-1); font-weight: 620; margin-top: 2em; }
.prose h4 { font-size: var(--step-0); font-weight: 650; margin-top: 1.75em; }
.prose h5, .prose h6 {
  font-size: var(--step--1);
  font-weight: 650;
  margin-top: 1.5em;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--muted);
}

.prose p { margin: 0; }
.prose strong { font-weight: 650; color: var(--ink); }
.prose em { font-style: italic; }

.prose ul, .prose ol { margin: 0; padding-left: 1.5em; }
.prose li + li { margin-top: 0.45em; }
.prose li > ul, .prose li > ol { margin-top: 0.45em; }
.prose ul { list-style: none; }
.prose ul > li { position: relative; }
.prose ul > li::before {
  content: "";
  position: absolute;
  left: -1em;
  top: 0.62em;
  width: 0.3125rem;
  height: 0.3125rem;
  border-radius: 50%;
  background: var(--faint);
}
.prose ul ul > li::before { background: transparent; box-shadow: inset 0 0 0 1px var(--faint); }
.prose ol { list-style: decimal; }
.prose ol > li::marker { color: var(--faint); font-family: var(--mono); font-size: 0.85em; }

.prose a { color: var(--accent-ink); text-decoration-thickness: 1px; text-underline-offset: 2px; }
.prose a:hover { text-decoration-thickness: 2px; }
.prose a.rec-link { font-family: var(--mono); font-size: 0.9em; }
.prose .dead-link {
  color: var(--muted);
  text-decoration: underline dotted var(--faint);
  cursor: help;
}
.prose .img-note { color: var(--faint); font-family: var(--mono); font-size: 0.85em; }

.prose code {
  font-family: var(--mono);
  font-size: 0.855em;
  background: var(--surface-2);
  padding: 0.1em 0.32em;
  border-radius: 2px;
  border: 1px solid var(--rule-soft);
  word-break: break-word;
}

.prose blockquote {
  margin: 0;
  padding: 0.125rem 0 0.125rem 1.125rem;
  border-left: 2px solid var(--accent);
  color: var(--muted);
}
.prose blockquote > * + * { margin-top: 0.9em; }

.prose hr { border: 0; border-top: 1px solid var(--rule); margin: 2.5em 0; }

.code-block {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 3px;
  overflow: hidden;
}

.code-lang {
  display: block;
  padding: 0.3125rem 0.75rem;
  border-bottom: 1px solid var(--rule);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.code-block pre {
  margin: 0;
  padding: 0.875rem 1rem;
  overflow-x: auto;
}

.code-block code {
  font-family: var(--mono);
  font-size: 0.8125rem;
  line-height: 1.6;
  background: none;
  border: 0;
  padding: 0;
  white-space: pre;
  color: var(--ink-soft);
}

.diagram {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 3px;
  padding: 1rem;
  overflow-x: auto;
}

.table-scroll {
  overflow-x: auto;
  border: 1px solid var(--rule);
  border-radius: 3px;
  background: var(--surface);
}

.prose table {
  border-collapse: collapse;
  width: 100%;
  font-family: var(--sans);
  font-size: var(--step--1);
  line-height: 1.45;
}

.prose th, .prose td {
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--rule-soft);
  vertical-align: top;
}

.prose thead th {
  background: var(--surface-2);
  border-bottom: 1px solid var(--rule);
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}

.prose tbody tr:last-child td { border-bottom: 0; }
.prose td:first-child { font-weight: 550; color: var(--ink); }

/* -------------------------------------------------------------- relations */

.relations {
  margin-top: 4rem;
  padding-top: 1.75rem;
  border-top: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.rel-group h2 {
  margin: 0 0 0.625rem;
  font-family: var(--mono);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 500;
}

.rel-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }

.rel {
  display: grid;
  grid-template-columns: 2.75rem minmax(0, 1fr);
  gap: 0.625rem;
  align-items: baseline;
  width: 100%;
  text-align: left;
  padding: 0.4375rem 0.5rem;
  margin-left: -0.5rem;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--step--1);
  cursor: pointer;
}

.rel:hover { background: var(--surface-2); }
.rel .num { font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--faint); }
.rel .label { display: flex; align-items: baseline; gap: 0.4375rem; }
.rel.is-superseded .label span:last-child { text-decoration: line-through; color: var(--muted); }

/* ----------------------------------------------------------------- overview */

.overview .reader-inner { max-width: 46rem; }

.lede {
  font-family: var(--serif);
  font-size: var(--step-2);
  line-height: 1.45;
  color: var(--ink-soft);
  margin: 0.75rem 0 0;
  text-wrap: pretty;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
  gap: 1px;
  margin-top: 2.5rem;
  background: var(--rule);
  border: 1px solid var(--rule);
  border-radius: 3px;
  overflow: hidden;
}

.tile { background: var(--surface); padding: 0.875rem 1rem; }

.tile .v {
  font-family: var(--mono);
  font-size: var(--step-3);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  color: var(--ink);
}

.tile .k {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted);
}

.tile .v.accepted { color: var(--accepted); }
.tile .v.superseded { color: var(--superseded); }

.section-head {
  margin: 3.5rem 0 0.375rem;
  font-family: var(--sans);
  font-size: var(--step-1);
  font-weight: 620;
  color: var(--ink);
}

.section-note { margin: 0 0 1.25rem; font-size: var(--step--1); color: var(--muted); }

.ranked { list-style: none; margin: 0; padding: 0; }

.ranked li { border-bottom: 1px solid var(--rule-soft); }

.ranked button {
  display: grid;
  grid-template-columns: 2.5rem 2.75rem minmax(0, 1fr);
  gap: 0.75rem;
  align-items: baseline;
  width: 100%;
  text-align: left;
  padding: 0.6875rem 0.5rem;
  margin-left: -0.5rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.ranked button:hover { background: var(--surface-2); }

.ranked .cites {
  font-family: var(--mono);
  font-size: var(--step--1);
  font-variant-numeric: tabular-nums;
  color: var(--accent-ink);
  font-weight: 600;
}

.ranked .num { font-family: var(--mono); font-size: var(--step--1); color: var(--faint); font-variant-numeric: tabular-nums; }
.ranked .body .t { font-weight: 500; display: flex; align-items: baseline; gap: 0.4375rem; }
.ranked .body .g { font-size: var(--step--1); color: var(--muted); margin-top: 0.1875rem; line-height: 1.4; }

/* A chain reads left to right: what it was, what replaced it. */
.chains { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }

.chain {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.375rem 0.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--rule-soft);
  font-size: var(--step--1);
}

.chain .link {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  border: 0;
  background: transparent;
  padding: 0.0625rem 0.25rem;
  cursor: pointer;
  border-radius: 2px;
  color: var(--superseded);
  text-decoration: line-through;
  font: inherit;
  font-family: var(--mono);
}

.chain .link:hover { background: var(--surface-2); }
.chain .link.current { color: var(--accepted); text-decoration: none; font-weight: 650; }
.chain .arrow { color: var(--faint); }
.chain .ct { color: var(--muted); flex: 1 1 12rem; min-width: 0; }

/* ------------------------------------------------------------------- mobile */

.back {
  display: none;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid var(--rule);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--step--1);
  padding: 0.375rem 0.6875rem;
  border-radius: 3px;
  cursor: pointer;
  margin-bottom: 1.5rem;
}

@media (max-width: 60rem) {
  .app { grid-template-columns: 1fr; }
  .rail { height: auto; position: static; border-right: 0; border-bottom: 1px solid var(--rule); }
  .sorts {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.sorts-label {
  font-family: var(--mono);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--faint);
  margin-right: 0.25rem;
}

.sort {
  font: inherit;
  font-size: var(--step--1);
  padding: 0.125rem 0.375rem;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.sort:hover { color: var(--ink); background: var(--surface-2); }

.sort[aria-pressed="true"] {
  color: var(--accent-ink);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--accent);
}

.register { max-height: none; }
  .reader-inner { padding: 2rem 1.25rem 4rem; }
  .rec-title { font-size: var(--step-3); }
  .back { display: inline-flex; }

  /* One column: the register and the reader take turns. */
  .app[data-view="record"] .rail { display: none; }
  .app[data-view="register"] .reader { display: none; }
}

@media (min-width: 60.0625rem) {
  .app[data-view] .rail, .app[data-view] .reader { display: flex; }
  .reader { display: block; }
}

/* -------------------------------------------------------------------- print */

@page { margin: 18mm 16mm; }

/*
 * Printing is not "the page, on paper". It is one decision, sent to someone who
 * will read it away from the page: a reviewer, an auditor, someone on a call.
 * So the register, the search, and the share controls all go; the state and the
 * date stay at the top where the reader's first question is answered; every
 * external url is spelled out, because a printed link is dead; and nothing is
 * allowed to break in a place that costs the reader a fact — a table row split
 * across a page boundary, or a heading stranded at the foot of one.
 */
@media print {
  /*
   * Paper is white and ink is black, whatever the reader was looking at. Listed
   * against the explicit theme selectors too, or a reader with the dark toggle
   * on would print a black page.
   */
  :root, :root[data-theme="light"], :root[data-theme="dark"] {
    color-scheme: light;
    --paper: #fff; --surface: #fff; --surface-2: #fff;
    --ink: #000; --ink-soft: #111; --muted: #444; --faint: #666;
    --rule: #999; --rule-soft: #ccc;
    --accent: #000; --accent-ink: #000; --accent-wash: #fff;
    --accepted: #000; --proposed: #000; --rejected: #000;
    --deprecated: #000; --superseded: #555;
  }

  body { background: #fff; color: #000; font-size: 10.5pt; }

  .rail, .back, .rec-actions { display: none !important; }

  .app { display: block; min-height: 0; }

  /*
   * Paper is narrower than the one-column breakpoint — A4 is about 794px against
   * 960px — so the mobile rules are live while printing, and those rules have the
   * two halves take turns: whichever one is not being viewed is hidden. On paper
   * there are no turns. Written at the same specificity as the rules being
   * countered, and later in the sheet, so this wins in both views; without it,
   * printing the overview produces a blank sheet.
   */
  .app[data-view] .rail { display: none; }
  .app[data-view] .reader { display: block; }

  .reader-inner, .overview .reader-inner { max-width: none; margin: 0; padding: 0; }

  .print-head {
    display: block;
    margin: 0 0 1.5rem;
    padding-bottom: 0.35rem;
    border-bottom: 0.5pt solid var(--rule);
    font-family: var(--mono);
    font-size: 8pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .rec-title { font-size: 20pt; }
  .prose { margin-top: 1.5rem; font-size: 10.5pt; }

  /* State reads as form on paper, where backgrounds are usually dropped. */
  .dot { print-color-adjust: exact; -webkit-print-color-adjust: exact; }

  .glance { border: 0; border-left: 2pt solid #000; border-radius: 0; padding: 0 0 0 0.85rem; }
  /* A hairline box, not a tint: the reader may have background graphics off,
     and the notice has to survive that — it is the one thing on the sheet that
     says whether the decision still holds. */
  .notice, .notice.replaced, .notice.partial {
    border: 0.5pt solid #000;
    background: none;
    color: #000;
  }

  /* A printed link cannot be followed, so name its destination. Internal
     cross-references are excluded: an in-page route spelled out as a url tells
     the reader nothing the link text — "ADR-0065" — has not already told them. */
  a.ext-link, .prose a { color: #000; }
  a.ext-link::after {
    content: " <" attr(href) ">";
    font-family: var(--mono);
    font-size: 0.8em;
    color: var(--muted);
    word-break: break-all;
  }

  /* Nothing scrolls on paper, so anything that scrolled must now wrap or fit. */
  .table-scroll, .code-block pre, .diagram { overflow: visible; }
  .prose thead th { white-space: normal; }
  .code-block code { white-space: pre-wrap; word-break: break-word; }

  .rec-head, .code-lang { break-after: avoid; }
  .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 { break-after: avoid; break-inside: avoid; }
  .prose tr, .prose thead, .prose li, .glance, .notice, .rec-meta, .rel { break-inside: avoid; }
  /* Repeat the header when a long table does cross a page. */
  .prose thead { display: table-header-group; }
  .prose p { orphans: 3; widows: 3; }

  .relations { margin-top: 2rem; break-before: auto; }
  .rel { cursor: default; }
}
`.trim();
