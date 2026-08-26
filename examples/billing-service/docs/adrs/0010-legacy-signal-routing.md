# 10. Legacy signal routing

Date: 2026-05-06

## Status

Superseded by [ADR-0012](0012-signal-fan-out-policy.md)

## Context

Downstream services needed to know when an invoice changed state, and the first
implementation had each of them poll.

## Decision

Introduce a single `InvoiceChanged` event carrying the new state, and have
consumers filter on it themselves.

## Consequences

Every consumer receives every change and discards most of them. At current
volume that is roughly forty times more deliveries than any consumer needs,
which is what [ADR-0012](0012-signal-fan-out-policy.md) addresses.
