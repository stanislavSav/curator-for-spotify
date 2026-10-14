import { randomUUID } from 'node:crypto';
import { DEFAULT_DJ_CONFIG, normaliseDjConfig, type DjSetConfig, type DjTemplate, type DjTemplateInput } from '@curator/shared';
import { nowIso, type DB } from '../../db/db.ts';

interface Row {
  id: string;
  name: string;
  include_pool: number;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export class TemplateNameTakenError extends Error {
  constructor(name: string) {
    super(`A template named “${name}” exists already. Pick another name.`);
  }
}

const toTemplate = (r: Row): DjTemplate => ({
  id: r.id,
  name: r.name,
  includePool: r.include_pool === 1,
  config: normaliseDjConfig(JSON.parse(r.config_json)),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * A Set Template holds settings, not tracks: the start track, locked and
 * excluded tracks are never stored. Without "Include Pool" the Pool is stored
 * as the default; applying the template keeps the current Pool then.
 */
export function templateConfig(config: DjSetConfig, includePool: boolean): DjSetConfig {
  const c = normaliseDjConfig(config);
  return {
    ...c,
    pool: includePool ? c.pool : structuredClone(DEFAULT_DJ_CONFIG.pool),
    startTrackId: null,
    lockedTrackIds: [],
    excludedTrackIds: [],
  };
}

/** Names compare without case, so "Warm-up" and "warm-up" cannot both exist. */
function assertNameFree(db: DB, name: string, exceptId: string | null) {
  const rows = db.prepare('SELECT id, name FROM dj_templates').all() as { id: string; name: string }[];
  const wanted = name.toLowerCase();
  if (rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === wanted)) throw new TemplateNameTakenError(name);
}

export function listTemplates(db: DB): DjTemplate[] {
  const rows = db.prepare('SELECT * FROM dj_templates ORDER BY created_at DESC, rowid DESC').all() as Row[];
  return rows.map(toTemplate);
}

export function getTemplate(db: DB, id: string): DjTemplate | null {
  const row = db.prepare('SELECT * FROM dj_templates WHERE id = ?').get(id) as Row | undefined;
  return row ? toTemplate(row) : null;
}

/** Throws TemplateNameTakenError when the name is in use. */
export function createTemplate(db: DB, input: DjTemplateInput): DjTemplate {
  assertNameFree(db, input.name, null);
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    'INSERT INTO dj_templates (id, name, include_pool, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, input.name, input.includePool ? 1 : 0, JSON.stringify(templateConfig(input.config, input.includePool)), now, now);
  return getTemplate(db, id)!;
}

/** Null when the template does not exist; throws TemplateNameTakenError when the new name is in use. */
export function updateTemplate(db: DB, id: string, patch: Partial<DjTemplateInput>): DjTemplate | null {
  const current = getTemplate(db, id);
  if (!current) return null;
  const name = patch.name ?? current.name;
  if (patch.name !== undefined) assertNameFree(db, name, id);
  const includePool = patch.includePool ?? current.includePool;
  const config = templateConfig(patch.config ?? current.config, includePool);
  db.prepare('UPDATE dj_templates SET name = ?, include_pool = ?, config_json = ?, updated_at = ? WHERE id = ?').run(
    name,
    includePool ? 1 : 0,
    JSON.stringify(config),
    nowIso(),
    id,
  );
  return getTemplate(db, id);
}

export function deleteTemplate(db: DB, id: string): boolean {
  return db.prepare('DELETE FROM dj_templates WHERE id = ?').run(id).changes > 0;
}
