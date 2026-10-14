import { useState } from 'react';
import type { DjSetRecord, Job } from '@curator/shared';
import { Badge, Button, Card, ErrorNote, JobProgress } from '../../components/ui.tsx';
import { isoDay } from './saved.ts';

type Props = {
  record: DjSetRecord;
  justSaved: boolean;
  onCreate: () => void;
  creating: boolean;
  createError: unknown;
  job: Job | undefined;
  onRename: (name: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onUseSettings: () => void;
  onClose: () => void;
};

type Asking = 'create' | 'rename' | 'delete' | null;

/** The top of a draft's view: what a draft is, and Create on Spotify / Rename / Delete. */
export function DraftHeader({ record, justSaved, onCreate, creating, createError, job, onRename, onDelete, onUseSettings, onClose }: Props) {
  const [asking, setAsking] = useState<Asking>(null);
  const [name, setName] = useState(record.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      setAsking(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const ask = (a: Asking) => {
    setAsking(a);
    setError(null);
    if (a === 'rename') setName(record.name);
  };

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {record.name} <Badge tone="warn">Draft — not on Spotify yet</Badge>
        </span>
      }
      actions={
        <>
          <Button variant="ghost" onClick={onUseSettings} title="Copy this draft's settings into the panel on the left and rebuild. Your edits stay on pairs that remain.">
            Use these settings
          </Button>
          <Button onClick={onClose}>Back to builder</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-zinc-400">
        {justSaved
          ? `“${record.name}” is saved as a draft with ${record.tracks} tracks. `
          : `Saved ${isoDay(record.createdAt)}${record.updatedAt ? `, updated ${isoDay(record.updatedAt)}` : ''}. `}
        Edit the Transition Sheet or run an AI pass here; your changes are saved in this app. Nothing goes to Spotify
        until you create the playlist.
      </p>

      {asking === 'create' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-300">Create the private playlist “{record.name}” on Spotify?</span>
          <Button variant="primary" disabled={creating} onClick={onCreate}>
            {creating ? 'Creating…' : 'Create playlist'}
          </Button>
          <Button variant="ghost" disabled={creating} onClick={() => ask(null)}>
            Cancel
          </Button>
        </div>
      ) : asking === 'rename' ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n || n === record.name) return ask(null);
            void run(() => onRename(n));
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            aria-label="Draft name"
            className="min-w-60 flex-1 rounded bg-zinc-800 px-3 py-1.5 text-sm"
          />
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            Rename
          </Button>
          <Button variant="ghost" type="button" onClick={() => ask(null)}>
            Cancel
          </Button>
        </form>
      ) : asking === 'delete' ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-950/30 px-3 py-2 text-sm text-red-200">
          <span className="flex-1">Delete this draft? Its tracks and Transition Sheet are gone after this.</span>
          <Button variant="danger" disabled={busy} onClick={() => void run(onDelete)}>
            {busy ? 'Deleting…' : 'Delete draft'}
          </Button>
          <Button variant="ghost" onClick={() => ask(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={creating || record.tracks === 0} onClick={() => ask('create')}>
            Create on Spotify
          </Button>
          <Button onClick={() => ask('rename')}>Rename</Button>
          <Button variant="ghost" className="text-red-300!" onClick={() => ask('delete')}>
            Delete draft
          </Button>
        </div>
      )}
      <div className="mt-3 space-y-2">
        <ErrorNote error={error ?? createError} />
        <JobProgress job={job} />
      </div>
    </Card>
  );
}
