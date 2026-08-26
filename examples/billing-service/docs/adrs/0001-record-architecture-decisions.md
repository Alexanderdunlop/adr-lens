# 1. Record architecture decisions

Date: 2026-01-08

## Status

Accepted

## Context

Billing Service has three teams committing to it and a two-year history. The
reasoning behind its shape lives in pull request threads and in the heads of
whoever was on call at the time. New joiners keep re-opening settled questions
because nothing says they were settled.

## Decision

We will record architecturally significant decisions as files in
`docs/adrs/`, numbered sequentially, using the format described by Michael
Nygard. A decision is significant if a future engineer would reasonably ask "why
is it like this?" and the code alone does not answer.

## Consequences

Every decision has one canonical home, and superseding one is an explicit act
rather than a quiet edit. The cost is that a pull request changing behaviour now
has to change its record in the same commit, or the two disagree.
