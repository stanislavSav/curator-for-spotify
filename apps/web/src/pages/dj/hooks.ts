import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiPassAgents,
  AiPassRequest,
  AiPassResult,
  DjSetConfig,
  DjSetRecord,
  DjSetResult,
  DjTemplate,
  DjTemplateInput,
  DjTransition,
  DjTransitionPatch,
  DjWorkspace,
  Job,
} from '@curator/shared';
import { api, useJob } from '../../api.ts';
import { aiBannerText } from './ai.ts';
import { carryEdits, patchRecord } from './edits.ts';

export interface Built {
  config: DjSetConfig;
  result: DjSetResult;
  /** When the preview arrived (ms). */
  at: number;
  /** Edits moved from the previous preview, and edits lost because their pair changed. */
  carried: { kept: number; dropped: number };
}

/**
 * The set's shape: everything that decides which tracks are picked and in
 * which order. A change here waits for "Rebuild set". Locks only matter for the
 * next build, and the sheet settings never change the tracks.
 */
export const shapeOf = (c: DjSetConfig) => JSON.stringify({ ...c, lockedTrackIds: [], transitions: null });

/** The sheet settings: Sheet Style, Colour, default bars and rules. */
export const sheetOf = (c: DjSetConfig) => JSON.stringify(c.transitions);

const SHEET_DEBOUNCE_MS = 250;
const SAVE_DEBOUNCE_MS = 600;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The DJ page's current set. It is restored from the server when the page
 * opens (so page changes and reloads never replace it) and autosaved after
 * every change. Tracks change only on an explicit build: Generate, Regenerate,
 * Rebuild set, a Set Template or a track action. Other set settings only mark
 * the set as out of date (dirty). Sheet settings recompute the Transition Sheet
 * for the same tracks in the same order, keeping edits and AI values.
 */
