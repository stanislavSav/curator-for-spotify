// Pure rules for the privacy guard (scripts/check-public.mjs).
// No I/O here, so node:test can cover every rule.

/** Add this text to a line to skip the content checks for that line. */
export const IGNORE_MARKER = 'check-public-ignore';

/** Paths that look private but are meant to be published. */
const ALLOWED_PATHS = [/^data\/\.gitkeep$/, /(^|\/)\.env\.example$/, /(^|\/)fixtures\/[^/]+\.sample\.json$/];

/** Path rules: a publishable file must not match any of them. */
const PATH_RULES = [
  { test: (p) => /^data\//.test(p), reason: 'file under data/ (your real library lives there)' },
  { test: (p) => /(^|\/)backups\//.test(p), reason: 'file under a backups/ folder' },
  { test: (p, b) => /\.sqlite/i.test(b), reason: 'SQLite database file' },
  { test: (p, b) => /\.db(-wal|-shm|-journal)?$/i.test(b), reason: 'database file' },
  { test: (p, b) => /^(snapshot|proposals)([._-][^/]*)?\.json$/i.test(b), reason: 'Snapshot or Proposals file (real library data)' },
  {
    test: (p, b) => /^(spotify-curator|curator-for-spotify)-backup.*\.json(\.gz)?$/i.test(b) || /\.curator-backup\.json(\.gz)?$/i.test(b),
    reason: 'Full Backup file (your library, playlists and work)',
  },
  { test: (p, b) => b === '.env' || b.startsWith('.env.'), reason: '.env file (holds your Client ID)' },
  { test: (p, b) => /\.(pem|key|p12|pfx)$/i.test(b), reason: 'key or certificate file' },
  { test: (p, b) => b === '.private-markers', reason: 'your personal markers file (keep it git-ignored)' },
  {
    test: (p, b) => /^(Streaming_?History|endsong_|my_spotify_data)/i.test(b),
    reason: 'Spotify data export file',
  },
];

/** Returns why a path must not be published, or null when it is fine. */
export function checkPath(path) {
  const p = path.replace(/\\/g, '/');
  if (ALLOWED_PATHS.some((re) => re.test(p))) return null;
  const base = p.slice(p.lastIndexOf('/') + 1);
  const rule = PATH_RULES.find((r) => r.test(p, base));
  return rule ? rule.reason : null;
}

// Values that are clearly placeholders, not real secrets.
const PLACEHOLDER = /fake|test|example|dummy|sample|placeholder|changeme|your[_-]|xxxx|\.\.\.|<|\$\{|process\.env/i;

function looksLikeSecret(value) {
  return value.length >= 20 && /[0-9]/.test(value) && /[A-Za-z]/.test(value) && !PLACEHOLDER.test(value);
}

const SECRET_KEY = String.raw`[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd)[A-Za-z0-9_-]*`;

/** Content rules for secrets. Each returns the matched value or null. */
const SECRET_RULES = [
  {
    reason: 'Spotify-like Client ID (32 hex characters) assigned to a CLIENT_ID key',
    find: (line) => line.match(/client[_-]?id["']?\s*[:=]\s*["'`]?([0-9a-f]{32})(?![0-9a-z])/i)?.[1] ?? null,
  },
  {
    reason: 'private key block',
    find: (line) => line.match(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/)?.[0] ?? null,
  },
  {
    reason: 'Spotify access token (BQ...)',
    find: (line) => line.match(/(?<![A-Za-z0-9_-])BQ[A-Za-z0-9_-]{100,}/)?.[0] ?? null,
  },
  {
    reason: 'hard-coded secret (api key / secret / token / password with a long value)',
    find: (line) => {
      const quoted = new RegExp(String.raw`\b${SECRET_KEY}["']?\s*[:=]\s*(["'\`])([^"'\`\s]{20,})\1`, 'i');
      const envLine = new RegExp(String.raw`^\s*(?:export\s+)?${SECRET_KEY}\s*=\s*([^\s#"'\`]{20,})`, 'i');
      const q = line.match(quoted)?.[2];
      if (q && looksLikeSecret(q)) return q;
      const e = line.match(envLine)?.[1];
      if (e && looksLikeSecret(e)) return e;
      return null;
    },
  },
];

/**
 * Parses a .private-markers file. One marker per line.
 * A line like /pattern/flags is a regex; any other line is a literal,
 * matched case-insensitively. Empty lines and lines starting with # are skipped.
 */
export function parseMarkers(text) {
  const markers = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Only valid regex flags count, so a path like /Users/jane stays a literal.
    const re = line.match(/^\/(.+)\/([dimsuvy]*)$/);
    if (re) {
      markers.push({ label: line, regex: new RegExp(re[1], re[2]) });
    } else {
      const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      markers.push({ label: line, regex: new RegExp(escaped, 'i') });
    }
  }
  return markers;
}

/** Shows only the start of a secret, so CI logs do not leak it. */
export function mask(value) {
  return value.length <= 8 ? '****' : `${value.slice(0, 4)}…(${value.length} chars)`;
}

/**
 * Scans the text of one file.
 * Returns findings: { line, reason, detail }.
 * Personal markers show their label (it comes from your local file);
 * secrets are masked.
 */
export function scanText(text, markers = []) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(IGNORE_MARKER)) continue;
    for (const rule of SECRET_RULES) {
      const hit = rule.find(line);
      if (hit) findings.push({ line: i + 1, reason: rule.reason, detail: mask(hit) });
    }
    for (const m of markers) {
      if (m.regex.test(line)) findings.push({ line: i + 1, reason: 'personal marker from .private-markers', detail: m.label });
    }
  }
  return findings;
}

/** True when the buffer looks binary (a NUL byte in the first 8 KB). */
export function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}
