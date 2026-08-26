# 2. Idempotent batch settlement

Date: 2026-01-22

## Status

Accepted. Scope narrowed by [TCK-1042](https://tracker.example/TCK-1042): the
per-region settlement workers were folded into one queue for the initial
release.

> **Superseded in part by [ADR-0009](0009-single-store-idempotency-gate.md):**
> the invoice id scheme changed. The execution model below still holds.

## Context

Settlement runs nightly across every tenant. The previous implementation held
run state in memory and restarted the whole batch on any failure, so one bad
tenant could delay everyone else until morning.

We needed an execution model that satisfied:

- **Scale** — thousands of tenants per night, no shared mutable state
- **Reliability** — safe under partial failure and duplicate queue delivery
- **Auditability** — every transition observable without attaching a debugger

### Options considered

1. **Step Functions** — built-in state machine, but couples the batch shape to
   infrastructure definitions and makes dynamic tenant sets awkward.
2. **Long-running workers** — simplest code, expensive at rest, and fragile
   across deploys.
3. **Queue-driven single-pass workers** — stateless handlers that advance one
   invoice at a time.

## Decision

We adopt a **single-pass settlement model** built on Lambda + SQS. Each message
settles exactly one invoice and either completes or fails; nothing is revisited
inside a run.

| Property | Before | After |
|---|---|---|
| Blast radius of one failure | whole batch | one invoice |
| Restart cost | full replay | the failed message only |
| Concurrency limit | one worker | queue concurrency |

## Consequences

Batches cannot be replayed as a unit — a re-run means re-enqueuing the invoices
that failed, which is why [ADR-0009](0009-single-store-idempotency-gate.md)
exists. Ordering within a tenant is no longer guaranteed, so anything
order-sensitive has to be made commutative.
