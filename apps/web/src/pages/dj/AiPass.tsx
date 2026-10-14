import { useEffect, useRef, useState } from 'react';
import type { AiPassAgents, DjTransition, TransitionSettings } from '@curator/shared';
import { cx, ErrorNote } from '../../components/ui.tsx';
import { AGENT_NAMES, NO_AGENT_HELP, settingsLine } from './ai.ts';
import { aiDiffers, fromAi, sameSettings } from './edits.ts';
import type { AiBanner } from './hooks.ts';

/** A four-point sparkle with a small second one, like Spotify's Auto button. */
export function SparkleIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M10 4C10 9.5 12.5 12 18 12C12.5 12 10 14.5 10 20C10 14.5 7.5 12 2 12C7.5 12 10 9.5 10 4Z" />
      <path d="M19 1.5C19 3.8 19.9 4.8 22 5C19.9 5.2 19 6.2 19 8.5C19 6.2 18.1 5.2 16 5C18.1 4.8 19 3.8 19 1.5Z" />
    </svg>
  );
}

interface ButtonProps {
  agents: AiPassAgents | undefined;
  running: boolean;
  disabled?: boolean;
  onRun: (focus?: string) => void;
}

/** "✦ AI pass": a dark pill. The main click runs at once; the caret opens an optional focus. */
export function AiPassButton({ agents, running, disabled = false, onRun }: ButtonProps) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const agent = agents?.selected ?? null;
  const off = disabled || running || agent == null;
  const title =
    agents == null ? 'Looking for an agent CLI…' : agent == null ? NO_AGENT_HELP : `Ask ${AGENT_NAMES[agent]} to review this sheet`;
  const run = (f?: string) => {
    setOpen(false);
    onRun(f?.trim() || undefined);
  };

  return (
    <div ref={ref} className="relative" title={title}>
      <div
        className={cx(
          'inline-flex items-stretch overflow-hidden rounded-xl bg-[#1f1f1f] text-sm font-semibold text-white',
          off && 'opacity-50',
        )}
      >
        <button
          onClick={() => run()}
          disabled={off}
          className="inline-flex items-center gap-2 px-5 py-2.5 transition hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          {running ? <Spinner /> : <SparkleIcon />}
          {running ? 'Thinking…' : 'AI pass'}
        </button>
        <button
          onClick={() => setOpen(!open)}
          disabled={off}
          aria-label="AI pass with a focus"
          aria-expanded={open}
          title="Add a focus first, e.g. darker, more echo"
          className="border-l border-white/10 px-2.5 transition hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden fill="currentColor">
            <path d="M2.5 4.5 6 8l3.5-3.5z" />
          </svg>
        </button>
      </div>
      {open && (
        <form
          className="absolute right-0 top-full z-20 mt-2 w-72 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 shadow-xl"
          onSubmit={(e) => {
            e.preventDefault();
            run(focus);
          }}
        >
          <label className="block text-xs text-zinc-400">
            Focus (optional)
            <input
              autoFocus
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              maxLength={200}
              placeholder="darker, more echo"
              className="mt-1 w-full rounded bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500"
            />
          </label>
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1f1f1f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2a2a2a]"
          >
            <SparkleIcon /> Run AI pass
          </button>
        </form>
      )}
    </div>
  );
}

/** Progress, result or error of the AI pass, above the cards. */
export function AiPassBanner({
  running,
  message,
  agentName,
  banner,
  onDismiss,
  nameAction,
}: {
  running: boolean;
  message: string;
  agentName: string;
  banner: AiBanner | null;
  onDismiss: () => void;
  /** What to do with the suggested set name (use it, rename a draft); null = show it only. */
  nameAction?: { label: string; onClick: (name: string) => void; doneFor?: string | null } | null;
}) {
  if (running) {
    return (
      <p className="mb-3 flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-300" aria-live="polite">
        <Spinner /> {message || `Waiting for ${agentName}…`} You can keep using the sheet.
      </p>
    );
  }
  if (!banner) return null;
  return (
    <div className="mb-3 flex items-start gap-2" aria-live="polite">
      <div className="min-w-0 flex-1">
        {banner.kind === 'error' ? (
          <ErrorNote error={banner.error} />
        ) : (
          <div className="rounded-lg border border-zinc-700 bg-[#1f1f1f] px-3 py-2 text-sm text-zinc-100">
            <p className="flex items-start gap-2">
              <SparkleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{banner.text}</span>
            </p>
            {banner.setName && (
              <p className="mt-2 flex flex-wrap items-center gap-2 pl-6 text-zinc-300">
                <span>
                  Suggested name: <span className="font-semibold text-white">{banner.setName}</span>
                </span>
                {nameAction &&
                  (nameAction.doneFor === banner.setName ? (
                    <span className="text-xs text-emerald-300">✓ Done</span>
                  ) : (
                    <button
                      onClick={() => nameAction.onClick(banner.setName!)}
                      className="rounded-full bg-zinc-800 px-3 py-0.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
                    >
                      {nameAction.label}
                    </button>
                  ))}
              </p>
            )}
          </div>
        )}
      </div>
      <button onClick={onDismiss} aria-label="Dismiss" className="rounded px-2 py-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
        ✕
      </button>
    </div>
  );
}

/** The sparkle "AI" badge of a card whose settings come from the AI pass. */
export function AiBadge({ transition: tr }: { transition: DjTransition }) {
  if (!tr.ai || !fromAi(tr)) return null;
  const title = aiDiffers(tr) ? `AI pass by ${AGENT_NAMES[tr.ai.agent]}: ${tr.ai.reason}` : `${AGENT_NAMES[tr.ai.agent]} agrees with the rules.`;
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded bg-[#1f1f1f] px-1.5 py-0.5 text-xs font-semibold text-white">
      <SparkleIcon className="size-3" /> AI
    </span>
  );
}

/** "Rules: …" vs "AI: …" for a pair where they differ, with a button to switch. */
export function RulesVsAi({ transition: tr, onChange }: { transition: DjTransition; onChange?: (s: TransitionSettings) => void }) {
  if (!tr.ai || !aiDiffers(tr)) return null;
  const option = (label: string, s: TransitionSettings, action: string, why: string) => {
    const on = sameSettings(tr.settings, s);
    return (
      <div className={cx('flex items-center justify-between gap-2 rounded-md px-2 py-1', on ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400')}>
        <span className="min-w-0 truncate" title={why}>
          <span className="font-medium">{label}:</span> {settingsLine(s)}
        </span>
        {onChange && !on && (
          <button onClick={() => onChange(s)} className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-200 hover:bg-zinc-700">
            {action}
          </button>
        )}
      </div>
    );
  };
  return (
    <div className="space-y-0.5 rounded-lg border border-zinc-800 p-1 text-xs">
      {option('Rules', tr.suggested, 'Reset to rules', tr.reason)}
      {option('AI', tr.ai.settings, 'Use AI', tr.ai.reason)}
    </div>
  );
}

export function Spinner() {
  return <span aria-hidden className="inline-block size-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />;
}
