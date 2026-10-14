import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Job, JobKind } from '@curator/shared';
import { api, useJob, useLatestJob } from '../../api.ts';

/**
 * Starts a job with a POST and polls it. Shows the latest job of the kind on
 * load, and refreshes the Library queries when the job finishes.
 */
export function useJobRunner(kind: JobKind, path: string) {
  const queryClient = useQueryClient();
  const latest = useLatestJob(kind);
  const [jobId, setJobId] = useState<string | null>(null);
  const id = jobId ?? latest.data?.id ?? null;
  const job = useJob(id);

  const start = useMutation({
    mutationFn: () => api<Job>(path, { method: 'POST' }),
    onSuccess: (j) => {
      setJobId(j.id);
      // Other panels following this kind pick up the new job.
      void queryClient.invalidateQueries({ queryKey: ['latestJob', kind] });
    },
  });

  const status = job.data?.status;
  useEffect(() => {
    if (jobId && status && status !== 'running') {
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      void queryClient.invalidateQueries({ queryKey: ['latestJob', kind] });
    }
  }, [jobId, status, kind, queryClient]);

  return {
    job: job.data ?? latest.data ?? null,
    running: status === 'running' || start.isPending,
    start: () => start.mutate(),
    error: start.error,
  };
}
