import { basename, dirname } from 'node:path';
import type { Corpus } from './corpus.ts';
import { decisionLine } from './digest.ts';
import { sectionKey } from './parse.ts';
import type { AdrNode, RelationKind, Section, Status } from './types.ts';

/**
 * What happened to a record between two revisions.
 *
 * `unchanged` records are counted but never listed: a diff that reports the
 * things that did not happen is a listing, not a diff.
 */
export type ChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

/**
 * How much a change deserves the reader's attention.
 *
 * The whole point of the command is that a line diff cannot make this judgement.
 * `significant` changes what the record decides or whether it still holds;
 * `notable` changes how it is identified or structured; `minor` is wording.
 */
export type Significance = 'significant' | 'notable' | 'minor';

const SIGNIFICANCE_RANK: Record<Significance, number> = {
  significant: 0,
  notable: 1,
  minor: 2,
};

/** An edge to another record, added or removed. */
export interface RelationChange {
  kind: RelationKind;
  targetId: string;
  /** How the target is best referred to: `ADR-0009`, or its filename when unnumbered. */
  targetLabel: string;
  /**
   * False when the edge lives on the *other* record — this one became superseded
   * because something else was written, without being touched itself.
   */
  stated: boolean;
}

/**
 * One structured difference. A discriminated union rather than a pair of strings,
 * so every emitter — terminal, markdown, JSON — words it in its own register from
 * the same facts.
 */
export type Change =
  | {
      field: 'status';
      significance: Significance;
      before: Status;
      after: Status;
      beforeRaw: string | null;
      afterRaw: string | null;
    }
  | { field: 'decision'; significance: Significance; before: string | null; after: string | null }
  | {
      field: 'relations';
      significance: Significance;
      added: RelationChange[];
      removed: RelationChange[];
    }
  | { field: 'title'; significance: Significance; before: string; after: string }
  | {
      field: 'number';
      significance: Significance;
      before: number | null;
      after: number | null;
      beforeLabel: string | null;
      afterLabel: string | null;
    }
  | { field: 'path'; significance: Significance; before: string; after: string }
  | { field: 'sections'; significance: Significance; added: string[]; removed: string[] }
  | { field: 'wording'; significance: Significance; sections: string[] }
  | {
      field: 'date' | 'author';
      significance: Significance;
      before: string | null;
      after: string | null;
    };

/**
 * A record's semantic facts at one revision, for the two cases where there is
 * nothing to compare against: an addition has no before, a removal has no after.
 */
export interface RecordSnapshot {
  status: Status;
  statusRaw: string | null;
  decision: string | null;
  relations: RelationChange[];
}

export interface RecordDiff {
  kind: ChangeKind;
  /** The loudest change on the record. Added and removed records are always significant. */
  significance: Significance;
  /** Id on the head side, or the base side for a removal. */
  id: string;
  /** Set only when the record moved: its id on the base side. */
  previousId?: string;
  number: number | null;
  numberLabel: string | null;
  title: string;
  changes: Change[];
  /** The record as it stands (added) or as it stood (removed). Absent when changed. */
  snapshot?: RecordSnapshot;
  /**
   * The record's lifecycle moved but its decision sentence did not. Worth saying
   * out loud: "superseded, and the substance is untouched" is a different review
   * than "superseded, and rewritten".
   */
  decisionHeld: boolean;
}

export interface DiffCounts {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  significant: number;
  notable: number;
  minor: number;
}

export interface CorpusDiff {
  /** Added, removed, and changed records, loudest first. */
  records: RecordDiff[];
  counts: DiffCounts;
}

/**
 * Compare two revisions of a corpus.
 *
 * Nothing here reads text as text: the fields being compared have already been
 * parsed into status, decision, relations, and sections, so re-wrapping a
 * paragraph moves nothing and a one-word change to a decision moves everything.
 */
