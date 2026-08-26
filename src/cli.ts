#!/usr/bin/env node
import { relative } from 'node:path';
import { ArgError, type Flags, parseArgs } from './cli/args.ts';
import { renderHelp } from './cli/help.ts';
import { createContext, filtered, type GlobalFlags, resolveOne } from './commands/context.ts';
import { lintCorpus, lintExitCode, renderLint } from './commands/lint.ts';
import { renderList, summariseCorpus } from './commands/list.ts';
import { mapToJson, renderMap } from './commands/map.ts';
import type { ServeHandle } from './commands/serve.ts';
import { renderShow } from './commands/show.ts';
import { defaultOutputName, watchSite, writeSite } from './commands/web.ts';
import { search } from './core/search.ts';
import type { AdrNode } from './core/types.ts';
import { theme } from './render/theme.ts';

const VERSION = '0.1.0';

async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof ArgError) {
      console.error(theme.error(error.message));
      console.error(theme.dim('Run `adr-lens --help` for usage.'));
      return 2;
    }
    throw error;
  }

  const { command, operands, flags } = parsed;

  if (flags.version) {
    console.log(VERSION);
    return 0;
  }
  if (flags.help || command === 'help') {
    console.log(renderHelp());
    return 0;
  }
  if (flags.noColor) process.env.NO_COLOR = '1';

  const context = await createContext(flags as GlobalFlags);

  if (context.corpus.adrs.length === 0) {
    console.error(theme.warn(`No decision records found under ${flags.root}`));
    console.error(
      theme.dim(
        'Looked for directories named adr, adrs, decisions, decision-records, architecture-decisions.',
      ),
    );
    return 1;
  }

  switch (command) {
    case 'show':
      return runShow(context, operands, flags);
    case 'lint':
      return runLint(context, flags);
    case 'map':
      return runMap(context, flags);
    case 'browse':
      return runBrowse(context, operands, flags);
    case 'web':
      return runWeb(context, flags);
    case 'search':
      return runSearch(context, operands, flags);
    default:
      return runList(context, operands, flags);
  }
}

type Context = Awaited<ReturnType<typeof createContext>>;

