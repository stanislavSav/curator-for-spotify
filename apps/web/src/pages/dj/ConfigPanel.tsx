import { useEffect, useState, type ReactNode } from 'react';
import {
  BARS_NOTE,
  CURVE_PRESETS,
  curvePoints,
  curveTarget,
  TRANSITION_STYLES,
  type CurvePreset,
  type DjCurve,
  type DjLibraryFilter,
  type DjPoolOptions,
  type DjSetConfig,
  type DjTransitionRules,
  type TimeRange,
} from '@curator/shared';
import { Badge, Button, cx } from '../../components/ui.tsx';
import { DJ_PRESETS } from './presets.ts';

type Props = { config: DjSetConfig; onChange: (c: DjSetConfig) => void; options: DjPoolOptions | undefined };

const EMPTY_FILTER: DjLibraryFilter = {
  tags: [],
  decades: [],
  bpmMin: null,
  bpmMax: null,
  energyMin: null,
  energyMax: null,
  likedOnly: false,
};

const RECENT: { id: TimeRange; label: string }[] = [
  { id: 'short_term', label: 'Last 4 weeks' },
  { id: 'medium_term', label: 'Last 6 months' },
  { id: 'long_term', label: 'All time' },
];

const RULES: { id: keyof DjTransitionRules; label: string }[] = [
  { id: 'longBlendWhenCompatible', label: 'Long blend when key and tempo match' },
  { id: 'riseOnEnergyJump', label: 'Rise when energy jumps' },
  { id: 'shortFadeOnClash', label: 'Short Fade or cut on a clash' },
  { id: 'autoWhenUnknown', label: 'Auto when a key is unknown' },
];

