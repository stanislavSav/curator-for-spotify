import { useEffect, useState, type ReactNode } from 'react';
import {
  CURVE_PRESETS,
  curvePoints,
  curveTarget,
  SHEET_STYLES,
  TRANSITION_COLOURS,
  type CurvePreset,
  type DjCurve,
  type DjLibraryFilter,
  type DjPoolOptions,
  type DjSetConfig,
  type DjTransitionRules,
  type SheetStyle,
  type TimeRange,
  type TransitionColour,
} from '@curator/shared';
import { cx } from '../../components/ui.tsx';
import {
  advancedSummary,
  KEY_LABELS,
  keySummary,
  poolSummary,
  shapeSummary,
  tempoSummary,
  transitionsSummary,
} from './summaries.ts';

type Props = {
  config: DjSetConfig;
  onChange: (c: DjSetConfig) => void;
  /** The Set Templates row at the top. */
  templates: ReactNode;
  options: DjPoolOptions | undefined;
  /** Usable tracks in the last preview, for the Pool summary. */
  usable: number | null;
  /** Always visible under the sections (rebuild status, Regenerate). */
  footer: ReactNode;
};

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
  { id: 'longBlendWhenCompatible', label: 'Long blend with a bass swap when key and tempo match' },
  { id: 'riseOnEnergyJump', label: 'Build (high-pass in) when energy jumps' },
  { id: 'shortFadeOnClash', label: 'Short and masked on a clash; hard cut when it is big' },
  { id: 'autoWhenUnknown', label: 'Leave on Auto when a key is unknown' },
];

const BARS_NOTE = 'Bars are a length to aim for: 2, 4 or 8, and 16 for some tracks. Spotify sets the exact length, and shows no bar choice when it finds no clear beat.';

type SectionId = 'pool' | 'shape' | 'tempo' | 'key' | 'transitions' | 'advanced';

