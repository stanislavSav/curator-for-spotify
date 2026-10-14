import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthStatus, Job, SyncSummary } from '@curator/shared';
import { api, useJob, useLatestJob } from '../../api.ts';
import { Button, ErrorNote, JobProgress, Stat } from '../../components/ui.tsx';
import { Code, CopyField, formatDate, formatDateTime, LinkButton, Step, type StepState } from './parts.tsx';

const RELOGIN_WARN_DAYS = 14;

export function CreateAppStep({ auth }: { auth: AuthStatus }) {
  const state: StepState = auth.configured ? 'done' : 'todo';
  return (
    <Step n={1} title="Create your Spotify app" state={state}>
      <p>
        The tool talks to Spotify through your own developer app. You need Spotify Premium: Spotify turns off
        Development Mode apps when the owner has no Premium.
      </p>
      <details open={!auth.configured} className="rounded-lg bg-zinc-950/60 p-3">
        <summary className="cursor-pointer text-zinc-100">{auth.configured ? 'Show the steps again' : 'Steps'}</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>
            Open{' '}
            <a className="text-brand underline" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
              developer.spotify.com/dashboard
            </a>{' '}
            and log in with your Spotify account.
          </li>
          <li>
            Click <b>Create app</b>. Use any name and description, for example "Spotify Curator". Leave Website empty.
          </li>
          <li>
            In <b>Redirect URIs</b>, paste this address and click <b>Add</b>. It must match exactly. Use{' '}
            <Code>127.0.0.1</Code>, not <Code>localhost</Code>: Spotify rejects <Code>localhost</Code>.
            <div className="mt-2">
              <CopyField value={auth.redirectUri} />
            </div>
          </li>
          <li>
            Under <b>Which API/SDKs are you planning to use?</b>, tick <b>Web API</b>. Accept the terms and click{' '}
            <b>Save</b>.
          </li>
          <li>
            Open the app's <b>Settings</b> and copy the <b>Client ID</b>. You do not need the client secret.
          </li>
          <li>
            If you will log in with a Spotify account that does not own the app, add that account in{' '}
            <b>Settings › User Management</b>. Otherwise Spotify answers every call with 403.
          </li>
          <li>
            Copy <Code>.env.example</Code> to <Code>.env</Code> in the project folder and set{' '}
            <Code>SPOTIFY_CLIENT_ID=&lt;your Client ID&gt;</Code>. Then stop <Code>npm run dev</Code> (Ctrl+C) and start it
            again.
          </li>
        </ol>
      </details>
      {!auth.configured && (
        <p className="text-amber-300">The server has no SPOTIFY_CLIENT_ID yet. Reload this page after the restart.</p>
      )}
    </Step>
  );
}

export function ConnectStep({ auth }: { auth: AuthStatus }) {
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth'] }),
  });
  const state: StepState = !auth.configured ? 'locked' : auth.connected ? 'done' : 'todo';
  const daysLeft = auth.reloginBy ? Math.floor((Date.parse(auth.reloginBy) - Date.now()) / 86_400_000) : null;

  return (
    <Step n={2} title="Connect your Spotify account" state={state} lockedHint="Finish step 1 first.">
      {auth.connected ? (
        <>
          <p>
            Connected as <b className="text-zinc-100">{auth.user?.displayName ?? 'unknown user'}</b>
            {auth.user && <span className="text-zinc-500"> ({auth.user.id})</span>}.
          </p>
          {auth.reloginBy && (
            <p className={daysLeft !== null && daysLeft < RELOGIN_WARN_DAYS ? 'text-amber-300' : 'text-zinc-400'}>
              Spotify ends this login after 6 months. Log in again by <b>{formatDate(auth.reloginBy)}</b>
              {daysLeft !== null && daysLeft >= 0 && ` (${daysLeft} days left)`}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => logout.mutate()} disabled={logout.isPending}>
              Log out
            </Button>
            <a className="self-center text-sm text-zinc-400 underline hover:text-zinc-200" href="/auth/login">
              Log in again now
            </a>
          </div>
          <ErrorNote error={logout.error} />
        </>
      ) : (
        <>
          <p>Log in with Spotify and allow access. Spotify sends you back here when you are done.</p>
          <LinkButton href="/auth/login">Connect Spotify</LinkButton>
        </>
      )}
    </Step>
  );
}

export function useSyncSummary(enabled: boolean) {
  return useQuery({ queryKey: ['sync', 'summary'], queryFn: () => api<SyncSummary>('/api/sync/summary'), enabled });
}

