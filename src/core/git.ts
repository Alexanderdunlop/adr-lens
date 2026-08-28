import { execFile } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { buildCorpus, type Corpus } from './corpus.ts';
import { isAdrPath } from './discover.ts';
import { parseAdr } from './parse.ts';
import type { AdrDir, ParsedAdr } from './types.ts';

const execFileAsync = promisify(execFile);

/** A git invocation that failed, carrying git's own message where there is one. */
export class GitError extends Error {}

/** Where the records live, and where the repository holding them starts. */
export interface Repo {
  /** Absolute path of the repository root, as git reports it. */
  toplevel: string;
  /** Absolute path the caller pointed the tool at, which record ids are relative to. */
  root: string;
  /**
   * `root` expressed relative to the repository root, slash-separated and
   * trailing-slashed, or empty at the top.
   *
   * Taken from git rather than computed, because `--show-toplevel` resolves
   * symlinks and the caller's path may not be resolved — on macOS anything under
   * `/tmp` differs. Subtracting this prefix from a tree path yields an id that
   * matches the one the on-disk corpus gives the same file, which is what lets
   * the working tree be one side of a comparison.
   */
  prefix: string;
}

/**
 * The revisions a diff runs between. `head` is null when the right-hand side is
 * the working tree, which is the state a record is usually in while being written.
 */
export interface RevRange {
  /** A commit-ish `git show` can read from. */
  base: string;
  /** A commit-ish, or null for the working tree. */
  head: string | null;
  /** The spelling the caller used, for display. */
  baseLabel: string;
  headLabel: string;
}

/**
 * Bases tried when no range is given, in the order a repository is likely to use
 * them. `origin/` last: a local branch is the more accurate comparison when both
 * exist, since it is what the author has actually merged.
 */
const DEFAULT_BASES = ['main', 'master', 'origin/main', 'origin/master'];

/** Trees this large are pathological; the cap only exists to bound memory. */
const MAX_TREE_BYTES = 64 * 1024 * 1024;

/** How many blobs to read at once. Enough to hide process startup, few enough to be polite. */
const READ_CONCURRENCY = 8;

export async function openRepo(root: string): Promise<Repo> {
  const absolute = resolve(root);
  const toplevel = await tryGit(absolute, ['rev-parse', '--show-toplevel']);
  if (toplevel === null) {
    throw new GitError(`${root} is not inside a git repository, so there is nothing to diff.`);
  }
  const prefix = await git(absolute, ['rev-parse', '--show-prefix']);
  return { toplevel: toplevel.trim(), root: absolute, prefix: prefix.trim() };
}

/**
 * Parse and resolve a range specifier.
 *
 * - `A..B` — B as committed
 * - `A..`  — B is the working tree, uncommitted changes included
 * - `A...B` — from where the branches diverged, which is what a pull request shows
 * - `A`    — shorthand for `A..HEAD`
 * - absent — the repository's default branch against HEAD
 */
export async function resolveRange(repo: Repo, spec?: string): Promise<RevRange> {
  const trimmed = spec?.trim() ?? '';

  const separator = trimmed.includes('...') ? '...' : trimmed.includes('..') ? '..' : null;
  const parts = separator ? trimmed.split(separator) : [trimmed, 'HEAD'];
  if (parts.length > 2) {
    throw new GitError(
      `"${trimmed}" names more than two revisions. Expected <rev>${separator}<rev>.`,
    );
  }
  const [left, right] = parts as [string, string];

  const baseLabel = left.trim() || (await defaultBase(repo));
  // An empty right-hand side is only meaningful with a separator: `adr-lens diff
  // main` compares against HEAD, `adr-lens diff main..` against the working tree.
  const headLabel = right.trim() || (separator ? null : 'HEAD');

  await assertRevision(repo, baseLabel);
  if (headLabel !== null) await assertRevision(repo, headLabel);

  let base = baseLabel;
  if (separator === '...') {
    const other = headLabel ?? 'HEAD';
    const mergeBase = await tryGit(repo.toplevel, ['merge-base', baseLabel, other]);
    if (mergeBase === null) {
      throw new GitError(`${baseLabel} and ${other} share no history, so there is no merge base.`);
    }
    base = mergeBase.trim();
  }

  return { base, head: headLabel, baseLabel, headLabel: headLabel ?? 'working tree' };
}

