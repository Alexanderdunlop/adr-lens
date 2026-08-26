# ADR-008: Adopt a single formatter

**Status:** Proposed
**Date:** 2026-04-02
**Author:** Platform team

## Context

The platform is a greenfield monorepo with several apps and shared packages. We
need linting and formatting that is fast, configurable per package, and does not
need two tools kept in step.

The options considered:

1. **Two tools** — the industry default, with a large plugin ecosystem.
2. **One combined tool** — a single binary covering both jobs.

## Decision

We will use **one tool** for linting and formatting.

## Key differences

| Aspect | Two tools | One tool |
|---|---|---|
| Packages to install | many | one |
| Config files | four | one |
| Time to check 10k files | ~45s | under 1s |
| Import sorting | plugin | built in |

## Consequences

A smaller ecosystem, so a rule that exists only as a plugin elsewhere may have
no equivalent. In exchange, checks run fast enough to sit in a pre-commit hook.