export function ConfigPanel({ config, onChange, options }: Props) {
  const set = <K extends keyof DjSetConfig>(key: K, value: DjSetConfig[K]) => onChange({ ...config, [key]: value });
  const pool = config.pool;
  const setPool = (p: Partial<DjSetConfig['pool']>) => set('pool', { ...pool, ...p });
  const lib = pool.library;
  const setLib = (f: Partial<DjLibraryFilter>) => setPool({ library: { ...(lib ?? EMPTY_FILTER), ...f } });
  const tr = config.transitions;
  const setTr = (t: Partial<DjSetConfig['transitions']>) => set('transitions', { ...tr, ...t });

  return (
    <div className="space-y-5 text-sm">
      <Group title="Presets" hint="A preset changes the set shape. Your Pool stays.">
        <div className="flex flex-wrap gap-2">
          {DJ_PRESETS.map((p) => (
            <Button key={p.id} title={p.about} onClick={() => onChange(p.apply(config))}>
              {p.label}
            </Button>
          ))}
        </div>
      </Group>

      <Group title="Pool" hint="The tracks the set may use. Sources add up.">
        <PlaylistPicker options={options} selected={pool.playlistIds} onChange={(ids) => setPool({ playlistIds: ids })} />

        <div className="mt-3 space-y-1">
          <div className="text-xs text-zinc-500">Recent favourites (your top tracks)</div>
          {RECENT.map((r) => (
            <Check
              key={r.id}
              checked={pool.recent[r.id]}
              onChange={(v) => setPool({ recent: { ...pool.recent, [r.id]: v } })}
              label={
                <>
                  {r.label} <Count n={options?.recent[r.id]} />
                </>
              }
            />
          ))}
        </div>

        <div className="mt-3">
          <Check
            checked={lib != null}
            onChange={(v) => setPool({ library: v ? (lib ?? EMPTY_FILTER) : null })}
            label={
              <>
                Whole Library, filtered <Count n={options?.library.tracks} />
              </>
            }
          />
          {lib && <LibraryFilter filter={lib} options={options} onChange={setLib} />}
        </div>
      </Group>

      <Group title="Length">
        <div className="flex items-center gap-2">
          <Segmented
            value={config.length.mode}
            options={[
              { value: 'minutes', label: 'Minutes' },
              { value: 'tracks', label: 'Tracks' },
            ]}
            onChange={(mode) =>
              set('length', mode === 'minutes' ? { mode, minutes: 60 } : { mode: 'tracks', count: 20 })
            }
          />
          <NumberInput
            value={config.length.mode === 'minutes' ? config.length.minutes : config.length.count}
            min={config.length.mode === 'minutes' ? 5 : 2}
            max={config.length.mode === 'minutes' ? 600 : 300}
            onChange={(n) =>
              set('length', config.length.mode === 'minutes' ? { mode: 'minutes', minutes: n } : { mode: 'tracks', count: n })
            }
          />
        </div>
      </Group>

      <Group title="Energy Curve" hint="The target energy from the first to the last track.">
        <CurveEditor curve={config.curve} onChange={(c) => set('curve', c)} />
      </Group>

      <Group title="Tempo">
        <Check
          checked={config.bpmRange != null}
          onChange={(v) => set('bpmRange', v ? { min: 110, max: 130 } : null)}
          label="Limit the BPM range"
        />
        {config.bpmRange && (
          <div className="mt-2 flex items-center gap-2">
            <NumberInput value={config.bpmRange.min} min={30} max={300} onChange={(n) => set('bpmRange', { ...config.bpmRange!, min: n })} />
            <span className="text-zinc-500">to</span>
            <NumberInput value={config.bpmRange.max} min={30} max={300} onChange={(n) => set('bpmRange', { ...config.bpmRange!, max: n })} />
            <span className="text-zinc-500">BPM</span>
          </div>
        )}
        <BpmHistogram options={options} range={config.bpmRange} />
        <label className="mt-3 block">
          <span className="flex justify-between text-zinc-300">
            Max tempo step <span className="tabular-nums text-zinc-400">{config.maxBpmStepPct} %</span>
          </span>
          <input
            type="range"
            min={1}
            max={15}
            step={0.5}
            value={config.maxBpmStepPct}
            onChange={(e) => set('maxBpmStepPct', Number(e.target.value))}
            className="w-full accent-brand"
          />
          <span className="text-xs text-zinc-500">DJs pitch tracks by about 6 %. Under 3 % is ideal.</span>
        </label>
        <div className="mt-2">
          <Check checked={config.allowHalfDouble} onChange={(v) => set('allowHalfDouble', v)} label="Half and double time match (85 ↔ 170)" />
        </div>
      </Group>

      <Group title="Key" hint="Camelot wheel distance between neighbours.">
        <Segmented
          value={config.keyStrictness}
          options={[
            { value: 'strict', label: 'Strict (≤ 1)', title: 'Same key, a neighbour, or relative major/minor only' },
            { value: 'relaxed', label: 'Relaxed (≤ 2)', title: 'Also allows two steps and diagonal moves' },
            { value: 'off', label: 'Off', title: 'Ignore keys' },
          ]}
          onChange={(v) => set('keyStrictness', v)}
        />
      </Group>

      <Group title="Artist spacing">
        <div className="flex items-center gap-2">
          <span className="text-zinc-300">No same artist within</span>
          <NumberInput value={config.artistSpacing} min={0} max={20} onChange={(n) => set('artistSpacing', n)} />
          <span className="text-zinc-300">tracks</span>
        </div>
      </Group>

      <Group title="Transitions" hint="Defaults for the Transition Sheet.">
        <div className="flex items-center gap-2">
          <span className="text-zinc-300" title={BARS_NOTE}>
            Default length
          </span>
          <Segmented
            value={String(tr.defaultBars)}
            options={['4', '8', '16'].map((b) => ({ value: b, label: `${b} bars`, title: BARS_NOTE }))}
            onChange={(b) => setTr({ defaultBars: Number(b) as 4 | 8 | 16 })}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {(['Fade', 'Rise', 'Blend'] as const).map((s) => (
            <Check
              key={s}
              checked={tr.styles[s]}
              onChange={(v) => setTr({ styles: { ...tr.styles, [s]: v } })}
              title={TRANSITION_STYLES[s].about}
              label={
                <>
                  {s}
                  {TRANSITION_STYLES[s].status === 'likely' && (
                    <Badge tone="warn" title={TRANSITION_STYLES[s].about}>
                      unverified
                    </Badge>
                  )}
                </>
              }
            />
          ))}
        </div>
        <div className="mt-3 space-y-1">
          {RULES.map((r) => (
            <Check key={r.id} checked={tr.rules[r.id]} onChange={(v) => setTr({ rules: { ...tr.rules, [r.id]: v } })} label={r.label} />
          ))}
        </div>
      </Group>
    </div>
  );
}

