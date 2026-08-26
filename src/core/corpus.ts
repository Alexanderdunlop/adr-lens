import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { discoverAdrDirs, isAdrFile } from './discover.ts';
import { parseAdr } from './parse.ts';
import type { AdrDir, AdrNode, ParsedAdr, RawRef, Relation, RelationKind } from './types.ts';
import { INVERSE_RELATION } from './types.ts';

export interface Corpus {
  /** The directories the records were loaded from. */
  dirs: AdrDir[];
  /** Every record, in stable order (by number, then id). */
  adrs: AdrNode[];
  byId: Map<string, AdrNode>;
  /** Numbers that appear on more than one record. */
  duplicateNumbers: Map<number, string[]>;
  /** Relation refs that pointed at nothing resolvable. */
  danglingRefs: Array<{ from: string; ref: RawRef; evidence: string; kind: RelationKind }>;
}

export interface LoadOptions {
  /** How deep to search for ADR directories. */
  maxDepth?: number;
}

/** Load every ADR under `root`, discovering the conventional directories. */
export async function loadCorpus(root: string, options: LoadOptions = {}): Promise<Corpus> {
  const dirs = await discoverAdrDirs(root, options.maxDepth);
  return loadCorpusFromDirs(dirs, root);
}

export async function loadCorpusFromDirs(dirs: AdrDir[], root: string): Promise<Corpus> {
  const absoluteRoot = resolve(root);
  const parsed: ParsedAdr[] = [];

  for (const dir of dirs) {
    const entries = await readdir(dir.path, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && isAdrFile(e.name))
      .map((e) => e.name)
      .sort();

    for (const name of files) {
      const path = join(dir.path, name);
      const raw = await readFile(path, 'utf8');
      const id = relative(absoluteRoot, path) || name;
      parsed.push(parseAdr(raw, { id, path }));
    }
  }

  return buildCorpus(parsed, dirs);
}

/** Assemble the cross-record view: resolve links, relations, and inbound edges. */
export function buildCorpus(parsed: ParsedAdr[], dirs: AdrDir[] = []): Corpus {
  // `rawRelations` is carried on the working nodes so relations can be resolved in
  // place, then dropped from the public shape once every edge is known.
  type WorkingNode = AdrNode & { rawRelations: ParsedAdr['rawRelations'] };

  const nodes: WorkingNode[] = parsed.map((adr) => ({
    ...adr,
    relations: [],
    inbound: [],
    outbound: [],
    mirrored: [],
    supersededBy: null,
    supersedes: [],
  }));

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const index = buildIndex(nodes);
  const danglingRefs: Corpus['danglingRefs'] = [];

  for (const node of nodes) {
    // Resolve markdown links to sibling records and flag dead local paths.
    for (const link of node.links) {
      if (isExternal(link.href)) continue;
      const target = resolveHref(node, link.href, byId, index);
      if (target) link.targetId = target;
      else if (isLocalPath(link.href)) {
        link.broken = !existsSync(resolve(dirname(node.path), stripAnchor(link.href)));
      }
    }

    // Resolve inferred relations.
    const relations: Relation[] = [];
    for (const raw of node.rawRelations) {
      const targetId = resolveRef(node, raw.ref, byId, index);
      if (!targetId) {
        danglingRefs.push({
          from: node.id,
          ref: raw.ref,
          evidence: raw.evidence,
          kind: raw.kind,
        });
        continue;
      }
      if (targetId === node.id) continue; // a record referring to itself is noise
      if (relations.some((r) => r.kind === raw.kind && r.targetId === targetId)) continue;
      relations.push({ kind: raw.kind, targetId, evidence: raw.evidence });
    }
    node.relations = relations;
  }

  // Mirror every stated relation onto its target, so either half of a pair is
  // enough to see the whole edge — authors usually write only one side.
  for (const node of nodes) {
    for (const relation of node.relations) {
      const target = byId.get(relation.targetId);
      if (!target) continue;
      const kind = INVERSE_RELATION[relation.kind];
      if (target.mirrored.some((r) => r.kind === kind && r.targetId === node.id)) continue;
      target.mirrored.push({ kind, targetId: node.id, evidence: relation.evidence });
    }
  }

  // Partiality claimed by either side wins, and must settle *before* the
  // supersession fields are derived — otherwise a full `supersedes` on one
  // record would resurrect the total-replacement reading on the other.
  for (const node of nodes) {
    const partial = new Set(
      [...node.relations, ...node.mirrored]
        .filter((r) => r.kind === 'superseded-in-part-by')
        .map((r) => r.targetId),
    );
    if (partial.size === 0) continue;

    node.relations = node.relations.map((r) =>
      r.kind === 'superseded-by' && partial.has(r.targetId)
        ? { ...r, kind: 'superseded-in-part-by' }
        : r,
    );

    for (const targetId of partial) {
      const target = byId.get(targetId);
      if (!target) continue;
      target.relations = target.relations.map((r) =>
        r.kind === 'supersedes' && r.targetId === node.id
          ? { ...r, kind: 'supersedes-in-part' }
          : r,
      );
      target.mirrored = target.mirrored.map((r) =>
        r.kind === 'supersedes' && r.targetId === node.id
          ? { ...r, kind: 'supersedes-in-part' }
          : r,
      );
    }
  }

  // Only now derive edges and the full-supersession fields.
  for (const node of nodes) {
    const outbound = new Set<string>();
    for (const link of node.links) if (link.targetId) outbound.add(link.targetId);
    for (const relation of node.relations) outbound.add(relation.targetId);
    outbound.delete(node.id);
    node.outbound = [...outbound].sort();

    node.supersededBy = node.relations.find((r) => r.kind === 'superseded-by')?.targetId ?? null;
    node.supersedes = node.relations.filter((r) => r.kind === 'supersedes').map((r) => r.targetId);
  }

  for (const node of nodes) {
    for (const targetId of node.outbound) {
      const target = byId.get(targetId);
      if (target && !target.inbound.includes(node.id)) target.inbound.push(node.id);
    }
  }

  for (const node of nodes) {
    if (node.supersededBy) {
      const target = byId.get(node.supersededBy);
      if (target && !target.supersedes.includes(node.id)) target.supersedes.push(node.id);
    }
    for (const supersededId of node.supersedes) {
      const target = byId.get(supersededId);
      if (target && target.supersededBy === null) target.supersededBy = node.id;
    }
  }

  for (const node of nodes) node.inbound.sort();

  nodes.sort(compareAdrs);

  const duplicateNumbers = new Map<number, string[]>();
  const groups = new Map<number, string[]>();
  for (const node of nodes) {
    if (node.number === null) continue;
    const list = groups.get(node.number) ?? [];
    list.push(node.id);
    groups.set(node.number, list);
  }
  for (const [number, ids] of groups) {
    if (ids.length > 1) duplicateNumbers.set(number, ids);
  }

  return { dirs, adrs: nodes, byId, duplicateNumbers, danglingRefs };
}

