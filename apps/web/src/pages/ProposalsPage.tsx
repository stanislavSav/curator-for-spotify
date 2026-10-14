import { useState } from 'react';
import { PROPOSAL_STATUSES, type ProposalStatus } from '@curator/shared';
import { Button, Empty, ErrorNote, cx } from '../components/ui.tsx';
import { ApplyBar } from './proposals/ApplyBar.tsx';
import { useProposals } from './proposals/data.ts';
import { EmptyState, InvalidFile, SummaryCard } from './proposals/Panels.tsx';
import { ProposalCard } from './proposals/ProposalCard.tsx';

type Filter = 'all' | ProposalStatus;
const FILTERS: Filter[] = ['all', ...PROPOSAL_STATUSES];

// Owned by the proposals feature.
export function ProposalsPage() {
  const q = useProposals();
  const [filter, setFilter] = useState<Filter>('all');
  const data = q.data;
  const shown = data?.proposals.filter((p) => filter === 'all' || p.status === filter) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Proposals</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">
            New playlists suggested from your listening, by your AI agent or by simple rules. Approve the ones you want,
            edit names, descriptions and tracks, drop the rest. Then create the approved ones on Spotify. Nothing changes
            on Spotify until you press Create.
          </p>
        </div>
        <Button onClick={() => void q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? 'Loading…' : 'Reload file'}
        </Button>
      </div>

      <ErrorNote error={q.error} />
      {q.isPending && <Empty>Loading Proposals…</Empty>}

      {data?.file.status === 'missing' && <EmptyState snapshotAt={data.currentSnapshotAt} />}
      {data?.file.status === 'invalid' && <InvalidFile file={data.file} />}

      {data?.file.status === 'ok' && (
        <>
          <SummaryCard data={data} />

          <nav className="flex flex-wrap gap-1">
            {FILTERS.map((f) => {
              const n = f === 'all' ? data.proposals.length : data.counts[f];
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cx(
                    'rounded-full px-3 py-1 text-sm capitalize',
                    f === filter ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
                  )}
                >
                  {f} <span className="tabular-nums opacity-60">{n}</span>
                </button>
              );
            })}
          </nav>

          {shown.length === 0 ? (
            <Empty>No {filter === 'all' ? '' : `${filter} `}Proposals.</Empty>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {shown.map((p) => (
                <ProposalCard key={p.id} p={p} basic={data.file.generator === 'basic'} />
              ))}
            </div>
          )}

          <ApplyBar proposals={data.proposals} />
        </>
      )}
    </div>
  );
}