function PlaylistPicker({
  options,
  selected,
  onChange,
}: {
  options: DjPoolOptions | undefined;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  if (!options) return <p className="text-zinc-500">Loading playlists…</p>;
  if (options.playlists.length === 0) return <p className="text-zinc-500">No owned playlists yet. Run Sync first.</p>;
  const shown = options.playlists.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
        <span>Playlists ({selected.length} chosen)</span>
        {selected.length > 0 && (
          <button className="hover:text-zinc-300" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a playlist"
        className="mb-1 w-full rounded bg-zinc-800 px-2 py-1 text-sm placeholder:text-zinc-500"
      />
      <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
        {shown.map((p) => (
          <Check
            key={p.id}
            checked={selected.includes(p.id)}
            onChange={(v) => toggle(p.id, v)}
            title={`${p.withBpm} of ${p.tracks} tracks have a BPM`}
            label={
              <span className="flex min-w-0 flex-1 justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {p.withBpm}/{p.tracks}
                </span>
              </span>
            }
          />
        ))}
      </div>
    </div>
  );
}

function LibraryFilter({
  filter,
  options,
  onChange,
}: {
  filter: DjLibraryFilter;
  options: DjPoolOptions | undefined;
  onChange: (f: Partial<DjLibraryFilter>) => void;
}) {
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="mt-2 space-y-3 border-l border-zinc-800 pl-3">
      <Check checked={filter.likedOnly} onChange={(v) => onChange({ likedOnly: v })} label="Liked Songs only" />
      {options && options.tags.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-zinc-500">Tags (any)</div>
          <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {options.tags.map((t) => (
              <Chip key={t.tag} on={filter.tags.includes(t.tag)} onClick={() => onChange({ tags: toggleIn(filter.tags, t.tag) })}>
                {t.tag} <span className="text-zinc-500">{t.count}</span>
              </Chip>
            ))}
          </div>
        </div>
      )}
      {options && options.decades.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-zinc-500">Decades</div>
          <div className="flex flex-wrap gap-1">
            {options.decades.map((d) => (
              <Chip key={d.decade} on={filter.decades.includes(d.decade)} onClick={() => onChange({ decades: toggleIn(filter.decades, d.decade) })}>
                {String(d.decade).slice(2)}s <span className="text-zinc-500">{d.count}</span>
              </Chip>
            ))}
          </div>
        </div>
      )}
      <RangeRow label="BPM" min={filter.bpmMin} max={filter.bpmMax} step={1} onChange={(a, b) => onChange({ bpmMin: a, bpmMax: b })} />
      <RangeRow label="Energy" min={filter.energyMin} max={filter.energyMax} step={0.05} onChange={(a, b) => onChange({ energyMin: a, energyMax: b })} />
    </div>
  );
}

function RangeRow({
  label,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  min: number | null;
  max: number | null;
  step: number;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const parse = (s: string) => (s.trim() === '' ? null : Number(s));
  const cls = 'w-20 rounded bg-zinc-800 px-2 py-1 tabular-nums placeholder:text-zinc-600';
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-zinc-300">{label}</span>
      <input className={cls} type="number" step={step} placeholder="min" value={min ?? ''} onChange={(e) => onChange(parse(e.target.value), max)} />
      <span className="text-zinc-500">–</span>
      <input className={cls} type="number" step={step} placeholder="max" value={max ?? ''} onChange={(e) => onChange(min, parse(e.target.value))} />
    </div>
  );
}

