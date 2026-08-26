import { theme } from '../render/theme.ts';

export const HELP = `
${theme.h1('adr-lens')} ${theme.dim('— make architecture decision records readable')}

${theme.h2('Usage')}
  adr-lens [command] [path] [options]

${theme.h2('Commands')}
  ${theme.bold('list')} [query]      List records, one line each. The default command.
  ${theme.bold('show')} <ref>        Render one record: number, id fragment, or title substring.
  ${theme.bold('browse')} [query]    Interactive browser — list on the left, record on the right.
  ${theme.bold('map')}               Where to start: most-cited records, supersession chains, loose ends.
  ${theme.bold('lint')}              Audit the corpus for duplicates, broken links, and stale statuses.
  ${theme.bold('search')} <query>    Rank records by relevance to a query.

${theme.h2('Scope')}
  -C, --root <path>    Directory to search (default: cwd).
      --depth <n>      How deep to look for adr/ adrs/ decisions/ dirs (default 6).
  -d, --dir <text>     Only records whose path contains <text>.
  -s, --status <list>  Comma-separated: accepted, proposed, rejected, deprecated, superseded, unknown.
      --live           Hide superseded records.

${theme.h2('Output')}
  -w, --width <n>      Columns to render into (default: terminal width, capped at 100).
      --sort <key>     number | influence | date | title | length.
  -n, --limit <n>      Show at most n records.
  -V, --verbose        Add the extracted decision line under each row (list).
  -g, --group          Group rows by source directory (list).
  -u, --urls           Print link destinations (show).
      --summary        Header and decision line only (show).
      --sections <l>   Comma-separated section names to include (show).
      --top <n>        How many entries per section (map).
  -a, --all            Include informational findings (lint).
      --json           Machine-readable output.
      --no-color       Disable colour.

${theme.h2('Examples')}
  ${theme.dim('# Triage a service you have never read')}
  adr-lens map -C ../billing-service

  ${theme.dim('# What is current, most-cited first')}
  adr-lens list --live --sort influence -V

  ${theme.dim('# Read one decision, with its citations')}
  adr-lens show 65

  ${theme.dim('# Just the decision and consequences of everything about retries')}
  adr-lens search retry --sections decision,consequences

  ${theme.dim('# Audit before a review')}
  adr-lens lint --all
`.trim();

export function renderHelp(): string {
  return HELP;
}
