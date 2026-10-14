import { useState, type KeyboardEvent } from 'react';
import { PROPOSAL_LIMITS, type ProposalStatus, type ProposalView } from '@curator/shared';
import { Badge, Button, ErrorNote, cx } from '../../components/ui.tsx';
import { THEME_LABEL, duration, plural, usePatchProposal } from './data.ts';
import { TrackList } from './TrackList.tsx';

const STATUS_TONE: Record<ProposalStatus, 'neutral' | 'good' | 'bad' | 'info'> = {
  pending: 'neutral',
  approved: 'good',
  dropped: 'bad',
  created: 'info',
};

export function ProposalCard({ p, basic = false }: { p: ProposalView; basic?: boolean }) {
  const patch = usePatchProposal(p.id);
  const [open, setOpen] = useState(false);
  const readOnly = p.status === 'created';
  const anyEdit = p.edited.name || p.edited.description || p.edited.tracks;
  const topOverlap = p.overlaps[0];
  const errors = p.issues.filter((i) => i.level === 'error');
  const warnings = p.issues.filter((i) => i.level === 'warning');
  const s = p.stats;

  return (
    <article
      className={cx(
        'flex flex-col gap-3 rounded-xl border bg-zinc-900/60 p-4',
        p.status === 'approved' ? 'border-brand/60' : 'border-zinc-800',
        p.status === 'dropped' && 'opacity-60',
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
        <Badge tone="info">{THEME_LABEL[p.theme]}</Badge>
        {basic && <Badge title="Built by simple rules, not by an AI agent">Basic</Badge>}
        <Badge title={basic ? 'How strong the rule-based evidence is' : 'How sure your AI agent is that you will want this playlist'}>
          {Math.round(p.confidence * 100)}% confidence
        </Badge>
        {anyEdit && <Badge tone="warn">edited</Badge>}
      </header>

      <EditableText
        key={`n:${p.name}`}
        value={p.name}
        max={PROPOSAL_LIMITS.name}
        disabled={readOnly || patch.isPending}
        onSave={(name) => patch.mutate({ name })}
        className="text-lg font-semibold"
        label="Playlist name"
      />
      <EditableText
        key={`d:${p.description}`}
        value={p.description}
        max={PROPOSAL_LIMITS.description}
        disabled={readOnly || patch.isPending}
        onSave={(description) => patch.mutate({ description })}
        className="text-sm text-zinc-300"
        label="Description"
        multiline
      />

      <p className="text-sm text-zinc-400">
        <span className="font-medium text-zinc-300">Why: </span>
        {p.rationale}
      </p>

      <p className="text-xs text-zinc-400">
        {plural(s.count, 'track')} · {duration(s.durationMs)}
        {s.bpmMin != null && ` · ${s.bpmMin === s.bpmMax ? s.bpmMin : `${s.bpmMin}–${s.bpmMax}`} BPM`}
        {s.topTags.length > 0 && ` · ${s.topTags.join(', ')}`}
        {s.unknown > 0 && <span className="text-red-300"> · {s.unknown} unknown</span>}
      </p>

      {p.rules && <Rules rules={p.rules} />}

      {topOverlap && (
        <p
          className={cx(
            'rounded px-2 py-1 text-xs',
            topOverlap.share >= 0.5 ? 'bg-amber-950/60 text-amber-300' : 'bg-zinc-800/60 text-zinc-400',
          )}
        >
          {Math.round(topOverlap.share * 100)}% of the tracks are already in “{topOverlap.name}”.
          {topOverlap.share >= 0.5 && ' This may be a near-duplicate.'}
        </p>
      )}
      {p.editsOutdated && (
        <p className="rounded bg-amber-950/60 px-2 py-1 text-xs text-amber-300">
          The proposals file changed this track list after you edited it. Reset to see the new version.
        </p>
      )}
      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="space-y-0.5 text-xs">
          {[...errors, ...warnings].slice(0, 4).map((i, k) => (
            <li key={k} className={i.level === 'error' ? 'text-red-300' : 'text-amber-300'}>
              {i.message}
            </li>
          ))}
          {errors.length + warnings.length > 4 && (
            <li className="text-zinc-500">… and {errors.length + warnings.length - 4} more (see the track list)</li>
          )}
        </ul>
      )}

      <div>
        <button className="text-sm text-zinc-300 hover:text-white" onClick={() => setOpen((o) => !o)}>
          {open ? '▾ Hide tracks' : `▸ Show ${plural(s.count, 'track')}`}
        </button>
        {open && (
          <div className="mt-2">
            <TrackList
              tracks={p.tracks}
              readOnly={readOnly}
              busy={patch.isPending}
              onChange={(trackIds) => patch.mutate({ trackIds })}
            />
          </div>
        )}
      </div>

      <ErrorNote error={patch.error} />

      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
        {readOnly ? (
          p.spotifyUrl && (
            <a href={p.spotifyUrl} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline">
              Open in Spotify ↗
            </a>
          )
        ) : (
          <>
            <Button
              variant={p.status === 'approved' ? 'secondary' : 'primary'}
              disabled={patch.isPending}
              onClick={() => patch.mutate({ status: p.status === 'approved' ? 'pending' : 'approved' })}
            >
              {p.status === 'approved' ? 'Unapprove' : 'Approve'}
            </Button>
            <Button
              variant="ghost"
              disabled={patch.isPending}
              onClick={() => patch.mutate({ status: p.status === 'dropped' ? 'pending' : 'dropped' })}
            >
              {p.status === 'dropped' ? 'Undrop' : 'Drop'}
            </Button>
            {(anyEdit || p.status !== 'pending') && (
              <Button
                variant="ghost"
                className="ml-auto"
                disabled={patch.isPending}
                onClick={() => patch.mutate({ reset: true })}
                title="Undo all edits and set the status back to pending"
              >
                Reset
              </Button>
            )}
          </>
        )}
      </footer>
    </article>
  );
}

