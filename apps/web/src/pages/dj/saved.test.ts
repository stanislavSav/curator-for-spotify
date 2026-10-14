import { describe, expect, it } from 'vitest';
import { DEFAULT_DJ_CONFIG, type DjSetConfig, type DjTemplate } from '@curator/shared';
import {
  applyUserTemplate,
  countSets,
  filterSets,
  isDraft,
  suggestSetName,
  suggestTemplateName,
  templateNamed,
  uniqueName,
} from './saved.ts';

const base: DjSetConfig = structuredClone(DEFAULT_DJ_CONFIG);

const current: DjSetConfig = {
  ...base,
  pool: { ...base.pool, playlistIds: ['pl-mine'] },
  lockedTrackIds: ['t-locked'],
  excludedTrackIds: ['t-removed'],
  startTrackId: 't-start',
  length: { mode: 'minutes', minutes: 30 },
};

const saved: DjSetConfig = {
  ...base,
  pool: { ...base.pool, playlistIds: ['pl-template'], recent: { short_term: false, medium_term: false, long_term: true } },
  lockedTrackIds: ['t-other'],
  excludedTrackIds: [],
  startTrackId: null,
  length: { mode: 'tracks', count: 25 },
  keyStrictness: 'strict',
  transitions: { ...base.transitions, sheetStyle: 'club', colour: 'bold' },
};

const template = (name: string, includePool = false, config = saved): DjTemplate => ({
  id: `tpl-${name}`,
  name,
  includePool,
  config,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
});

describe('applyUserTemplate', () => {
  it('keeps the current Pool and tracks when the template has no Pool', () => {
    const next = applyUserTemplate(current, template('Club'));
    expect(next.pool).toEqual(current.pool);
    expect(next.lockedTrackIds).toEqual(['t-locked']);
    expect(next.excludedTrackIds).toEqual(['t-removed']);
    expect(next.startTrackId).toBe('t-start');
    expect(next.length).toEqual({ mode: 'tracks', count: 25 });
    expect(next.keyStrictness).toBe('strict');
    expect(next.transitions.sheetStyle).toBe('club');
  });

  it('uses the whole config when the template has its Pool', () => {
    const next = applyUserTemplate(current, template('Club', true));
    expect(next).toEqual(saved);
  });

  it('fills an older stored config up to the current shape', () => {
    const old = { length: { mode: 'minutes', minutes: 45 } } as unknown as DjSetConfig;
    const next = applyUserTemplate(current, template('Old', false, old));
    expect(next.length).toEqual({ mode: 'minutes', minutes: 45 });
    expect(next.transitions).toEqual(base.transitions);
    expect(next.pool).toEqual(current.pool);
  });

  it('does not share objects with the stored template', () => {
    const t = template('Club', true);
    const next = applyUserTemplate(current, t);
    next.pool.playlistIds.push('pl-x');
    expect(t.config.pool.playlistIds).toEqual(['pl-template']);
  });
});

describe('name suggestions', () => {
  const now = new Date(2026, 9, 14, 12);

  it('suggests a dated template name that is not in use', () => {
    expect(suggestTemplateName([], now)).toBe('My set 14 Oct');
    expect(suggestTemplateName(['my set 14 oct'], now)).toBe('My set 14 Oct (2)');
    expect(suggestTemplateName(['My set 14 Oct', 'My set 14 Oct (2)'], now)).toBe('My set 14 Oct (3)');
  });

  it('suggests a set name', () => {
    expect(suggestSetName([], now)).toMatch(/^DJ Set 2026-10-1[34]$/);
    expect(uniqueName('Friday', ['Friday', 'Saturday'])).toBe('Friday (2)');
  });

  it('finds the template a 409 was about', () => {
    const list = [template('Club'), template('Warm-up')];
    expect(templateNamed(list, 'Club')?.id).toBe('tpl-Club');
    expect(templateNamed(list, ' warm-up ')?.id).toBe('tpl-Warm-up');
    expect(templateNamed(list, 'Other')).toBeUndefined();
  });
});

describe('Earlier sets filter', () => {
  const sets = [
    { id: 'a', status: 'draft' as const },
    { id: 'b', status: 'created' as const },
    { id: 'c', status: 'draft' as const },
    // A record from before drafts existed.
    { id: 'd' } as { id: string; status: 'created' },
  ];

  it('filters by status, treating a missing status as created', () => {
    expect(filterSets(sets, 'all').map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterSets(sets, 'drafts').map((s) => s.id)).toEqual(['a', 'c']);
    expect(filterSets(sets, 'created').map((s) => s.id)).toEqual(['b', 'd']);
    expect(isDraft(sets[3]!)).toBe(false);
  });

  it('counts each filter', () => {
    expect(countSets(sets)).toEqual({ all: 4, drafts: 2, created: 2 });
    expect(countSets([])).toEqual({ all: 0, drafts: 0, created: 0 });
  });
});
