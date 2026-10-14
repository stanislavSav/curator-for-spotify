import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiPassAgents, AiPassRequest, AiPassResult, DjSetConfig, DjSetRecord, DjSetResult, DjTransition, DjTransitionPatch, Job } from '@curator/shared';
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

/**
 * The preview. The set is built on first load, on a new seed (Regenerate) and
 * when the user asks for it (rebuild); other settings changes never re-pick
 * tracks on their own, they only mark the preview as out of date (dirty).
 * Sheet settings recompute the Transition Sheet for the same tracks in the same
 * order, keeping edits and AI values. Edits on pairs that survive a rebuild are kept.
 */
export function useLivePreview(config: DjSetConfig, seed: number) {
  const [built, setBuilt] = useState<Built | null>(null);
  const [pending, setPending] = useState(true);
  const [sheetPending, setSheetPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [buildNo, setBuildNo] = useState(0);
  const configRef = useRef(config);
  configRef.current = config;
  const builtRef = useRef(built);
  builtRef.current = built;

  useEffect(() => {
    const ctrl = new AbortController();
    setPending(true);
    void (async () => {
      const c = configRef.current;
      try {
        const fresh = await api<DjSetResult>('/api/dj/preview', {
          method: 'POST',
          json: { config: c, seed },
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        const { result, kept, dropped } = carryEdits(builtRef.current?.result ?? null, fresh);
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
  }, [buildNo, seed]);

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

  /** Applies an edit to the shown preview (page state only). */
  const edit = (f: (r: DjSetResult) => DjSetResult) => setBuilt((b) => (b ? { ...b, result: f(b.result) } : b));
  /** Builds the set again from the current settings (same seed). */
  const rebuild = () => setBuildNo((n) => n + 1);
  /** The shown set was built from other set settings than the current ones. */
  const dirty = built != null && !pending && shapeOf(built.config) !== shapeOf(config);

  return { built, pending, sheetPending, error, edit, rebuild, dirty };
}

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

export type AiBanner = { kind: 'done'; text: string } | { kind: 'error'; error: unknown };

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
      setBanner({ kind: 'done', text: aiBannerText(r.agent, r.summary, changed, r.rejected.length) });
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