function Rules({ rules }: { rules: NonNullable<ProposalView['rules']> }) {
  const parts = [
    rules.tags?.length ? `tags: ${rules.tags.join(', ')}` : null,
    rules.bpm ? `${rules.bpm[0]}–${rules.bpm[1]} BPM` : null,
    rules.years ? `${rules.years[0]}–${rules.years[1]}` : null,
    rules.energy ? `energy ${rules.energy[0]}–${rules.energy[1]}` : null,
    rules.note ?? null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" title="The rules behind this Proposal. Informational only.">
      {parts.map((x) => (
        <span key={x} className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
          {x}
        </span>
      ))}
    </div>
  );
}

/** Inline edit: saves on blur or Enter, Escape cancels. Remount (key) to take a new server value. */
function EditableText({
  value,
  max,
  disabled,
  onSave,
  className,
  label,
  multiline,
}: {
  value: string;
  max: number;
  disabled: boolean;
  onSave: (v: string) => void;
  className: string;
  label: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const tooLong = draft.length > max;
  const commit = () => {
    const v = draft.trim();
    if (v === value || tooLong || (!multiline && v === '')) {
      if (!multiline && v === '') setDraft(value);
      return;
    }
    onSave(v);
  };
  const common = {
    'aria-label': label,
    value: draft,
    disabled,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        setDraft(value);
        e.currentTarget.blur();
      }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
    className: cx(
      'w-full resize-none rounded border border-transparent bg-transparent px-1 -mx-1 hover:border-zinc-700 focus:border-zinc-500 focus:bg-zinc-950 focus:outline-none disabled:hover:border-transparent',
      tooLong && 'border-red-500',
      className,
    ),
  };
  return (
    <div>
      {multiline ? <textarea rows={2} placeholder="No description" {...common} /> : <input {...common} />}
      {draft !== value && (
        <div className={cx('text-right text-xs', tooLong ? 'text-red-400' : 'text-zinc-500')}>
          {draft.length}/{max}
        </div>
      )}
    </div>
  );
}
