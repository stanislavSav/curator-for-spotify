import { strFromU8, unzipSync } from 'fflate';
import type { HistoryImportResult, HistorySummary } from '@curator/shared';
import type { DB } from '../../db/db.ts';

export interface UploadedFile {
  name: string;
  data: Uint8Array;
}

/** One stream_history row. */
export interface HistoryRow {
  ts: string;
  trackUri: string;
  msPlayed: number;
  reasonStart: string | null;
  reasonEnd: string | null;
  shuffle: number | null;
  skipped: number | null;
  platform: string | null;
}

/** A play from the old account-data format: no URI, minute precision. */
export interface LegacyRow {
  ts: string;
  artist: string;
  title: string;
  msPlayed: number;
}

const EXTENDED_FILE = /(Streaming_History_Audio_.*|endsong_\d+)\.json$/i;
const LEGACY_FILE = /StreamingHistory(_music_)?\d+\.json$/i;
const ZIP_FILE = /\.zip$/i;

const isZip = (f: UploadedFile) =>
  ZIP_FILE.test(f.name) || (f.data[0] === 0x50 && f.data[1] === 0x4b && f.data[2] === 0x03 && f.data[3] === 0x04);

/** Expands .zip uploads and keeps only Streaming History music files. Plain .json uploads are kept as they are. */
export function collectHistoryFiles(uploads: UploadedFile[]): UploadedFile[] {
  const out: UploadedFile[] = [];
  for (const f of uploads) {
    if (isZip(f)) {
      const entries = unzipSync(f.data, {
        filter: (e) => EXTENDED_FILE.test(baseName(e.name)) || LEGACY_FILE.test(baseName(e.name)),
      });
      for (const [name, data] of Object.entries(entries)) out.push({ name: baseName(name), data });
    } else if (/\.json$/i.test(f.name)) {
      out.push({ name: baseName(f.name), data: f.data });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export interface ParsedHistory {
  files: HistoryImportResult['files'];
  rowsRead: number;
  extended: HistoryRow[];
  legacy: LegacyRow[];
  skipped: number;
}

/** Parses Streaming History JSON files. The format is detected per row, so file names don't matter. */
export function parseHistoryFiles(files: UploadedFile[]): ParsedHistory {
  const parsed: ParsedHistory = { files: [], rowsRead: 0, extended: [], legacy: [], skipped: 0 };
  for (const f of files) {
    let rows: unknown;
    try {
      rows = JSON.parse(strFromU8(f.data));
    } catch {
      throw new Error(`${f.name} is not valid JSON.`);
    }
    if (!Array.isArray(rows)) {
      parsed.files.push({ name: f.name, format: 'unknown', rows: 0 });
      continue;
    }
    let format: 'extended' | 'legacy' | 'unknown' = 'unknown';
    for (const raw of rows) {
      parsed.rowsRead++;
      if (!raw || typeof raw !== 'object') {
        parsed.skipped++;
        continue;
      }
      const r = raw as Record<string, unknown>;
      if ('ts' in r && 'ms_played' in r) {
        format = 'extended';
        const row = parseExtendedRow(r);
        if (row) parsed.extended.push(row);
        else parsed.skipped++;
      } else if ('endTime' in r && 'msPlayed' in r) {
        format = 'legacy';
        const row = parseLegacyRow(r);
        if (row) parsed.legacy.push(row);
        else parsed.skipped++;
      } else {
        parsed.skipped++;
      }
    }
    parsed.files.push({ name: f.name, format, rows: rows.length });
  }
  return parsed;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const bool = (v: unknown) => (v === true || v === 1 || v === '1' ? 1 : v === false || v === 0 || v === '0' ? 0 : null);

export function parseExtendedRow(r: Record<string, unknown>): HistoryRow | null {
  const uri = str(r.spotify_track_uri);
  // Podcasts, audiobooks and rows with lost metadata have no track URI.
  if (!uri || !uri.startsWith('spotify:track:') || str(r.spotify_episode_uri)) return null;
  const ts = toIso(r.ts);
  const ms = Number(r.ms_played);
  if (!ts || !Number.isFinite(ms)) return null;
  return {
    ts,
    trackUri: uri,
    msPlayed: Math.round(ms),
    reasonStart: str(r.reason_start),
    reasonEnd: str(r.reason_end),
    shuffle: bool(r.shuffle),
    skipped: bool(r.skipped),
    platform: str(r.platform),
  };
}

export function parseLegacyRow(r: Record<string, unknown>): LegacyRow | null {
  const artist = str(r.artistName);
  const title = str(r.trackName);
  // endTime is UTC with minute precision: "2023-01-05 14:32".
  const ts = typeof r.endTime === 'string' ? toIso(r.endTime.replace(' ', 'T') + (r.endTime.length <= 16 ? ':00Z' : 'Z')) : null;
  const ms = Number(r.msPlayed);
  if (!artist || !title || !ts || !Number.isFinite(ms)) return null;
  return { ts, artist, title, msPlayed: Math.round(ms) };
}

/** Normalises any parseable time to "YYYY-MM-DDTHH:MM:SSZ" so string order is time order. */
function toIso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Lower case, no accents or punctuation, single spaces. Used to match legacy rows to tracks. */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Map "artist\0title" → track URI, for every artist of every synced track. */
export function buildTrackMatcher(db: DB): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT t.uri, t.name, a.name AS artist FROM tracks t
       JOIN track_artists ta ON ta.track_id = t.id JOIN artists a ON a.id = ta.artist_id`,
    )
    .all() as { uri: string; name: string; artist: string }[];
  const map = new Map<string, string>();
  for (const r of rows) {
    const key = `${normalizeTitle(r.artist)}\0${normalizeTitle(r.name)}`;
    if (!map.has(key)) map.set(key, r.uri);
  }
  return map;
}

export interface ImportOptions {
  /** Called between chunks so a job can report progress. */
  onProgress?: (done: number, total: number) => void | Promise<void>;
  chunkSize?: number;
}

/** Parses the uploads and writes new rows to stream_history (INSERT OR IGNORE). */
export async function importHistory(db: DB, uploads: UploadedFile[], opts: ImportOptions = {}): Promise<HistoryImportResult> {
  const files = collectHistoryFiles(uploads);
  if (files.length === 0) {
    throw new Error(
      'No Streaming History files found. Upload the export .zip or the Streaming_History_Audio_*.json files.',
    );
  }
  const parsed = parseHistoryFiles(files);

  let legacy: HistoryImportResult['legacy'] = null;
  const legacyRows: HistoryRow[] = [];
  if (parsed.legacy.length > 0) {
    const matcher = buildTrackMatcher(db);
    let matched = 0;
    for (const r of parsed.legacy) {
      const uri = matcher.get(`${normalizeTitle(r.artist)}\0${normalizeTitle(r.title)}`);
      if (!uri) continue;
      matched++;
      legacyRows.push({
        ts: r.ts,
        trackUri: uri,
        msPlayed: r.msPlayed,
        reasonStart: null,
        reasonEnd: null,
        shuffle: null,
        skipped: null,
        platform: null,
      });
    }
    legacy = { rows: parsed.legacy.length, matched, unmatched: parsed.legacy.length - matched };
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO stream_history (ts, track_uri, ms_played, reason_start, reason_end, shuffle, skipped, platform)
     VALUES (@ts, @trackUri, @msPlayed, @reasonStart, @reasonEnd, @shuffle, @skipped, @platform)`,
  );
  // Legacy rows have minute precision. Skip one when the extended history already has the same play.
  const sameMinute = db.prepare('SELECT 1 FROM stream_history WHERE track_uri = ? AND ts >= ? AND ts <= ? LIMIT 1');

  const total = parsed.extended.length + legacyRows.length;
  const chunkSize = opts.chunkSize ?? 5000;
  let inserted = 0;
  let done = 0;
  const writeChunk = db.transaction((rows: HistoryRow[], isLegacy: boolean) => {
    for (const r of rows) {
      if (isLegacy) {
        const t = Date.parse(r.ts);
        const from = new Date(t - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
        const to = new Date(t + 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
        if (sameMinute.get(r.trackUri, from, to)) continue;
      }
      inserted += insert.run(r).changes;
    }
  });
  for (const [rows, isLegacy] of [
    [parsed.extended, false],
    [legacyRows, true],
  ] as const) {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      writeChunk(chunk, isLegacy);
      done += chunk.length;
      await opts.onProgress?.(done, total);
    }
  }

  let firstTs: string | null = null;
  let lastTs: string | null = null;
  for (const r of [...parsed.extended, ...legacyRows]) {
    if (!firstTs || r.ts < firstTs) firstTs = r.ts;
    if (!lastTs || r.ts > lastTs) lastTs = r.ts;
  }

  return {
    files: parsed.files,
    rowsRead: parsed.rowsRead,
    inserted,
    duplicates: total - inserted,
    skipped: parsed.skipped,
    legacy,
    firstTs,
    lastTs,
  };
}

export function historySummary(db: DB): HistorySummary {
  const base = db
    .prepare('SELECT COUNT(*) AS rows, MIN(ts) AS firstTs, MAX(ts) AS lastTs, COUNT(DISTINCT track_uri) AS distinctTracks FROM stream_history')
    .get() as { rows: number; firstTs: string | null; lastTs: string | null; distinctTracks: number };
  // track_uri is "spotify:track:<id>", so the id starts at character 15.
  const { matched } = db
    .prepare(
      `SELECT COUNT(*) AS matched FROM (SELECT DISTINCT track_uri FROM stream_history) h
       JOIN tracks t ON t.id = substr(h.track_uri, 15)`,
    )
    .get() as { matched: number };
  return {
    ...base,
    matchedTracks: matched,
    matchedPct: base.distinctTracks > 0 ? Math.round((matched / base.distinctTracks) * 1000) / 10 : 0,
  };
}

/** Uncompressed-ish size above which the import runs as a background job. */
export const JOB_THRESHOLD_BYTES = 4 * 1024 * 1024;
