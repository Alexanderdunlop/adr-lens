/**
 * Programmatic entry point. The core is deliberately free of terminal concerns so
 * it can back other surfaces — a web view, an editor plugin, or an MCP server
 * exposing the same corpus to an agent.
 */

export type { DiffRenderOptions } from './commands/diff.ts';
export { diffToJson, renderDiff } from './commands/diff.ts';
export type { Finding, LintOptions, Severity } from './commands/lint.ts';
export { lintCorpus, lintExitCode } from './commands/lint.ts';
export type { Corpus, LoadOptions } from './core/corpus.ts';
export { buildCorpus, compareAdrs, loadCorpus, loadCorpusFromDirs } from './core/corpus.ts';
export type {
  Change,
  ChangeKind,
  CorpusDiff,
  DiffCounts,
  RecordDiff,
  RecordSnapshot,
  RelationChange,
  Significance,
} from './core/diff.ts';
export { diffCorpora, matchRecords, referenceLabel } from './core/diff.ts';
export {
  ageInDays,
  currentVersion,
  decisionLine,
  findSection,
  formatAge,
  influence,
  isOrphan,
  readingMinutes,
  supersessionChain,
} from './core/digest.ts';
export { ADR_DIR_NAMES, discoverAdrDirs, isAdrFile, isAdrPath } from './core/discover.ts';
export type { Repo, RevRange } from './core/git.ts';
export { GitError, knownDirs, loadCorpusAtRev, openRepo, resolveRange } from './core/git.ts';
export type { ParseOptions } from './core/parse.ts';
export { maskCodeFences, parseAdr, sectionKey, stripInline } from './core/parse.ts';
export type { Scored, SearchFilters } from './core/search.ts';
export { search } from './core/search.ts';
export { isLive, normaliseStatus, STATUS_ORDER } from './core/status.ts';
export type {
  Adr,
  AdrDir,
  AdrNode,
  Link,
  ParsedAdr,
  RawRef,
  RawRelation,
  Relation,
  RelationKind,
  Section,
  Status,
} from './core/types.ts';
export { INVERSE_RELATION } from './core/types.ts';
export type { RenderOptions } from './render/markdown.ts';
export { renderMarkdown } from './render/markdown.ts';
