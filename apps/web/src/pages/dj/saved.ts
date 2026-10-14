import { normaliseDjConfig, type DjSetConfig, type DjSetSummary, type DjTemplate } from '@curator/shared';

// Pure helpers for the user's Set Templates and saved DJ Sets (drafts and created).

/**
 * The settings after applying a user Set Template. With its Pool, the template
 * replaces everything. Without it, the current Pool and the current locked,
 * removed and start tracks stay (they belong to that Pool).
 */
export function applyUserTemplate(current: DjSetConfig, template: Pick<DjTemplate, 'includePool' | 'config'>): DjSetConfig {
  const next = normaliseDjConfig(structuredClone(template.config));
  if (template.includePool) return next;
  return {
    ...next,
    pool: current.pool,
    lockedTrackIds: current.lockedTrackIds,
    excludedTrackIds: current.excludedTrackIds,
    startTrackId: current.startTrackId,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Oct". */
export const shortDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

/** "14 Oct 2026" from an ISO timestamp, or the raw date part when it does not parse. */
export function isoDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : `${shortDate(d)} ${d.getFullYear()}`;
}

/** `base`, or `base (2)`, `base (3)`… so it does not match a name in use (case-insensitive). */
export function uniqueName(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const name = `${base} (${i})`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

/** "My set 14 Oct", unique among the user's templates. */
export const suggestTemplateName = (taken: string[], now: Date) => uniqueName(`My set ${shortDate(now)}`, taken);

/** "DJ Set 2026-10-14", unique among the saved sets. */
export const suggestSetName = (taken: string[], now: Date) => uniqueName(`DJ Set ${now.toISOString().slice(0, 10)}`, taken);

/** The template with this name (case-insensitive), for "Replace it?" after a 409. */
export const templateNamed = (list: DjTemplate[], name: string) =>
  list.find((t) => t.name === name) ?? list.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());

/** Older records have no status: they were all created on Spotify. */
export const isDraft = (s: Pick<DjSetSummary, 'status'>) => s.status === 'draft';

export type SetFilter = 'all' | 'drafts' | 'created';

export const SET_FILTERS: { value: SetFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'created', label: 'On Spotify' },
];

export function filterSets<T extends Pick<DjSetSummary, 'status'>>(list: T[], filter: SetFilter): T[] {
  if (filter === 'all') return list;
  return list.filter((s) => isDraft(s) === (filter === 'drafts'));
}

export function countSets(list: Pick<DjSetSummary, 'status'>[]): Record<SetFilter, number> {
  const drafts = list.filter(isDraft).length;
  return { all: list.length, drafts, created: list.length - drafts };
}

/** User templates shown before "More…". */
export const TEMPLATES_SHOWN = 6;
