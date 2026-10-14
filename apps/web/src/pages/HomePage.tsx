import { useState } from 'react';
import { useAuthStatus } from '../api.ts';
import { Button, Empty, ErrorNote } from '../components/ui.tsx';
import { FullBackupCard } from './home/FullBackupCard.tsx';
import { ConnectStep, CreateAppStep, NextSteps, SyncStep, useSyncSummary } from './home/steps.tsx';

const AUTH_ERRORS: Record<string, string> = {
  access_denied: 'You cancelled the Spotify login. Click "Connect Spotify" to try again.',
  invalid_state: 'The login link expired or was opened twice. Click "Connect Spotify" to try again.',
};

// The auth callback redirects to /?authError=… (before the hash).
function readAuthError(): string | null {
  return new URLSearchParams(window.location.search).get('authError');
}

// Owned by the sync feature.
export function HomePage() {
  const auth = useAuthStatus();
  const summary = useSyncSummary(Boolean(auth.data?.connected));
  const [authError, setAuthError] = useState(readAuthError);

  const dismissAuthError = () => {
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    setAuthError(null);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Setup & Sync</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Follow these steps once. Afterwards, come back here to sync your Library before you use the other pages.
        </p>
      </div>

      {authError && (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-red-950/60 p-3 text-sm text-red-300">
          <p>
            {AUTH_ERRORS[authError] ??
              `Spotify login failed (${authError}). Check that the redirect URI in your Spotify app matches step 1 exactly, then try again.`}
          </p>
          <Button variant="ghost" onClick={dismissAuthError}>
            Dismiss
          </Button>
        </div>
      )}

      <ErrorNote error={auth.error} />
      {auth.isPending && <Empty>Loading…</Empty>}
      {auth.data && (
        <>
          <CreateAppStep auth={auth.data} />
          <ConnectStep auth={auth.data} />
          <SyncStep auth={auth.data} summary={auth.data.connected ? summary.data : undefined} />
          <NextSteps synced={Boolean(auth.data.connected && summary.data?.lastSuccessAt)} />
        </>
      )}
      <FullBackupCard />
    </div>
  );
}
