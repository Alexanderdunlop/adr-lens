# 11. Per-tenant rate limits

Date: 2026-05-20

## Status

Accepted

## Context

One tenant's bulk import saturated the settlement queue for six hours. Queue
concurrency is global, so a single caller can consume all of it.

## Decision

Rate limit per tenant at the queue producer, using a token bucket sized from the
tenant's plan. Rejected work is retried with backoff rather than dropped.

## Consequences

A noisy tenant slows only itself. Limits become a support-visible number, which
means they will be argued about, so they are configuration rather than code.
