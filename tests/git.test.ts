import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus } from '../src/core/corpus.ts';
import { diffCorpora } from '../src/core/diff.ts';
import {
  GitError,
  knownDirs,
  loadCorpusAtRev,
  openRepo,
  type Repo,
  resolveRange,
} from '../src/core/git.ts';

const run = promisify(execFile);

/**
 * A real repository rather than a stubbed one: the whole point of this module is
 * the shape of git's output, which a stub would only restate. macOS puts temp
 * directories behind a symlink, which is exactly the case that broke naive path
 * arithmetic, so building here is doing real work.
 */
let dir: string;
let repo: Repo;

const record = (number: string, title: string, status: string, decision: string): string =>
  `# ${number}. ${title}\n\nDate: 2026-01-01\n\n## Status\n\n${status}\n\n## Context\n\nBilling settles invoices nightly.\n\n## Decision\n\n${decision}\n`;

const HASHED = record(
  '4',
  'Hashed invoice id',
  'Accepted',
  'Hash the tenant id, customer id, and period together with SHA-256.',
);

async function git(...args: string[]): Promise<void> {
  await run('git', args, { cwd: dir });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adr-lens-git-'));
  await mkdir(join(dir, 'docs/adrs'), { recursive: true });

  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'test@example.test');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');

  await writeFile(join(dir, 'docs/adrs/0004-hashed-invoice-id.md'), HASHED);
  await writeFile(join(dir, 'docs/adrs/README.md'), '# Decisions\n\nAn index, not a record.\n');
  await git('add', '-A');
  await git('commit', '-qm', 'the hashed id');

  await git('checkout', '-qb', 'feature');
  await git('mv', 'docs/adrs/0004-hashed-invoice-id.md', 'docs/adrs/0004-invoice-identity.md');
  await writeFile(
    join(dir, 'docs/adrs/0004-invoice-identity.md'),
    HASHED.replace(
      '\nAccepted\n',
      '\nSuperseded by [ADR-0009](0009-single-store-idempotency-gate.md)\n',
    ),
  );
  await writeFile(
    join(dir, 'docs/adrs/0009-single-store-idempotency-gate.md'),
    record(
      '9',
      'Single-store idempotency gate',
      'Accepted. Supersedes [ADR-0004](0004-invoice-identity.md).',
      'Build the invoice id from tenant, customer, and period in the store’s own convention.',
    ),
  );
  await git('add', '-A');
  await git('commit', '-qm', 'supersede the hashed id');

  repo = await openRepo(dir);
}, 30_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('opening a repository', () => {
  it('refuses a directory that is not in one', async () => {
    await expect(openRepo(tmpdir())).rejects.toBeInstanceOf(GitError);
  });
});

describe('resolving a range', () => {
  it('defaults to the default branch against HEAD', async () => {
    const range = await resolveRange(repo, '');
    expect(range).toMatchObject({ baseLabel: 'main', head: 'HEAD' });
  });

  it('reads an empty right-hand side as the working tree', async () => {
    const range = await resolveRange(repo, 'main..');
    expect(range.head).toBeNull();
    expect(range.headLabel).toBe('working tree');
  });

  it('takes a bare revision as the base', async () => {
    expect(await resolveRange(repo, 'main')).toMatchObject({ baseLabel: 'main', head: 'HEAD' });
  });

  it('resolves three dots to the merge base', async () => {
    const range = await resolveRange(repo, 'main...HEAD');
    const { stdout } = await run('git', ['rev-parse', 'main'], { cwd: dir });
    expect(range.base).toBe(stdout.trim());
    expect(range.baseLabel).toBe('main');
  });

  it('names a revision it cannot find', async () => {
    await expect(resolveRange(repo, 'nope..HEAD')).rejects.toThrow(/nope/);
  });
});

describe('loading a corpus at a revision', () => {
  it('reads the records as they stood, skipping the index file', async () => {
    const base = await loadCorpusAtRev(repo, 'main');
    expect(base.adrs.map((a) => a.id)).toEqual(['docs/adrs/0004-hashed-invoice-id.md']);
    expect(base.adrs[0]?.status).toBe('accepted');
  });

  it('gives records the same ids the working tree does', async () => {
    const head = await loadCorpusAtRev(repo, 'HEAD');
    const disk = await loadCorpus(dir);
    expect(head.adrs.map((a) => a.id).sort()).toEqual(disk.adrs.map((a) => a.id).sort());
  });

  it('reports the directories the current corpus uses, repository-relative', async () => {
    const disk = await loadCorpus(dir);
    expect([...knownDirs(disk, repo)]).toContain('docs/adrs');
  });
});

describe('diffing two revisions of a real repository', () => {
  it('reads a rename plus a supersession as one changed record and one addition', async () => {
    const base = await loadCorpusAtRev(repo, 'main');
    const head = await loadCorpusAtRev(repo, 'HEAD');
    const diff = diffCorpora(base, head);

    expect(diff.counts).toMatchObject({ added: 1, removed: 0, changed: 1 });

    const changed = diff.records.find((r) => r.number === 4);
    expect(changed?.previousId).toBe('docs/adrs/0004-hashed-invoice-id.md');
    expect(changed?.id).toBe('docs/adrs/0004-invoice-identity.md');
    expect(changed?.decisionHeld).toBe(true);
    expect(changed?.changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['status', 'relations', 'path']),
    );
  });
});
