import type { AdrNode, Status } from './types.ts';

export interface SearchFilters {
  /** Free-text query matched against number, title, and body. */
  query?: string;
  /** Restrict to these statuses. */
  status?: Status[];
  /** Only records whose id contains this substring (used to scope to one repo). */
  dir?: string;
  /** Hide records that have been superseded. */
  liveOnly?: boolean;
}

export interface Scored {
  adr: AdrNode;
  score: number;
  /** Where the match landed, for display: `title`, `number`, or `body`. */
  matchedIn: 'number' | 'title' | 'body' | 'none';
}

/**
 * Rank records against a query. Weighting is deliberately blunt — an exact
 * number match beats a title match beats a body match — because ADR titles are
 * long and descriptive, so substring matching on them is already precise.
 */
export function search(adrs: AdrNode[], filters: SearchFilters): Scored[] {
  const query = filters.query?.trim().toLowerCase() ?? '';
  const terms = query.split(/\s+/).filter(Boolean);

  const results: Scored[] = [];

  for (const adr of adrs) {
    if (filters.status && filters.status.length > 0 && !filters.status.includes(adr.status)) {
      continue;
    }
    if (filters.liveOnly && (adr.supersededBy !== null || adr.status === 'superseded')) continue;
    if (filters.dir && !adr.id.toLowerCase().includes(filters.dir.toLowerCase())) continue;

    if (terms.length === 0) {
      results.push({ adr, score: 0, matchedIn: 'none' });
      continue;
    }

    const scored = scoreAdr(adr, terms);
    if (scored) results.push(scored);
  }

  if (terms.length > 0) results.sort((a, b) => b.score - a.score);
  return results;
}

function scoreAdr(adr: AdrNode, terms: string[]): Scored | null {
  const title = adr.title.toLowerCase();
  const body = adr.body.toLowerCase();
  const numberLabel = adr.numberLabel?.toLowerCase() ?? '';
  const numeric = adr.number === null ? '' : String(adr.number);

  let score = 0;
  let matchedIn: Scored['matchedIn'] = 'none';

  for (const term of terms) {
    let termScore = 0;

    if (numeric && (term === numeric || term === numberLabel || term === `adr-${numeric}`)) {
      termScore = 1000;
      matchedIn = 'number';
    } else if (title === term) {
      termScore = 800;
      matchedIn = 'title';
    } else if (title.includes(term)) {
      // A match on a word boundary is worth more than one mid-word.
      const boundary = new RegExp(`\\b${escapeRegExp(term)}`).test(title);
      termScore = boundary ? 200 : 90;
      if (matchedIn === 'none' || matchedIn === 'body') matchedIn = 'title';
    } else if (body.includes(term)) {
      const occurrences = countOccurrences(body, term);
      termScore = 10 + Math.min(occurrences, 10);
      if (matchedIn === 'none') matchedIn = 'body';
    }

    // Every term must land somewhere — this is an AND search, which is what you
    // want when narrowing 99 records down to the three that matter.
    if (termScore === 0) return null;
    score += termScore;
  }

  // Nudge well-connected records up: if two match equally, read the cited one.
  score += Math.min(adr.inbound.length, 20);

  return { adr, score, matchedIn };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count < 50) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
