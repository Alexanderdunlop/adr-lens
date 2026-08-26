---
status: Rejected
date: 2026-06-19
deciders: Platform team
---

# 13. Multi-currency line items on one invoice

## Context

A prospect asked for a single invoice combining line items priced in different
currencies, converted at the invoice date.

## Decision

Rejected. An invoice carries exactly one currency.

Mixing currencies means storing a conversion rate per line item and reproducing
it exactly on every later read, including credits and refunds issued months
afterwards. That makes the invoice total a function of when it is asked about,
which no downstream consumer expects.

## Consequences

Customers needing this receive one invoice per currency. Revisit if a
regulatory or contractual requirement makes a single document mandatory — the
alternative would be a presentation-layer grouping, not a data-model change.
