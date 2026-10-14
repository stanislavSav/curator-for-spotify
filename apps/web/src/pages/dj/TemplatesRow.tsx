import { useEffect, useState, type ReactNode } from 'react';
import type { DjSetConfig, DjTemplate } from '@curator/shared';
import { ApiError } from '../../api.ts';
import { Button, cx, ErrorNote } from '../../components/ui.tsx';
import { useDjTemplates } from './hooks.ts';
import { applyUserTemplate, suggestTemplateName, TEMPLATES_SHOWN, templateNamed } from './saved.ts';
import { poolSummary } from './summaries.ts';
import { SET_TEMPLATES } from './templates.ts';

type Props = {
  config: DjSetConfig;
  /** Usable tracks in the last preview, for the Pool summary. */
  usable: number | null;
  /** A Set Template is an explicit choice: apply it and rebuild at once. */
  onApply: (c: DjSetConfig) => void;
};

type Panel =
  | { kind: 'save' }
  | { kind: 'menu'; id: string }
  | { kind: 'rename'; id: string }
  | { kind: 'delete'; id: string };

const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;

/** Built-in and user Set Templates, with Save and a small manage menu. */
export function TemplatesRow({ config, usable, onApply }: Props) {
  const templates = useDjTemplates();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel]);

  const open = (p: Panel | null) => {
    setPanel(p);
    setError(null);
    setNotice(null);
  };
  const done = (text: string) => {
    setPanel(null);
    setError(null);
    setNotice(text);
  };

  const list = templates.list;
  const shown = showAll ? list : list.slice(0, TEMPLATES_SHOWN);
  const hidden = list.length - shown.length;
  const selected = panel && panel.kind !== 'save' ? list.find((t) => t.id === panel.id) : undefined;

  return (
    <div className="border-b border-zinc-800 px-4 py-3">
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Set Templates</div>
      <div className="flex flex-wrap gap-1.5">
        {SET_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setNotice(null);
              onApply(t.apply(config));
            }}
            title={`${t.about} Your Pool stays.`}
            className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            {t.label}
          </button>
        ))}
        {shown.map((t) => (
          <UserChip
            key={t.id}
            template={t}
            active={panel != null && panel.kind !== 'save' && panel.id === t.id}
            onApply={() => {
              setNotice(null);
              onApply(applyUserTemplate(config, t));
            }}
            onMenu={() => open(panel?.kind === 'menu' && panel.id === t.id ? null : { kind: 'menu', id: t.id })}
          />
        ))}
        {list.length > TEMPLATES_SHOWN && (
          <button onClick={() => setShowAll(!showAll)} className="rounded-full px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100">
            {showAll ? 'Fewer' : `More… (${hidden})`}
          </button>
        )}
        <button
          onClick={() => open(panel?.kind === 'save' ? null : { kind: 'save' })}
          aria-expanded={panel?.kind === 'save'}
          title="Save the current settings as a Set Template"
          className="rounded-full border border-dashed border-zinc-600 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-400 hover:text-zinc-100"
        >
          + Save
        </button>
      </div>

      {panel?.kind === 'save' && (
        <SaveForm
          suggested={suggestTemplateName(list.map((t) => t.name), new Date())}
          poolText={poolSummary(config.pool, usable)}
          onCancel={() => open(null)}
          onSave={async (name, includePool) => {
            try {
              await templates.create({ name, includePool, config });
              done(`Saved “${name}”.`);
              return 'ok';
            } catch (e) {
              if (isConflict(e)) return 'exists';
              setError(e);
              return 'error';
            }
          }}
          onReplace={async (name, includePool) => {
            const existing = templateNamed(list, name);
            if (!existing) return setError('That template is gone. Save again.');
            try {
              await templates.update({ id: existing.id, patch: { includePool, config } });
              done(`Replaced “${existing.name}”.`);
            } catch (e) {
              setError(e);
            }
          }}
        />
      )}

      {panel?.kind === 'menu' && selected && (
        <Popover>
          <div className="mb-2 truncate text-xs text-zinc-400">
            “{selected.name}” · {selected.includePool ? 'with its own Pool' : 'keeps your Pool'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="ghost" className="px-3 py-1 text-xs" onClick={() => open({ kind: 'rename', id: selected.id })}>
              Rename
            </Button>
            <Button
              variant="ghost"
              className="px-3 py-1 text-xs"
              title={selected.includePool ? 'Save the current settings and Pool into it' : 'Save the current settings into it'}
              onClick={async () => {
                try {
                  await templates.update({ id: selected.id, patch: { config } });
                  done(`Updated “${selected.name}” with the current settings.`);
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Update with current settings
            </Button>
            <Button variant="ghost" className="px-3 py-1 text-xs text-red-300!" onClick={() => open({ kind: 'delete', id: selected.id })}>
              Delete
            </Button>
          </div>
        </Popover>
      )}

      {panel?.kind === 'rename' && selected && (
        <RenameForm
          initial={selected.name}
          onCancel={() => open(null)}
          onSave={async (name) => {
            try {
              await templates.update({ id: selected.id, patch: { name } });
              done(`Renamed to “${name}”.`);
            } catch (e) {
              setError(isConflict(e) ? 'A template with this name exists. Pick another name.' : e);
            }
          }}
        />
      )}

      {panel?.kind === 'delete' && selected && (
        <Popover>
          <p className="mb-2 text-xs text-zinc-300">Delete the template “{selected.name}”? Your sets are not changed.</p>
          <div className="flex gap-1.5">
            <Button
              variant="danger"
              className="px-3 py-1 text-xs"
              onClick={async () => {
                try {
                  await templates.remove(selected.id);
                  done(`Deleted “${selected.name}”.`);
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" className="px-3 py-1 text-xs" onClick={() => open(null)}>
              Cancel
            </Button>
          </div>
        </Popover>
      )}

      {(error != null || templates.error != null) && (
        <div className="mt-2">
          <ErrorNote error={error ?? templates.error} />
        </div>
      )}
      {notice && (
        <p className="mt-1.5 text-xs text-zinc-500" aria-live="polite">
          {notice}
        </p>
      )}
    </div>
  );
}

function UserChip({ template: t, active, onApply, onMenu }: { template: DjTemplate; active: boolean; onApply: () => void; onMenu: () => void }) {
  const about = t.includePool ? 'Uses its own Pool.' : 'Your Pool stays.';
  return (
    <span
      className={cx(
        'inline-flex items-stretch overflow-hidden rounded-full border text-xs',
        active ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500',
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu();
      }}
    >
      <button onClick={onApply} title={`Your template. ${about} Right-click or ⋯ to manage.`} className="flex items-center gap-1 py-1 pl-2.5 pr-1 text-zinc-200">
        {t.includePool && <span aria-label="includes a Pool" className="size-1.5 rounded-full bg-brand" />}
        <span className="max-w-36 truncate">{t.name}</span>
      </button>
      <button onClick={onMenu} aria-label={`Manage “${t.name}”`} aria-expanded={active} className="px-1.5 text-zinc-500 hover:text-zinc-100">
        ⋯
      </button>
    </span>
  );
}

function Popover({ children }: { children: ReactNode }) {
  return <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 shadow-lg">{children}</div>;
}

function SaveForm({
  suggested,
  poolText,
  onSave,
  onReplace,
  onCancel,
}: {
  suggested: string;
  poolText: string;
  onSave: (name: string, includePool: boolean) => Promise<'ok' | 'exists' | 'error'>;
  onReplace: (name: string, includePool: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(suggested);
  const [includePool, setIncludePool] = useState(false);
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const trimmed = name.trim();

  return (
    <Popover>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) void run(async () => setExists((await onSave(trimmed, includePool)) === 'exists'));
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setExists(false);
          }}
          maxLength={60}
          aria-label="Template name"
          className="w-full rounded bg-zinc-800 px-2.5 py-1.5 text-sm"
        />
        <label className="flex cursor-pointer items-start gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={includePool} onChange={(e) => setIncludePool(e.target.checked)} className="mt-0.5 accent-brand" />
          <span>
            Include Pool
            <span className="block text-zinc-500">{poolText}</span>
            {!includePool && <span className="block text-zinc-500">Without it, the template keeps the Pool you have when you apply it.</span>}
          </span>
        </label>
        {exists ? (
          <div className="rounded bg-amber-950/40 p-2 text-xs text-amber-200">
            A template with this name exists — Replace it?
            <div className="mt-1.5 flex gap-1.5">
              <Button type="button" variant="primary" className="px-3 py-1 text-xs" disabled={busy} onClick={() => void run(() => onReplace(trimmed, includePool))}>
                Replace
              </Button>
              <Button type="button" variant="ghost" className="px-3 py-1 text-xs" onClick={() => setExists(false)}>
                Pick another name
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <Button type="submit" variant="primary" className="px-3 py-1 text-xs" disabled={busy || !trimmed}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="ghost" className="px-3 py-1 text-xs" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </form>
    </Popover>
  );
}

function RenameForm({ initial, onSave, onCancel }: { initial: string; onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  return (
    <Popover>
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!trimmed || trimmed === initial) return onCancel();
          setBusy(true);
          await onSave(trimmed);
          setBusy(false);
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          aria-label="New template name"
          className="min-w-0 flex-1 rounded bg-zinc-800 px-2.5 py-1.5 text-sm"
        />
        <Button type="submit" variant="primary" className="px-3 py-1 text-xs" disabled={busy || !trimmed}>
          Rename
        </Button>
        <Button type="button" variant="ghost" className="px-3 py-1 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </form>
    </Popover>
  );
}
