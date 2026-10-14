import type { ReactNode } from 'react';
import type { ProposalsResponse, ValidationIssue } from '@curator/shared';
import { Badge, Card } from '../../components/ui.tsx';
import { BasicProposalsButton } from './BasicProposals.tsx';
import { ago, plural } from './data.ts';

const Code = ({ children }: { children: string }) => (
  <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200">{children}</code>
);

/** No proposals file yet: two ways to get Proposals. */
export function EmptyState({ snapshotAt }: { snapshotAt: string | null }) {
  return (
    <Card title="No Proposals yet">
      <p className="mb-4 max-w-3xl text-sm text-zinc-400">
        First, run Sync on <a className="text-brand hover:underline" href="#/home">Setup &amp; Sync</a>, then Enrich on the{' '}
        <a className="text-brand hover:underline" href="#/library">Library</a> page: tags, BPM and energy make better
        Proposals. Then choose one of these two ways.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <h3 className="font-semibold">Use your AI agent</h3>
          <p className="mt-1 text-xs text-zinc-500">The most personal Proposals: names, themes and a reason for each track.</p>
          <ol className="mt-4 space-y-4 text-sm">
            <Step n={1} title="Build a Snapshot">
              On the <a className="text-brand hover:underline" href="#/library">Library</a> page, run Build snapshot.
              <div className="mt-1 text-xs text-zinc-500">
                {snapshotAt ? `Current Snapshot: built ${ago(snapshotAt)}.` : 'There is no Snapshot yet.'}
              </div>
            </Step>
            <Step n={2} title="Ask your AI agent">
              In a terminal, open your AI agent in this project folder and run <Code>/propose-playlists</Code>. It reads{' '}
              <Code>data/snapshot.json</Code> and writes <Code>data/proposals.json</Code>. You can add a focus, for example{' '}
              <Code>/propose-playlists more running playlists</Code>.
              <div className="mt-1 text-xs text-zinc-500">
                Works with Claude Code, Codex, Gemini CLI, Cursor or Copilot. See <Code>AGENTS.md</Code>.
              </div>
            </Step>
            <Step n={3} title="Review here">
              Come back to this page. It reloads the file when you return.
            </Step>
          </ol>
        </section>
        <section className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <h3 className="font-semibold">Generate basic proposals</h3>
          <p className="mt-1 text-xs text-zinc-500">No AI agent needed.</p>
          <p className="mt-4 text-sm text-zinc-400">
            The app groups your Library by simple rules: genre tags, tempo, era, energy, and songs you liked long ago but
            no longer play. The lists are plainer than an AI agent&apos;s, but you review them the same way: approve,
            edit or drop each one.
          </p>
          <div className="mt-4 space-y-2">
            <BasicProposalsButton />
          </div>
        </section>
      </div>
      <p className="mt-4 text-xs text-zinc-500">
        Nothing changes on Spotify until you approve Proposals and press Create.
      </p>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold">
        {n}
      </span>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-zinc-400">{children}</div>
      </div>
    </li>
  );
}

const issueLine = (i: ValidationIssue) => `${i.path ? `${i.path}: ` : ''}${i.message}`;

/** The file exists but cannot be used. */
export function InvalidFile({ file }: { file: ProposalsResponse['file'] }) {
  return (
    <section className="rounded-xl border border-red-900 bg-red-950/40 p-4">
      <h2 className="font-semibold text-red-200">The proposals file has errors</h2>
      <p className="mt-1 text-sm text-red-200/80">
        <Code>{file.path}</Code> could not be read. Ask your AI agent to run <Code>npm run validate-proposals</Code> and
        fix the errors, or run <Code>/propose-playlists</Code> again. You can also replace the file with basic proposals.
      </p>
      <div className="mt-3 space-y-2">
        <BasicProposalsButton replace label="Replace with basic proposals" />
      </div>
      <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto font-mono text-xs text-red-300">
        {file.errors.slice(0, 100).map((e, k) => (
          <li key={k}>{issueLine(e)}</li>
        ))}
        {file.errors.length > 100 && <li>… and {file.errors.length - 100} more</li>}
      </ul>
    </section>
  );
}

export function SummaryCard({ data }: { data: ProposalsResponse }) {
  const { file } = data;
  const basic = file.generator === 'basic';
  const staleSnapshot = data.currentSnapshotAt && file.snapshotGeneratedAt !== data.currentSnapshotAt;
  const notes = [...file.errors, ...file.warnings];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {basic ? 'Basic Proposals' : "Your AI agent's view of your Library"}
          {basic && <Badge title="Built by simple rules, not by an AI agent">Basic</Badge>}
        </span>
      }
      actions={<BasicProposalsButton replace />}
    >
      {data.summary && <p className="text-sm leading-relaxed text-zinc-300">{data.summary}</p>}
      <p className="mt-3 text-xs text-zinc-500">
        {basic ? (
          <>
            {plural(data.proposals.length, 'Basic Proposal')} built {ago(file.generatedAt)} by rules (tags, tempo, era,
            energy). Regenerate after a new Sync or Enrich.
          </>
        ) : (
          <>
            {plural(data.proposals.length, 'Proposal')} written {ago(file.generatedAt)}, from the Snapshot of{' '}
            {file.snapshotGeneratedAt?.slice(0, 16).replace('T', ' ')}. Run <Code>/propose-playlists</Code> again for a
            new set.
          </>
        )}{' '}
        Your decisions on the same ids are kept.
      </p>
      {staleSnapshot && (
        <p className="mt-2 rounded bg-amber-950/60 px-2 py-1 text-xs text-amber-300">
          You built a newer Snapshot ({ago(data.currentSnapshotAt)}).{' '}
          {basic ? 'Regenerate basic proposals' : <>Run <Code>/propose-playlists</Code></>} to use it.
        </p>
      )}
      {notes.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-zinc-400">
            File check: {plural(file.errors.length, 'error')}, {plural(file.warnings.length, 'warning')}
          </summary>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
            {notes.map((i, k) => (
              <li key={k} className={i.level === 'error' ? 'text-red-300' : 'text-amber-300'}>
                {issueLine(i)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
