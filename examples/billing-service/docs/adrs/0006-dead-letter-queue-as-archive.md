# 6. Dead-letter queue as a passive archive

Date: 2026-03-11

## Status

Accepted

## Context

Four separate dead-letter consumers had grown, one per queue, each with its own
slightly different idea of what to do with a failed message. Two of them retried
in ways that could double-charge.

## Decision

Replace the four dedicated retry handlers with a per-record decorator that
callers wrap their handler in. Two policies fix the design:

**Error policy.** Errors are tagged `DATA` (deterministic, will fail again) or
`SYSTEM` (everything else). Classification decides whether the customer-facing
webhook fires; it does not decide whether the message reaches the queue.

**Uniform-archive policy.** Every error escapes the handler. The decorator never
acknowledges a failed message. On retry exhaustion the message lands in the
dead-letter queue, so depth means one thing everywhere: failures since the last
drain.

```ts
export const settle = withFailureArchive(async (record) => {
  const invoice = await load(record.invoiceId);
  await post(invoice);
});
```

## Consequences

Operators watch one number. Misclassifying a transient error as `DATA` is
recoverable, because the message is archived either way.
