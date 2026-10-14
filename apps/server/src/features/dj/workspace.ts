import { normaliseDjConfig, type DjSetResult, type DjWorkspace, type DjWorkspaceInput } from '@curator/shared';
import { nowIso, type DB } from '../../db/db.ts';

interface Row {
  config_json: string;
  seed: number;
  result_json: string;
  from_draft_json: string | null;
  updated_at: string;
}

/** The DJ page's current set, or null when the user has none (or cleared it). */
export function getWorkspace(db: DB): DjWorkspace | null {
  const r = db.prepare('SELECT * FROM dj_workspace WHERE id = 1').get() as Row | undefined;
  if (!r) return null;
  return {
    config: normaliseDjConfig(JSON.parse(r.config_json)),
    seed: r.seed,
    result: JSON.parse(r.result_json) as DjSetResult,
    fromDraft: r.from_draft_json ? (JSON.parse(r.from_draft_json) as DjWorkspace['fromDraft']) : null,
    updatedAt: r.updated_at,
  };
}

export function saveWorkspace(db: DB, w: DjWorkspaceInput): DjWorkspace {
  const updatedAt = nowIso();
  db.prepare(
    `INSERT INTO dj_workspace (id, config_json, seed, result_json, from_draft_json, updated_at) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET config_json = excluded.config_json, seed = excluded.seed,
       result_json = excluded.result_json, from_draft_json = excluded.from_draft_json, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(w.config), w.seed, JSON.stringify(w.result), w.fromDraft ? JSON.stringify(w.fromDraft) : null, updatedAt);
  return { ...w, updatedAt };
}

export function clearWorkspace(db: DB) {
  db.prepare('DELETE FROM dj_workspace').run();
}
