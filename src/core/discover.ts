import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { AdrDir } from './types.ts';

/**
 * Directory names that conventionally hold decision records. `decisions` and
 * `architecture-decisions` show up as often as the adr-tools default in practice.
 */
const ADR_DIR_NAMES = new Set([
  'adr',
  'adrs',
  'decisions',
  'decision-records',
  'architecture-decisions',
  'architecture-decision-records',
]);

/** Directories never worth walking into. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'vendor',
  'target',
  '__pycache__',
  '.venv',
  'venv',
]);

/**
 * A markdown file in an ADR directory counts as a record unless it is obviously
 * scaffolding. Templates and indexes are the two that show up everywhere.
 */
const NON_ADR_FILES = new Set([
  'readme.md',
  'index.md',
  'template.md',
  'adr-template.md',
  '0000-template.md',
  'contributing.md',
]);

export function isAdrFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') && !NON_ADR_FILES.has(lower);
}

/**
 * Walk `root` looking for directories whose name matches a known ADR convention.
 * Recursion stops at `maxDepth` so pointing this at a Github folder full of repos
 * stays fast, and never descends into a matched directory (ADRs do not nest).
 */
export async function discoverAdrDirs(root: string, maxDepth = 6): Promise<AdrDir[]> {
  const absoluteRoot = resolve(root);
  const found: AdrDir[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip rather than fail the whole scan
    }

    const subdirs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      subdirs.push(entry.name);
    }

    for (const name of subdirs) {
      const full = join(dir, name);
      if (ADR_DIR_NAMES.has(name.toLowerCase())) {
        const count = await countAdrFiles(full);
        if (count > 0) {
          found.push({
            path: full,
            relative: relative(absoluteRoot, full) || '.',
            count,
          });
        }
        continue; // do not descend into a matched ADR directory
      }
      await walk(full, depth + 1);
    }
  }

  // A path pointed straight at an ADR directory should just work.
  const direct = await countAdrFiles(absoluteRoot);
  if (direct > 0 && ADR_DIR_NAMES.has(basenameOf(absoluteRoot).toLowerCase())) {
    return [{ path: absoluteRoot, relative: '.', count: direct }];
  }

  await walk(absoluteRoot, 0);

  // Fall back to loose markdown in the root when nothing conventional turned up.
  if (found.length === 0 && direct > 0) {
    return [{ path: absoluteRoot, relative: '.', count: direct }];
  }

  return found.sort((a, b) => b.count - a.count || a.relative.localeCompare(b.relative));
}

async function countAdrFiles(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && isAdrFile(e.name)).length;
  } catch {
    return 0;
  }
}

function basenameOf(path: string): string {
  const parts = path.split(sep).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
