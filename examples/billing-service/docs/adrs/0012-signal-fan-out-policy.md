# 12. Signal fan-out policy

Date: 2026-06-04

## Status

Accepted. Supersedes [ADR-0010](0010-legacy-signal-routing.md).

## Context

The single broad event from [ADR-0010](0010-legacy-signal-routing.md) meant
every consumer paid for every change.

## Decision

We define two categories of signal:

- **Routes** — state transitions a consumer acts on. Published as distinct
  event types (`InvoiceSettled`, `InvoiceFailed`, `InvoiceVoided`) so consumers
  subscribe to what they need.
- **Side-effects** — everything else. Recorded on the row and readable on
  demand, never published.

A new event type needs a named consumer. Nothing is published speculatively.

## Consequences

Deliveries dropped by roughly ninety-five percent. Adding a consumer for an
existing transition is now free; adding one for a transition we do not publish
requires an ADR.

## Related

- [ADR-0003](0003-write-then-publish.md) — how these are published reliably