export function useLivePreview(
  config: DjSetConfig,
  seed: number,
  fromDraft: DjWorkspace['fromDraft'],
  onRestore: (w: DjWorkspace) => void,
) {
  const [built, setBuilt] = useState<Built | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(true);
  const [sheetPending, setSheetPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [buildNo, setBuildNo] = useState(0);
  const configRef = useRef(config);
  configRef.current = config;
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const builtRef = useRef(built);
  builtRef.current = built;
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  /** Edits and AI values to carry onto the next build instead of the shown preview's (a saved set's). */
  const carryFromRef = useRef<DjSetResult | null>(null);
  /** What the server already has, so a restore or an unchanged render does not save again. */
  const savedRef = useRef<string | null>(null);

  // Restore the current set once, when the page opens.
  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const w = await api<DjWorkspace | null>('/api/dj/workspace', { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        if (w) {
          savedRef.current = workspaceKey(w.config, w.result, w.fromDraft);
          setBuilt({ config: w.config, result: w.result, at: Date.parse(w.updatedAt), carried: { kept: 0, dropped: 0 } });
          setSaveState('saved');
          onRestoreRef.current(w);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e);
      } finally {
        if (!ctrl.signal.aborted) {
          setLoaded(true);
          setPending(false);
        }
      }
    })();
    return () => ctrl.abort();
  }, []);

  // Build only when asked (buildNo > 0), never on mount or on a settings change.
  useEffect(() => {
    if (buildNo === 0) return;
    const ctrl = new AbortController();
    setPending(true);
    void (async () => {
      const c = configRef.current;
      try {
        const fresh = await api<DjSetResult>('/api/dj/preview', {
          method: 'POST',
          json: { config: c, seed: seedRef.current },
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        const prev = carryFromRef.current ?? builtRef.current?.result ?? null;
        carryFromRef.current = null;
        const { result, kept, dropped } = carryEdits(prev, fresh);
        setBuilt({ config: c, result, at: Date.now(), carried: { kept, dropped } });
        setError(null);
        setPending(false);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(e);
        setPending(false);
      }
    })();
    return () => ctrl.abort();
  }, [buildNo]);

  const sheetKey = sheetOf(config);
  useEffect(() => {
    const b = builtRef.current;
    if (!b || pending || sheetOf(b.config) === sheetKey || b.result.tracks.length < 2) return;
    const ctrl = new AbortController();
    setSheetPending(true);
    const timer = setTimeout(async () => {
      const transitionsCfg = configRef.current.transitions;
      try {
        const current = builtRef.current ?? b;
        const sheet = await api<DjTransition[]>('/api/dj/sheet', {
          method: 'POST',
          json: { tracks: current.result.tracks, config: { ...current.config, transitions: transitionsCfg } },
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        setBuilt((cur) => {
          if (!cur) return cur;
          const { result } = carryEdits(cur.result, { ...cur.result, transitions: sheet });
          return { ...cur, config: { ...cur.config, transitions: transitionsCfg }, result };
        });
        setError(null);
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e);
      } finally {
        if (!ctrl.signal.aborted) setSheetPending(false);
      }
    }, SHEET_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [sheetKey, pending]);

  // Autosave the current set (tracks, sheet, edits, AI values, linked draft).
  useEffect(() => {
    if (!loaded || !built) return;
    const key = workspaceKey(built.config, built.result, fromDraft);
    if (key === savedRef.current) return;
    setSaveState('saving');
    const timer = setTimeout(async () => {
      try {
        await api('/api/dj/workspace', {
          method: 'PUT',
          json: { config: built.config, seed: built.result.seed, result: built.result, fromDraft },
        });
        savedRef.current = key;
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [loaded, built, fromDraft]);

  /** Applies an edit to the shown preview (page state only). */
  const edit = (f: (r: DjSetResult) => DjSetResult) => setBuilt((b) => (b ? { ...b, result: f(b.result) } : b));
  /**
   * Builds the set from the current settings and seed. `carryFrom` (a saved
   * set) gives the edits to keep instead of the shown preview's.
   */
  const rebuild = (carryFrom?: DjSetResult) => {
    if (carryFrom) carryFromRef.current = carryFrom;
    setBuildNo((n) => n + 1);
  };
  /** Shows a saved set exactly as it was saved: no rebuild, same tracks, sheet, edits and AI values. */
  const load = (c: DjSetConfig, result: DjSetResult) => {
    carryFromRef.current = null;
    setBuilt({ config: c, result, at: Date.now(), carried: { kept: 0, dropped: 0 } });
    setError(null);
    setPending(false);
  };
  /** Drops the current tracklist and Transition Sheet (settings and drafts stay). */
  const clear = async () => {
    await api('/api/dj/workspace', { method: 'DELETE' });
    savedRef.current = null;
    setBuilt(null);
    setError(null);
    setSaveState('idle');
  };
  /** The shown set was built from other set settings than the current ones. */
  const dirty = built != null && !pending && shapeOf(built.config) !== shapeOf(config);

  return { built, loaded, pending, sheetPending, error, edit, rebuild, load, clear, dirty, saveState };
}

const workspaceKey = (c: DjSetConfig, r: DjSetResult, d: DjWorkspace['fromDraft']) => JSON.stringify([c, r, d]);

/** A created set, with optimistic PATCH for edits and Applied ticks. */
export function useDjSet(id: string | null) {
  const qc = useQueryClient();
  const queryKey = ['dj', 'set', id];
  const mutationKey = ['dj', 'patch', id];
  const query = useQuery({
    queryKey,
    queryFn: () => api<DjSetRecord>(`/api/dj/sets/${id}`),
    enabled: id != null,
  });
  const patch = useMutation({
    mutationKey,
    mutationFn: ({ index, body }: { index: number; body: DjTransitionPatch }) =>
      api<DjSetRecord>(`/api/dj/sets/${id}/transitions/${index}`, { method: 'PATCH', json: body }),
    onMutate: async ({ index, body }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<DjSetRecord>(queryKey);
      if (prev) qc.setQueryData(queryKey, patchRecord(prev, index, body));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSuccess: (record) => {
      // A later tick may still be in flight; its optimistic state wins until it lands.
      if (qc.isMutating({ mutationKey }) <= 1) qc.setQueryData(queryKey, record);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['dj', 'sets'] }),
  });
  return {
    record: query.data,
    error: query.error ?? patch.error,
    loading: query.isLoading,
    update: (index: number, body: DjTransitionPatch) => patch.mutate({ index, body }),
  };
}

/** The user's Set Templates. Mutations throw ApiError; a 409 means the name is taken. */
export function useDjTemplates() {
  const qc = useQueryClient();
  const queryKey = ['dj', 'templates'];
  const query = useQuery({ queryKey, queryFn: () => api<DjTemplate[]>('/api/dj/templates') });
  const settle = { onSettled: () => qc.invalidateQueries({ queryKey }) };
  const create = useMutation({
    mutationFn: (input: DjTemplateInput) => api<DjTemplate>('/api/dj/templates', { method: 'POST', json: input }),
    ...settle,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<DjTemplateInput> }) =>
      api<DjTemplate>(`/api/dj/templates/${id}`, { method: 'PATCH', json: patch }),
    ...settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/dj/templates/${id}`, { method: 'DELETE' }),
    ...settle,
  });
  return {
    list: query.data ?? [],
    error: query.error,
    create: create.mutateAsync,
    update: update.mutateAsync,
    remove: remove.mutateAsync,
  };
}

/** Re-renders every 30 s, for "Rebuilt 3 min ago". */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** What an AI pass runs on: the preview (with its pair keys at the start) or a created set. */
export type AiTarget = { kind: 'preview'; keys: string[] } | { kind: 'set'; setId: string };

export type AiBanner = { kind: 'done'; text: string; setName: string | null } | { kind: 'error'; error: unknown };

/**
 * The AI Pass: which agent CLI is installed, the running job, and a banner
 * for the result. `onResult` puts the result into the page and returns how
 * many pairs changed.
 */
export function useAiPass(onResult: (r: AiPassResult, target: AiTarget) => number) {
  const agents = useQuery({
    queryKey: ['dj', 'ai-pass', 'agents'],
    queryFn: () => api<AiPassAgents>('/api/dj/ai-pass/agents'),
    staleTime: Infinity,
  });
  const [target, setTarget] = useState<AiTarget | null>(null);
  const [banner, setBanner] = useState<AiBanner | null>(null);
  const start = useMutation({
    mutationFn: (req: AiPassRequest) => api<Job>('/api/dj/ai-pass', { method: 'POST', json: req }),
    onError: (error) => setBanner({ kind: 'error', error }),
  });
  const jobId = start.data?.id ?? null;
  const job = useJob(jobId);
  const status = job.data?.status;
  const result = useQuery({
    queryKey: ['dj', 'ai-pass', 'result', jobId],
    queryFn: () => api<AiPassResult>(`/api/dj/ai-pass/${jobId}`),
    enabled: jobId != null && status === 'done',
    staleTime: Infinity,
    retry: false,
  });

  const handled = useRef<string | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  useEffect(() => {
    if (!jobId || handled.current === jobId || !target) return;
    if (status === 'failed') {
      handled.current = jobId;
      setBanner({ kind: 'error', error: job.data?.error || 'The AI pass failed.' });
    } else if (result.error) {
      handled.current = jobId;
      setBanner({ kind: 'error', error: result.error });
    } else if (result.data) {
      handled.current = jobId;
      const r = result.data;
      const changed = onResultRef.current(r, target);
      setBanner({ kind: 'done', text: aiBannerText(r.agent, r.summary, changed, r.rejected.length), setName: r.setName ?? null });
    }
  }, [jobId, status, result.data, result.error]);

  const running = start.isPending || status === 'running' || (status === 'done' && handled.current !== jobId);
  return {
    /** Undefined while loading; an error counts as "none installed". */
    agents: agents.data ?? (agents.isError ? { available: [], selected: null } : undefined),
    running,
    message: job.data?.status === 'running' ? job.data.message : '',
    target,
    banner,
    dismiss: () => setBanner(null),
    run: (req: AiPassRequest, t: AiTarget) => {
      setTarget(t);
      setBanner(null);
      start.mutate(req);
    },
  };
}