export function diffCorpora(base: Corpus, head: Corpus): CorpusDiff {
  const { pairs, added, removed } = matchRecords(base.adrs, head.adrs);

  // Base ids translated to their head-side spelling, so an edge pointing at a
  // renamed record does not read as one edge removed and another added.
  const renames = new Map<string, string>();
  for (const [before, after] of pairs) {
    if (before.id !== after.id) renames.set(before.id, after.id);
  }

  const labels = new Map<string, string>();
  for (const adr of [...base.adrs, ...head.adrs]) {
    labels.set(renames.get(adr.id) ?? adr.id, referenceLabel(adr));
  }

  const records: RecordDiff[] = [];
  const counts: DiffCounts = {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
    significant: 0,
    notable: 0,
    minor: 0,
  };

  for (const adr of added) {
    records.push({
      kind: 'added',
      significance: 'significant',
      id: adr.id,
      number: adr.number,
      numberLabel: adr.numberLabel,
      title: adr.title,
      changes: [],
      snapshot: snapshotOf(adr, (id) => id, labels),
      decisionHeld: false,
    });
    counts.added++;
  }

  for (const adr of removed) {
    records.push({
      kind: 'removed',
      significance: 'significant',
      id: adr.id,
      number: adr.number,
      numberLabel: adr.numberLabel,
      title: adr.title,
      changes: [],
      snapshot: snapshotOf(adr, (id) => renames.get(id) ?? id, labels),
      decisionHeld: false,
    });
    counts.removed++;
  }

  for (const [before, after] of pairs) {
    const changes = compareRecords(before, after, renames, labels);
    if (changes.length === 0) {
      counts.unchanged++;
      continue;
    }

    const significance = loudest(changes);
    const decisionBefore = decisionLine(before);
    records.push({
      kind: 'changed',
      significance,
      id: after.id,
      ...(before.id === after.id ? {} : { previousId: before.id }),
      number: after.number,
      numberLabel: after.numberLabel,
      title: after.title,
      changes,
      decisionHeld:
        significance === 'significant' &&
        decisionBefore !== null &&
        !changes.some((c) => c.field === 'decision'),
    });
    counts.changed++;
  }

  for (const record of records) counts[record.significance]++;

  records.sort(
    (a, b) =>
      SIGNIFICANCE_RANK[a.significance] - SIGNIFICANCE_RANK[b.significance] ||
      compareByNumber(a, b),
  );

  return { records, counts };
}

/* -------------------------------------------------------------------- matching */

/**
 * Pair up the two sides.
 *
 * Ordered passes, first match wins, each record consumed once. The order matters:
 * a rename plus an edit has to read as one changed record rather than a deletion
 * and an addition, and the number is the only identity an ADR really has — but
 * numbers repeat across directories, so the path has to break the tie.
 */
export function matchRecords(
  base: AdrNode[],
  head: AdrNode[],
): { pairs: Array<[AdrNode, AdrNode]>; added: AdrNode[]; removed: AdrNode[] } {
  const pairs: Array<[AdrNode, AdrNode]> = [];
  const availableBase = new Set(base);
  const remainingHead: AdrNode[] = [];

  const take = (candidate: AdrNode | undefined, node: AdrNode): boolean => {
    if (!candidate || !availableBase.has(candidate)) return false;
    availableBase.delete(candidate);
    pairs.push([candidate, node]);
    return true;
  };

  // 1. Same path. The overwhelming majority, and free.
  const byId = new Map(base.map((adr) => [adr.id, adr]));
  for (const node of head) {
    if (!take(byId.get(node.id), node)) remainingHead.push(node);
  }

  // 2. Same number in the same directory. Numbering is per-directory in practice,
  //    so this is the identity that survives a rename.
  const stillRemaining = passOn(remainingHead, (node) =>
    take(
      pick(
        [...availableBase].filter(
          (adr) => adr.number !== null && adr.number === node.number && sameDir(adr, node),
        ),
        node,
      ),
      node,
    ),
  );

  // 3. Same number anywhere, when that is unambiguous on both sides.
  const afterNumber = passOn(stillRemaining, (node) => {
    if (node.number === null) return false;
    const candidates = [...availableBase].filter((adr) => adr.number === node.number);
    const rivals = stillRemaining.filter((other) => other.number === node.number);
    if (candidates.length !== 1 || rivals.length !== 1) return false;
    return take(candidates[0], node);
  });

  // 4. Same title. Catches a renumber, where every other identity has moved.
  const afterTitle = passOn(afterNumber, (node) => {
    const key = normalise(node.title);
    if (!key) return false;
    const candidates = [...availableBase].filter((adr) => normalise(adr.title) === key);
    if (candidates.length === 0) return false;
    return take(pick(candidates, node), node);
  });

  return {
    pairs,
    added: afterTitle,
    removed: [...availableBase],
  };
}

/** Run a pass over the unmatched records, returning those it did not claim. */
function passOn(nodes: AdrNode[], attempt: (node: AdrNode) => boolean): AdrNode[] {
  const left: AdrNode[] = [];
  for (const node of nodes) if (!attempt(node)) left.push(node);
  return left;
}