export function ConfigPanel({ config, onChange, templates, options, usable, footer }: Props) {
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    pool: true,
    shape: true,
    tempo: false,
    key: false,
    transitions: false,
    advanced: false,
  });
  const section = (id: SectionId) => ({ open: open[id], onToggle: () => setOpen({ ...open, [id]: !open[id] }) });
  const set = <K extends keyof DjSetConfig>(key: K, value: DjSetConfig[K]) => onChange({ ...config, [key]: value });
  const pool = config.pool;
  const setPool = (p: Partial<DjSetConfig['pool']>) => set('pool', { ...pool, ...p });
  const lib = pool.library;
  const setLib = (f: Partial<DjLibraryFilter>) => setPool({ library: { ...(lib ?? EMPTY_FILTER), ...f } });
  const tr = config.transitions;
  const setTr = (t: Partial<DjSetConfig['transitions']>) => set('transitions', { ...tr, ...t });

  return (
    <div className="flex min-h-0 flex-1 flex-col text-sm">
      {templates}

      <div className="min-h-0 flex-1 divide-y divide-zinc-800 lg:overflow-y-auto">
        <Section title="Pool" summary={poolSummary(pool, usable)} {...section('pool')}>
          <p className="text-xs text-zinc-500">The tracks the set may use. Sources add up.</p>
          <PlaylistPicker options={options} selected={pool.playlistIds} onChange={(ids) => setPool({ playlistIds: ids })} />
          <div className="space-y-1">
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
          <div>
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
        </Section>

        <Section title="Shape" summary={shapeSummary(config)} {...section('shape')}>
          <div className="flex items-center gap-2">
            <Segmented
              value={config.length.mode}
              options={[
                { value: 'minutes', label: 'Minutes' },
                { value: 'tracks', label: 'Tracks' },
              ]}
              onChange={(mode) => set('length', mode === 'minutes' ? { mode, minutes: 60 } : { mode: 'tracks', count: 20 })}
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
          <div>
            <div className="mb-1 text-xs text-zinc-500">Energy Curve: the target energy from the first to the last track.</div>
            <CurveEditor curve={config.curve} onChange={(c) => set('curve', c)} />
          </div>
        </Section>

        <Section title="Tempo" summary={tempoSummary(config)} {...section('tempo')}>
          <Check
            checked={config.bpmRange != null}
            onChange={(v) => set('bpmRange', v ? { min: 110, max: 130 } : null)}
            label="Limit the BPM range"
          />
          {config.bpmRange && (
            <div className="flex items-center gap-2">
              <NumberInput value={config.bpmRange.min} min={30} max={300} onChange={(n) => set('bpmRange', { ...config.bpmRange!, min: n })} />
              <span className="text-zinc-500">to</span>
              <NumberInput value={config.bpmRange.max} min={30} max={300} onChange={(n) => set('bpmRange', { ...config.bpmRange!, max: n })} />
              <span className="text-zinc-500">BPM</span>
            </div>
          )}
          <BpmHistogram options={options} range={config.bpmRange} />
          <label className="block">
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
        </Section>

        <Section title="Key" summary={keySummary(config)} {...section('key')}>
          <p className="text-xs text-zinc-500">Camelot wheel distance between neighbours.</p>
          <Segmented
            value={config.keyStrictness}
            options={[
              { value: 'strict', label: KEY_LABELS.strict, title: 'Same key, a neighbour, or relative major/minor only' },
              { value: 'relaxed', label: KEY_LABELS.relaxed, title: 'Also allows two steps and diagonal moves' },
              { value: 'off', label: KEY_LABELS.off, title: 'Ignore keys' },
            ]}
            onChange={(v) => set('keyStrictness', v)}
          />
        </Section>

        <Section title="Transitions" summary={transitionsSummary(config)} {...section('transitions')}>
          <div>
            <div className="mb-1 text-xs text-zinc-500">Sheet Style: the flavour of the suggested transitions.</div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(SHEET_STYLES) as SheetStyle[]).map((id) => (
                <Chip key={id} on={tr.sheetStyle === id} title={SHEET_STYLES[id].about} onClick={() => setTr({ sheetStyle: id })}>
                  {SHEET_STYLES[id].label}
                </Chip>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-400">{SHEET_STYLES[tr.sheetStyle].about}</p>
          </div>
          <div>
            <div className="mb-1 text-xs text-zinc-500">Colour: how many filters, effects and loops clean blends get.</div>
            <Segmented
              value={tr.colour}
              options={(Object.keys(TRANSITION_COLOURS) as TransitionColour[]).map((id) => ({
                value: id,
                label: TRANSITION_COLOURS[id].label,
                title: TRANSITION_COLOURS[id].about,
              }))}
              onChange={(colour) => setTr({ colour })}
            />
            <p className="mt-1 text-xs text-zinc-400">{TRANSITION_COLOURS[tr.colour].about}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-300" title={BARS_NOTE}>
              Default length
            </span>
            <Segmented
              value={String(tr.defaultBars)}
              options={['4', '8', '16'].map((b) => ({ value: b, label: `${b} bars`, title: BARS_NOTE }))}
              onChange={(b) => setTr({ defaultBars: b === '4' ? 4 : b === '16' ? 16 : 8 })}
            />
          </div>
        </Section>

        <Section title="Advanced" summary={advancedSummary(config)} {...section('advanced')}>
          <Check checked={config.allowHalfDouble} onChange={(v) => set('allowHalfDouble', v)} label="Half and double time match (85 ↔ 170)" />
          <div className="flex items-center gap-2">
            <span className="text-zinc-300">No same artist within</span>
            <NumberInput value={config.artistSpacing} min={0} max={20} onChange={(n) => set('artistSpacing', n)} />
            <span className="text-zinc-300">tracks</span>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-zinc-500">Transition rules</div>
            {RULES.map((r) => (
              <Check key={r.id} checked={tr.rules[r.id]} onChange={(v) => setTr({ rules: { ...tr.rules, [r.id]: v } })} label={r.label} />
            ))}
          </div>
        </Section>
      </div>

      <div className="sticky bottom-0 border-t border-zinc-800 bg-zinc-900 px-4 py-3">{footer}</div>
    </div>
  );
}

function Section({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-zinc-800/40"
      >
        <span aria-hidden className={cx('inline-block w-3 text-zinc-500 transition-transform', open && 'rotate-90')}>
          ›
        </span>
        <span className="shrink-0 font-medium text-zinc-100">{title}</span>
        {!open && <span className="ml-auto min-w-0 truncate text-xs text-zinc-500" title={summary}>{summary}</span>}
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </section>
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
      <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
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

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={cx('rounded-full px-2.5 py-1 text-xs', on ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}
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