function runList(context: Context, operands: string[], flags: Flags): number {
  const query = operands.join(' ').trim() || undefined;
  const adrs = filtered(context, flags as GlobalFlags, query);

  if (flags.json) {
    console.log(
      JSON.stringify(
        adrs.map((adr) => toJson(adr)),
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(
    renderList(context, adrs, {
      sort: flags.sort,
      verbose: flags.verbose,
      limit: flags.limit,
      group: flags.group || context.corpus.dirs.length > 1,
    }).join('\n'),
  );

  console.log('');
  console.log(summariseCorpus(adrs));
  return 0;
}

function runSearch(context: Context, operands: string[], flags: Flags): number {
  const query = operands.join(' ').trim();
  if (!query) {
    console.error(theme.error('search needs a query'));
    return 2;
  }

  const results = search(context.corpus.adrs, {
    query,
    ...(flags.status ? { status: flags.status } : {}),
    ...(flags.dir ? { dir: flags.dir } : {}),
    liveOnly: flags.liveOnly,
  });

  if (flags.json) {
    console.log(
      JSON.stringify(
        results.map((r) => ({ ...toJson(r.adr), score: r.score, matchedIn: r.matchedIn })),
        null,
        2,
      ),
    );
    return 0;
  }

  if (results.length === 0) {
    console.log(theme.dim(`Nothing matched “${query}”.`));
    return 1;
  }

  // Search results are already ranked, so the list must not re-sort them.
  console.log(
    renderList(
      context,
      results.map((r) => r.adr),
      {
        sort: flags.sort ?? undefined,
        verbose: flags.verbose ?? true,
        limit: flags.limit,
      },
    ).join('\n'),
  );
  console.log('');
  console.log(
    theme.dim(`${results.length} match${results.length === 1 ? '' : 'es'} for “${query}”`),
  );
  return 0;
}

function runShow(context: Context, operands: string[], flags: Flags): number {
  const reference = operands.join(' ').trim();
  if (!reference) {
    console.error(theme.error('show needs a record reference (number, filename, or title)'));
    return 2;
  }

  const resolved = resolveOne(context.corpus, reference);

  if (Array.isArray(resolved)) {
    if (resolved.length === 0) {
      console.error(theme.error(`No record matched “${reference}”.`));
      return 1;
    }
    console.error(theme.warn(`“${reference}” matched ${resolved.length} records:`));
    console.error('');
    console.error(renderList(context, resolved, { group: true }).join('\n'));
    return 1;
  }

  if (flags.json) {
    console.log(JSON.stringify(toJson(resolved, true), null, 2));
    return 0;
  }

  console.log(
    renderShow(context, resolved, {
      summary: flags.summary,
      urls: flags.urls,
      ...(flags.sections ? { sections: flags.sections } : {}),
    }).join('\n'),
  );
  return 0;
}

function runLint(context: Context, flags: Flags): number {
  const findings = lintCorpus(context.corpus, { all: flags.all });

  if (flags.json) {
    console.log(JSON.stringify(findings, null, 2));
    return lintExitCode(findings);
  }

  console.log(renderLint(context, findings, { all: flags.all }).join('\n'));
  return lintExitCode(findings);
}

function runMap(context: Context, flags: Flags): number {
  if (flags.json) {
    console.log(JSON.stringify(mapToJson(context), null, 2));
    return 0;
  }
  console.log(renderMap(context, flags.top ? { top: flags.top } : {}).join('\n'));
  return 0;
}

async function runWeb(context: Context, flags: Flags): Promise<number> {
  const out = flags.out ?? defaultOutputName(flags.root);
  const options = {
    out,
    now: context.now,
    ...(flags.scope ? { scope: flags.scope } : {}),
  };

  if (flags.watch) return runWebWatch(flags, options);

  const result = await writeSite(context.corpus, flags.root, options);

  console.log(
    `${theme.ok('\u2713')} ${relative(process.cwd(), result.path)}  ${theme.dim(
      `${result.records} records · ${Math.round(result.bytes / 1024)} kB`,
    )}`,
  );

  if (flags.open) {
    await openInBrowser(result.path);
  } else {
    console.log(theme.dim(`  open it with: open ${relative(process.cwd(), result.path)}`));
  }

  return 0;
}

/**
 * Watch mode never returns on its own: it holds the process open until
 * interrupted, reporting each rebuild on a single status line.
 */
async function runWebWatch(
  flags: Flags,
  options: { out: string; now: Date; scope?: string },
): Promise<number> {
  const { clockTime, createStatusLine } = await import('./commands/watch.ts');
  const status = createStatusLine(process.stdout);

  // The newest build, served from memory rather than read back off disk.
  let page = '';
  let server: ServeHandle | null = null;

  const { handle, initial } = await watchSite(flags.root, {
    ...options,
    onBuild: (result) => {
      page = result.html;
      const pushed = server?.reload() ?? 0;
      status.update(
        `${theme.dim(clockTime(new Date()))} ${theme.ok('\u2713')} rebuilt  ${theme.dim(
          `${result.records} records \u00b7 ${Math.round(result.bytes / 1024)} kB${
            pushed > 0 ? ` \u00b7 reloaded ${pushed} tab${pushed === 1 ? '' : 's'}` : ''
          }`,
        )}`,
      );
    },
    onError: (error) => {
      // A rebuild failing must not end the session — the next save usually fixes it.
      status.update(
        `${theme.dim(clockTime(new Date()))} ${theme.error('\u2717')} ${error.message}`,
      );
    },
  });
  page = initial.html;

  if (flags.serve) {
    const { startServer } = await import('./commands/serve.ts');
    try {
      server = await startServer(() => page, flags.port !== undefined ? { port: flags.port } : {});
    } catch (error) {
      // A port we cannot have is worth stopping for, rather than silently
      // degrading to the manual-refresh mode the user asked to be rid of.
      handle.close();
      console.error(theme.error(error instanceof Error ? error.message : String(error)));
      return 1;
    }
  }

  const where = relative(process.cwd(), initial.path);
  console.log(
    `${theme.ok('\u2713')} ${where}  ${theme.dim(
      `${initial.records} records \u00b7 ${Math.round(initial.bytes / 1024)} kB`,
    )}`,
  );
  if (server) {
    console.log(`  ${server.url}`);
    console.log(theme.dim(`  reloads on save \u00b7 ctrl-c to stop`));
  } else {
    console.log(
      theme.dim(`  watching for changes \u00b7 reload the page after a save \u00b7 ctrl-c to stop`),
    );
  }

  if (flags.open) await openInBrowser(server ? server.url : initial.path);

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      handle.close();
      status.done();
      // Tell the open tabs to stop listening before the socket disappears.
      const closed = server ? server.close() : Promise.resolve();
      void closed.then(resolve, resolve);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

  return 0;
}

async function openInBrowser(path: string): Promise<void> {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const { spawn } = await import('node:child_process');
  spawn(opener, [path], { detached: true, stdio: 'ignore' }).unref();
}

async function runBrowse(context: Context, operands: string[], flags: Flags): Promise<number> {
  if (!process.stdout.isTTY) {
    console.error(theme.error('browse needs an interactive terminal.'));
    console.error(theme.dim('Use `adr-lens list` or `adr-lens show` when piping output.'));
    return 2;
  }

  // Loaded lazily so the non-interactive commands never pay Ink's startup cost.
  const { startBrowser } = await import('./tui/browser.tsx');
  await startBrowser({
    context,
    initialQuery: operands.join(' ').trim(),
    liveOnly: flags.liveOnly,
    ...(flags.status ? { status: flags.status } : {}),
  });
  return 0;
}

function toJson(adr: AdrNode, includeBody = false): Record<string, unknown> {
  return {
    id: adr.id,
    path: adr.path,
    number: adr.number,
    title: adr.title,
    status: adr.status,
    statusRaw: adr.statusRaw,
    date: adr.date,
    author: adr.author,
    wordCount: adr.wordCount,
    sections: adr.sections.map((s) => s.title),
    relations: adr.relations,
    citedBy: adr.inbound,
    cites: adr.outbound,
    supersededBy: adr.supersededBy,
    supersedes: adr.supersedes,
    warnings: adr.warnings,
    ...(includeBody ? { body: adr.body } : {}),
  };
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(theme.error(error instanceof Error ? error.message : String(error)));
    if (process.env.ADR_LENS_DEBUG) console.error(error);
    process.exitCode = 1;
  });
