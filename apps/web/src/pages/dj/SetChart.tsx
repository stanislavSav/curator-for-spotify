import { useState } from 'react';
import type { DjSetResult } from '@curator/shared';
import { playedBpm } from './sheet.ts';

// Two small charts on one x axis (track position): energy vs the Energy Curve,
// then BPM. Separate charts instead of a dual axis. Dark chart colours from
// the dataviz reference palette (slot 1 blue, slot 2 orange).
const ACTUAL = '#3987e5';
const BPM = '#d95926';
const W = 640;
const PAD = { l: 34, r: 12, t: 8, b: 8 };

export function SetChart({ result, foldHalfDouble }: { result: DjSetResult; foldHalfDouble: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = result.tracks.length;
  if (n === 0) return null;
  const x = (i: number) => PAD.l + (n === 1 ? 0.5 : i / (n - 1)) * (W - PAD.l - PAD.r);
  const colW = (W - PAD.l - PAD.r) / Math.max(1, n - 1);

  const eH = 150;
  const ey = (v: number) => PAD.t + (1 - v) * (eH - PAD.t - PAD.b);
  const bpms = playedBpm(result.tracks.map((t) => t.bpm), foldHalfDouble);
  const bLo = Math.floor(Math.min(...bpms) - 3);
  const bHi = Math.ceil(Math.max(...bpms) + 3);
  const bH = 90;
  const by = (v: number) => PAD.t + (1 - (v - bLo) / (bHi - bLo || 1)) * (bH - PAD.t - PAD.b);

  const target = result.tracks.map((t, i) => `${x(i)},${ey(t.targetEnergy)}`).join(' ');
  const segments = energySegments(result).map((seg) => seg.map((i) => `${x(i)},${ey(result.tracks[i]!.energy!)}`).join(' '));
  const bpmLine = bpms.map((b, i) => `${x(i)},${by(b)}`).join(' ');
  const h = hover != null ? result.tracks[hover] : null;

  const hitAreas = (height: number) =>
    result.tracks.map((_, i) => (
      <rect
        key={i}
        x={x(i) - colW / 2}
        y={0}
        width={colW}
        height={height}
        fill="transparent"
        onMouseEnter={() => setHover(i)}
        onFocus={() => setHover(i)}
      />
    ));
  const crosshair = (height: number) =>
    hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={height - PAD.b} className="stroke-zinc-600" />;

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className="mb-1 flex flex-wrap items-center gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden>
            <line x1="1" x2="17" y1="4" y2="4" stroke={ACTUAL} strokeWidth="2" strokeLinecap="round" />
          </svg>
          Actual energy
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden>
            <line x1="1" x2="17" y1="4" y2="4" className="stroke-zinc-400" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          Target (Energy Curve)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${eH}`} className="w-full" role="img" aria-label="Energy per track against the Energy Curve">
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={ey(v)} y2={ey(v)} className="stroke-zinc-800" />
            <text x={PAD.l - 6} y={ey(v) + 3} textAnchor="end" className="fill-zinc-500 text-[10px]">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {crosshair(eH)}
        <polyline points={target} fill="none" className="stroke-zinc-400" strokeWidth={2} strokeDasharray="5 4" />
        {segments.map((pts, i) => (
          <polyline key={i} points={pts} fill="none" stroke={ACTUAL} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {result.tracks.map((t, i) =>
          t.energy == null ? null : (
            <circle key={i} cx={x(i)} cy={ey(t.energy)} r={hover === i ? 5 : 4} fill={ACTUAL} className="stroke-zinc-950" strokeWidth={2} />
          ),
        )}
        {hitAreas(eH)}
      </svg>

      <div className="mb-1 mt-3 text-xs text-zinc-400">
        BPM{foldHalfDouble && <span className="text-zinc-500"> · half/double time shown at the tempo it mixes at</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${bH}`} className="w-full" role="img" aria-label="BPM per track">
        {[bLo, bHi].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={by(v)} y2={by(v)} className="stroke-zinc-800" />
            <text x={PAD.l - 6} y={by(v) + 3} textAnchor="end" className="fill-zinc-500 text-[10px]">
              {v}
            </text>
          </g>
        ))}
        {crosshair(bH)}
        <polyline points={bpmLine} fill="none" stroke={BPM} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {bpms.map((b, i) => (
          <circle key={i} cx={x(i)} cy={by(b)} r={hover === i ? 5 : 4} fill={BPM} className="stroke-zinc-950" strokeWidth={2} />
        ))}
        {hitAreas(bH)}
      </svg>

      {h && hover != null && (
        <div
          className="pointer-events-none absolute top-6 z-10 w-56 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-xs shadow-lg"
          style={{ left: `${Math.min(85, Math.max(15, (x(hover) / W) * 100))}%` }}
        >
          <div className="truncate font-medium text-zinc-100">
            {hover + 1}. {h.name}
          </div>
          <div className="truncate text-zinc-400">{h.artists.join(', ')}</div>
          <div className="mt-1 tabular-nums text-zinc-300">
            Energy {h.energy?.toFixed(2) ?? '?'} · target {h.targetEnergy.toFixed(2)}
          </div>
          <div className="tabular-nums text-zinc-300">
            {h.bpm} BPM{Math.abs(bpms[hover]! - h.bpm) > 0.5 && ` (mixes as ${Math.round(bpms[hover]!)})`} · {h.camelot ?? 'key ?'}
          </div>
        </div>
      )}
    </div>
  );
}

/** Runs of consecutive tracks with a known energy, so gaps break the line. */
function energySegments(result: DjSetResult): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  result.tracks.forEach((t, i) => {
    if (t.energy == null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(i);
  });
  if (cur.length) out.push(cur);
  return out;
}
