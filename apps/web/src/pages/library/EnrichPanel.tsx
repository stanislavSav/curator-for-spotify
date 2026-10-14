import { useMutation, useQuery } from '@tanstack/react-query';
import type { EnrichSourceStatus, EnrichStatus, Job } from '@curator/shared';
import { api } from '../../api.ts';
import { Badge, Button, Card, ErrorNote, JobProgress, cx } from '../../components/ui.tsx';
import { useJobRunner } from './useJobRunner.ts';

const n = (v: number) => v.toLocaleString('en');
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const minutes = (m: number | null) => (m == null ? '' : m < 1 ? 'under a minute' : m < 90 ? `~${m} min` : `~${(m / 60).toFixed(1)} h`);

/** Enrich: run/stop, per-source progress, what is still missing and why, and past runs. */
export function EnrichPanel() {
  const enrich = useJobRunner('enrich', '/api/enrich');
  const status = useQuery({
    queryKey: ['library', 'enrich-status'],
    queryFn: () => api<EnrichStatus>('/api/enrich/status'),
    refetchInterval: enrich.running ? 3000 : false,
    refetchIntervalInBackground: true,
  });
  const stop = useMutation({
    mutationFn: (id: string) => api(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  });
  const s = status.data;
  const active = s?.sources.filter((x) => x.state !== 'unavailable') ?? [];
  const waiting = active.reduce((sum, x) => sum + x.waiting, 0);
  const eta = active.reduce((sum, x) => sum + (x.etaMinutes ?? 0), 0);
  const looked = active.reduce((sum, x) => sum + x.done + x.notFound, 0);
  const lookable = active.reduce((sum, x) => sum + x.total - x.skipped, 0);
  // Tie "Stopping…" to the job it was sent for, so a new run starts clean.
  const stopping = stop.isSuccess && stop.variables === enrich.job?.id && enrich.running;

  return (
    <Card
      title="1. Enrich"
      actions={
        enrich.running ? (
          <Button onClick={() => enrich.job && stop.mutate(enrich.job.id)} disabled={stopping}>
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        ) : (
          <Button variant="primary" onClick={enrich.start} disabled={!s?.gaps.tracks}>
            {waiting > 0 && (s?.runs.length ?? 0) > 0 ? 'Continue' : 'Run enrich'}
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-zinc-400">
        Looks up what Spotify no longer gives apps: BPM, key and energy per track, and genre tags per artist. Each item is
        looked up once. Items a source does not know are tried again after {s?.retryAfterDays ?? 30} days. You can stop at any
        time; the next run continues where it stopped.
      </p>

      <Headline running={enrich.running} waiting={waiting} eta={eta} looked={looked} lookable={lookable} />
      {enrich.running && (
        <div className="mb-4">
          <JobProgress job={enrich.job} />
          {stopping && <p className="mt-1 text-xs text-zinc-500">Finishing the current request, then stopping…</p>}
        </div>
      )}
      <ErrorNote error={enrich.error ?? status.error ?? stop.error} />

      {s && (
        <div className="space-y-4">
          <SourceTable sources={s.sources} />
          <Gaps gaps={s.gaps} />
          <RunHistory runs={s.runs} />
        </div>
      )}
    </Card>
  );
}

function Headline(p: { running: boolean; waiting: number; eta: number; looked: number; lookable: number }) {
  const pct = p.lookable ? Math.round((p.looked / p.lookable) * 100) : 0;
  let text: string;
  if (p.lookable === 0) text = 'Sync your Library first.';
  else if (p.running) text = `Running. ${n(p.waiting)} lookups left, ${minutes(p.eta)} at the current pace.`;
  else if (p.waiting > 0)
    text = `${n(p.waiting)} lookups still waiting (${minutes(p.eta)}). Press Continue. You can use the rest of the app meanwhile.`;
  else text = 'Every item has been looked up. What is still missing is listed below, with the reason.';
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-sm">
        <span className={p.waiting > 0 && !p.running ? 'text-amber-300' : 'text-zinc-300'}>{text}</span>
        {p.lookable > 0 && <span className="tabular-nums text-zinc-400">{pct}% looked up</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
        <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SourceTable({ sources }: { sources: EnrichSourceStatus[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="py-1 pr-3 font-medium">Source</th>
            <th className="py-1 pr-3 font-medium">Progress</th>
            <th className="py-1 pr-3 text-right font-medium">Found</th>
            <th className="py-1 pr-3 text-right font-medium">Not found</th>
            <th className="py-1 pr-3 text-right font-medium">Waiting</th>
            <th className="py-1 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((src) => (
            <tr key={src.id} className="border-t border-zinc-800 align-top">
              <td className="py-2 pr-3">
                <div className="font-medium">{src.label}</div>
                <div className="text-xs text-zinc-500">{src.provides}</div>
              </td>
              <td className="w-1/3 py-2 pr-3">
                <Bar src={src} />
                <div className="mt-1 text-xs text-zinc-500">
                  {[
                    `${n(src.total)} ${src.unit}`,
                    src.skipped ? `${n(src.skipped)} skipped: ${src.skippedReason}` : null,
                    src.notFound && src.nextRetryAt ? `not found retried from ${date(src.nextRetryAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {src.note && <div className="text-xs text-zinc-500">{src.note}</div>}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{n(src.done)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-amber-300">{n(src.notFound)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-zinc-300">{n(src.waiting)}</td>
              <td className="py-2">
                {src.state === 'complete' && <Badge tone="good">Complete</Badge>}
                {src.state === 'pending' && <Badge tone="warn">{minutes(src.etaMinutes)} left</Badge>}
                {src.state === 'unavailable' && <Badge tone="neutral">Unavailable</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 flex gap-4 text-xs text-zinc-500">
        <Legend className="bg-brand" label="found" />
        <Legend className="bg-amber-500/70" label="source has no data" />
        <Legend className="bg-zinc-600" label="skipped" />
        <Legend className="bg-zinc-800" label="waiting" />
      </p>
    </div>
  );
}

function Bar({ src }: { src: EnrichSourceStatus }) {
  const part = (v: number) => `${src.total ? (v / src.total) * 100 : 0}%`;
  return (
    <div className="flex h-2 overflow-hidden rounded bg-zinc-800" title={`${n(src.done)} found, ${n(src.notFound)} not found, ${n(src.skipped)} skipped, ${n(src.waiting)} waiting`}>
      <div className="bg-brand" style={{ width: part(src.done) }} />
      <div className="bg-amber-500/70" style={{ width: part(src.notFound) }} />
      <div className="bg-zinc-600" style={{ width: part(src.skipped) }} />
    </div>
  );
}

const Legend = ({ className, label }: { className: string; label: string }) => (
  <span className="inline-flex items-center gap-1">
    <span className={cx('inline-block h-2 w-3 rounded-sm', className)} />
    {label}
  </span>
);

function Gaps({ gaps }: { gaps: EnrichStatus['gaps'] }) {
  if (!gaps.tracks) return null;
  const rows: { label: string; count: number; why: string; effect: string }[] = [
    {
      label: 'without BPM',
      count: gaps.noBpm,
      why: [
        gaps.noBpmBothNotFound ? `${n(gaps.noBpmBothNotFound)} unknown to ReccoBeats and Deezer` : '',
        gaps.noBpmNoIsrc ? `${n(gaps.noBpmNoIsrc)} have no ISRC` : '',
        gaps.noBpmWaiting ? `${n(gaps.noBpmWaiting)} not looked up yet` : '',
      ]
        .filter(Boolean)
        .join(', '),
      effect: 'DJ Sets skip them.',
    },
    {
      label: 'without key',
      count: gaps.noKey,
      why: 'only ReccoBeats gives key; Deezer gives BPM only',
      effect: 'DJ Sets treat the key as unknown and suggest Auto transitions.',
    },
    {
      label: 'without tags',
      count: gaps.noTags,
      why: 'none of their artists has MusicBrainz or Wikidata tags (yet)',
      effect: 'Proposals group them by artist, era and audio features only.',
    },
  ];
  return (
    <div className="rounded-lg bg-zinc-950/60 p-3">
      <h3 className="mb-2 text-sm font-medium">What is still missing</h3>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.label} className="text-zinc-400">
            <span className="tabular-nums text-zinc-200">{n(r.count)}</span> of {n(gaps.tracks)} tracks {r.label}
            {r.count > 0 && (
              <>
                {r.why && <> — {r.why}.</>} <span className="text-zinc-500">{r.effect}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-zinc-500">To see these tracks, pick "Missing BPM" or "Missing tags" in the filter above the track table.</p>
    </div>
  );
}

const PHASE_SPLIT = /\s(?=(?:ReccoBeats|Deezer|Spotify genres|MusicBrainz|MusicBrainz \(linked\)|Wikidata):)/;

function RunHistory({ runs }: { runs: Job[] }) {
  if (runs.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">Past runs ({runs.length})</summary>
      <ul className="mt-2 space-y-2">
        {runs.map((r) => {
          const ms = (r.finishedAt ? Date.parse(r.finishedAt) : Date.now()) - Date.parse(r.startedAt);
          return (
            <li key={r.id} className="rounded bg-zinc-950/60 p-2">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span>{new Date(r.startedAt).toLocaleString()}</span>
                <span>· {Math.max(1, Math.round(ms / 60_000))} min</span>
                <Badge tone={r.status === 'done' ? 'good' : r.status === 'running' ? 'info' : 'bad'}>{r.status}</Badge>
              </div>
              <ul className="mt-1 list-disc pl-5 text-zinc-400">
                {(r.error ? [r.message, r.error] : r.message.split(PHASE_SPLIT)).filter(Boolean).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
