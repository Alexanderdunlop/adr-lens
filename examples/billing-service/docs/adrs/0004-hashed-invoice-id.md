# 4. Hashed invoice id

Date: 2026-02-14

## Status

Superseded by [ADR-0009](0009-single-store-idempotency-gate.md)

## Context

Settlement needs a stable id per invoice so a redelivered message does not
produce a second invoice.

## Decision

Hash the tenant id, customer id, and period together with SHA-256 and take the
first 32 hex characters as the invoice id.

## Consequences

The id is opaque, which makes support work harder: given an id from a customer
ticket, there is no way to tell which tenant it belongs to without a table scan.
