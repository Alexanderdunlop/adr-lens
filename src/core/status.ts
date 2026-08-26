import type { Status } from './types.ts';

const STATUS_PATTERNS: ReadonlyArray<[RegExp, Status]> = [
  [/^supersed(ed|es)?\b/, 'superseded'],
  [/^(accepted|approved|adopted|active|done|implemented)\b/, 'accepted'],
  [/^(proposed|proposal|draft|pending|under\s+review|rfc|wip)\b/, 'proposed'],
  [/^(rejected|declined|abandoned|dropped|withdrawn)\b/, 'rejected'],
  [/^(deprecated|obsolete|retired|sunset)\b/, 'deprecated'],
];

const PARTIAL_SUPERSESSION =
  /^(?:(?:partl?y|partially|in\s+part,?)\s+supersed(?:ed|es)?|supersed(?:ed|es)?\s+(?:in\s+part|partl?y|partially))\b/;

/**
 * Reduce a free-text status to one of the known lifecycle states.
 *
 * Only the *leading* token is considered, because real status lines routinely
 * continue into prose that mentions other states — `Accepted. Supersedes 0034.`
 * is accepted, not superseded. Where a line records a transition
 * (`Proposed → Accepted`) the final state wins.
 */
export function normaliseStatus(raw: string | null | undefined): Status {
  if (!raw) return 'unknown';

  let text = raw.trim();
  if (!text) return 'unknown';

  // A transition arrow means the tail is the current state.
  const arrowParts = text.split(/\s*(?:→|->|=>|➜)\s*/);
  text = arrowParts[arrowParts.length - 1]!.trim();

  // Drop leading decoration: bold markers, list bullets, emoji, brackets.
  const cleaned = text
    .replace(/^[*_`\-–—>\s]+/, '')
    .replace(/^\[+/, '')
    .replace(/^[^\p{L}]+/u, '')
    .toLowerCase();

  // `Superseded by X` and `Supersedes X` both start with the same stem but mean
  // opposite things for *this* record's own status. Only the passive form
  // changes the status; the active form leaves the record accepted.
  if (/^supersedes\b/.test(cleaned)) return 'accepted';

  // Partial supersession leaves the record in force, so it must not read as
  // dead. The qualifier lands on either side of the verb in practice:
  // "superseded in part by X" and "partially superseded by X" are both common.
  if (PARTIAL_SUPERSESSION.test(cleaned)) return 'accepted';

  for (const [pattern, status] of STATUS_PATTERNS) {
    if (pattern.test(cleaned)) return status;
  }

  return 'unknown';
}

/** Statuses that mean "this is the current thinking". */
export function isLive(status: Status): boolean {
  return status === 'accepted' || status === 'proposed';
}

export const STATUS_ORDER: readonly Status[] = [
  'accepted',
  'proposed',
  'superseded',
  'deprecated',
  'rejected',
  'unknown',
];
