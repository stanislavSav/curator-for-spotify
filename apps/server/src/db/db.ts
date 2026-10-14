import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
// CURATOR_DATA_DIR lets a demo or test run use a throwaway data folder.
export const DATA_DIR = process.env.CURATOR_DATA_DIR ? resolve(process.env.CURATOR_DATA_DIR) : resolve(ROOT_DIR, 'data');

export type DB = Database.Database;

// One schema for the whole app. Features own their tables (see comments) but the
// schema lives here so parallel work never fights over migrations.
const SCHEMA = `
-- auth (spotify/auth.ts)
CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,          -- epoch ms
  scope TEXT NOT NULL,
  user_id TEXT,
  display_name TEXT,
  authorized_at TEXT NOT NULL           -- ISO; refresh token dies 6 months later
);

-- library (features/sync)
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('owned','followed','generated')),
  items_readable INTEGER NOT NULL,
  items_total INTEGER NOT NULL DEFAULT 0,
  snapshot_id TEXT NOT NULL,
  items_snapshot_id TEXT,               -- snapshot_id at the last item sync
  image_url TEXT,
  public INTEGER NOT NULL DEFAULT 0,
  collaborative INTEGER NOT NULL DEFAULT 0,
  library_position INTEGER,             -- order in /me/playlists
  synced_at TEXT NOT NULL,
  removed_at TEXT                       -- set when no longer in /me/playlists
);
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL,
  name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  isrc TEXT,
  album_id TEXT,
  album_name TEXT NOT NULL DEFAULT '',
  release_date TEXT
);
CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  genres_json TEXT,                     -- NULL = not fetched yet
  genres_fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS track_artists (
  track_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (track_id, artist_id)
);
CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  track_id TEXT NOT NULL,
  added_at TEXT,
  added_by TEXT,
  PRIMARY KEY (playlist_id, position)
);
CREATE INDEX IF NOT EXISTS playlist_items_track ON playlist_items(track_id);
CREATE TABLE IF NOT EXISTS liked_tracks (
  track_id TEXT PRIMARY KEY,
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS top_tracks (
  time_range TEXT NOT NULL,
  rank INTEGER NOT NULL,
  track_id TEXT NOT NULL,
  PRIMARY KEY (time_range, rank)
);
CREATE TABLE IF NOT EXISTS top_artists (
  time_range TEXT NOT NULL,
  rank INTEGER NOT NULL,
  artist_id TEXT NOT NULL,
  PRIMARY KEY (time_range, rank)
);
CREATE TABLE IF NOT EXISTS recent_plays (
  played_at TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  context_type TEXT,
  context_uri TEXT
);

-- enrichment (features/enrich)
CREATE TABLE IF NOT EXISTS audio_features (
  track_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,                 -- reccobeats | deezer | manual | none
  tempo REAL, key INTEGER, mode INTEGER,
  energy REAL, danceability REAL, valence REAL, loudness REAL,
  acousticness REAL, instrumentalness REAL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('track','artist')),
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  tag TEXT NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (entity_type, entity_id, source, tag)
);
CREATE TABLE IF NOT EXISTS enrich_attempts (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id, source)
);

-- streaming history import + pruning (features/prune)
CREATE TABLE IF NOT EXISTS stream_history (
  ts TEXT NOT NULL,
  track_uri TEXT NOT NULL,
  ms_played INTEGER NOT NULL,
  reason_start TEXT,
  reason_end TEXT,
  shuffle INTEGER,
  skipped INTEGER,
  platform TEXT,
  PRIMARY KEY (ts, track_uri)
);
CREATE INDEX IF NOT EXISTS stream_history_track ON stream_history(track_uri);
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prune_log (
  playlist_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  pruned_at TEXT NOT NULL,
  backup_id INTEGER
);
CREATE TABLE IF NOT EXISTS backup_restores (
  backup_id INTEGER NOT NULL,
  restored_at TEXT NOT NULL,
  action TEXT NOT NULL,                 -- refollowed | recreated
  playlist_id TEXT,
  url TEXT
);

-- proposals (features/proposals); the proposals themselves live in data/proposals.json
CREATE TABLE IF NOT EXISTS proposal_state (
  proposal_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','dropped','created')),
  edited_json TEXT,
  spotify_playlist_id TEXT,
  updated_at TEXT NOT NULL
);

-- DJ sets (features/dj)
CREATE TABLE IF NOT EXISTS dj_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  spotify_playlist_id TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',   -- draft | created
  updated_at TEXT
);

-- the DJ page's current set, autosaved (features/dj); one row
CREATE TABLE IF NOT EXISTS dj_workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config_json TEXT NOT NULL,
  seed INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  from_draft_json TEXT,
  updated_at TEXT NOT NULL
);

-- user Set Templates (features/dj)
CREATE TABLE IF NOT EXISTS dj_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  include_pool INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- jobs (jobs/jobs.ts)
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
`;

export function openDb(file = resolve(DATA_DIR, 'curator.sqlite')): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Columns added after a table first shipped; CREATE TABLE IF NOT EXISTS does not add them. */
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: 'dj_sets', column: 'status', ddl: "TEXT NOT NULL DEFAULT 'created'" },
  { table: 'dj_sets', column: 'updated_at', ddl: 'TEXT' },
];

function migrate(db: DB) {
  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

let shared: DB | null = null;

/** Process-wide DB. Tests should call openDb(':memory:') instead. */
export function getDb(): DB {
  shared ??= openDb();
  return shared;
}

export const nowIso = () => new Date().toISOString();