async function defaultBase(repo: Repo): Promise<string> {
  for (const candidate of DEFAULT_BASES) {
    if (await revisionExists(repo, candidate)) return candidate;
  }
  throw new GitError(
    `No default branch found (tried ${DEFAULT_BASES.join(', ')}). Name one: adr-lens diff <rev>..<rev>`,
  );
}

async function assertRevision(repo: Repo, rev: string): Promise<void> {
  if (await revisionExists(repo, rev)) return;
  throw new GitError(`Unknown revision "${rev}".`);
}

async function revisionExists(repo: Repo, rev: string): Promise<boolean> {
  const sha = await tryGit(repo.toplevel, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return sha !== null;
}

/**
 * Load every record as it stood at `rev`.
 *
 * The tree is listed in full and filtered here rather than with a pathspec:
 * `ls-tree` matches pathspecs by prefix, so it cannot express "any markdown file
 * under any `adrs/` directory" — and the directories are exactly what may have
 * moved between the two revisions.
 */
export async function loadCorpusAtRev(
  repo: Repo,
  rev: string,
  options: { known?: ReadonlySet<string> } = {},
): Promise<Corpus> {
  const listing = await git(repo.toplevel, ['ls-tree', '-r', '-z', '--name-only', rev]);
  const known = options.known ?? new Set<string>();

  const paths: Array<{ repoPath: string; id: string; absolute: string }> = [];
  for (const repoPath of listing.split('\0')) {
    if (!repoPath || !isAdrPath(repoPath, known)) continue;
    // A record outside the directory the caller asked about is not in scope, even
    // though it is in the same repository.
    if (repo.prefix && !repoPath.startsWith(repo.prefix)) continue;
    const id = repoPath.slice(repo.prefix.length).split('/').join(sep);
    paths.push({ repoPath, id, absolute: join(repo.root, id) });
  }

  const parsed = await mapConcurrent(paths, READ_CONCURRENCY, async (entry) => {
    const raw = await git(repo.toplevel, ['show', `${rev}:${entry.repoPath}`]);
    return parseAdr(raw, { id: entry.id, path: entry.absolute });
  });

  return buildCorpus(parsed, dirsOf(parsed, repo.root));
}

/** The directories a set of parsed records came from, in the shape the corpus reports. */
function dirsOf(parsed: ParsedAdr[], root: string): AdrDir[] {
  const counts = new Map<string, number>();
  for (const adr of parsed) {
    const dir = dirname(adr.path);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts]
    .map(([path, count]) => ({ path, relative: relative(root, path) || '.', count }))
    .sort((a, b) => b.count - a.count || a.relative.localeCompare(b.relative));
}

/**
 * Repository-relative directories holding the records a corpus loaded, so a
 * corpus kept somewhere unconventional is still recognised in an older tree.
 */
export function knownDirs(corpus: Corpus, repo: Repo): ReadonlySet<string> {
  const dirs = new Set<string>();

  const add = (absolute: string): void => {
    const rel = relative(repo.root, absolute);
    if (rel.startsWith('..')) return;
    const suffix = rel.split(sep).join('/');
    dirs.add(`${repo.prefix}${suffix}`.replace(/\/$/, ''));
  };

  for (const dir of corpus.dirs) add(dir.path);
  for (const adr of corpus.adrs) add(dirname(adr.path));
  return dirs;
}

/* ------------------------------------------------------------------- internals */

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: MAX_TREE_BYTES,
      encoding: 'utf8',
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new GitError(stderr || (error instanceof Error ? error.message : String(error)));
  }
}

/** Run a git command that is allowed to fail, e.g. asking whether a revision exists. */
async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });

  await Promise.all(workers);
  return results;
}
