import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  normaliseDjConfig,
  type DjCreateRequest,
  type DjDraftRequest,
  type DjDraftUpdate,
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
import { AGENT_NAMES, countAiChanges, mergeAiResult, pairKeys } from './dj/ai.ts';
import { AiPassBanner, AiPassButton, Spinner } from './dj/AiPass.tsx';
import { HowToApply, SheetExportButtons } from './dj/ApplyPanel.tsx';
import { ApplyMode } from './dj/ApplyMode.tsx';
import { ConfigPanel } from './dj/ConfigPanel.tsx';
import { DraftHeader } from './dj/DraftHeader.tsx';
import { EarlierSets } from './dj/EarlierSets.tsx';
import { appliedCount, editResult } from './dj/edits.ts';
import { useAiPass, useDjSet, useLivePreview, useNow, type AiTarget } from './dj/hooks.ts';
import { SetChart } from './dj/SetChart.tsx';
import { fmtDuration } from './dj/sheet.ts';
import { isDraft, suggestSetName, uniqueName } from './dj/saved.ts';
import { rebuiltAgo } from './dj/summaries.ts';
import { loadConfig, saveConfig } from './dj/templates.ts';
import { TemplatesRow } from './dj/TemplatesRow.tsx';
import { AppliedProgress, TrackList, TransitionSheet } from './dj/TransitionSheet.tsx';

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// Owned by the dj feature.
export function DjPage() {
  const qc = useQueryClient();
  const [config, setConfigState] = useState(loadConfig);
  const [seed, setSeed] = useState(randomSeed);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const now = useNow();

  /**
   * A settings change returns to the builder. Set settings wait for "Rebuild
   * set"; sheet settings only refresh the Transition Sheet (see useLivePreview).
   */
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
  /** The Current Set is this draft (opened from Earlier sets or saved from the builder); changes save to it. */
  const [fromDraft, setFromDraft] = useState<{ id: string; name: string } | null>(null);
  // The current set is restored from the server, with its seed and linked draft.
  const live = useLivePreview(config, seed, fromDraft, (w) => {
    setSeed(w.seed);
    setFromDraft(w.fromDraft);
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const built = live.built;
  const saved = useDjSet(viewingId);

  const aiPass = useAiPass((r, target) => {
    if (target.kind === 'set') {
      void qc.invalidateQueries({ queryKey: ['dj', 'sets'] });
      if (!r.set) {
        void qc.invalidateQueries({ queryKey: ['dj', 'set', target.setId] });
        return r.transitions.length;
      }
      qc.setQueryData(['dj', 'set', target.setId], r.set);
      return countAiChanges(r.set.result, r);
    }
    const changed = built ? countAiChanges(built.result, r, target.keys) : 0;
    live.edit((res) => mergeAiResult(res, r, target.keys));
    return changed;
  });
  /** The Current Set is a copy of this set on Spotify (opened from Earlier sets). */
  const [basedOn, setBasedOn] = useState<{ id: string; name: string; url: string | null } | null>(null);
  /** A saved set waiting to be opened, while the user decides about the unsaved Current Set. */
  const [pendingOpen, setPendingOpen] = useState<DjSetRecord | null>(null);
  /** What the linked draft already holds, so opening it does not save it again. */
  const draftSavedKey = useRef<string | null>(null);
  const [draftSave, setDraftSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** A name taken from the AI pass for the next Save draft / Create on Spotify of the Current Set. */
  const [aiName, setAiName] = useState<string | null>(null);
  // A new set (Generate, Regenerate, Clear) needs a new name.
  const currentSeed = live.built?.result.seed ?? null;
  useEffect(() => setAiName(null), [currentSeed]);
  const aiFor = (kind: AiTarget['kind'], setId?: string, nameAction?: Parameters<typeof AiPassBanner>[0]['nameAction']) => {
    const t = aiPass.target;
    const mine = t != null && t.kind === kind && (t.kind === 'preview' || t.setId === setId);
    const agent = aiPass.agents?.selected;
    return (
      <AiPassBanner
        running={mine && aiPass.running}
        message={aiPass.message}
        agentName={agent ? AGENT_NAMES[agent] : 'your AI agent'}
        banner={mine ? aiPass.banner : null}
        onDismiss={aiPass.dismiss}
        nameAction={nameAction}
      />
    );
  };

  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  /** Create on Spotify: the builder's set (a request) or a saved draft (its id). */
  const create = useMutation({
    mutationFn: (arg: { req: DjCreateRequest } | { draftId: string }) =>
      'req' in arg
        ? api<{ job: Job; setId: string }>('/api/dj/sets', { method: 'POST', json: arg.req })
        : api<{ job: Job; setId: string }>(`/api/dj/sets/${arg.draftId}/create`, { method: 'POST' }),
  });
  const createdDraftId = create.variables && 'draftId' in create.variables ? create.variables.draftId : null;
  const job = useJob(create.data?.job.id ?? null);
  const jobDone = job.data?.status === 'done';
  const creating = create.isPending || job.data?.status === 'running';
  useEffect(() => {
    if (!jobDone || !create.data) return;
    const id = create.data.setId;
    void qc.invalidateQueries({ queryKey: ['dj', 'sets'] });
    void qc.invalidateQueries({ queryKey: ['dj', 'set', id] });
    if (createdDraftId) void qc.invalidateQueries({ queryKey: ['dj', 'set', createdDraftId] });
    setFromDraft((d) => (d && (d.id === id || d.id === createdDraftId) ? null : d));
    setJustCreated(id);
    view(id);
  }, [jobDone, create.data?.setId]);
  // A new preview is a new set: allow creating it.
  useEffect(() => {
    if (!creating) create.reset();
  }, [built?.at]);

  const showRecord = (r: DjSetRecord) => {
    qc.setQueryData(['dj', 'set', r.id], r);
    void qc.invalidateQueries({ queryKey: ['dj', 'sets'] });
  };
  const saveDraft = useMutation({
    mutationFn: (req: DjDraftRequest) => api<DjSetRecord>('/api/dj/drafts', { method: 'POST', json: req }),
    onSuccess: (r) => {
      showRecord(r);
      // The builder stays on the set, now linked to the draft: later changes save to it.
      draftSavedKey.current = draftKey(r.config, r.result);
      setFromDraft({ id: r.id, name: r.name });
      setBasedOn(null);
      setJustSaved(r.id);
    },
  });
  const putDraft = useMutation({
    mutationFn: ({ id, body }: { id: string; body: DjDraftUpdate }) =>
      api<DjSetRecord>(`/api/dj/sets/${id}`, { method: 'PUT', json: body }),
    onSuccess: (r) => {
      showRecord(r);
      setFromDraft((d) => (d?.id === r.id ? { id: r.id, name: r.name } : d));
    },
  });
  const deleteSet = useMutation({
    mutationFn: (id: string) => api<void>(`/api/dj/sets/${id}`, { method: 'DELETE' }),
    onSuccess: (_v, id) => {
      if (viewingId === id) view(null);
      setFromDraft((d) => (d?.id === id ? null : d));
      void qc.invalidateQueries({ queryKey: ['dj', 'sets'] });
    },
  });
  const takenNames = history.data?.map((s) => s.name) ?? [];

  // A Current Set linked to a Draft saves its changes back to that Draft.
  useEffect(() => {
    if (!fromDraft || !built || live.pending) return;
    const key = draftKey(built.config, built.result);
    if (key === draftSavedKey.current) return;
    setDraftSave('saving');
    const id = fromDraft.id;
    const timer = setTimeout(() => {
      putDraft.mutate(
        { id, body: { config: built.config, result: built.result } },
        {
          onSuccess: () => {
            draftSavedKey.current = key;
            setDraftSave('saved');
          },
          onError: () => setDraftSave('error'),
        },
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [fromDraft?.id, built, live.pending]);

  // While the sheet is being recomputed, the shown values may be about to change.
  const stale = live.sheetPending;
  /** Explicit track actions (remove, start, bring back) rebuild at once. */
  const setConfigAndRebuild = (c: DjSetConfig) => {
    setConfig(c);
    live.rebuild();
  };
  const record = viewingId ? saved.record : undefined;

  /**
   * Opens a saved set in the builder exactly as it was saved (no rebuild). A
   * Draft stays linked, so changes save back to it; a set on Spotify opens as a
   * copy, because its playlist does not change from here.
   */
  const openInBuilder = (r: DjSetRecord) => {
    const c = normaliseDjConfig(r.config);
    const draft = isDraft(r);
    const result = draft ? r.result : { ...r.result, transitions: r.result.transitions.map((t) => ({ ...t, applied: false })) };
    setConfigState(c);
    saveConfig(c);
    setSeed(r.result.seed);
    live.load(c, result);
    draftSavedKey.current = draft ? draftKey(c, result) : null;
    setFromDraft(draft ? { id: r.id, name: r.name } : null);
    setBasedOn(draft ? null : { id: r.id, name: r.name, url: r.spotifyUrl });
    setPendingOpen(null);
    view(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  /** Opening another set replaces the Current Set; ask first when it is not saved anywhere. */
  const requestOpen = async (id: string) => {
    const r = await qc.fetchQuery({ queryKey: ['dj', 'set', id], queryFn: () => api<DjSetRecord>(`/api/dj/sets/${id}`) });
    if (fromDraft?.id === r.id && built) {
      view(null);
      return;
    }
    if (built && !fromDraft) setPendingOpen(r);
    else openInBuilder(r);
  };
  const takeSettingsOf = (r: DjSetRecord) => void requestOpen(r.id);

  const footer = (
    <div className="space-y-2">
      {config.excludedTrackIds.length + config.lockedTrackIds.length > 0 && (
        <div className="space-y-0.5 text-xs text-zinc-400">
          {config.lockedTrackIds.length > 0 && (
            <FooterLine label={`${config.lockedTrackIds.length} locked track(s)`} action="Unlock all" onClick={() => setConfig({ ...config, lockedTrackIds: [] })} />
          )}
          {config.excludedTrackIds.length > 0 && (
            <FooterLine label={`${config.excludedTrackIds.length} removed track(s)`} action="Bring back" onClick={() => setConfigAndRebuild({ ...config, excludedTrackIds: [] })} />
          )}
        </div>
      )}
      {live.dirty && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-950/40 px-2 py-1.5 text-xs text-amber-200">
          <span>Settings changed. The set below still uses the old ones.</span>
          <Button
            variant="primary"
            onClick={() => {
              live.rebuild();
              view(null);
            }}
            title="Pick and order the tracks again with the current settings (same seed)."
          >
            Rebuild set
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs text-zinc-400" aria-live="polite">
          {live.pending ? (
            <>
              <Spinner /> Rebuilding…
            </>
          ) : live.sheetPending ? (
            <>
              <Spinner /> Updating the sheet…
            </>
          ) : live.error ? (
            <span className="text-red-300">Rebuild failed</span>
          ) : built ? (
            <span title="The current set is saved automatically, so leaving the page or reloading keeps it.">
              {`${rebuiltAgo(built.at, now)} · ${built.result.tracks.length} tracks · `}
              {live.saveState === 'saving' ? 'saving…' : live.saveState === 'error' ? <span className="text-red-300">not saved</span> : 'saved'}
            </span>
          ) : null}
        </span>
        <Button
          onClick={() => {
            setSeed(randomSeed());
            view(null);
            // A regenerated set is new, not a copy of the one on Spotify.
            setBasedOn(null);
            live.rebuild();
          }}
          disabled={!live.loaded || live.pending}
          title="Build again with another random seed. Edits stay on pairs that remain."
        >
          {built ? 'Regenerate' : 'Generate set'}
        </Button>
      </div>
      {built && !viewingId && (
        <div className="flex items-center justify-end gap-2 text-xs">
          {confirmClear ? (
            <>
              <span className="text-zinc-400">Drop these tracks and the Transition Sheet?</span>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmClear(false);
                  setFromDraft(null);
                  setBasedOn(null);
                  void live.clear();
                }}
              >
                Clear set
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <button
              className="text-zinc-500 underline-offset-2 hover:text-zinc-200 hover:underline"
              onClick={() => setConfirmClear(true)}
              title="Drop the current tracklist and Transition Sheet. Your settings, templates and drafts stay."
            >
              Clear set
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">DJ Set</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Build a playlist ordered for smooth transitions by BPM, Camelot key and an Energy Curve. Choose a Pool on the
          left and press Rebuild set after a change; Sheet Style and Colour update the sheet at once. Check the Transition Sheet, create the playlist on Spotify
          (or save a draft to finish later), then set each transition in Spotify › Mix and tick it here.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start">
          <ConfigPanel
            config={config}
            onChange={setConfig}
            templates={<TemplatesRow config={config} usable={built?.result.pool.usable ?? null} onApply={setConfigAndRebuild} />}
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
          {pendingOpen && built && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              <span className="min-w-0 flex-1">
                Your current set is not saved as a draft. Opening “{pendingOpen.name}” replaces it.
              </span>
              <Button
                variant="primary"
                disabled={saveDraft.isPending}
                onClick={() =>
                  saveDraft.mutate(
                    { name: aiName ?? suggestSetName(takenNames, new Date()), config: built.config, result: built.result },
                    { onSuccess: () => openInBuilder(pendingOpen) },
                  )
                }
              >
                {saveDraft.isPending ? 'Saving…' : 'Save it as a draft, then open'}
              </Button>
              <Button variant="danger" onClick={() => openInBuilder(pendingOpen)}>
                Replace it
              </Button>
              <Button variant="ghost" onClick={() => setPendingOpen(null)}>
                Cancel
              </Button>
            </div>
          )}
          {viewingId ? (
            record ? (
              <SavedSetView
                record={record}
                justCreated={justCreated === record.id}
                onUpdate={saved.update}
                onApply={() => setApplyOpen(true)}
                onClose={() => view(null)}
                onUseSettings={() => takeSettingsOf(record)}
                draftHeader={
                  isDraft(record) && (
                    <DraftHeader
                      key={record.id}
                      record={record}
                      justSaved={justSaved === record.id}
                      onCreate={() => create.mutate({ draftId: record.id })}
                      creating={creating && createdDraftId === record.id}
                      createError={createdDraftId === record.id ? create.error : null}
                      job={createdDraftId === record.id ? job.data : undefined}
                      onRename={(name) => putDraft.mutateAsync({ id: record.id, body: { name } })}
                      onDelete={() => deleteSet.mutateAsync(record.id)}
                      onUseSettings={() => takeSettingsOf(record)}
                      onClose={() => view(null)}
                    />
                  )
                }
                error={saved.error}
                aiButton={
                  <AiPassButton
                    agents={aiPass.agents}
                    running={aiPass.running}
                    disabled={record.result.transitions.length === 0}
                    onRun={(focus) => aiPass.run({ setId: record.id, focus }, { kind: 'set', setId: record.id })}
                  />
                }
                aiBanner={aiFor(
                  'set',
                  record.id,
                  isDraft(record)
                    ? { label: 'Rename to this', doneFor: record.name, onClick: (name) => void putDraft.mutateAsync({ id: record.id, body: { name } }) }
                    : null,
                )}
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
              {fromDraft && (
                <p className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
                  Editing draft <span className="font-medium text-zinc-100">“{fromDraft.name}”</span> · changes are saved to it
                  automatically
                  {draftSave === 'saving' ? ' · saving…' : draftSave === 'error' ? ' · ' : ''}
                  {draftSave === 'error' && <span className="text-red-300">could not save</span>}
                </p>
              )}
              {basedOn && (
                <p className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
                  A copy of <span className="font-medium text-zinc-100">“{basedOn.name}”</span>, which is on Spotify. Changes here do
                  not change that playlist: save them as a new draft or create a new playlist.
                  {basedOn.url && (
                    <>
                      {' '}
                      <a href={basedOn.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                        Open in Spotify
                      </a>
                    </>
                  )}
                </p>
              )}
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
                    onStart: (id) => setConfigAndRebuild({ ...config, startTrackId: config.startTrackId === id ? null : id }),
                    onRemove: (id) =>
                      setConfigAndRebuild({
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
                    <AiPassButton
                      agents={aiPass.agents}
                      running={aiPass.running}
                      disabled={built.result.transitions.length === 0 || stale}
                      onRun={(focus) =>
                        aiPass.run(
                          { tracks: built.result.tracks, transitions: built.result.transitions, config: built.config, focus },
                          { kind: 'preview', keys: pairKeys(built.result) },
                        )
                      }
                    />
                    <Button variant="ghost" onClick={() => setApplyOpen(true)} disabled={built.result.transitions.length === 0} title="One transition at a time, full screen">
                      Apply mode
                    </Button>
                    <SheetExportButtons result={built.result} />
                  </>
                }
              >
                {aiFor('preview', undefined, { label: 'Use this name', doneFor: aiName, onClick: setAiName })}
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
                suggestedName={
                  aiName ? uniqueName(aiName, takenNames) : fromDraft ? uniqueName(fromDraft.name, takenNames) : suggestSetName(takenNames, new Date())
                }
                onCreate={(name) => create.mutate({ req: { name, config: built.config, result: built.result } })}
                running={creating && !createdDraftId}
                error={createdDraftId ? null : create.error}
                job={createdDraftId ? undefined : job.data}
                onSaveDraft={(name) => saveDraft.mutate({ name, config: built.config, result: built.result })}
                savingDraft={saveDraft.isPending}
                fromDraft={fromDraft}
                onUpdateDraft={(id) =>
                  putDraft.mutate(
                    { id, body: { config: built.config, result: built.result } },
                    {
                      onSuccess: (r) => {
                        setJustSaved(null);
                        view(r.id);
                      },
                    },
                  )
                }
                updatingDraft={putDraft.isPending}
                draftError={saveDraft.error ?? putDraft.error}
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
                    <Spinner /> {live.loaded ? 'Building the set… This does not change anything on Spotify.' : 'Loading your current set…'}
                  </span>
                ) : (
                  <span className="flex flex-col items-center gap-3">
                    <span>No set yet. Choose a Pool and the set shape on the left, then generate a set. This does not change anything on Spotify.</span>
                    <Button variant="primary" disabled={!live.loaded} onClick={() => live.rebuild()}>
                      Generate set
                    </Button>
                  </span>
                )}
              </Empty>
            </Card>
          )}

          {record && applyOpen && (
            <ApplyMode
              result={record.result}
              maxBpmStepPct={normaliseDjConfig(record.config).maxBpmStepPct}
              spotifyUrl={record.spotifyUrl}
              onApplied={isDraft(record) ? undefined : (i, v) => saved.update(i, { applied: v })}
              onClose={() => setApplyOpen(false)}
            />
          )}

          <EarlierSets
            sets={history.data}
            error={history.error}
            viewingId={viewingId}
            openId={viewingId ? null : (fromDraft?.id ?? basedOn?.id ?? null)}
            onOpen={(id) => void requestOpen(id)}
            onView={view}
            onDelete={(id) => deleteSet.mutateAsync(id)}
          />
        </div>
      </div>
    </div>
  );
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
  suggestedName,
  onCreate,
  running,
  error,
  job,
  onSaveDraft,
  savingDraft,
  fromDraft,
  onUpdateDraft,
  updatingDraft,
  draftError,
}: {
  disabled: boolean;
  busy: boolean;
  suggestedName: string;
  onCreate: (name: string) => void;
  running: boolean;
  error: unknown;
  job: Job | undefined;
  onSaveDraft: (name: string) => void;
  savingDraft: boolean;
  fromDraft: { id: string; name: string } | null;
  onUpdateDraft: (id: string) => void;
  updatingDraft: boolean;
  draftError: unknown;
}) {
  const [name, setName] = useState(suggestedName);
  const [asking, setAsking] = useState<'create' | 'draft' | null>(null);
  const ask = (mode: 'create' | 'draft') => {
    setName(suggestedName);
    setAsking(mode);
  };
  const working = running || savingDraft || updatingDraft;

  return (
    <Card title="Create on Spotify">
      <p className="mb-3 text-sm text-zinc-400">
        This makes a new private playlist in this order, with this Transition Sheet and your edits. It does not change
        any existing playlist. Save draft keeps the set in this app only, to finish later.
        {busy && ' Wait for the rebuild to finish.'}
      </p>
      {asking ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            if (asking === 'create') onCreate(n);
            else onSaveDraft(n);
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            aria-label={asking === 'create' ? 'Playlist name' : 'Draft name'}
            className="min-w-60 flex-1 rounded bg-zinc-800 px-3 py-1.5 text-sm"
          />
          <Button variant="primary" type="submit" disabled={disabled || working || !name.trim()}>
            {asking === 'create' ? (running ? 'Creating…' : 'Create playlist') : savingDraft ? 'Saving…' : 'Save draft'}
          </Button>
          <Button variant="ghost" type="button" onClick={() => setAsking(null)} disabled={working}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={disabled} onClick={() => ask('create')}>
            Create on Spotify
          </Button>
          <Button disabled={disabled} onClick={() => ask('draft')} title="Keep this set in the app without creating it on Spotify">
            Save draft
          </Button>
          {fromDraft && (
            <Button
              variant="secondary"
              disabled={disabled || working}
              onClick={() => onUpdateDraft(fromDraft.id)}
              title={`Replace the tracks and sheet of the draft “${fromDraft.name}” with this set`}
            >
              {updatingDraft ? 'Updating…' : `Update draft “${fromDraft.name}”`}
            </Button>
          )}
        </div>
      )}
      <div className="mt-3 space-y-2">
        <ErrorNote error={error} />
        <ErrorNote error={draftError} />
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
  draftHeader,
  error,
  aiButton,
  aiBanner,
}: {
  record: DjSetRecord;
  justCreated: boolean;
  onUpdate: (index: number, body: DjTransitionPatch) => void;
  onApply: () => void;
  onClose: () => void;
  onUseSettings: () => void;
  /** Set for drafts: replaces the created set's header. */
  draftHeader: ReactNode;
  error: unknown;
  aiButton: ReactNode;
  aiBanner: ReactNode;
}) {
  const config = normaliseDjConfig(record.config);
  const total = record.result.transitions.length;
  const draft = isDraft(record);
  return (
    <>
      {draftHeader || (
        <Card
          title={record.name}
          actions={
            <>
              <Button variant="ghost" onClick={onUseSettings} title="Open a copy of this set in the builder, exactly as saved, to change it">
                Open in builder
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
      )}
      <ErrorNote error={error} />
      <Card
        title={
          <span className="flex flex-wrap items-center gap-3">
            Transition Sheet {!draft && <AppliedProgress done={appliedCount(record.result)} total={total} />}
          </span>
        }
        actions={
          <>
            {aiButton}
            <Button variant={draft ? 'ghost' : 'primary'} onClick={onApply} disabled={total === 0} title="One transition at a time, full screen">
              Apply mode
            </Button>
            <SheetExportButtons result={record.result} name={record.name} applied={!draft} />
          </>
        }
      >
        {aiBanner}
        <TransitionSheet
          result={record.result}
          maxBpmStepPct={config.maxBpmStepPct}
          defaultBars={config.transitions.defaultBars}
          onEdit={(i, s) => onUpdate(i, { settings: s })}
          onApplied={draft ? undefined : (i, v) => onUpdate(i, { applied: v })}
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

/** Compares a set's content for the draft autosave. */
const draftKey = (c: DjSetConfig, r: DjSetResult) => JSON.stringify([c, r.tracks.map((t) => t.id), r.transitions]);
