/**
 * What the review page adds to the reading page's stylesheet.
 *
 * Additive only: every shared element — the rail, the register entries, the prose
 * — keeps the stylesheet it already had, so a record under review looks the same
 * as it will once merged.
 */
export const DIFF_STYLES = `
:root {
  --add:      #2f6b46;
  --add-wash: #e3f1e7;
  --del:      #8c3a32;
  --del-wash: #f6e6e4;
}

@media (prefers-color-scheme: dark) {
  :root {
    --add:      #7fb377;
    --add-wash: #1c2a20;
    --del:      #d97b70;
    --del-wash: #2c1e1c;
  }
}

:root[data-theme="light"] {
  --add: #2f6b46; --add-wash: #e3f1e7; --del: #8c3a32; --del-wash: #f6e6e4;
}
:root[data-theme="dark"] {
  --add: #7fb377; --add-wash: #1c2a20; --del: #d97b70; --del-wash: #2c1e1c;
}

/* A split view needs the width a single column deliberately gives up. */
.reader-inner.wide { max-width: 96rem; padding-left: 1.5rem; padding-right: 1.5rem; }

/* ------------------------------------------------------------------- the rail */

.modes { display: flex; gap: 0.25rem; }

.mode {
  flex: 1;
  appearance: none;
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--step--1);
  padding: 0.3rem 0.5rem;
}

.mode[aria-pressed="true"] {
  background: var(--accent-wash);
  border-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
}

.mode .n { color: var(--faint); font-family: var(--mono); font-size: 0.85em; margin-left: 0.2rem; }

/* The weight of a change, as a bar down the left of its register entry. */
.entry.significant { box-shadow: inset 3px 0 0 var(--del); }
.entry.notable { box-shadow: inset 3px 0 0 var(--proposed); }
.entry.minor { box-shadow: inset 3px 0 0 var(--rule); }
.entry .why { color: var(--muted); font-size: var(--step--1); grid-column: 2; }
.entry .why .mk { color: var(--add); font-weight: 600; }

/* ---------------------------------------------------------------- the summary */

.dsummary {
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--surface);
  padding: 0.875rem 1rem;
  margin: 1.5rem 0 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.drowline { display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: 0.75rem; align-items: baseline; }
.drowline .k { color: var(--muted); font-size: var(--step--1); font-family: var(--mono); }
.drowline .v { min-width: 0; overflow-wrap: anywhere; }
.drowline .was {
  display: block;
  color: var(--muted);
  font-size: var(--step--1);
  margin-top: 0.25rem;
  padding-left: 0.6rem;
  border-left: 2px solid var(--rule);
}
.drowline .arrow { color: var(--faint); padding: 0 0.15rem; }
.drowline .muted { color: var(--muted); }
.drowline .gone { color: var(--del); }
.drowline .new { color: var(--add); }
.drowline s { color: var(--muted); }
.drowline code { font-family: var(--mono); font-size: 0.9em; }

.weight { font-family: var(--mono); font-size: var(--step--1); }
.weight.significant { color: var(--del); }
.weight.notable { color: var(--proposed); }
.weight.minor { color: var(--faint); }

.dbadge {
  font-family: var(--mono);
  font-size: 0.6em;
  font-weight: 700;
  letter-spacing: 0.08em;
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  margin-left: 0.6rem;
  vertical-align: middle;
}
.dbadge.new { color: var(--add); border: 1px solid var(--add); }
.dbadge.gone { color: var(--del); border: 1px solid var(--del); }

/* ------------------------------------------------------------------ the split */

.dsplit {
  border: 1px solid var(--rule);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface);
}

.dhead {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--rule);
  background: var(--surface-2);
  position: sticky;
  top: 0;
  z-index: 2;
}

.dside {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 1.25rem;
  font-family: var(--mono);
  font-size: var(--step--1);
}
.dside.old { border-right: 1px solid var(--rule); }
.dside .rev { color: var(--muted); }
.dside .muted { color: var(--faint); }

.drow { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--rule-soft); }
.drow:first-of-type { border-top: 0; }

.dcell { padding: 1rem 1.25rem; min-width: 0; }
.dcell.old { border-right: 1px solid var(--rule); }

/* Only changed rows are tinted. Tinting everything would say nothing. */
.drow.changed .dcell.old, .drow.removed .dcell.old { background: color-mix(in srgb, var(--del-wash) 55%, transparent); }
.drow.changed .dcell.new, .drow.added .dcell.new { background: color-mix(in srgb, var(--add-wash) 55%, transparent); }
.drow.added .dcell.old, .drow.removed .dcell.new { background: var(--surface-2); }

.dempty { color: var(--faint); font-family: var(--mono); }

/* The changed words themselves, which is what the eye should land on. */
ins.w, del.w {
  border-radius: 3px;
  padding: 0.05em 0.15em;
  text-decoration: none;
}
ins.w { background: var(--add-wash); box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--add) 45%, transparent); }
del.w { background: var(--del-wash); box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--del) 45%, transparent); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--del) 60%, transparent); }

.dcell .prose { font-size: 0.9375rem; }
.dcell .prose h2 { font-size: var(--step-0); margin-top: 0; }
.dcell .prose > * + * { margin-top: 0.9em; }

/* Stacked rather than side by side once two columns stop being readable. */
@media (max-width: 68rem) {
  .drow, .dhead { grid-template-columns: 1fr; }
  .dcell.old, .dside.old { border-right: 0; border-bottom: 1px solid var(--rule); }
}
`;
