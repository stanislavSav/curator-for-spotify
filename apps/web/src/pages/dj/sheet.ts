import { SETTING_ROWS, type DjSetResult, type DjTransition } from '@curator/shared';
import { isEdited, pairTitle, presetLine, rowValue } from './edits.ts';

export const fmtDuration = (ms: number) => {
  const min = Math.round(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

export const fmtPct = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(1)} %`;

export const fmtEnergyDelta = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(2)}`;

/** With half/double time on, each BPM is read as the version nearest the previous track (85 → 170). */
export function playedBpm(bpms: number[], fold: boolean): number[] {
  const out: number[] = [];
  bpms.forEach((b, i) => {
    const prev = out[i - 1];
    if (!fold || prev == null) return out.push(b);
    out.push([b, b * 2, b / 2].reduce((best, x) => (Math.abs(x - prev) < Math.abs(best - prev) ? x : best)));
  });
  return out;
}

export const LEGEND = "'in' = incoming track, 'out' = outgoing track. Pick Custom in Spotify, then set each row.";

export const APPLY_STEPS = [
  'Open the playlist in the Spotify app (phone or desktop).',
  'Tap Mix. Spotify adds an Auto transition to every pair.',
  'Tap the label between two songs to edit that transition. Pick the preset from this sheet. For Custom, set the bars and each row (Volume, EQ, Filter, Effects, Looping), then Save.',
  'Play it with shuffle off. Spotify Connect and the web player play it without transitions.',
];

export const APPLY_DONTS = [
  "Don't use Smart Reorder: it replaces this order.",
  "Don't reorder tracks after you edit transitions: that can reset them to Auto. To change the set, build a new one here; it makes a new playlist.",
];

const presetText = (t: DjTransition) => {
  const p = presetLine(t.settings.preset);
  return `${p.before}${p.name}${p.after}`;
};

/** Plain-text Transition Sheet for the clipboard. */
export function sheetAsText(result: DjSetResult, name?: string | null, opts: { applied?: boolean } = {}): string {
  const lines = [
    `${name ? `DJ Set: ${name}` : 'DJ Set'} (${result.tracks.length} tracks, ${fmtDuration(result.durationMs)})`,
    'Apply in Spotify: open the playlist › Mix › tap each transition. No Smart Reorder. No reordering afterwards.',
    LEGEND,
    '',
  ];
  result.tracks.forEach((t, i) => {
    const energy = t.energy == null ? 'E ?' : `E ${t.energy.toFixed(2)}`;
    lines.push(`${String(i + 1).padStart(2)}. ${t.artists.join(', ')} – ${t.name}  [${t.bpm} BPM · ${t.camelot ?? '?'} · ${energy}]`);
    const tr = result.transitions[i];
    if (!tr) return;
    const marks = [isEdited(tr) ? 'edited' : null, opts.applied && tr.applied ? 'applied' : null].filter(Boolean);
    lines.push(`    → ${pairTitle(i, tr.settings)}${marks.length ? ` (${marks.join(', ')})` : ''}`);
    lines.push(`      ${presetText(tr)}`);
    for (const row of SETTING_ROWS) lines.push(`      ${`${row.label}:`.padEnd(9)}${rowValue(tr.settings, row.key)}`);
    lines.push(`      ${tr.reason}`);
  });
  return lines.join('\n');
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function transitionHtml(tr: DjTransition, i: number, applied: boolean): string {
  const p = presetLine(tr.settings.preset);
  const rows = SETTING_ROWS.map(
    (r) => `<tr><td><i style="background:${r.color}"></i>${esc(r.label)}</td><td>${esc(rowValue(tr.settings, r.key))}</td></tr>`,
  ).join('');
  const box = applied ? `<span class="box">${tr.applied ? '☑' : '☐'}</span>` : '';
  return `${box}<b>${esc(pairTitle(i, tr.settings))}</b>${isEdited(tr) ? ' <small>(edited)</small>' : ''}
<div>${esc(p.before)}<b>${esc(p.name)}</b>${esc(p.after)}</div><table class="rows">${rows}</table><small>${esc(tr.reason)}</small>`;
}

/** A standalone, printer-friendly HTML page of the sheet. */
export function sheetAsHtml(result: DjSetResult, name?: string | null, opts: { applied?: boolean } = {}): string {
  const rows = result.tracks
    .map((t, i) => {
      const tr = result.transitions[i];
      return `<tr><td>${i + 1}</td><td><b>${esc(t.name)}</b><br><small>${esc(t.artists.join(', '))}</small></td>
<td>${t.bpm}</td><td>${esc(t.camelot ?? '—')}</td><td>${t.energy == null ? '—' : t.energy.toFixed(2)}</td>
<td>${tr ? transitionHtml(tr, i, opts.applied ?? false) : '<small>end</small>'}</td></tr>`;
    })
    .join('\n');
  const title = esc(name ? `DJ Set: ${name}` : 'DJ Set');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font:12px system-ui,sans-serif;color:#111;margin:24px}h1{font-size:18px;margin:0 0 4px}
p,li{margin:2px 0}table{border-collapse:collapse;width:100%;margin-top:12px}
th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;color:#555}
table.rows{margin:4px 0;width:auto}table.rows td{border:0;padding:1px 8px 1px 0}
i{display:inline-block;width:3px;height:10px;margin-right:5px;vertical-align:middle}
.box{font-size:14px;margin-right:4px}small{color:#555}tr{break-inside:avoid}@media print{body{margin:0}}
</style></head><body><h1>${title}</h1>
<p>${result.tracks.length} tracks · ${fmtDuration(result.durationMs)} · score ${result.score.total}/100</p>
<p>${esc(LEGEND)}</p>
<ol>${APPLY_STEPS.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
<ul>${APPLY_DONTS.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<table><thead><tr><th>#</th><th>Track</th><th>BPM</th><th>Key</th><th>Energy</th><th>Transition to next</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
}
