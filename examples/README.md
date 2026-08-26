# Example corpus

An invented `billing-service` with 13 decision records, used for demos and for
seeing the tool work on something realistic without needing a repo of your own.

```sh
adr-lens map  -C examples/billing-service
adr-lens web  -C examples/billing-service --open
adr-lens lint -C examples/billing-service --all
```

It deliberately covers the awkward cases: both title layouts, YAML frontmatter,
a status hard-wrapped across lines, a full supersession chain and a *partial*
one, a rejected decision, tables, a mermaid diagram, a fenced code block, and a
link to a non-record file.

Everything in it is fictional.
