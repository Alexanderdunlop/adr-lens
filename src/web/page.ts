import type { Corpus } from '../core/corpus.ts';
import type { Status } from '../core/types.ts';
import { escapeHtml } from '../render/html.ts';
import {
  buildModel,
  type ClientModel,
  toClientModel,
  type WebModel,
  type WebRecord,
} from './data.ts';
import { SCRIPT } from './script.ts';
import { STYLES } from './styles.ts';

export interface PageOptions {
  /** What the page is a view of, e.g. `billing-service`. */
  scope: string;
  /** Page title; defaults to the scope. */
  title?: string;
  now?: Date;
  /** Emit only the body markup, for embedding. */
  fragment?: boolean;
}

/** Render a whole corpus as one self-contained HTML document. */
export function renderPage(corpus: Corpus, options: PageOptions): string {
  const model = buildModel(corpus, {
    scope: options.scope,
    now: options.now ?? new Date(),
  });

  const title = options.title ?? `${options.scope} · decisions`;
  const body = renderBody(model);

  if (options.fragment) return body;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
${STYLES}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** The markup, without the document wrapper — what an artifact page needs. */
export function renderPageBody(corpus: Corpus, options: PageOptions): string {
  return renderPage(corpus, { ...options, fragment: true });
}

export function pageStyles(): string {
  return STYLES;
}

/* ----------------------------------------------------------------------- body */

function renderBody(model: WebModel): string {
  return `<div class="app" id="app" data-view="register">
${renderRail(model)}
${renderReader(model)}
</div>
<script>
window.__ADR = ${jsonScript(toClientModel(model))};
${SCRIPT}
</script>`;
}

/**
 * Serialise the model for the inline script. `<` must never appear raw inside a
 * `<script>`, or a record whose prose contains `</script>` would close the tag
 * and break the page.
 */
function jsonScript(model: ClientModel): string {
  return (
    JSON.stringify(model)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      // U+2028/9 are literal line terminators in JS source but legal inside a
      // JSON string, so they must be escaped as well.
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
  );
}

/* ----------------------------------------------------------------------- rail */

function renderRail(model: WebModel): string {
  const { totals } = model;

  const filters = [
    `<button class="chip" type="button" data-filter="all" aria-pressed="true">All <span class="n">${totals.records}</span></button>`,
    `<button class="chip" type="button" data-filter="current" aria-pressed="false">Current <span class="n">${totals.current}</span></button>`,
    ...model.statusCounts
      .filter((entry) => entry.status !== 'accepted')
      .map(
        (entry) =>
          `<button class="chip" type="button" data-filter="status:${entry.status}" aria-pressed="false"><span class="dot ${entry.status}"></span>${escapeHtml(entry.label)} <span class="n">${entry.count}</span></button>`,
      ),
  ].join('\n      ');

  return `<aside class="rail">
  <div class="rail-head">
    <div class="brand">
      <h1>Decisions</h1>
      <span class="scope">${escapeHtml(model.scope)}</span>
    </div>
    <p class="corpus-stats">${totals.records} records · ${totals.current} current · ~${totals.minutes} min to read all</p>
    <div class="search-wrap">
      <input class="search" id="q" type="search" placeholder="Search titles, decisions, body…" autocomplete="off" aria-label="Search decision records" />
    </div>
    <div class="filters" id="filters">
      ${filters}
    </div>
  </div>
  <div class="register" id="register" role="list"></div>
</aside>`;
}

/* --------------------------------------------------------------------- reader */

function renderReader(model: WebModel): string {
  return `<main class="reader" id="reader">
  <div class="reader-inner" id="reader-inner">
${renderOverview(model)}
  </div>
</main>
<template id="tpl-records">
${model.records.map(renderRecord).join('\n')}
</template>`;
}

function renderOverview(model: WebModel): string {
  const { totals } = model;

  const tiles = [
    { v: String(totals.records), k: 'records', cls: '' },
    { v: String(totals.current), k: 'still current', cls: 'accepted' },
    {
      v: String(totals.records - totals.current),
      k: 'replaced',
      cls: 'superseded',
    },
    { v: `${Math.round(totals.words / 1000)}k`, k: 'words', cls: '' },
  ]
    .map(
      (tile) =>
        `<div class="tile"><div class="v ${tile.cls}">${escapeHtml(tile.v)}</div><span class="k">${escapeHtml(tile.k)}</span></div>`,
    )
    .join('');

  const cited = model.mostCited
    .map(
      (entry) => `<li><button type="button" data-goto="${entry.slug}">
      <span class="cites">${entry.citedBy}&nbsp;refs</span>
      <span class="num">${escapeHtml(entry.numberLabel)}</span>
      <span class="body"><span class="t"><span class="dot ${entry.status}"></span><span>${escapeHtml(entry.title)}</span></span>${
        entry.gist ? `<span class="g">${entry.gist}</span>` : ''
      }</span>
    </button></li>`,
    )
    .join('\n    ');

  const chains = model.chains
    .slice(0, 12)
    .map((chain) => {
      const links = chain.entries
        .map(
          (entry) =>
            `<button type="button" class="link${entry.current ? ' current' : ''}" data-goto="${entry.slug}">${escapeHtml(entry.numberLabel)}</button>`,
        )
        .join('<span class="arrow">→</span>');
      return `<li class="chain">${links}<span class="ct">${escapeHtml(chain.title)}</span></li>`;
    })
    .join('\n    ');

  return `    <section class="overview-body">
      <div class="rec-head">
        <p class="eyebrow"><span class="rec-no">${escapeHtml(model.scope)}</span><span>as of ${escapeHtml(model.generatedAt)}</span></p>
        <h2 class="rec-title">What this service decided, and what still holds</h2>
        <p class="lede">${totals.records} decision records. ${totals.current} of them still describe how the system works; ${totals.records - totals.current} have been replaced. Start with the most-referenced — they are what everything else is built on.</p>
      </div>

      <div class="tiles">${tiles}</div>

      ${
        model.mostCited.length > 0
          ? `<h3 class="section-head">Start here</h3>
      <p class="section-note">The decisions other records lean on most.</p>
      <ol class="ranked">
    ${cited}
      </ol>`
          : ''
      }

      ${
        model.chains.length > 0
          ? `<h3 class="section-head">Where the thinking changed</h3>
      <p class="section-note">Each chain ends at the record that holds today.</p>
      <ul class="chains">
    ${chains}
      </ul>`
          : ''
      }
    </section>`;
}

/* --------------------------------------------------------------------- record */

function renderRecord(record: WebRecord): string {
  const meta = [
    `<span class="state ${record.status}"><span class="dot ${record.status}"></span>${escapeHtml(record.statusLabel)}</span>`,
    record.date
      ? `<span>${escapeHtml(record.date)}<span class="sep"> · </span>${escapeHtml(record.age)} ago</span>`
      : '',
    `<span>${record.minutes} min read</span>`,
    record.citedBy > 0 ? `<span>referenced by ${record.citedBy}</span>` : '',
    record.author ? `<span>${escapeHtml(record.author)}</span>` : '',
  ]
    .filter(Boolean)
    .join('\n        ');

  const notices: string[] = [];

  if (record.replacedBy) {
    notices.push(
      `<p class="notice replaced"><strong>Replaced.</strong> This is no longer how the system works. Current thinking: <a href="#/${record.currentSlug ?? record.replacedBy.slug}">${escapeHtml(record.replacedBy.label)}</a>.</p>`,
    );
  }

  const partial = record.relations.find((group) => group.kind === 'superseded-in-part-by');
  if (partial && !record.replacedBy) {
    const targets = partial.entries
      .map((entry) => `<a href="#/${entry.slug}">${escapeHtml(entry.numberLabel)}</a>`)
      .join(', ');
    notices.push(
      `<p class="notice partial"><strong>Partly replaced</strong> by ${targets}. The rest of this record still holds — read the status note below for what changed.</p>`,
    );
  }

  const relations = record.relations
    .map(
      (group) => `<section class="rel-group">
          <h2>${escapeHtml(group.label)}</h2>
          <ul class="rel-list">${group.entries
            .map(
              (entry) =>
                `<li><button type="button" class="rel${entry.superseded ? ' is-superseded' : ''}" data-goto="${entry.slug}"><span class="num">${escapeHtml(entry.numberLabel)}</span><span class="label"><span class="dot ${entry.status}"></span><span>${escapeHtml(entry.title)}</span></span></button></li>`,
            )
            .join('')}</ul>
        </section>`,
    )
    .join('\n        ');

  return `<section data-slug="${record.slug}">
      <button class="back" type="button" data-back>← All records</button>
      <div class="rec-head">
        <p class="eyebrow"><span class="rec-no">ADR ${escapeHtml(record.numberLabel)}</span><span>${escapeHtml(record.group)}</span></p>
        <h2 class="rec-title">${escapeHtml(record.title)}</h2>
        <div class="rec-meta">
        ${meta}
        </div>
      </div>
      ${notices.join('\n      ')}
      ${
        record.gist
          ? `<div class="glance"><span class="k">The decision</span><p class="decision">${record.gist}</p></div>`
          : ''
      }
      ${record.statusProse ? `<p class="status-prose">${record.statusProse}</p>` : ''}
      <article class="prose">
${record.bodyHtml}
      </article>
      ${
        relations
          ? `<footer class="relations">
        ${relations}
      </footer>`
          : ''
      }
    </section>`;
}

/** Status ordering used by the rail's filter chips. */
export const FILTER_STATUSES: readonly Status[] = [
  'accepted',
  'proposed',
  'superseded',
  'deprecated',
  'rejected',
  'unknown',
];
