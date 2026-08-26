# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): a note,
committed alongside the code, saying what changed and how it moves the version.

Add one in the same PR as the change:

```sh
pnpm changeset
```

Pick `patch`, `minor`, or `major`, then write the line you would want to read in
the changelog — what changed for someone using the tool, not which files moved.

On merge to `main`, CI opens (or updates) a **"chore: version packages"** pull
request that bumps the version and writes `CHANGELOG.md`. Merging *that* is what
publishes to npm. A change with no changeset ships no release, which is the
intended behaviour for refactors, tests, and docs.
