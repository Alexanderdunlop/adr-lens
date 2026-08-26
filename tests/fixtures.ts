import { buildCorpus } from '../src/core/corpus.ts';
import { parseAdr } from '../src/core/parse.ts';
import type { AdrNode, ParsedAdr } from '../src/core/types.ts';

/** The adr-tools layout: numbered title, bare `Date:`, prose status. */
export const ADR_TOOLS = `# 2. Idempotent batch settlement

Date: 2026-03-02

## Status

Accepted. Scope narrowed by [TCK-1042](https://example.test/TCK-1042): the legacy consumers
were removed. The settlement decisions below remain in force.

## Context

Billing Service settles invoices in nightly batches.

### Options considered

1. **AWS Step Functions** — couples topology to infrastructure.
2. **Lambda + SQS** — stateless handlers.

## Decision

We adopt a **single-pass settlement model** built on Lambda + SQS.

## Consequences

Batches cannot be replayed.
`;

/** The bold-field layout: `# ADR-001: Title` with `**Status:**` lines. */
export const BOLD_FIELDS = `# ADR-001: Adopt a single formatter

**Status:** Proposed
**Date:** 2026-02-10
**Author:** Engineering Team

## Context

The platform is a greenfield monorepo.

## Decision

We will use **one tool** for linting and formatting.
`;

/** A decision section that opens with a sub-heading and a bolded pseudo-label. */
export const NESTED_DECISION = `# 34. Dead-letter queue as a passive archive

Date: 2026-04-01

## Status

Accepted

## Decision

Replace the four dedicated retry handlers with a per-record decorator that callers wrap.

**Error policy.** Errors are tagged DATA or SYSTEM.

## Consequences

Operators watch one queue.
`;

export const SUBHEADING_FIRST = `# 65. Single-store idempotency gate

Date: 2026-05-01

## Status

Accepted. **Supersedes [ADR-0054](0054-hashed-invoice-id.md)** — the deterministic id
replaces the hashed one.

## Decision

### One run per grain

\`buildInvoiceId\` produces a **period-independent composite id** in the store's
convention.

## Consequences

Settlement is idempotent.
`;

export function parse(raw: string, id: string): ParsedAdr {
  return parseAdr(raw, { id: `docs/adrs/${id}`, path: `/repo/docs/adrs/${id}` });
}

/** Build a corpus from `[filename, markdown]` pairs. */
export function corpusOf(...files: Array<[string, string]>): {
  nodes: AdrNode[];
  byNumber: (n: number) => AdrNode;
  corpus: ReturnType<typeof buildCorpus>;
} {
  const corpus = buildCorpus(files.map(([name, raw]) => parse(raw, name)));
  return {
    nodes: corpus.adrs,
    byNumber: (n: number) => {
      const found = corpus.adrs.find((a) => a.number === n);
      if (!found) throw new Error(`No ADR numbered ${n} in fixture corpus`);
      return found;
    },
    corpus,
  };
}
