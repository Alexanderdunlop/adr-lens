# 9. Single-store idempotency gate

Date: 2026-04-18

## Status

Accepted. **Supersedes [ADR-0004](0004-hashed-invoice-id.md)** — the readable
composite id replaces the hashed one.

## Context

The hashed id from [ADR-0004](0004-hashed-invoice-id.md) was opaque, and
deduplication was scoped per settlement version, so re-running a period could
produce a second invoice for the same customer.

## Decision

### One invoice per grain, enforced by a conditional create

`buildInvoiceId(tenantId, customerId, periodId?)` produces a
**period-independent composite id** in the store's key convention — uppercase
labels joined by `#`:

- **`TENANT#tenantId#CUSTOMER#customerId`** — subscription billing: one invoice
  per customer per tenant.
- **`TENANT#tenantId#PERIOD#periodId#CUSTOMER#customerId`** — metered billing:
  one invoice per customer per period.

Every value segment is validated to be free of `#`, so the segments stay
unambiguous. The grain is derived from the tenant's billing mode rather than
configured, so there is no knob to set inconsistently.

The conditional create on this id is the only deduplication authority. Anything
else that thinks it knows whether an invoice exists is advisory.

## Consequences

Settlement is idempotent. Support can read a tenant out of an id by eye. The
migration required a backfill mapping old hashed ids to new composite ones,
retained for one billing cycle.

## Related

- [ADR-0002](0002-idempotent-batch-settlement.md) — the execution model this gates
- [rollout plan](../plans/2026-04-12-003-rollout-plan.md)