/** Break a tie between same-number candidates: same filename, then same title. */
function pick(candidates: AdrNode[], node: AdrNode): AdrNode | undefined {
  if (candidates.length <= 1) return candidates[0];
  const sameName = candidates.find((adr) => basename(adr.id) === basename(node.id));
  if (sameName) return sameName;
  const sameTitle = candidates.find((adr) => normalise(adr.title) === normalise(node.title));
  if (sameTitle) return sameTitle;
  const sameDirectory = candidates.find((adr) => sameDir(adr, node));
  return sameDirectory ?? candidates[0];
}

function sameDir(a: AdrNode, b: AdrNode): boolean {
  return dirname(a.id) === dirname(b.id);
}

/* ------------------------------------------------------------------ comparison */

function compareRecords(
  before: AdrNode,
  after: AdrNode,
  renames: Map<string, string>,
  labels: Map<string, string>,
): Change[] {
  const changes: Change[] = [];

  if (before.status !== after.status) {
    changes.push({
      field: 'status',
      significance: 'significant',
      before: before.status,
      after: after.status,
      beforeRaw: before.statusRaw,
      afterRaw: after.statusRaw,
    });
  } else if (normalise(before.statusRaw ?? '') !== normalise(after.statusRaw ?? '')) {
    // The lifecycle held, but the qualifying prose did not — "Accepted. Scope
    // narrowed by TCK-1042" is a fact no other field carries.
    changes.push({
      field: 'status',
      significance: 'notable',
      before: before.status,
      after: after.status,
      beforeRaw: before.statusRaw,
      afterRaw: after.statusRaw,
    });
  }

  const decisionBefore = decisionLine(before);
  const decisionAfter = decisionLine(after);
  if (normalise(decisionBefore ?? '') !== normalise(decisionAfter ?? '')) {
    changes.push({
      field: 'decision',
      significance: 'significant',
      before: decisionBefore,
      after: decisionAfter,
    });
  }

  const relations = compareRelations(before, after, renames, labels);
  if (relations) changes.push(relations);

  if (normalise(before.title) !== normalise(after.title)) {
    changes.push({
      field: 'title',
      significance: 'notable',
      before: before.title,
      after: after.title,
    });
  }

  if (before.number !== after.number) {
    changes.push({
      field: 'number',
      significance: 'notable',
      before: before.number,
      after: after.number,
      beforeLabel: before.numberLabel,
      afterLabel: after.numberLabel,
    });
  }

  if (before.id !== after.id) {
    changes.push({ field: 'path', significance: 'notable', before: before.id, after: after.id });
  }

  // A status or decision change has already been reported in full, so counting
  // the section it lives in as "reworded" says the same thing again, more vaguely.
  const covered = new Set(
    changes
      .filter((c) => c.field === 'status' || c.field === 'decision')
      .map((c) => sectionKey(c.field)),
  );
  changes.push(...compareSections(before, after, covered));

  if (before.date !== after.date) {
    changes.push({
      field: 'date',
      significance: 'minor',
      before: before.date,
      after: after.date,
    });
  }

  if (normalise(before.author ?? '') !== normalise(after.author ?? '')) {
    changes.push({
      field: 'author',
      significance: 'minor',
      before: before.author,
      after: after.author,
    });
  }

  return changes;
}

/**
 * Edges gained and lost, counting both the ones this record states and the ones
 * other records state about it. The mirrored half matters most in review: adding
 * a record that supersedes an old one changes the old one's standing without
 * touching its file, and a line diff cannot show that at all.
 */
function compareRelations(
  before: AdrNode,
  after: AdrNode,
  renames: Map<string, string>,
  labels: Map<string, string>,
): Change | null {
  const beforeEdges = edgeMap(before, (id) => renames.get(id) ?? id);
  const afterEdges = edgeMap(after, (id) => id);

  const toChange = (key: string, stated: boolean): RelationChange => {
    const [kind, targetId] = splitKey(key);
    return { kind, targetId, targetLabel: labels.get(targetId) ?? basename(targetId), stated };
  };

  const gained: RelationChange[] = [];
  const lost: RelationChange[] = [];
  for (const [key, stated] of afterEdges)
    if (!beforeEdges.has(key)) gained.push(toChange(key, stated));
  for (const [key, stated] of beforeEdges)
    if (!afterEdges.has(key)) lost.push(toChange(key, stated));

  // A gained supersession usually gains a bare cross-reference with it, from the
  // same markdown link. Reporting both says the same thing twice.
  const added = withoutRedundantRelated(gained);
  const removed = withoutRedundantRelated(lost);

  if (added.length === 0 && removed.length === 0) return null;

  // A supersession decides whether the record still holds; `related` is a
  // cross-reference, which is worth listing but never worth leading with.
  const structural = [...added, ...removed].some((r) => r.kind !== 'related');

  return {
    field: 'relations',
    significance: structural ? 'significant' : 'notable',
    added,
    removed,
  };
}