export function SyncStep({ auth, summary }: { auth: AuthStatus; summary: SyncSummary | undefined }) {
  const qc = useQueryClient();
  const latest = useLatestJob('sync');
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => api<Job>('/api/sync', { method: 'POST' }),
    onSuccess: (job) => setJobId(job.id),
    onError: () => qc.invalidateQueries({ queryKey: ['auth'] }),
  });

  // Follow a sync that is already running (for example after a page reload).
  const activeId = jobId ?? (latest.data?.status === 'running' ? latest.data.id : null);
  const active = useJob(activeId);
  const job = active.data ?? latest.data ?? null;
  const running = job?.status === 'running';

  useEffect(() => {
    if (active.data && active.data.status !== 'running') {
      void qc.invalidateQueries({ queryKey: ['sync', 'summary'] });
      void qc.invalidateQueries({ queryKey: ['latestJob', 'sync'] });
      void qc.invalidateQueries({ queryKey: ['auth'] });
    }
  }, [active.data?.status, active.data, qc]);

  const state: StepState = !auth.connected ? 'locked' : summary?.lastSuccessAt ? 'done' : 'todo';
  const p = summary?.playlists;

  return (
    <Step n={3} title="Sync your Library" state={state} lockedHint="Connect your Spotify account first (step 2).">
      <p>
        Sync copies your playlists, Liked Songs, top tracks and artists, and your last 50 plays into the local database.
        It reads a playlist's tracks again only when the playlist changed. Spotify does not return the tracks of Followed
        Playlists, so they show as names only.
      </p>
      <p className="text-zinc-400">
        Sync again before you prune or make Proposals. Spotify keeps only your last 50 plays, so frequent syncs keep more
        of them.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => start.mutate()} disabled={running || start.isPending}>
          {running ? 'Syncing…' : summary?.lastSuccessAt ? 'Sync again' : 'Sync now'}
        </Button>
        {summary?.lastSuccessAt && (
          <span className="text-zinc-500">Last successful sync: {formatDateTime(summary.lastSuccessAt)}</span>
        )}
      </div>
      <JobProgress job={job} />
      <ErrorNote error={start.error} />
      {summary && p && (summary.lastSuccessAt || p.owned + p.followed + p.generated > 0) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Owned playlists" value={p.owned} hint={`${p.itemsSynced} of ${p.readable} readable playlists have their tracks synced`} />
          <Stat label="Followed playlists" value={p.followed} hint="Names only: Spotify does not return their tracks" />
          <Stat label="Generated playlists" value={p.generated} hint="Made by Spotify. Never pruned." />
          <Stat label="No longer in Library" value={p.removed} hint="Playlists that a sync no longer found" />
          <Stat label="Liked Songs" value={summary.likedTracks} />
          <Stat
            label="Library tracks"
            value={summary.libraryTracks}
            hint="Unique tracks in Liked Songs, readable playlists, top tracks and recent plays"
          />
          <Stat label="Artists" value={summary.artists} />
          <Stat label="Recent plays" value={summary.recentPlays} hint="Collected from every sync" />
        </div>
      )}
    </Step>
  );
}

const NEXT_STEPS: { href: string; title: string; text: string }[] = [
  {
    href: '#/library',
    title: 'Library',
    text: 'Enrich your tracks with BPM, key, energy and tags. Then write the Snapshot that your AI agent reads.',
  },
  {
    href: '#/proposals',
    title: 'Proposals',
    text: 'Ask your AI agent to propose playlists, or generate basic proposals without one. Then review, edit and create the new playlists here.',
  },
  {
    href: '#/prune',
    title: 'Prune',
    text: 'When your Spotify data export arrives, import the Streaming History. Then review the Prune Candidates.',
  },
  {
    href: '#/dj',
    title: 'DJ Set',
    text: 'Pick a Pool and an Energy Curve. The app orders the tracks and gives you a Transition Sheet.',
  },
];

export function NextSteps({ synced }: { synced: boolean }) {
  return (
    <Step n={4} title="Next steps" state={synced ? 'todo' : 'locked'} lockedHint="Sync your Library first (step 3).">
      <ul className="grid gap-2 sm:grid-cols-2">
        {NEXT_STEPS.map((s) => (
          <li key={s.href}>
            <a href={s.href} className="block rounded-lg border border-zinc-800 p-3 hover:border-zinc-600 hover:bg-zinc-800/40">
              <div className="font-medium text-zinc-100">{s.title} →</div>
              <div className="mt-1 text-zinc-400">{s.text}</div>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-zinc-400">
        No data export yet? Request it now at{' '}
        <a className="text-brand underline" href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">
          spotify.com/account/privacy
        </a>
        : tick <b>Extended streaming history</b>. It can take up to 30 days. Everything else works without it.
      </p>
    </Step>
  );
}