function CurveEditor({ curve, onChange }: { curve: DjCurve; onChange: (c: DjCurve) => void }) {
  const points = curvePoints(curve);
  return (
    <div className="space-y-2">
      <select
        value={curve.preset}
        onChange={(e) => {
          const v = e.target.value as CurvePreset | 'custom';
          onChange(v === 'custom' ? { preset: 'custom', points: [...points] } : { preset: v });
        }}
        className="w-full rounded bg-zinc-800 px-2 py-1"
      >
        {Object.entries(CURVE_PRESETS).map(([id, p]) => (
          <option key={id} value={id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom</option>
      </select>
      <CurvePreview curve={curve} />
      {curve.preset === 'custom' && (
        <div className="space-y-1">
          <div className="flex items-end gap-1">
            {curve.points.map((v, i) => (
              <input
                key={i}
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={v}
                aria-label={`Point ${i + 1}`}
                title={`Point ${i + 1}: ${v.toFixed(2)}`}
                onChange={(e) => onChange({ preset: 'custom', points: curve.points.map((p, j) => (j === i ? Number(e.target.value) : p)) })}
                className="h-24 min-w-0 flex-1 accent-brand [writing-mode:vertical-lr] [direction:rtl]"
              />
            ))}
          </div>
          <div className="flex gap-2 text-xs">
            <button
              className="text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
              disabled={curve.points.length >= 12}
              onClick={() => onChange({ preset: 'custom', points: [...curve.points, curve.points.at(-1) ?? 0.6] })}
            >
              + point
            </button>
            <button
              className="text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
              disabled={curve.points.length <= 2}
              onClick={() => onChange({ preset: 'custom', points: curve.points.slice(0, -1) })}
            >
              − point
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CurvePreview({ curve }: { curve: DjCurve }) {
  const w = 240;
  const h = 56;
  const pts = Array.from({ length: 41 }, (_, i) => {
    const p = i / 40;
    return `${(p * w).toFixed(1)},${(h - 4 - curveTarget(curve, p) * (h - 8)).toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full rounded bg-zinc-900" role="img" aria-label="Energy Curve preview">
      <line x1={0} x2={w} y1={h / 2} y2={h / 2} className="stroke-zinc-800" strokeDasharray="2 3" />
      <polyline points={pts.join(' ')} fill="none" stroke="#3987e5" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function BpmHistogram({ options, range }: { options: DjPoolOptions | undefined; range: DjSetConfig['bpmRange'] }) {
  const bins = options?.bpmHistogram ?? [];
  if (bins.length === 0) return null;
  const max = Math.max(...bins.map((b) => b.count));
  const lo = bins[0]!.bpm;
  const hi = bins.at(-1)!.bpm + 10;
  const w = 240;
  const h = 40;
  const bw = (w / (hi - lo)) * 10;
  return (
    <figure className="mt-2">
      <svg viewBox={`0 0 ${w} ${h + 12}`} className="w-full" role="img" aria-label="Library tracks per BPM">
        {bins.map((b) => {
          const inRange = !range || (b.bpm + 10 > range.min && b.bpm <= range.max);
          const bh = Math.max(1, (b.count / max) * h);
          return (
            <rect
              key={b.bpm}
              x={((b.bpm - lo) / (hi - lo)) * w + 1}
              y={h - bh}
              width={Math.max(1, bw - 2)}
              height={bh}
              rx={1.5}
              className={inRange ? 'fill-zinc-400' : 'fill-zinc-700'}
            >
              <title>{`${b.bpm}–${b.bpm + 9} BPM: ${b.count} tracks`}</title>
            </rect>
          );
        })}
        <text x={0} y={h + 11} className="fill-zinc-500 text-[9px]">
          {lo}
        </text>
        <text x={w} y={h + 11} textAnchor="end" className="fill-zinc-500 text-[9px]">
          {hi} BPM
        </text>
      </svg>
      <figcaption className="text-xs text-zinc-500">Your Library by BPM. Hover a bar for the count.</figcaption>
    </figure>
  );
}

// ---- small controls ---------------------------------------------------------

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="font-medium text-zinc-100">{title}</h3>
      {hint && <p className="mb-2 text-xs text-zinc-500">{hint}</p>}
      {!hint && <div className="mb-2" />}
      {children}
    </section>
  );
}

function Check({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; title?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-zinc-300 hover:text-zinc-100" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-brand" />
      {label}
    </label>
  );
}

function Count({ n }: { n: number | undefined }) {
  return n == null ? null : <span className="text-xs tabular-nums text-zinc-500">({n})</span>;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx('rounded-full px-2 py-0.5 text-xs', on ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}
    >
      {children}
    </button>
  );
}

/** Commits on blur or Enter, so typing "120" does not clamp at "1". */
function NumberInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) return setDraft(String(value));
    const clamped = Math.min(max, Math.max(min, n));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="w-20 rounded bg-zinc-800 px-2 py-1 tabular-nums"
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-zinc-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx('rounded-full px-3 py-1 text-xs', o.value === value ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:text-zinc-100')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
