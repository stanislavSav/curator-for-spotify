import { useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { Badge, Button, cx } from '../../components/ui.tsx';

export type StepState = 'done' | 'todo' | 'locked';

const stateBadge: Record<StepState, ReactNode> = {
  done: <Badge tone="good">Done</Badge>,
  todo: <Badge tone="info">To do</Badge>,
  locked: <Badge>Waiting</Badge>,
};

/** One numbered step of the setup checklist. Locked steps are dimmed and say what to finish first. */
export function Step({
  n,
  title,
  state,
  lockedHint,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  lockedHint?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        'rounded-xl border p-4',
        state === 'todo' ? 'border-brand/50 bg-zinc-900' : 'border-zinc-800 bg-zinc-900/60',
      )}
    >
      <header className="mb-3 flex items-center gap-3">
        <span
          className={cx(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            state === 'done' ? 'bg-brand text-black' : 'bg-zinc-800 text-zinc-300',
          )}
        >
          {state === 'done' ? '✓' : n}
        </span>
        <h2 className="flex-1 text-base font-semibold">{title}</h2>
        {stateBadge[state]}
      </header>
      {state === 'locked' && lockedHint ? (
        <p className="text-sm text-zinc-500">{lockedHint}</p>
      ) : (
        <div className="space-y-3 text-sm text-zinc-300">{children}</div>
      )}
    </section>
  );
}

/** A link styled like the primary Button. */
export function LinkButton({ className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cx(
        'inline-flex items-center gap-2 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-black transition hover:bg-brand-dark',
        className,
      )}
      {...props}
    />
  );
}

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100">{value}</code>
      <Button onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-zinc-950 px-1 py-0.5 font-mono text-xs text-zinc-100">{children}</code>;
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
