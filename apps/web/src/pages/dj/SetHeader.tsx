import { useState } from 'react';
import { Badge, cx } from '../../components/ui.tsx';

export type SetKind = 'new' | 'draft' | 'spotify';

const KIND: Record<SetKind, { label: string; tone: 'neutral' | 'warn' | 'good' }> = {
  new: { label: 'New set', tone: 'neutral' },
  draft: { label: 'Draft', tone: 'warn' },
  spotify: { label: 'On Spotify', tone: 'good' },
};

/**
 * One line that says which set is open: new, a Draft, or a copy of a set on
 * Spotify; its name (click to rename); and whether it is saved or in sync.
 */
export function SetHeader({
  kind,
  name,
  status,
  statusTone = 'muted',
  spotifyUrl,
  onRename,
}: {
  kind: SetKind;
  name: string | null;
  status: string;
  statusTone?: 'muted' | 'good' | 'warn' | 'bad';
  spotifyUrl: string | null;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? '');
  const k = KIND[kind];
  const save = () => {
    const n = draft.trim();
    if (n && n !== name) onRename(n);
    setEditing(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-3">
      <Badge tone={k.tone}>{k.label}</Badge>
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={100}
          aria-label="Set name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="min-w-48 flex-1 rounded bg-zinc-800 px-2 py-1 text-lg font-semibold"
        />
      ) : (
        <button
          onClick={() => {
            setDraft(name ?? '');
            setEditing(true);
          }}
          title="Rename"
          className={cx('min-w-0 truncate rounded px-1 text-left text-lg font-semibold hover:bg-zinc-800', !name && 'text-zinc-500')}
        >
          {name ?? 'Untitled set'} <span className="text-sm font-normal text-zinc-500">✎</span>
        </button>
      )}
      <span
        className={cx(
          'ml-auto text-sm',
          statusTone === 'good' && 'text-emerald-300',
          statusTone === 'warn' && 'text-amber-300',
          statusTone === 'bad' && 'text-red-300',
          statusTone === 'muted' && 'text-zinc-400',
        )}
        aria-live="polite"
      >
        {status}
      </span>
      {spotifyUrl && (
        <a href={spotifyUrl} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline">
          Open in Spotify
        </a>
      )}
    </div>
  );
}
