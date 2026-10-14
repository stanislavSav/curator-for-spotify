import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Job } from '@curator/shared';

// Small shared UI kit (Tailwind). Feature pages compose these; add new
// primitives here only if two or more pages need them.

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-black hover:bg-brand-dark',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  ghost: 'text-zinc-300 hover:bg-zinc-800',
};

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cx(
        'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-zinc-800 bg-zinc-900/60 p-4', className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-4">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-zinc-800 text-zinc-300',
  good: 'bg-emerald-900/60 text-emerald-300',
  warn: 'bg-amber-900/60 text-amber-300',
  bad: 'bg-red-900/60 text-red-300',
  info: 'bg-sky-900/60 text-sky-300',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg bg-zinc-900 p-3" title={hint}>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function JobProgress({ job }: { job: Job | null | undefined }) {
  if (!job) return null;
  const pct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : job.status === 'done' ? 100 : 0;
  return (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between text-zinc-400">
        <span>
          {job.status === 'running' ? job.message || 'Working…' : job.status === 'done' ? job.message || 'Done' : 'Failed'}
        </span>
        {job.total > 0 && (
          <span className="tabular-nums">
            {job.progress}/{job.total}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
        <div
          className={cx('h-full transition-all', job.status === 'failed' ? 'bg-red-500' : 'bg-brand')}
          style={{ width: `${pct}%` }}
        />
      </div>
      {job.error && <p className="text-red-400">{job.error}</p>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded bg-red-950/60 p-2 text-sm text-red-300">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-zinc-500">{children}</p>;
}

export { cx };
