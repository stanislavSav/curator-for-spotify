import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A slide-over panel from the right. Esc, the close button or a click on the
 * backdrop closes it; the page behind does not scroll while it is open.
 */
export function Drawer({ open, onClose, title, actions, children }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Kept in a ref so a new onClose on every render does not re-run the effect (and steal focus).
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <div className={open ? 'fixed inset-0 z-40' : 'pointer-events-none fixed inset-0 z-40'} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl outline-none transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="flex items-center gap-2">
            {actions}
            <button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
              ✕
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{open && children}</div>
      </div>
    </div>
  );
}
