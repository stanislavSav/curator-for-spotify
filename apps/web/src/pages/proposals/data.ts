import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BasicProposalsResponse, Job, ProposalPatch, ProposalTheme, ProposalsResponse } from '@curator/shared';
import { api } from '../../api.ts';

const KEY = ['proposals'];

// Refetch on focus: the user's AI agent writes the file in another window, then they come back.
export const useProposals = () =>
  useQuery({ queryKey: KEY, queryFn: () => api<ProposalsResponse>('/api/proposals'), refetchOnWindowFocus: true });

export function usePatchProposal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProposalPatch) =>
      api<{ ok: true }>(`/api/proposals/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useApplyProposals() {
  return useMutation({
    mutationFn: (ids: string[]) => api<Job>('/api/proposals/apply', { method: 'POST', json: { ids } }),
  });
}

/** Writes Basic Proposals. Without replace, an existing file gives a 409. */
export function useGenerateBasic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (replace: boolean) =>
      api<BasicProposalsResponse>('/api/proposals/basic', { method: 'POST', json: { replace } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export const invalidateProposals = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

// ---- formatting ----

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

export const trackTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (min < 2) return 'just now';
  if (min < 90) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const THEME_LABEL: Record<ProposalTheme, string> = {
  genre: 'Genre',
  mood: 'Mood',
  era: 'Era',
  activity: 'Activity',
  tempo: 'Tempo',
  rediscover: 'Rediscover',
  other: 'Other',
};
