import { basename, dirname } from 'node:path';
import type { Corpus } from '../core/corpus.ts';
import { isOrphan } from '../core/digest.ts';
import type { AdrNode } from '../core/types.ts';
import { truncateToWidth } from '../render/inline.ts';
import { theme } from '../render/theme.ts';
import type { CommandContext } from './context.ts';

export type Severity = 'error' | 'warn' | 'info';

export interface Finding {
  severity: Severity;
  /** Stable machine-readable code, e.g. `duplicate-number`. */
  rule: string;
  /** The record the finding is attached to, or null for corpus-level findings. */
  adrId: string | null;
  message: string;
  /** Extra lines shown indented beneath the message. */
  detail?: string[];
}

export interface LintOptions {
  /** Include informational findings (orphans, missing sections). */
  all?: boolean;
}

/**
 * Checks are ordered by how much damage the problem does to a reader: a broken
 * link or a duplicate number actively misleads; a missing date is untidy.
 */
export function lintCorpus(corpus: Corpus, options: LintOptions = {}): Finding[] {
  const findings: Finding[] = [];

  findings.push(...duplicateNumbers(corpus));
  findings.push(...numberGaps(corpus));
  findings.push(...brokenLinks(corpus));
  findings.push(...danglingReferences(corpus));
  findings.push(...supersessionProblems(corpus));
  findings.push(...missingMetadata(corpus));

  if (options.all) {
    findings.push(...missingSections(corpus));
    findings.push(...orphans(corpus));
  }

  const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  return findings.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.adrId ?? '').localeCompare(b.adrId ?? ''),
  );
}

function duplicateNumbers(corpus: Corpus): Finding[] {
  const findings: Finding[] = [];

  for (const [number, ids] of corpus.duplicateNumbers) {
    // Numbering is per-directory in practice, so only flag collisions inside the
    // same directory — two repos both having an 0005 is expected.
    const byDir = new Map<string, string[]>();
    for (const id of ids) {
      const dir = dirname(id);
      byDir.set(dir, [...(byDir.get(dir) ?? []), id]);
    }

    for (const [dir, collisions] of byDir) {
      if (collisions.length < 2) continue;
      findings.push({
        severity: 'error',
        rule: 'duplicate-number',
        adrId: collisions[0]!,
        message: `Number ${number} is used by ${collisions.length} records in ${dir}`,
        detail: collisions.map((id) => basename(id)),
      });
    }
  }

  return findings;
}

function numberGaps(corpus: Corpus): Finding[] {
  const findings: Finding[] = [];
  const byDir = new Map<string, number[]>();

  for (const adr of corpus.adrs) {
    if (adr.number === null) continue;
    const dir = dirname(adr.id);
    byDir.set(dir, [...(byDir.get(dir) ?? []), adr.number]);
  }

  for (const [dir, numbers] of byDir) {
    const present = new Set(numbers);
    const max = Math.max(...numbers);
    const min = Math.min(...numbers);
    const missing: number[] = [];
    for (let n = min; n < max; n++) if (!present.has(n)) missing.push(n);
    if (missing.length === 0) continue;

    findings.push({
      severity: 'info',
      rule: 'number-gap',
      adrId: null,
      // A gap usually means a record was deleted rather than superseded, which
      // loses the reasoning — worth knowing, not worth failing over.
      message: `${dir}: ${missing.length} gap${missing.length === 1 ? '' : 's'} in numbering`,
      detail: [missing.map((n) => String(n).padStart(4, '0')).join(', ')],
    });
  }

  return findings;
}

function brokenLinks(corpus: Corpus): Finding[] {
  const findings: Finding[] = [];

  for (const adr of corpus.adrs) {
    const broken = adr.links.filter((link) => link.broken);
    if (broken.length === 0) continue;
    findings.push({
      severity: 'error',
      rule: 'broken-link',
      adrId: adr.id,
      message: `${broken.length} broken local link${broken.length === 1 ? '' : 's'}`,
      detail: broken.map((link) => `${link.href}${link.section ? `  (in ${link.section})` : ''}`),
    });
  }

  return findings;
}

function danglingReferences(corpus: Corpus): Finding[] {
  const grouped = new Map<string, string[]>();

  for (const { from, ref, evidence, kind } of corpus.danglingRefs) {
    // A `## Related` bullet routinely points at plans, RFCs, and other services'
    // records. Only an unresolvable *supersession* actually strands the reader,
    // because it promises a replacement decision that cannot be found.
    if (kind === 'related') continue;

    const list = grouped.get(from) ?? [];
    list.push(
      `${ref.kind === 'number' ? `ADR-${ref.value}` : ref.value} — “${truncate(evidence)}”`,
    );
    grouped.set(from, list);
  }

  return [...grouped].map(([adrId, detail]) => ({
    severity: 'warn' as Severity,
    rule: 'dangling-reference',
    adrId,
    message: `References ${detail.length} record${detail.length === 1 ? '' : 's'} that could not be resolved`,
    detail,
  }));
}

