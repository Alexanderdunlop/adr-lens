import type { SortKey } from '../commands/list.ts';
import type { Status } from '../core/types.ts';

export interface ParsedArgs {
  command: string;
  /** Positional arguments after the command. */
  operands: string[];
  flags: Flags;
}

export interface Flags {
  root: string;
  width?: number;
  status?: Status[];
  dir?: string;
  liveOnly: boolean;
  maxDepth?: number;
  json: boolean;
  noColor: boolean;
  sort?: SortKey;
  limit?: number;
  verbose: boolean;
  group: boolean;
  all: boolean;
  urls: boolean;
  summary: boolean;
  sections?: string[];
  top?: number;
  help: boolean;
  version: boolean;
  /** Output path for `web`. */
  out?: string;
  /** Overrides the page's title/scope label for `web`. */
  scope?: string;
  /** Open the generated page in the default browser. */
  open: boolean;
  /** Rebuild the page whenever a record changes. */
  watch: boolean;
  /** Serve the page on localhost and push a reload after each rebuild. */
  serve: boolean;
  /** Port for `--serve`. A free one is chosen when this is not set. */
  port?: number;
}

const STATUSES: readonly Status[] = [
  'proposed',
  'accepted',
  'rejected',
  'deprecated',
  'superseded',
  'unknown',
];

const SORTS: readonly SortKey[] = ['number', 'influence', 'date', 'title', 'length'];

const KNOWN_COMMANDS = new Set(['list', 'show', 'lint', 'map', 'browse', 'search', 'web', 'help']);

export class ArgError extends Error {}

/**
 * A small hand-rolled parser. The flag surface is stable and short, and pulling
 * in a parser library would be more code than this is.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Flags = {
    root: process.cwd(),
    liveOnly: false,
    json: false,
    noColor: false,
    verbose: false,
    group: false,
    all: false,
    urls: false,
    summary: false,
    help: false,
    version: false,
    open: false,
    watch: false,
    serve: false,
  };

  const operands: string[] = [];
  let command: string | null = null;
  let rootSet = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === '--') {
      operands.push(...argv.slice(i + 1));
      break;
    }

    if (!arg.startsWith('-')) {
      if (command === null && KNOWN_COMMANDS.has(arg)) command = arg;
      else operands.push(arg);
      continue;
    }

    // Support both `--flag=value` and `--flag value`.
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
    const takeValue = (): string => {
      if (inlineValue !== null) return inlineValue;
      const next = argv[++i];
      if (next === undefined) throw new ArgError(`${name} needs a value`);
      return next;
    };

    switch (name) {
      case '-h':
      case '--help':
        flags.help = true;
        break;
      case '-v':
      case '--version':
        flags.version = true;
        break;
      case '-C':
      case '--root':
      case '--path':
        flags.root = takeValue();
        rootSet = true;
        break;
      case '-w':
      case '--width':
        flags.width = parseNumber(takeValue(), name);
        break;
      case '-s':
      case '--status':
        flags.status = parseStatuses(takeValue());
        break;
      case '-d':
      case '--dir':
        flags.dir = takeValue();
        break;
      case '--live':
      case '--current':
        flags.liveOnly = true;
        break;
      case '--depth':
        flags.maxDepth = parseNumber(takeValue(), name);
        break;
      case '--json':
        flags.json = true;
        break;
      case '--no-color':
      case '--no-colour':
        flags.noColor = true;
        break;
      case '--sort':
        flags.sort = parseSort(takeValue());
        break;
      case '-n':
      case '--limit':
        flags.limit = parseNumber(takeValue(), name);
        break;
      case '--top':
        flags.top = parseNumber(takeValue(), name);
        break;
      case '-V':
      case '--verbose':
        flags.verbose = true;
        break;
      case '-g':
      case '--group':
        flags.group = true;
        break;
      case '-a':
      case '--all':
        flags.all = true;
        break;
      case '-u':
      case '--urls':
        flags.urls = true;
        break;
      case '--summary':
        flags.summary = true;
        break;
      case '-o':
      case '--out':
        flags.out = takeValue();
        break;
      case '--open':
        flags.open = true;
        break;
      case '-W':
      case '--watch':
        flags.watch = true;
        break;
      case '-S':
      case '--serve':
        flags.serve = true;
        break;
      case '--port':
        flags.port = parsePort(takeValue(), name);
        flags.serve = true;
        break;
      case '--scope':
      case '--title':
        flags.scope = takeValue();
        break;
      case '--section':
      case '--sections':
        flags.sections = takeValue()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      default:
        throw new ArgError(`Unknown option: ${name}`);
    }
  }

  // A served page that never changes is just a worse `--open`, so serving implies
  // watching. The reverse is not true: `--watch` on its own still writes a file
  // and nothing else.
  if (flags.serve) flags.watch = true;

  // A bare path as the first operand is a natural way to point the tool at a repo.
  if (!rootSet && command !== 'show' && operands.length > 0 && looksLikePath(operands[0]!)) {
    flags.root = operands.shift()!;
  }

  return { command: command ?? 'list', operands, flags };
}

function looksLikePath(value: string): boolean {
  return value === '.' || value === '..' || value.includes('/') || value.startsWith('~');
}

function parseNumber(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) throw new ArgError(`${name} expects a number`);
  return parsed;
}

function parsePort(value: string, name: string): number {
  const port = parseNumber(value, name);
  if (port < 1 || port > 65535) throw new ArgError(`${name} expects a port between 1 and 65535`);
  return port;
}

function parseStatuses(value: string): Status[] {
  const parts = value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const result: Status[] = [];
  for (const part of parts) {
    const match = STATUSES.find((s) => s === part || s.startsWith(part));
    if (!match) {
      throw new ArgError(`Unknown status "${part}". Expected one of: ${STATUSES.join(', ')}`);
    }
    result.push(match);
  }
  return result;
}

function parseSort(value: string): SortKey {
  const match = SORTS.find((s) => s === value || s.startsWith(value.toLowerCase()));
  if (!match) throw new ArgError(`Unknown sort "${value}". Expected one of: ${SORTS.join(', ')}`);
  return match;
}