export function compareAdrs(a: AdrNode, b: AdrNode): number {
  if (a.number !== null && b.number !== null && a.number !== b.number) return a.number - b.number;
  if (a.number === null && b.number !== null) return 1;
  if (a.number !== null && b.number === null) return -1;
  return a.id.localeCompare(b.id);
}

/* ------------------------------------------------------------------ resolution */

interface Index {
  /** Absolute path → id. */
  byPath: Map<string, string>;
  /** Lowercased basename → ids. */
  byBasename: Map<string, string[]>;
  /** Number → ids, scoped per directory so numbering can repeat across repos. */
  byNumberInDir: Map<string, string[]>;
  /** Number → ids across the whole corpus, used only when unambiguous. */
  byNumber: Map<number, string[]>;
}

function buildIndex(nodes: AdrNode[]): Index {
  const byPath = new Map<string, string>();
  const byBasename = new Map<string, string[]>();
  const byNumberInDir = new Map<string, string[]>();
  const byNumber = new Map<number, string[]>();

  for (const node of nodes) {
    byPath.set(resolve(node.path), node.id);
    push(byBasename, basename(node.path).toLowerCase(), node.id);
    if (node.number !== null) {
      push(byNumberInDir, `${dirname(node.path)}#${node.number}`, node.id);
      push(byNumber, node.number, node.id);
    }
  }

  return { byPath, byBasename, byNumberInDir, byNumber };
}

function push<K>(map: Map<K, string[]>, key: K, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function resolveHref(
  from: AdrNode,
  href: string,
  byId: Map<string, AdrNode>,
  index: Index,
): string | undefined {
  const clean = stripAnchor(href);
  if (!clean || !clean.toLowerCase().endsWith('.md')) return undefined;

  // Relative path from the linking file is the common case and the most precise.
  const exact = index.byPath.get(resolve(dirname(from.path), clean));
  if (exact) return exact;

  return pickSameDir(from, index.byBasename.get(basename(clean).toLowerCase()), byId);
}

function resolveRef(
  from: AdrNode,
  ref: RawRef,
  byId: Map<string, AdrNode>,
  index: Index,
): string | undefined {
  if (ref.kind === 'path') {
    const direct = resolveHref(from, ref.value, byId, index);
    if (direct) return direct;
    return pickSameDir(from, index.byBasename.get(basename(ref.value).toLowerCase()), byId);
  }

  const number = Number.parseInt(ref.value, 10);
  if (Number.isNaN(number)) return undefined;

  // Prefer a match in the same directory — `ADR-12` inside one service means that
  // service's twelfth decision, not another repo's.
  const sameDir = index.byNumberInDir.get(`${dirname(from.path)}#${number}`);
  if (sameDir?.length === 1) return sameDir[0];
  if (sameDir && sameDir.length > 1) return sameDir.filter((id) => id !== from.id)[0];

  const anywhere = index.byNumber.get(number);
  return anywhere?.length === 1 ? anywhere[0] : undefined;
}

/** Disambiguate same-basename candidates by preferring the linker's own directory. */
function pickSameDir(
  from: AdrNode,
  candidates: string[] | undefined,
  byId: Map<string, AdrNode>,
): string | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const dir = dirname(from.path);
  const local = candidates.find((id) => dirname(byId.get(id)?.path ?? '') === dir);
  return local ?? candidates[0];
}

function stripAnchor(href: string): string {
  return href.split('#')[0]!.split('?')[0]!;
}

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#');
}

function isLocalPath(href: string): boolean {
  return !isExternal(href) && !href.startsWith('mailto:');
}