function supersessionProblems(corpus: Corpus): Finding[] {
  const findings: Finding[] = [];

  for (const adr of corpus.adrs) {
    // A record marked superseded with no target leaves the reader stranded.
    if (adr.status === 'superseded' && !adr.supersededBy) {
      findings.push({
        severity: 'warn',
        rule: 'superseded-without-target',
        adrId: adr.id,
        message: 'Status is superseded but no replacement record could be identified',
        detail: adr.statusRaw ? [adr.statusRaw] : undefined,
      });
    }

    // The reverse: a live-looking record that something else claims to replace.
    if (adr.supersededBy && adr.status !== 'superseded' && adr.status !== 'deprecated') {
      const target = corpus.byId.get(adr.supersededBy);
      findings.push({
        severity: 'warn',
        rule: 'stale-status',
        adrId: adr.id,
        message: `Reads as ${adr.status} but is superseded by ${target?.numberLabel ?? adr.supersededBy}`,
      });
    }

    // Mutual supersession is a genuine contradiction.
    if (adr.supersededBy) {
      const target = corpus.byId.get(adr.supersededBy);
      if (target?.supersededBy === adr.id) {
        findings.push({
          severity: 'error',
          rule: 'supersession-cycle',
          adrId: adr.id,
          message: `Mutual supersession with ${target.numberLabel ?? target.id}`,
        });
      }
    }
  }

  return findings;
}

function missingMetadata(corpus: Corpus): Finding[] {
  const findings: Finding[] = [];

  for (const adr of corpus.adrs) {
    if (adr.status === 'unknown') {
      findings.push({
        severity: 'warn',
        rule: 'no-status',
        adrId: adr.id,
        message: adr.statusRaw
          ? `Status “${truncate(adr.statusRaw, 60)}” is not recognised`
          : 'No status',
      });
    }
    if (!adr.date) {
      findings.push({
        severity: 'info',
        rule: 'no-date',
        adrId: adr.id,
        message: 'No date',
      });
    }
  }

  return findings;
}

const EXPECTED_SECTIONS = ['context', 'decision'];

function missingSections(corpus: Corpus): Finding[] {
  const findings: Finding[] = [];

  for (const adr of corpus.adrs) {
    const present = new Set(adr.sections.map((s) => s.key.split(' ')[0]!));
    const missing = EXPECTED_SECTIONS.filter((key) => !present.has(key));
    if (missing.length === 0) continue;
    findings.push({
      severity: 'info',
      rule: 'missing-section',
      adrId: adr.id,
      message: `Missing section${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
    });
  }

  return findings;
}

function orphans(corpus: Corpus): Finding[] {
  return corpus.adrs.filter(isOrphan).map((adr) => ({
    severity: 'info' as Severity,
    rule: 'orphan',
    adrId: adr.id,
    message: 'Not referenced by, and does not reference, any other record',
  }));
}

/* -------------------------------------------------------------------- reporting */

export function renderLint(
  context: CommandContext,
  findings: Finding[],
  options: LintOptions = {},
): string[] {
  const out: string[] = [];
  const counts = tally(findings);

  if (findings.length === 0) {
    out.push(theme.ok('✓ No problems found.'));
    if (!options.all) out.push(theme.dim('  (run with --all for informational checks)'));
    return out;
  }

  const byId = context.corpus.byId;
  let lastId: string | null | undefined;

  for (const finding of findings) {
    if (finding.adrId !== lastId) {
      out.push('');
      const adr = finding.adrId ? byId.get(finding.adrId) : undefined;
      out.push(adr ? theme.h3(heading(adr)) : theme.h3('Corpus'));
      lastId = finding.adrId;
    }

    out.push(`  ${severityGlyph(finding.severity)} ${finding.message} ${theme.dim(finding.rule)}`);
    for (const line of finding.detail ?? []) {
      out.push(`      ${theme.dim(truncateToWidth(line, Math.max(20, context.width - 6)))}`);
    }
  }

  out.push('');
  out.push(theme.rule('─'.repeat(context.width)));
  out.push(summary(counts));
  if (!options.all) out.push(theme.dim('Run with --all to include informational checks.'));

  return out;
}

function heading(adr: AdrNode): string {
  return `${adr.numberLabel ?? '—'} ${adr.title}  ${theme.dim(dirname(adr.id))}`;
}

function severityGlyph(severity: Severity): string {
  if (severity === 'error') return theme.error('✕');
  if (severity === 'warn') return theme.warn('▲');
  return theme.dim('·');
}

function tally(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) counts[finding.severity]++;
  return counts;
}

function summary(counts: Record<Severity, number>): string {
  const parts: string[] = [];
  if (counts.error)
    parts.push(theme.error(`${counts.error} error${counts.error === 1 ? '' : 's'}`));
  if (counts.warn) parts.push(theme.warn(`${counts.warn} warning${counts.warn === 1 ? '' : 's'}`));
  if (counts.info) parts.push(theme.dim(`${counts.info} note${counts.info === 1 ? '' : 's'}`));
  return parts.length > 0 ? parts.join(theme.dim(' · ')) : theme.ok('clean');
}

/** Exit code: non-zero only for errors, so `lint` is safe to put in CI. */
export function lintExitCode(findings: Finding[]): number {
  return findings.some((f) => f.severity === 'error') ? 1 : 0;
}

function truncate(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