function snapshotOf(
  adr: AdrNode,
  canonical: (id: string) => string,
  labels: Map<string, string>,
): RecordSnapshot {
  const relations: RelationChange[] = [];
  for (const [key, stated] of edgeMap(adr, canonical)) {
    const [kind, targetId] = splitKey(key);
    relations.push({
      kind,
      targetId,
      targetLabel: labels.get(targetId) ?? basename(targetId),
      stated,
    });
  }

  return {
    status: adr.status,
    statusRaw: adr.statusRaw,
    decision: decisionLine(adr),
    relations: withoutRedundantRelated(relations),
  };
}

/**
 * A supersession is almost always written as a markdown link, which also reads as
 * a plain cross-reference — so the same pair of records shows up twice, once
 * meaningfully. Keep the meaningful one.
 */
function withoutRedundantRelated(edges: RelationChange[]): RelationChange[] {
  const stronger = new Set(
    edges.filter((edge) => edge.kind !== 'related').map((edge) => edge.targetId),
  );
  return edges.filter((edge) => edge.kind !== 'related' || !stronger.has(edge.targetId));
}

/** Every edge touching a record, keyed `kind|target`, valued by who stated it. */
function edgeMap(adr: AdrNode, canonical: (id: string) => string): Map<string, boolean> {
  const edges = new Map<string, boolean>();
  for (const relation of adr.relations) {
    edges.set(`${relation.kind}|${canonical(relation.targetId)}`, true);
  }
  for (const relation of adr.mirrored) {
    const key = `${relation.kind}|${canonical(relation.targetId)}`;
    if (!edges.has(key)) edges.set(key, false);
  }
  return edges;
}

function splitKey(key: string): [RelationKind, string] {
  const index = key.indexOf('|');
  return [key.slice(0, index) as RelationKind, key.slice(index + 1)];
}

/**
 * Which sections came, went, and were rewritten.
 *
 * Only the outermost heading level is compared. A section's body carries its
 * subsections, so counting both levels would report one edit twice — and
 * "Context reworded" is the useful granularity anyway.
 */
function compareSections(before: AdrNode, after: AdrNode, covered: ReadonlySet<string>): Change[] {
  const beforeSections = outermost(before.sections);
  const afterSections = outermost(after.sections);

  const added: string[] = [];
  const removed: string[] = [];
  const reworded: string[] = [];

  for (const [key, section] of afterSections) {
    const previous = beforeSections.get(key);
    if (!previous) added.push(section.title);
    else if (covered.has(key)) continue;
    else if (normalise(previous.body) !== normalise(section.body)) reworded.push(section.title);
  }
  for (const [key, section] of beforeSections) {
    if (!afterSections.has(key)) removed.push(section.title);
  }

  const changes: Change[] = [];
  if (added.length > 0 || removed.length > 0) {
    changes.push({
      // Losing a section loses reasoning; gaining one only adds it.
      significance: removed.length > 0 ? 'significant' : 'notable',
      field: 'sections',
      added,
      removed,
    });
  }
  if (reworded.length > 0) {
    changes.push({ field: 'wording', significance: 'minor', sections: reworded });
  }
  return changes;
}

function outermost(sections: Section[]): Map<string, Section> {
  const depth = sections.length > 0 ? Math.min(...sections.map((s) => s.depth)) : 0;
  const map = new Map<string, Section>();
  for (const section of sections) {
    if (section.depth !== depth) continue;
    if (!map.has(section.key)) map.set(section.key, section);
  }
  return map;
}

/* ------------------------------------------------------------------- internals */

function loudest(changes: Change[]): Significance {
  let rank = SIGNIFICANCE_RANK.minor;
  for (const change of changes) rank = Math.min(rank, SIGNIFICANCE_RANK[change.significance]);
  return (['significant', 'notable', 'minor'] as const)[rank] ?? 'minor';
}

function compareByNumber(a: RecordDiff, b: RecordDiff): number {
  if (a.number !== null && b.number !== null && a.number !== b.number) return a.number - b.number;
  if (a.number === null && b.number !== null) return 1;
  if (a.number !== null && b.number === null) return -1;
  return a.id.localeCompare(b.id);
}

/** How a record is best referred to when it is the target of an edge. */
export function referenceLabel(adr: AdrNode): string {
  return adr.numberLabel ? `ADR-${adr.numberLabel}` : basename(adr.id, '.md');
}

/**
 * Collapse whitespace so that re-wrapping a paragraph — the single biggest source
 * of noise in a line diff of an ADR — compares equal.
 */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
