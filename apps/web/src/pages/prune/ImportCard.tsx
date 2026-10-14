import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HistoryImportResponse, HistoryImportResult, HistorySummary } from '@curator/shared';
import { api, useJob } from '../../api.ts';
import { Card, ErrorNote, JobProgress, Stat, cx } from '../../components/ui.tsx';
import { day } from './format.ts';

export const useHistorySummary = () =>
  useQuery({ queryKey: ['prune', 'summary'], queryFn: () => api<HistorySummary>('/api/prune/history/summary') });

export function ImportCard() {
  const qc = useQueryClient();
  const summary = useHistorySummary();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<HistoryImportResult | null>(null);
  const job = useJob(jobId);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['prune'] });
  };

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const body = new FormData();
      for (const f of files) body.append('files', f, f.name);
      return api<HistoryImportResponse>('/api/prune/history', { method: 'POST', body });
    },
    onMutate: () => setResult(null),
    onSuccess: (r) => {
      if (r.result) {
        setResult(r.result);
        refresh();
      } else if (r.job) setJobId(r.job.id);
    },
  });

  useEffect(() => {
    if (job.data?.status !== 'done' || !jobId) return;
    api<HistoryImportResult>(`/api/prune/history/import/${jobId}`)
      .then(setResult)
      .catch(() => undefined)
      .finally(refresh);
  }, [job.data?.status, jobId]);

  const send = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => /\.(zip|json)$/i.test(f.name));
    if (files.length) upload.mutate(files);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    send(e.dataTransfer.files);
  };

  const s = summary.data;
  const busy = upload.isPending || job.data?.status === 'running';

  return (
    <Card title="1 · Streaming History">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => input.current?.click()}
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm',
            dragging ? 'border-brand bg-brand/10' : 'border-zinc-700 hover:border-zinc-500',
          )}
        >
          <p className="font-medium">Drop the export .zip or the Streaming_History_Audio_*.json files here</p>
          <p className="text-zinc-500">or click to choose files. Importing the same files again is safe.</p>
          <input
            ref={input}
            type="file"
            multiple
            accept=".zip,.json,application/zip,application/json"
            className="hidden"
            onChange={(e) => {
              send(e.target.files);
              e.target.value = '';
            }}
          />
          {busy && <p className="text-brand">Importing…</p>}
        </div>

        <div className="space-y-3 text-sm">
          {s && s.rows === 0 && (
            <div className="rounded-lg bg-amber-950/40 p-3 text-amber-200">
              <p className="font-medium">No Streaming History yet — your export is pending.</p>
              <p className="mt-1 text-amber-200/80">
                Spotify emails the “Extended streaming history” within 30 days of the request (
                <a className="underline" href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">
                  privacy page
                </a>
                ). Until you import it, the tool only knows edit dates and your last 50 plays, so candidates are not ticked
                for you.
              </p>
            </div>
          )}
          {s && s.rows > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Plays" value={s.rows.toLocaleString()} />
              <Stat label="From" value={day(s.firstTs)} />
              <Stat label="To" value={day(s.lastTs)} hint="Plays after this date are unknown until a newer export." />
              <Stat
                label="In library"
                value={`${s.matchedPct}%`}
                hint={`${s.matchedTracks} of ${s.distinctTracks} distinct tracks are in your synced library.`}
              />
            </div>
          )}
          <JobProgress job={job.data} />
          <ErrorNote error={upload.error} />
          {result && <ImportResult result={result} />}
        </div>
      </div>
    </Card>
  );
}

function ImportResult({ result: r }: { result: HistoryImportResult }) {
  return (
    <div className="rounded-lg bg-zinc-900 p-3 text-zinc-300">
      <p>
        Read {r.rowsRead.toLocaleString()} rows from {r.files.length} file{r.files.length === 1 ? '' : 's'}:{' '}
        <b className="text-zinc-100">{r.inserted.toLocaleString()} new plays</b>, {r.duplicates.toLocaleString()} already
        imported, {r.skipped.toLocaleString()} skipped (podcasts, audiobooks, no track).
      </p>
      {r.firstTs && (
        <p className="text-zinc-500">
          Range {day(r.firstTs)} → {day(r.lastTs)}.
        </p>
      )}
      {r.legacy && (
        <p className="mt-1 text-amber-300">
          Old format (no track links): {r.legacy.matched} of {r.legacy.rows} plays matched a library track by artist and
          title. The extended export is much better.
        </p>
      )}
    </div>
  );
}
