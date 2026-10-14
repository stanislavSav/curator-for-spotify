import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IMPORT_KINDS,
  IMPORT_KIND_LABELS,
  conflictChoiceKey,
  fullBackupFileName,
  type ConflictChoice,
  type FullBackup,
  type ImportConflict,
  type ImportPreview,
  type ImportResult,
  type LibraryTable,
} from '@curator/shared';
import { api } from '../../api.ts';
import { Button, Card, ErrorNote, cx } from '../../components/ui.tsx';
import { Code, formatDateTime } from './parts.tsx';

// The DJ page keeps its settings under this key (see pages/dj/templates.ts).
const DJ_CONFIG_KEY = 'dj-config-v1';

function readDjConfig(): unknown {
  try {
    const raw = localStorage.getItem(DJ_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDjConfig(config: unknown): boolean {
  try {
    localStorage.setItem(DJ_CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reads a .json or .json.gz file and parses it. */
async function readBackupFile(file: File): Promise<unknown> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzip = head[0] === 0x1f && head[1] === 0x8b;
  const text = gzip ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON. Choose a Full Backup file (.json or .json.gz).');
  }
}

const n = (v: number) => v.toLocaleString();

// Shown on the Setup & Sync page. Owned by the Full Backup feature.
export function FullBackupCard() {
  const [includeLibrary, setIncludeLibrary] = useState(false);
  const [pending, setPending] = useState<{ backup: FullBackup; preview: ImportPreview } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const download = useMutation({
    mutationFn: async () => {
      const backup = await api<FullBackup>(`/api/backup/export?library=${includeLibrary ? 1 : 0}`);
      backup.client = { djConfig: readDjConfig() };
      saveFile(fullBackupFileName(backup.exportedAt), JSON.stringify(backup));
    },
  });

  const open = useMutation({
    mutationFn: async (file: File) => {
      const backup = (await readBackupFile(file)) as FullBackup;
      const preview = await api<ImportPreview>('/api/backup/import/preview', { method: 'POST', json: backup });
      return { backup, preview };
    },
    onSuccess: setPending,
  });

  return (
    <Card title="Full Backup">
      <div className="space-y-3 text-sm text-zinc-300">
        <p>
          Save all your work in one file, then import it on another device or after a reinstall. The file holds your Set
          Templates, DJ Sets and Drafts, Proposal decisions and the Proposals file, Backups of pruned playlists, the prune
          log, and your DJ settings.
        </p>
        <p className="text-zinc-400">
          Not in the file: your Spotify login (connect again on the new device) and your Client ID (<Code>.env</Code>{' '}
          stays on each device).
        </p>
        <p className="rounded bg-amber-950/50 p-2 text-amber-300">
          The file holds personal data: your tracks, playlists and listening history. Do not share it and do not commit it
          to git.
        </p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={includeLibrary}
            onChange={(e) => setIncludeLibrary(e.target.checked)}
          />
          <span>
            Include library and enrichment cache
            <span className="block text-zinc-500">Skips a long Sync and Enrich on the new device. The file is bigger.</span>
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => download.mutate()} disabled={download.isPending}>
            {download.isPending ? 'Preparing…' : 'Download Full Backup'}
          </Button>
          <Button onClick={() => input.current?.click()} disabled={open.isPending}>
            {open.isPending ? 'Reading file…' : 'Import…'}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".json,.gz,application/json,application/gzip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) open.mutate(file);
            }}
          />
        </div>
        <ErrorNote error={download.error ?? open.error} />
      </div>
      {pending && <ImportDialog {...pending} onClose={() => setPending(null)} />}
    </Card>
  );
}

const CHOICE_LABELS: Record<ConflictChoice, string> = { mine: 'Keep mine', theirs: 'Use backup', both: 'Keep both' };

function ChoiceButtons({
  value,
  canKeepBoth,
  onChange,
}: {
  value: ConflictChoice;
  canKeepBoth: boolean;
  onChange: (c: ConflictChoice) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-zinc-700">
      {(Object.keys(CHOICE_LABELS) as ConflictChoice[]).map((c) => (
        <button
          key={c}
          type="button"
          disabled={c === 'both' && !canKeepBoth}
          title={c === 'both' && !canKeepBoth ? 'A copy is not possible here.' : undefined}
          onClick={() => onChange(c)}
          className={cx(
            'px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-30',
            value === c ? 'bg-brand text-black' : 'text-zinc-300 hover:bg-zinc-800',
          )}
        >
          {CHOICE_LABELS[c]}
        </button>
      ))}
    </div>
  );
}

const LIBRARY_LABELS: Partial<Record<LibraryTable, string>> = {
  tracks: 'Tracks',
  playlists: 'Playlists',
  liked_tracks: 'Liked Songs',
  audio_features: 'Tracks with BPM and key',
  tags: 'Tags',
  stream_history: 'Streaming History plays',
};

function ImportDialog({ backup, preview, onClose }: { backup: FullBackup; preview: ImportPreview; onClose: () => void }) {
  const qc = useQueryClient();
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>(() =>
    Object.fromEntries(preview.conflicts.map((c) => [conflictChoiceKey(c), 'mine'])),
  );
  const libraryEmpty = preview.library ? Object.values(preview.library.current).every((v) => v === 0) : false;
  const [importLibrary, setImportLibrary] = useState(libraryEmpty);
  const [restoreDj, setRestoreDj] = useState(preview.hasDjConfig);
  const [djRestored, setDjRestored] = useState<boolean | null>(null);

  const run = useMutation({
    mutationFn: () =>
      api<ImportResult>('/api/backup/import', {
        method: 'POST',
        json: { backup, choices, defaultChoice: 'mine', importLibrary: Boolean(preview.library && importLibrary) },
      }),
    onSuccess: () => {
      if (restoreDj && preview.hasDjConfig) setDjRestored(writeDjConfig(backup.client.djConfig));
      void qc.invalidateQueries();
    },
  });

  const setAll = (c: ConflictChoice) =>
    setChoices(Object.fromEntries(preview.conflicts.map((x) => [conflictChoiceKey(x), c === 'both' && !x.canKeepBoth ? 'mine' : c])));
  const kinds = IMPORT_KINDS.filter((k) => {
    const s = preview.summary[k];
    return s.new + s.conflicts + s.unchanged > 0;
  });
  const result = run.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="border-b border-zinc-800 p-4">
          <h2 className="text-lg font-semibold">{result ? 'Import finished' : 'Import Full Backup'}</h2>
          <p className="mt-1 text-sm text-zinc-400">Made on {formatDateTime(preview.exportedAt)}.</p>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {result ? (
            <ImportSummary result={result} djRestored={djRestored} />
          ) : (
            <>
              {preview.warnings.length > 0 && (
                <ul className="list-disc space-y-1 rounded bg-amber-950/40 p-2 pl-6 text-amber-300">
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}

              {kinds.length === 0 ? (
                <p className="text-zinc-400">The file holds no work items.</p>
              ) : (
                <table className="w-full text-left">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="py-1 font-medium">In the file</th>
                      <th className="py-1 text-right font-medium">New</th>
                      <th className="py-1 text-right font-medium">Conflicts</th>
                      <th className="py-1 text-right font-medium">Already here</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {kinds.map((k) => (
                      <tr key={k} className="border-t border-zinc-800">
                        <td className="py-1">{IMPORT_KIND_LABELS[k]}</td>
                        <td className="py-1 text-right">{preview.summary[k].new}</td>
                        <td className={cx('py-1 text-right', preview.summary[k].conflicts > 0 && 'text-amber-300')}>
                          {preview.summary[k].conflicts}
                        </td>
                        <td className="py-1 text-right text-zinc-500">{preview.summary[k].unchanged}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {preview.conflicts.length > 0 && (
                <section className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-zinc-100">Conflicts ({preview.conflicts.length})</h3>
                    <div className="flex items-center gap-1 text-xs text-zinc-400">
                      Apply to all:
                      {(Object.keys(CHOICE_LABELS) as ConflictChoice[]).map((c) => (
                        <Button key={c} variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => setAll(c)}>
                          {CHOICE_LABELS[c]}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <p className="text-zinc-400">These items exist on this device and in the file, with different content.</p>
                  <ul className="space-y-2">
                    {preview.conflicts.map((c) => (
                      <ConflictRow
                        key={conflictChoiceKey(c)}
                        conflict={c}
                        value={choices[conflictChoiceKey(c)] ?? 'mine'}
                        onChange={(v) => setChoices((s) => ({ ...s, [conflictChoiceKey(c)]: v }))}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {preview.library && (
                <section className="space-y-2">
                  <h3 className="font-semibold text-zinc-100">Library cache</h3>
                  <table className="w-full text-left tabular-nums">
                    <thead className="text-xs uppercase tracking-wide text-zinc-500">
                      <tr>
                        <th className="py-1 font-medium" />
                        <th className="py-1 text-right font-medium">In the file</th>
                        <th className="py-1 text-right font-medium">On this device</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(LIBRARY_LABELS) as LibraryTable[]).map((t) => (
                        <tr key={t} className="border-t border-zinc-800">
                          <td className="py-1">{LIBRARY_LABELS[t]}</td>
                          <td className="py-1 text-right">{n(preview.library!.backup[t])}</td>
                          <td className="py-1 text-right text-zinc-500">{n(preview.library!.current[t])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={importLibrary} onChange={() => setImportLibrary(true)} />
                      Replace my library cache with the one in the file
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={!importLibrary} onChange={() => setImportLibrary(false)} />
                      Skip: keep my library cache
                    </label>
                  </div>
                </section>
              )}

              {preview.hasDjConfig && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={restoreDj} onChange={(e) => setRestoreDj(e.target.checked)} />
                  Restore DJ settings (the settings the DJ page opens with)
                </label>
              )}

              <p className="text-zinc-500">
                Before the import, the app saves a Full Backup of this device to <Code>data/full-backups/</Code>.
              </p>
              <ErrorNote error={run.error} />
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-zinc-800 p-4">
          {result ? (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={run.isPending}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => run.mutate()} disabled={run.isPending}>
                {run.isPending ? 'Importing…' : 'Import'}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function ConflictRow({ conflict, value, onChange }: { conflict: ImportConflict; value: ConflictChoice; onChange: (c: ConflictChoice) => void }) {
  return (
    <li className="space-y-1 rounded-lg bg-zinc-950/60 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-zinc-100">
          {conflict.label} <span className="font-normal text-zinc-500">· {IMPORT_KIND_LABELS[conflict.kind]}</span>
        </span>
        <ChoiceButtons value={value} canKeepBoth={conflict.canKeepBoth} onChange={onChange} />
      </div>
      <div className="grid gap-x-4 text-xs text-zinc-400 sm:grid-cols-2">
        <span>
          <b className="text-zinc-300">Mine:</b> {conflict.mine}
        </span>
        <span>
          <b className="text-zinc-300">Backup:</b> {conflict.theirs}
        </span>
      </div>
    </li>
  );
}

function ImportSummary({ result, djRestored }: { result: ImportResult; djRestored: boolean | null }) {
  const rows = IMPORT_KINDS.map((k) => [k, result.counts[k]] as const).filter(
    ([, c]) => c.added + c.replaced + c.keptBoth + c.skipped > 0,
  );
  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map(([k, c]) => (
            <li key={k}>
              <b className="text-zinc-100">{IMPORT_KIND_LABELS[k]}:</b>{' '}
              {[
                c.added && `${c.added} added`,
                c.replaced && `${c.replaced} replaced`,
                c.keptBoth && `${c.keptBoth} kept as a copy`,
                c.skipped && `${c.skipped} kept as they were`,
              ]
                .filter(Boolean)
                .join(', ')}
            </li>
          ))}
        </ul>
      )}
      <p>
        {result.library.replaced
          ? `Library cache replaced (${n(result.library.rows)} rows).`
          : 'Library cache not changed.'}
      </p>
      {djRestored !== null && <p>{djRestored ? 'DJ settings restored.' : 'Could not restore DJ settings: browser storage is blocked.'}</p>}
      <p className="text-zinc-400">
        Your data from before the import is saved in <Code>{result.autoBackup}</Code>.
      </p>
      {!result.library.replaced && <p className="text-zinc-400">Next: if this device has no synced Library yet, run the Sync step above.</p>}
    </div>
  );
}
