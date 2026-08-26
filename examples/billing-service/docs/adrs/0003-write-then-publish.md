# 3. Write before publishing

Date: 2026-02-03

## Status

Accepted

## Context

Settlement emits events that downstream services act on. Publishing before the
write commits means a consumer can observe an invoice that does not exist yet;
writing without publishing means a consumer silently misses it.

## Decision

The publisher follows a three-phase protocol:

1. Write the row, with the event payload embedded and an `unpublished` marker.
2. Publish from the row.
3. Clear the marker.

A scheduled sweeper republishes anything still marked after five minutes, so a
crash between phases two and three costs a duplicate rather than a loss.

## Consequences

Consumers must tolerate duplicates. That is a cheaper contract than
exactly-once, and it is checkable — see
[ADR-0005](0005-retry-conflicting-writes.md) for how the sweeper avoids
fighting live writers.
