import { useEffect, useRef, useState } from 'react';
import type { DjSetResult } from '@curator/shared';
import { Badge, Button, cx } from '../../components/ui.tsx';
import { AiBadge } from './AiPass.tsx';
import { appliedCount, isEdited, pairTitle } from './edits.ts';
import { TransitionBody } from './TransitionCard.tsx';

interface Props {
  result: DjSetResult;
  maxBpmStepPct: number;
  spotifyUrl: string | null;
  /** Omit for a preview: Apply mode is then read-only. */
  onApplied?: (index: number, v: boolean) => void;
  onClose: () => void;
}

const firstOpen = (r: DjSetResult) => Math.max(0, r.transitions.findIndex((t) => !t.applied));

/** Full-screen view of one transition at a time, to read next to Spotify. */
export function ApplyMode({ result, maxBpmStepPct, spotifyUrl, onApplied, onClose }: Props) {
  const total = result.transitions.length;
  const [index, setIndex] = useState(() => (onApplied ? firstOpen(result) : 0));
  const i = Math.min(index, Math.max(0, total - 1));
  const tr = result.transitions[i];
  const done = appliedCount(result);

  // Handlers read the latest props through a ref, so the listener is added once.
  const latest = useRef({ i, tr, total, onApplied, onClose });
  latest.current = { i, tr, total, onApplied, onClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { i, tr, total, onApplied, onClose } = latest.current;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setIndex(Math.min(total - 1, i + 1));
      else if (e.key === 'ArrowLeft') setIndex(Math.max(0, i - 1));
      else if (e.key === ' ') {
        e.preventDefault();
        if (onApplied && tr && !tr.applied) onApplied(i, true);
        setIndex(Math.min(total - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = overflow;
    };
  }, []);

  const progress = onApplied ? done / Math.max(1, total) : (i + 1) / Math.max(1, total);

  return (
    <div role="dialog" aria-modal="true" aria-label="Apply mode" className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col bg-zinc-950">
      <div className="h-1 bg-zinc-800">
        <div className="h-full bg-brand transition-all" style={{ width: `${progress * 100}%` }} />
      </div>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Apply mode</h2>
          <span className="text-sm tabular-nums text-zinc-400">
            Transition {i + 1} of {total}
            {onApplied && ` · ${done}/${total} applied`}
          </span>
          {!onApplied && <Badge>read-only preview</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {spotifyUrl && (
            <a href={spotifyUrl} target="_blank" rel="noreferrer" className="rounded-full px-3 py-1.5 text-sm text-brand hover:bg-zinc-800">
              Open playlist in Spotify
            </a>
          )}
          <Button onClick={onClose} title="Esc">
            Close
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {tr ? (
          <div className={cx('mx-auto max-w-3xl', onApplied && tr.applied && 'opacity-70')}>
            <div className="mb-4 flex items-center gap-3">
              <h3 className="text-3xl font-semibold tabular-nums">{pairTitle(i, tr.settings)}</h3>
              {isEdited(tr) && <Badge tone="info">edited</Badge>}
              <AiBadge transition={tr} />
              {onApplied && tr.applied && <Badge tone="good">✓ applied</Badge>}
            </div>
            <TransitionBody
              index={i}
              transition={tr}
              from={result.tracks[i]!}
              to={result.tracks[i + 1]!}
              maxBpmStepPct={maxBpmStepPct}
              large
            />
          </div>
        ) : (
          <p className="text-center text-zinc-500">This set has no transitions.</p>
        )}
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3 sm:px-8">
        <p className="text-xs text-zinc-500">
          ← → move · {onApplied ? 'Space marks applied and goes next' : 'Space goes next'} · Esc closes
        </p>
        <div className="flex items-center gap-2">
          <Button disabled={i === 0} onClick={() => setIndex(i - 1)}>
            ← Prev
          </Button>
          {onApplied && tr && (
            <Button variant={tr.applied ? 'secondary' : 'primary'} onClick={() => onApplied(i, !tr.applied)}>
              {tr.applied ? 'Mark not applied' : 'Mark applied'}
            </Button>
          )}
          <Button disabled={i >= total - 1} onClick={() => setIndex(i + 1)}>
            Next →
          </Button>
        </div>
      </footer>
    </div>
  );
}
