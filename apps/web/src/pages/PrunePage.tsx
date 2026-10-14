import { useDeferredValue, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PRUNE_MONTHS, type PruneCandidate, type PruneCandidatesResponse } from '@curator/shared';
import { api } from '../api.ts';
import { Button, Card, Empty, ErrorNote } from '../components/ui.tsx';
import { BackupsCard } from './prune/BackupsCard.tsx';
import { CandidateGroup } from './prune/CandidateTable.tsx';
import { day, plural } from './prune/format.ts';
import { ImportCard } from './prune/ImportCard.tsx';
import { PruneDialog } from './prune/PruneDialog.tsx';

// Owned by the prune feature.
export function PrunePage() {
  const qc = useQueryClient();
  const [months, setMonths] = useState(DEFAULT_PRUNE_MONTHS);
  const deferredMonths = useDeferredValue(months);
  // Only the user's changes are stored; untouched rows follow the server's preselect.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [confirming, setConfirming] = useState<PruneCandidate[] | null>(null);

  const candidates = useQuery({
    queryKey: ['prune', 'candidates', deferredMonths],
    queryFn: () => api<PruneCandidatesResponse>(`/api/prune/candidates?months=${deferredMonths}`),
    placeholderData: keepPreviousData,
  });

  const rows = candidates.data?.playlists ?? [];
  const isChecked = (r: PruneCandidate) => overrides.get(r.id) ?? r.preselect;
  const setChecked = (ids: string[], value: boolean) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, value);
      return next;
    });
  const groups = useMemo(
    () => ({
      candidate: rows.filter((r) => r.group === 'candidate'),
      noEvidence: rows.filter((r) => r.group === 'no-evidence'),
      keep: rows.filter((r) => r.group === 'keep'),
    }),
    [rows],
  );
  const selected = rows.filter(isChecked);

  const closeDialog = (ran: boolean) => {
    setConfirming(null);
    if (ran) {
      setOverrides(new Map());
      void qc.invalidateQueries({ queryKey: ['prune'] });
    }
  };

  const data = candidates.data;

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-semibold">Prune</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Find playlists you no longer use and remove them from your Library. The tool looks for Usage Evidence: plays from
          the playlist, plays of its Exclusive Tracks (tracks that are in no other playlist and not in Liked Songs), and
          edits. Nothing is removed until you tick it and confirm. A Backup is saved first. Generated Playlists (Discover
          Weekly, Daylist, Blends) are never listed.
        </p>
      </div>

      <ImportCard />

      <Card
        title="2 · Review Prune Candidates"
        actions={
          <label className="flex items-center gap-3 text-sm text-zinc-300">
            <span className="whitespace-nowrap">
              Unused for <b className="tabular-nums text-zinc-100">{months}</b> months
            </span>
            <input
              type="range"
              min={1}
              max={36}
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="w-40 accent-brand"
            />
          </label>
        }
      >
        <p className="text-sm text-zinc-400">
          Tick the playlists you want to prune, then use the button at the bottom. Playlists with no Usage Evidence after{' '}
          {data ? day(data.cutoff) : '…'} are candidates.
          {data && data.excludedGenerated > 0 && ` ${plural(data.excludedGenerated, 'Generated Playlist')} left out.`}
        </p>
        <ErrorNote error={candidates.error} />
      </Card>

      {data && rows.length === 0 && <Empty>No playlists yet. Connect and run Sync on the Setup page first.</Empty>}

      {data && rows.length > 0 && (
        <div className="space-y-4">
          <CandidateGroup
            title="Prune Candidates"
            intro="Last Usage Evidence is older than the threshold, or the playlist is empty. Ticked by default when the evidence is strong."
            rows={groups.candidate}
            defaultOpen
            isChecked={isChecked}
            setChecked={setChecked}
          />
          <CandidateGroup
            title="No evidence"
            intro="The tool can't tell if you use these: mostly Followed Playlists (their tracks can't be read) and playlists without dated data. Never ticked by default — decide yourself."
            rows={groups.noEvidence}
            defaultOpen={false}
            isChecked={isChecked}
            setChecked={setChecked}
          />
          <CandidateGroup
            title="Keep"
            intro="Used within the threshold."
            rows={groups.keep}
            defaultOpen={false}
            isChecked={isChecked}
            setChecked={setChecked}
          />
        </div>
      )}

      <BackupsCard />

      {selected.length > 0 && (
        <div className="sticky bottom-4 z-40 flex items-center justify-between gap-4 rounded-xl border border-zinc-700 bg-zinc-900/95 p-3 shadow-xl backdrop-blur">
          <span className="text-sm text-zinc-300">
            {plural(selected.length, 'playlist')} ticked: {selected.filter((r) => r.kind === 'owned').length} to delete,{' '}
            {selected.filter((r) => r.kind === 'followed').length} to unfollow.
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setChecked(selected.map((r) => r.id), false)}>
              Untick all
            </Button>
            <Button variant="danger" onClick={() => setConfirming(selected)}>
              Prune {plural(selected.length, 'playlist')}
            </Button>
          </div>
        </div>
      )}

      {confirming && <PruneDialog playlists={confirming} onClose={closeDialog} />}
    </div>
  );
}
