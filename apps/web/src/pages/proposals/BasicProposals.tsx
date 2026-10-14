import { useState } from 'react';
import { PROPOSALS_FILE_EXISTS } from '@curator/shared';
import { ApiError } from '../../api.ts';
import { Button, ErrorNote } from '../../components/ui.tsx';
import { useGenerateBasic } from './data.ts';

/**
 * "Generate basic proposals" (no file yet) or "Regenerate basic proposals"
 * (replaces the file after a confirm). If a file appears in the meantime, the
 * server answers 409 and we ask before replacing it.
 */
export function BasicProposalsButton({ replace = false, label }: { replace?: boolean; label?: string }) {
  const generate = useGenerateBasic();
  const [confirm, setConfirm] = useState(false);
  const exists = generate.error instanceof ApiError && generate.error.code === PROPOSALS_FILE_EXISTS;

  const start = () => {
    if (replace) setConfirm(true);
    else generate.mutate(false, { onError: (e) => e instanceof ApiError && e.code === PROPOSALS_FILE_EXISTS && setConfirm(true) });
  };

  return (
    <>
      <Button variant={replace ? 'ghost' : 'primary'} disabled={generate.isPending} onClick={start}>
        {generate.isPending ? 'Generating…' : (label ?? (replace ? 'Regenerate basic proposals' : 'Generate basic proposals'))}
      </Button>
      {!exists && <ErrorNote error={generate.error} />}
      {confirm && (
        <ConfirmReplace
          busy={generate.isPending}
          onCancel={() => {
            setConfirm(false);
            generate.reset();
          }}
          onConfirm={() => generate.mutate(true, { onSettled: () => setConfirm(false) })}
        />
      )}
    </>
  );
}

function ConfirmReplace({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="border-b border-zinc-800 p-4">
          <h2 className="text-lg font-semibold">Replace the current Proposals?</h2>
        </header>
        <div className="space-y-2 p-4 text-sm text-zinc-300">
          <p>
            This writes new Basic Proposals to <code className="text-zinc-400">data/proposals.json</code>. The Proposals in
            the file now are replaced, including any that your AI agent wrote.
          </p>
          <p className="text-zinc-400">
            Playlists you already created on Spotify stay on Spotify. Your decisions and edits are kept only for Proposals
            with the same id.
          </p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-zinc-800 p-4">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Generating…' : 'Replace with basic proposals'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
