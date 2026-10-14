import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DjCreateRequest,
  DjPoolOptions,
  DjSetConfig,
  DjSetRecord,
  DjSetResult,
  DjSetSummary,
  Job,
} from '@curator/shared';
import { api, useJob } from '../api.ts';
import { Button, Card, Empty, ErrorNote, JobProgress, Stat } from '../components/ui.tsx';
import { HowToApply, SheetExportButtons } from './dj/ApplyPanel.tsx';
import { ConfigPanel } from './dj/ConfigPanel.tsx';
import { loadConfig, saveConfig } from './dj/presets.ts';
import { SetChart } from './dj/SetChart.tsx';
import { fmtDuration } from './dj/sheet.ts';
import { TransitionSheet } from './dj/TransitionSheet.tsx';

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
const today = () => new Date().toISOString().slice(0, 10);
/** Locks only matter for the next build, so they do not make the shown set stale. */
const shapeOf = (c: DjSetConfig) => JSON.stringify({ ...c, lockedTrackIds: [] });

// Owned by the dj feature.
export function DjPage() {
  const qc = useQueryClient();
  const [config, setConfigState] = useState(loadConfig);
  const setConfig = (c: DjSetConfig) => {
    setConfigState(c);
    saveConfig(c);
  };
  const [seed, setSeed] = useState(randomSeed);
  const [built, setBuilt] = useState<{ config: DjSetConfig; result: DjSetResult } | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const options = useQuery({ queryKey: ['dj', 'pool-options'], queryFn: () => api<DjPoolOptions>('/api/dj/pool-options') });
  const history = useQuery({ queryKey: ['dj', 'sets'], queryFn: () => api<DjSetSummary[]>('/api/dj/sets') });
  const viewing = useQuery({
    queryKey: ['dj', 'set', viewingId],
    queryFn: () => api<DjSetRecord>(`/api/dj/sets/${viewingId}`),
    enabled: viewingId != null,
  });

  const preview = useMutation({
    mutationFn: (req: { config: DjSetConfig; seed: number }) =>
      api<DjSetResult>('/api/dj/preview', { method: 'POST', json: req }),
    onSuccess: (result, req) => setBuilt({ config: req.config, result }),
  });
  const build = (c: DjSetConfig, s: number) => {
    setViewingId(null);
    create.reset();
    preview.mutate({ config: c, seed: s });
  };

  const create = useMutation({
    mutationFn: (req: DjCreateRequest) => api<{ job: Job; setId: string }>('/api/dj/sets', { method: 'POST', json: req }),
  });
  const job = useJob(create.data?.job.id ?? null);
  const jobDone = job.data?.status === 'done';
  const created = useQuery({
    queryKey: ['dj', 'set', create.data?.setId],
    queryFn: () => api<DjSetRecord>(`/api/dj/sets/${create.data!.setId}`),
    enabled: jobDone && create.data != null,
  });
  useEffect(() => {
    if (jobDone) void qc.invalidateQueries({ queryKey: ['dj', 'sets'] });
  }, [jobDone, qc]);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const actions = built && {
    lockedIds: config.lockedTrackIds,
    startId: config.startTrackId,
    busy: preview.isPending,
    onLock: (id: string) => setConfig({ ...config, lockedTrackIds: toggle(config.lockedTrackIds, id) }),
    onStart: (id: string) => {
      const c = { ...config, startTrackId: config.startTrackId === id ? null : id };
      setConfig(c);
      build(c, seed);
    },
    onRemove: (id: string) => {
      const c = {
        ...config,
        excludedTrackIds: [...config.excludedTrackIds, id],
        lockedTrackIds: config.lockedTrackIds.filter((x) => x !== id),
        startTrackId: config.startTrackId === id ? null : config.startTrackId,
      };
      setConfig(c);
      build(c, seed);
    },
  };

  const stale = built != null && shapeOf(built.config) !== shapeOf(config);
  const viewed = viewingId ? viewing.data : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">DJ Set</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Build a playlist ordered for smooth transitions by BPM, Camelot key and an Energy Curve. Choose a Pool on the
          left, then press <b>Build set</b>. Check the Transition Sheet, create the playlist on Spotify, and apply the
          transitions in Spotify › Mix.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <Card>
            <ConfigPanel config={config} onChange={setConfig} options={options.data} />
            {config.excludedTrackIds.length + config.lockedTrackIds.length > 0 && (
              <div className="mt-4 space-y-1 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
                {config.lockedTrackIds.length > 0 && (
                  <div className="flex justify-between">
                    <span>{config.lockedTrackIds.length} locked track(s)</span>
                    <button className="hover:text-zinc-100" onClick={() => setConfig({ ...config, lockedTrackIds: [] })}>
                      Unlock all
                    </button>
                  </div>
                )}
                {config.excludedTrackIds.length > 0 && (
                  <div className="flex justify-between">
                    <span>{config.excludedTrackIds.length} removed track(s)</span>
                    <button className="hover:text-zinc-100" onClick={() => setConfig({ ...config, excludedTrackIds: [] })}>
                      Bring back
                    </button>
                  </div>
                )}
              </div>
            )}
            <ErrorNote error={options.error} />
          </Card>
          <Button variant="primary" className="w-full justify-center" disabled={preview.isPending} onClick={() => build(config, seed)}>
            {preview.isPending ? 'Building…' : 'Build set'}
          </Button>
        </aside>

        <div className="min-w-0 space-y-6">
          <ErrorNote error={preview.error} />
          {viewed ? (
            <SavedSetView record={viewed} onClose={() => setViewingId(null)} onUseSettings={() => setConfig(viewed.config)} />
          ) : built ? (
            <>
              {stale && (
                <p className="rounded bg-amber-950/50 p-2 text-sm text-amber-300">
                  Settings changed. Press Build set to see them.
                </p>
              )}
              <ResultSummary result={built.result} />
              <Card
                title="Energy and tempo"
                actions={
                  <Button
                    disabled={preview.isPending}
                    onClick={() => {
                      const s = randomSeed();
                      setSeed(s);
                      build(config, s);
                    }}
                    title="Build again with another random seed"
                  >
                    Regenerate
                  </Button>
                }
              >
                <SetChart result={built.result} foldHalfDouble={built.config.allowHalfDouble} />
              </Card>
              <Card title="Transition Sheet" actions={<SheetExportButtons result={built.result} />}>
                <p className="mb-3 text-xs text-zinc-500">
                  One suggested Mix Transition per pair. These are suggestions; Spotify decides what is possible for each
                  pair. A * marks a style that Spotify has not confirmed. Lock tracks you want to keep, then Regenerate.
                </p>
                <TransitionSheet result={built.result} maxBpmStepPct={built.config.maxBpmStepPct} actions={actions ?? undefined} />
              </Card>
              <CreatePanel
                disabled={built.result.tracks.length === 0 || stale}
                onCreate={(name) => create.mutate({ name, config: built.config, result: built.result })}
                pending={create.isPending}
                error={create.error}
                job={job.data}
                created={created.data}
              />
            </>
          ) : (
            <Card>
              <Empty>
                No set yet. Choose a Pool and the set shape on the left, then press <b>Build set</b>. Building does not
                change anything on Spotify.
              </Empty>
            </Card>
          )}

          <Card title="Earlier sets">
            <ErrorNote error={history.error} />
            {history.data?.length ? (
              <ul className="divide-y divide-zinc-800 text-sm">
                {history.data.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{s.name}</div>
                      <div className="text-xs text-zinc-500">
                        {s.createdAt.slice(0, 10)} · {s.tracks} tracks · {fmtDuration(s.durationMs)} · score {s.score}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {s.spotifyUrl && (
                        <a href={s.spotifyUrl} target="_blank" rel="noreferrer" className="rounded-full px-3 py-1 text-sm text-brand hover:bg-zinc-800">
                          Open in Spotify
                        </a>
                      )}
                      <Button variant="ghost" onClick={() => setViewingId(s.id)}>
                        View sheet
                      </Button>
                    </div>
                  </li>
                ))}
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
  onCreate,
  pending,
  error,
  job,
  created,
}: {
  disabled: boolean;
  onCreate: (name: string) => void;
  pending: boolean;
  error: unknown;
  job: Job | undefined;
  created: DjSetRecord | undefined;
}) {
  const [name, setName] = useState(`DJ Set ${today()}`);
  const [asking, setAsking] = useState(false);
  const running = pending || job?.status === 'running';

  if (created) {
    return (
      <Card title="Created on Spotify">
        <p className="mb-3 text-sm text-zinc-300">
          “{created.name}” is a new private playlist with {created.tracks} tracks.{' '}
          {created.spotifyUrl && (
            <a href={created.spotifyUrl} target="_blank" rel="noreferrer" className="text-brand underline">
              Open it in Spotify
            </a>
          )}
        </p>
        <HowToApply url={created.spotifyUrl} />
      </Card>
    );
  }

  return (
    <Card title="Create on Spotify">
      <p className="mb-3 text-sm text-zinc-400">
        This makes a new private playlist in this order. It does not change any existing playlist.
        {disabled && ' Build the set with the current settings first.'}
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

function SavedSetView({ record, onClose, onUseSettings }: { record: DjSetRecord; onClose: () => void; onUseSettings: () => void }) {
  return (
    <>
      <Card
        title={record.name}
        actions={
          <>
            <Button variant="ghost" onClick={onUseSettings} title="Copy this set's settings into the form on the left">
              Use these settings
            </Button>
            <Button onClick={onClose}>Back to builder</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-zinc-400">
          Created {record.createdAt.slice(0, 10)}. This is a saved copy; the app never changes the playlist on Spotify.
        </p>
        <HowToApply url={record.spotifyUrl} />
      </Card>
      <ResultSummary result={record.result} />
      <Card title="Energy and tempo">
        <SetChart result={record.result} foldHalfDouble={record.config.allowHalfDouble} />
      </Card>
      <Card title="Transition Sheet" actions={<SheetExportButtons result={record.result} name={record.name} />}>
        <TransitionSheet result={record.result} maxBpmStepPct={record.config.maxBpmStepPct} />
      </Card>
    </>
  );
}
