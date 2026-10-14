import type { DjSetResult, DjTransition } from '@curator/shared';

export const fmtDuration = (ms: number) => {
  const min = Math.round(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

export const fmtPct = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(1)} %`;

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

export const transitionLabel = (t: DjTransition) => (t.bars ? `${t.style}, ${t.bars} bars` : t.style);

export const APPLY_STEPS = [
  'Open the playlist in the Spotify app (phone or desktop).',
  'Tap Mix. Spotify adds an Auto transition to every pair.',
  'Tap the label between two songs to edit that transition. Set the style and length from this sheet, then Save.',
  'Play it with shuffle off. Spotify Connect and the web player play it without transitions.',
];

export const APPLY_DONTS = [
  "Don't use Smart Reorder: it replaces this order.",
  "Don't reorder tracks after you edit transitions: that can reset them to Auto. To change the set, build a new one here; it makes a new playlist.",
];

/** Plain-text Transition Sheet for the clipboard. */
export function sheetAsText(result: DjSetResult, name?: string | null): string {
  const lines = [
    `${name ? `DJ Set: ${name}` : 'DJ Set'} (${result.tracks.length} tracks, ${fmtDuration(result.durationMs)})`,
    'Apply in Spotify: open the playlist › Mix › tap each transition. No Smart Reorder. No reordering afterwards.',
    '',
  ];
  result.tracks.forEach((t, i) => {
    const energy = t.energy == null ? 'E ?' : `E ${t.energy.toFixed(2)}`;
    lines.push(`${String(i + 1).padStart(2)}. ${t.artists.join(', ')} – ${t.name}  [${t.bpm} BPM · ${t.camelot ?? '?'} · ${energy}]`);
    const tr = result.transitions[i];
    if (tr) {
      const extra = [tr.eqHint, tr.cutHint ? 'consider a cut' : null].filter(Boolean).join(' · ');
      lines.push(`    → ${transitionLabel(tr)}${extra ? ` · ${extra}` : ''}`);
      lines.push(`      ${tr.reason}`);
    }
  });
  return lines.join('\n');
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A standalone, printer-friendly HTML page of the sheet. */
export function sheetAsHtml(result: DjSetResult, name?: string | null): string {
  const rows = result.tracks
    .map((t, i) => {
      const tr = result.transitions[i];
      return `<tr><td>${i + 1}</td><td><b>${esc(t.name)}</b><br><small>${esc(t.artists.join(', '))}</small></td>
<td>${t.bpm}</td><td>${esc(t.camelot ?? '—')}</td><td>${t.energy == null ? '—' : t.energy.toFixed(2)}</td>
<td>${tr ? `<b>${esc(transitionLabel(tr))}</b>${tr.eqHint ? `<br><small>${esc(tr.eqHint)}</small>` : ''}<br><small>${esc(tr.reason)}</small>` : '<small>end</small>'}</td></tr>`;
    })
    .join('\n');
  const title = esc(name ? `DJ Set: ${name}` : 'DJ Set');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font:12px system-ui,sans-serif;color:#111;margin:24px}h1{font-size:18px;margin:0 0 4px}
p,li{margin:2px 0}table{border-collapse:collapse;width:100%;margin-top:12px}
th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;color:#555}
small{color:#555}@media print{body{margin:0}}
</style></head><body><h1>${title}</h1>
<p>${result.tracks.length} tracks · ${fmtDuration(result.durationMs)} · score ${result.score.total}/100</p>
<ol>${APPLY_STEPS.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
<ul>${APPLY_DONTS.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<table><thead><tr><th>#</th><th>Track</th><th>BPM</th><th>Key</th><th>Energy</th><th>Transition to next</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
}
