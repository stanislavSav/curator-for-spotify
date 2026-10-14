import { useQuery } from '@tanstack/react-query';
import type { AuthStatus, Job, JobKind } from '@curator/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data?.code);
  return data as T;
}

export const useAuthStatus = () => useQuery({ queryKey: ['auth'], queryFn: () => api<AuthStatus>('/auth/status') });

/** Polls a job until it finishes. Pass null to disable. */
export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api<Job>(`/api/jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (q) => (q.state.data?.status === 'running' || !q.state.data ? 700 : false),
    // Keep following long jobs while the tab is in the background.
    refetchIntervalInBackground: true,
  });
}

/** The most recent job of a kind (or null). */
export const useLatestJob = (kind: JobKind) =>
  useQuery({ queryKey: ['latestJob', kind], queryFn: () => api<Job | null>(`/api/jobs?kind=${kind}`) });
