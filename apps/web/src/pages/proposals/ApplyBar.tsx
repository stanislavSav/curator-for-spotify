import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProposalView } from '@curator/shared';
import { useJob, useLatestJob } from '../../api.ts';
import { Button, ErrorNote, JobProgress } from '../../components/ui.tsx';
import { invalidateProposals, plural, useApplyProposals } from './data.ts';

/** Sticky bar: create the approved Proposals on Spotify and follow the job. */
export function ApplyBar({ proposals }: { proposals: ProposalView[] }) {
  const qc = useQueryClient();
  const apply = useApplyProposals();
  const latest = useLatestJob('apply-proposals');
  const [jobId, setJobId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const job = useJob(jobId);
  const status = job.data?.status;

  // Pick up a job that is still running after a page reload.
  useEffect(() => {
    if (!jobId && latest.data?.status === 'running') setJobId(latest.data.id);
  }, [jobId, latest.data]);

  useEffect(() => {
    if (status && status !== 'running') void invalidateProposals(qc);
  }, [status, qc]);

  const approved = proposals.filter((p) => p.status === 'approved');
  const created = proposals.filter((p) => p.status === 'created' && appliedIds.includes(p.id));
  if (approved.length === 0 && !jobId) return null;

  const start = () => {
    const ids = approved.map((p) => p.id);
    setAppliedIds(ids);
    apply.mutate(ids, { onSuccess: (j) => setJobId(j.id) });
  };

  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      {jobId ? (
        <div className="space-y-2">
          <JobProgress job={job.data} />
          {created.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {created.map((p) => (
                <a key={p.id} href={p.spotifyUrl ?? '#'} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  Open “{p.name}” in Spotify ↗
                </a>
              ))}
            </div>
          )}
          {status && status !== 'running' && (
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => setJobId(null)}>
                Close
              </Button>
              {approved.length > 0 && (
                <span className="text-xs text-zinc-500">{plural(approved.length, 'approved Proposal')} still waiting.</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">
            {plural(approved.length, 'Proposal')} approved. They are created as private playlists in your Spotify account.
          </p>
          <Button variant="primary" disabled={apply.isPending} onClick={start}>
            Create {plural(approved.length, 'approved playlist')} on Spotify
          </Button>
        </div>
      )}
      <ErrorNote error={apply.error} />
    </div>
  );
}
