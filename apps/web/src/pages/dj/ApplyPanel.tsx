import { useState } from 'react';
import type { DjSetResult } from '@curator/shared';
import { Button } from '../../components/ui.tsx';
import { APPLY_DONTS, APPLY_STEPS, sheetAsHtml, sheetAsText } from './sheet.ts';

/** "How to apply in Spotify" (ADR 0002): the app sets the order, the user sets the Transitions. */
export function HowToApply({ url }: { url: string | null }) {
  return (
    <div className="rounded-lg border border-brand/40 bg-brand/5 p-4 text-sm">
      <h3 className="font-semibold">How to apply in Spotify</h3>
      <p className="mt-1 text-zinc-400">
        Spotify has no API for Mix, so you apply the Transition Sheet by hand. Keep this page open next to Spotify.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-zinc-200">
        {APPLY_STEPS.map((s, i) => (
          <li key={i}>
            {i === 0 && url ? (
              <>
                <a href={url} target="_blank" rel="noreferrer" className="text-brand underline">
                  Open the playlist
                </a>{' '}
                in the Spotify app (phone or desktop).
              </>
            ) : (
              s
            )}
          </li>
        ))}
      </ol>
      <ul className="mt-3 space-y-1 text-amber-300">
        {APPLY_DONTS.map((s) => (
          <li key={s}>⚠ {s}</li>
        ))}
      </ul>
    </div>
  );
}

/** Copy and Print. `applied` adds the Applied ticks (created sets only). */
export function SheetExportButtons({ result, name, applied = false }: { result: DjSetResult; name?: string | null; applied?: boolean }) {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sheetAsText(result, name, { applied }));
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied(null), 2000);
  };
  const print = () => {
    const html = sheetAsHtml(result, name, { applied }).replace('</body>', '<script>window.onload=()=>window.print()</script></body>');
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <>
      <Button variant="ghost" onClick={copy} title="Copy the Transition Sheet as plain text">
        {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy sheet as text'}
      </Button>
      <Button variant="ghost" onClick={print} title="Open a printer-friendly page">
        Print
      </Button>
    </>
  );
}
