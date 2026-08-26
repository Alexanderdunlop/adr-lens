# 7. Round currency at the API boundary only

Date: 2026-03-25

## Status

Proposed

## Context

Rounding currently happens wherever a number is formatted, so the same invoice
can total differently in an email and in the API response.

## Decision

Money is carried as integer minor units everywhere internally. Rounding happens
exactly once, at the boundary that renders a value for a human.

## Consequences

Every internal type changes from a decimal to an integer, which is a wide but
mechanical migration. Until it lands, the two representations coexist and the
discrepancy remains.
