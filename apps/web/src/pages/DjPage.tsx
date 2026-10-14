import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  normaliseDjConfig,
  type DjCreateRequest,
  type DjPoolOptions,
  type DjSetConfig,
  type DjSetRecord,
  type DjSetResult,
  type DjSetSummary,
  type DjTransitionPatch,
  type Job,
} from '@curator/shared';
import { api, useJob } from '../api.ts';
import { Button, Card, Empty, ErrorNote, JobProgress, Stat } from '../components/ui.tsx';
import { HowToApply, SheetExportButtons } from './dj/ApplyPanel.tsx';
import { ApplyMode } from './dj/ApplyMode.tsx';
import { ConfigPanel } from './dj/ConfigPanel.tsx';
import { appliedCount, editResult } from './dj/edits.ts';
import { shapeOf, useDjSet, useLivePreview, useNow } from './dj/hooks.ts';
import { SetChart } from './dj/SetChart.tsx';
import { fmtDuration } from './dj/sheet.ts';
import { rebuiltAgo } from './dj/summaries.ts';
import { loadConfig, saveConfig } from './dj/templates.ts';
import { AppliedProgress, TrackList, TransitionSheet } from './dj/TransitionSheet.tsx';

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
const today = () => new Date().toISOString().slice(0, 10);
const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// Owned by the dj feature.
export function DjPage() {
  const qc = useQueryClient();
  const [config, setConfigState] = useState(loadConfig);
  const [seed, setSeed] = useState(randomSeed);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const now = useNow();

  /** Any settings change rebuilds the preview and returns to the builder. */
  const setConfig = (c: DjSetConfig) => {
    setConfigState(c);
    saveConfig(c);
    setViewingId(null);
  };
  const view = (id: string | null) => {
    setApplyOpen(false);
    setViewingId(id);
  };

  const options = useQuery({ queryKey: ['dj', 'pool-options'], queryFn: () => api<DjPoolOptions>('/api/dj/pool-options') });
  const history = useQuery({ queryKey: ['dj', 'sets'], queryFn: () => api<DjSetSummary[]>('/api/dj/sets') });
  const live = useLivePreview(config, seed);
  const built = live.built;
  const saved = useDjSet(viewingId);

  const create = useMutation({
    mutationFn: (req: DjCreateRequest) => api<{ job: Job; setId: string }>('/api/dj/sets', { method: 'POST', json: req }),
  });
  const job = useJob(create.data?.job.id ?? null);
  const jobDone = job.data?.status === 'done';
  const creating = create.isPending || job.data?.status === 'running';
  const [justCreated, setJustCreated] = useState<string | null>(null);
  useEffect(() => {
    if (!jobDone || !create.data) return;
    void qc.invalidateQueries({ queryKey: ['dj', 'sets'] });
    setJustCreated(create.data.setId);
    view(create.data.setId);
  }, [jobDone, create.data?.setId]);
  // A new preview is a new set: allow creating it.
  useEffect(() => {
    if (!creating) create.reset();
  }, [built?.at]);

  const stale = built != null && shapeOf(built.config) !== shapeOf(config);
  const record = viewingId ? saved.record : undefined;

  const footer = (
    <div className="space-y-2">
      {config.excludedTrackIds.length + config.lockedTrackIds.length > 0 && (
        <div className="space-y-0.5 text-xs text-zinc-400">
          {config.lockedTrackIds.length > 0 && (
            <FooterLine label={`${config.lockedTrackIds.length} locked track(s)`} action="Unlock all" onClick={() => setConfig({ ...config, lockedTrackIds: [] })} />
          )}
          {config.excludedTrackIds.length > 0 && (
            <FooterLine label={`${config.excludedTrackIds.length} removed track(s)`} action="Bring back" onClick={() => setConfig({ ...config, excludedTrackIds: [] })} />
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs text-zinc-400" aria-live="polite">
          {live.pending ? (
            <>
              <Spinner /> Rebuilding…
            </>
          ) : live.error ? (
            <span className="text-red-300">Rebuild failed</span>
          ) : built ? (
            `${rebuiltAgo(built.at, now)} · ${built.result.tracks.length} tracks`
          ) : null}
        </span>
        <Button
          onClick={() => {
            setSeed(randomSeed());
            view(null);
          }}
          title="Build again with another random seed. Edits stay on pairs that remain."
        >
          Regenerate
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">DJ Set</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Build a playlist ordered for smooth transitions by BPM, Camelot key and an Energy Curve. Choose a Pool on the
          left; the set rebuilds as you change settings. Check the Transition Sheet, create the playlist on Spotify,
          then set each transition in Spotify › Mix and tick it here.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start">
          <ConfigPanel
            config={config}
            onChange={setConfig}
            options={options.data}
            usable={built?.result.pool.usable ?? null}
            footer={footer}
          />
          {options.error != null && (
            <div className="p-3">
              <ErrorNote error={options.error} />
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {viewingId ? (
            record ? (
              <SavedSetView
                record={record}
                justCreated={justCreated === record.id}
                onUpdate={saved.update}
                onApply={() => setApplyOpen(true)}
                onClose={() => view(null)}
                onUseSettings={() => setConfig(normaliseDjConfig(record.config))}
                error={saved.error}
              />
            ) : (
              <Card>
                <ErrorNote error={saved.error} />
                {saved.loading && <Empty>Loading the set…</Empty>}
              </Card>
            )
          ) : built ? (
            <>
              <ErrorNote error={live.error} />
              <ResultSummary result={built.result} />
              <CarryNote carried={built.carried} />
              <Card title="Energy and tempo">
                <SetChart result={built.result} foldHalfDouble={built.config.allowHalfDouble} />
              </Card>
              <TracksCard result={built.result}>
                <TrackList
                  result={built.result}
                  actions={{
                    lockedIds: config.lockedTrackIds,
                    startId: config.startTrackId,
                    onLock: (id) => setConfig({ ...config, lockedTrackIds: toggleIn(config.lockedTrackIds, id) }),
                    onStart: (id) => setConfig({ ...config, startTrackId: config.startTrackId === id ? null : id }),
                    onRemove: (id) =>
                      setConfig({
                        ...config,
                        excludedTrackIds: [...config.excludedTrackIds, id],
                        lockedTrackIds: config.lockedTrackIds.filter((x) => x !== id),
                        startTrackId: config.startTrackId === id ? null : config.startTrackId,
                      }),
                  }}
                />
              </TracksCard>
              <Card
                title="Transition Sheet"
                actions={
                  <>
                    <Button variant="ghost" onClick={() => setApplyOpen(true)} disabled={built.result.transitions.length === 0} title="One transition at a time, full screen">
                      Apply mode
                    </Button>
                    <SheetExportButtons result={built.result} />
                  </>
                }
              >
                <p className="mb-3 text-xs text-zinc-500">
                  A suggestion for each pair. Press Edit on a card to change it; your edits go with the playlist when you
                  create it. An edit stays through a rebuild as long as the same two tracks still follow each other.
                </p>
                <TransitionSheet
                  result={built.result}
                  maxBpmStepPct={built.config.maxBpmStepPct}
                  defaultBars={built.config.transitions.defaultBars}
                  onEdit={(i, s) => live.edit((r) => editResult(r, i, s))}
                />
              </Card>
              <CreatePanel
                disabled={built.result.tracks.length === 0 || stale || live.pending}
                busy={live.pending || stale}
                onCreate={(name) => create.mutate({ name, config: built.config, result: built.result })}
                running={creating}
                error={create.error}
                job={job.data}
              />
              {applyOpen && (
                <ApplyMode result={built.result} maxBpmStepPct={built.config.maxBpmStepPct} spotifyUrl={null} onClose={() => setApplyOpen(false)} />
              )}
            </>
          ) : (
            <Card>
              <ErrorNote error={live.error} />
              <Empty>
                {live.pending ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner /> Building a preview… This does not change anything on Spotify.
                  </span>
                ) : (
                  <>No set yet. Choose a Pool and the set shape on the left. Building does not change anything on Spotify.</>
                )}
              </Empty>
            </Card>
          )}

          {record && applyOpen && (
            <ApplyMode
              result={record.result}
              maxBpmStepPct={normaliseDjConfig(record.config).maxBpmStepPct}
              spotifyUrl={record.spotifyUrl}
              onApplied={(i, v) => saved.update(i, { applied: v })}
              onClose={() => setApplyOpen(false)}
            />
          )}

          <Card title="Earlier sets">
            <ErrorNote error={history.error} />
            {history.data?.length ? (
              <ul className="divide-y divide-zinc-800 text-sm">
                {history.data.map((s) => {
                  const pairs = Math.max(0, s.tracks - 1);
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{s.name}</div>
                        <div className="text-xs text-zinc-500">
                          {s.createdAt.slice(0, 10)} · {s.tracks} tracks · {fmtDuration(s.durationMs)} · score {s.score} ·{' '}
                          <span className={s.applied >= pairs && pairs > 0 ? 'text-brand' : undefined}>
                            {s.applied ?? 0}/{pairs} applied
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {s.spotifyUrl && (
                          <a href={s.spotifyUrl} target="_blank" rel="noreferrer" className="rounded-full px-3 py-1 text-sm text-brand hover:bg-zinc-800">
                            Open in Spotify
                          </a>
                        )}
                        <Button variant={viewingId === s.id ? 'secondary' : 'ghost'} onClick={() => view(s.id)}>
                          {(s.applied ?? 0) < pairs ? 'Continue applying' : 'View sheet'}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Sets you create on Spotify appear here with their Transition Sheet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return <span aria-hidden className="inline-block size-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />;
}

function FooterLine({ label, action, onClick }: { label: string; action: string; onClick: () => void }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <button className="hover:text-zinc-100" onClick={onClick}>
        {action}
      </button>
    </div>
  );
}

function CarryNote({ carried }: { carried: { kept: number; dropped: number } }) {
  if (carried.kept + carried.dropped === 0) return null;
  return (
    <p className={carried.dropped ? 'rounded bg-amber-950/50 p-2 text-sm text-amber-300' : 'text-xs text-zinc-500'}>
      {carried.kept > 0 && `Kept your edits on ${carried.kept} transition(s). `}
      {carried.dropped > 0 &&
        `${carried.dropped} edited transition(s) are gone because those two tracks no longer follow each other. Lock tracks to keep pairs together.`}
    </p>
  );
}

function TracksCard({ result, children }: { result: DjSetResult; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="text-base font-semibold">
          <span aria-hidden className="mr-2 inline-block text-zinc-500 transition-transform group-open:rotate-90">
            ›
          </span>
          Tracks ({result.tracks.length})
        </span>
        <span className="text-xs text-zinc-500">Lock, start or remove tracks</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function ResultSummary({ result }: { result: DjSetResult }) {
  const s = result.score;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tracks" value={result.tracks.length} />
        <Stat label="Length" value={fmtDuration(result.durationMs)} />
        <Stat
          label="Score"
          value={`${s.total}/100`}
          hint={`Smooth tempo: ${pct(s.bpmSmooth)} of pairs. Compatible keys: ${pct(s.keyCompatible)}. Energy fit: ${pct(s.energyFit)}. Artist repeats: ${s.artistRepeats}.`}
        />
        <Stat
          label="Pool used"
          value={`${result.pool.usable}/${result.pool.total}`}
          hint="Usable tracks (BPM known, inside the BPM range) out of all Pool tracks"
        />
      </div>
      <div className="flex flex-wrap gap-x-4 text-xs text-zinc-400">
        <span>Smooth tempo {pct(s.bpmSmooth)}</span>
        <span>Compatible keys {pct(s.keyCompatible)}</span>
        <span>Energy fit {pct(s.energyFit)}</span>
        <span>Artist repeats {s.artistRepeats}</span>
        <span>Seed {result.seed}</span>
      </div>
      {result.warnings.length > 0 && (
        <ul className="space-y-1 rounded bg-zinc-900 p-3 text-sm text-amber-300">
          {result.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreatePanel({
  disabled,
  busy,
  onCreate,
  running,
  error,
  job,
}: {
  disabled: boolean;
  busy: boolean;
  onCreate: (name: string) => void;
  running: boolean;
  error: unknown;
  job: Job | undefined;
}) {
  const [name, setName] = useState(`DJ Set ${today()}`);
  const [asking, setAsking] = useState(false);

  return (
    <Card title="Create on Spotify">
      <p className="mb-3 text-sm text-zinc-400">
        This makes a new private playlist in this order, with this Transition Sheet and your edits. It does not change
        any existing playlist.
        {busy && ' Wait for the rebuild to finish.'}
      </p>
      {asking ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onCreate(name.trim());
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            aria-label="Playlist name"
            className="min-w-60 flex-1 rounded bg-zinc-800 px-3 py-1.5 text-sm"
          />
          <Button variant="primary" type="submit" disabled={disabled || running || !name.trim()}>
            {running ? 'Creating…' : 'Create playlist'}
          </Button>
          <Button variant="ghost" type="button" onClick={() => setAsking(false)} disabled={running}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button variant="primary" disabled={disabled} onClick={() => setAsking(true)}>
          Create on Spotify
        </Button>
      )}
      <div className="mt-3 space-y-2">
        <ErrorNote error={error} />
        <JobProgress job={job} />
      </div>
    </Card>
  );
}

function SavedSetView({
  record,
  justCreated,
  onUpdate,
  onApply,
  onClose,
  onUseSettings,
  error,
}: {
  record: DjSetRecord;
  justCreated: boolean;
  onUpdate: (index: number, body: DjTransitionPatch) => void;
  onApply: () => void;
  onClose: () => void;
  onUseSettings: () => void;
  error: unknown;
}) {
  const config = normaliseDjConfig(record.config);
  const total = record.result.transitions.length;
  return (
    <>
      <Card
        title={record.name}
        actions={
          <>
            <Button variant="ghost" onClick={onUseSettings} title="Copy this set's settings into the panel on the left">
              Use these settings
            </Button>
            <Button onClick={onClose}>Back to builder</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-zinc-400">
          {justCreated ? `“${record.name}” is a new private playlist with ${record.tracks} tracks. ` : `Created ${record.createdAt.slice(0, 10)}. `}
          Set each transition in Spotify, then tick it below. Your ticks and edits are saved here; the app never
          changes the playlist on Spotify.{' '}
          {record.spotifyUrl && (
            <a href={record.spotifyUrl} target="_blank" rel="noreferrer" className="text-brand underline">
              Open it in Spotify
            </a>
          )}
        </p>
        <details open={justCreated}>
          <summary className="cursor-pointer text-sm text-zinc-300">How to apply in Spotify</summary>
          <div className="mt-2">
            <HowToApply url={record.spotifyUrl} />
          </div>
        </details>
      </Card>
      <ErrorNote error={error} />
      <Card
        title={
          <span className="flex flex-wrap items-center gap-3">
            Transition Sheet <AppliedProgress done={appliedCount(record.result)} total={total} />
          </span>
        }
        actions={
          <>
            <Button variant="primary" onClick={onApply} disabled={total === 0} title="One transition at a time, full screen">
              Apply mode
            </Button>
            <SheetExportButtons result={record.result} name={record.name} applied />
          </>
        }
      >
        <TransitionSheet
          result={record.result}
          maxBpmStepPct={config.maxBpmStepPct}
          defaultBars={config.transitions.defaultBars}
          onEdit={(i, s) => onUpdate(i, { settings: s })}
          onApplied={(i, v) => onUpdate(i, { applied: v })}
        />
      </Card>
      <ResultSummary result={record.result} />
      <Card title="Energy and tempo">
        <SetChart result={record.result} foldHalfDouble={config.allowHalfDouble} />
      </Card>
      <TracksCard result={record.result}>
        <TrackList result={record.result} />
      </TracksCard>
    </>
  );
}
