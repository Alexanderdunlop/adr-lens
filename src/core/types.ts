/**
 * The normalised lifecycle state of a decision. Real corpora spell status a dozen
 * ways ("Accepted", "accepted ✅", "Accepted. Scope narrowed by TCK-1042"), so the
 * raw text is always kept alongside the normalised value.
 */
export type Status = 'proposed' | 'accepted' | 'rejected' | 'deprecated' | 'superseded' | 'unknown';

/** A `## Heading` block and the body text beneath it. */
export interface Section {
  /** Heading text with markdown stripped, e.g. `Context`. */
  title: string;
  /** Lowercased, punctuation-stripped title used for lookup, e.g. `context`. */
  key: string;
  /** Heading depth (2 for `##`, 3 for `###`). */
  depth: number;
  /**
   * Raw markdown body, excluding the heading line itself. Includes any nested
   * subsections, so `## Decision` carries everything under it.
   */
  body: string;
  /** 1-indexed line in the source file where the heading sits. */
  line: number;
  /** 1-indexed line just past the end of this section's content. */
  endLine: number;
}

/** A markdown link found in an ADR body. */
export interface Link {
  text: string;
  href: string;
  /** Set when the href resolves to another ADR in the same corpus. */
  targetId?: string;
  /** True when the href points at a local file that does not exist. */
  broken: boolean;
  /** The section the link appeared under, if any. */
  section?: string;
}

/**
 * How one ADR relates to another.
 *
 * Partial supersession is its own kind because mature corpora use it constantly
 * ("superseded in part by ADR-0065", "supersedes parts of ADR-0027") and
 * collapsing it into full supersession is actively misleading: the record is
 * still in force, and marking it dead sends readers to the wrong decision.
 */
export type RelationKind =
  | 'supersedes'
  | 'superseded-by'
  | 'supersedes-in-part'
  | 'superseded-in-part-by'
  | 'amends'
  | 'amended-by'
  | 'related';

/** The opposite direction of each relation, used to mirror edges across records. */
export const INVERSE_RELATION: Record<RelationKind, RelationKind> = {
  supersedes: 'superseded-by',
  'superseded-by': 'supersedes',
  'supersedes-in-part': 'superseded-in-part-by',
  'superseded-in-part-by': 'supersedes-in-part',
  amends: 'amended-by',
  'amended-by': 'amends',
  related: 'related',
};

export interface Relation {
  kind: RelationKind;
  targetId: string;
  /** The sentence the relation was inferred from, for display and debugging. */
  evidence?: string;
}

/**
 * A reference to another ADR before the corpus is known — either a file path
 * (`0012-thing.md`) or a bare number (`ADR-12`). Resolved to an id by the corpus.
 */
export interface RawRef {
  kind: 'path' | 'number';
  value: string;
}

export interface RawRelation {
  kind: RelationKind;
  ref: RawRef;
  evidence: string;
}

/**
 * The output of parsing a single file in isolation. Cross-ADR fields (`relations`,
 * `Link.targetId`, `Link.broken`) can only be filled in once every sibling file is
 * known, which is the corpus's job.
 */
export type ParsedAdr = Omit<Adr, 'relations'> & { rawRelations: RawRelation[] };

export interface Adr {
  /** Stable identifier: the corpus-relative path, e.g. `docs/adrs/0002-settlement.md`. */
  id: string;
  /** Absolute path on disk. */
  path: string;
  /** Parsed leading number, e.g. 2 for `0002-...md`. Null when unnumbered. */
  number: number | null;
  /** Zero-padded display number matching the file's own convention, e.g. `0002`. */
  numberLabel: string | null;
  title: string;
  status: Status;
  /** The status text exactly as written, including trailing prose. */
  statusRaw: string | null;
  /** ISO date string (`YYYY-MM-DD`) when one could be parsed. */
  date: string | null;
  /** Author line, when the format carries one. */
  author: string | null;
  sections: Section[];
  links: Link[];
  relations: Relation[];
  /** Full file contents. */
  raw: string;
  /** Body after the title line, with any metadata preamble left intact. */
  body: string;
  /**
   * `body` with a leading run of metadata field lines (`**Status:** …`, `Date: …`)
   * removed. Those facts are shown in the header, so repeating them at the top of
   * the rendered body is pure noise.
   */
  content: string;
  wordCount: number;
  /** Non-fatal parse observations, surfaced by `lint`. */
  warnings: string[];
}

/** An ADR plus everything only knowable by looking at the whole corpus. */
export interface AdrNode extends Adr {
  /** ADRs that link to this one. */
  inbound: string[];
  /** ADRs this one links to. */
  outbound: string[];
  /**
   * Relations other records declare *about* this one, mirrored into this node.
   * Kept separate from `relations` so it stays clear which record stated what.
   */
  mirrored: Relation[];
  /** Resolved full-supersession target. Partial supersession never sets this. */
  supersededBy: string | null;
  supersedes: string[];
}

export interface AdrDir {
  /** Absolute path of the directory holding the ADR files. */
  path: string;
  /** Path relative to the search root. */
  relative: string;
  count: number;
}
