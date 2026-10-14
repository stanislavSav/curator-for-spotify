import { useEffect, useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, useAuthStatus } from './api.ts';
import { cx } from './components/ui.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { LibraryPage } from './pages/LibraryPage.tsx';
import { ProposalsPage } from './pages/ProposalsPage.tsx';
import { PrunePage } from './pages/PrunePage.tsx';
import { DjPage } from './pages/DjPage.tsx';

const PAGES: { id: string; label: string; component: ComponentType }[] = [
  { id: 'home', label: 'Setup & Sync', component: HomePage },
  { id: 'library', label: 'Library', component: LibraryPage },
  { id: 'proposals', label: 'Proposals', component: ProposalsPage },
  { id: 'prune', label: 'Prune', component: PrunePage },
  { id: 'dj', label: 'DJ Set', component: DjPage },
];

const currentHash = () => window.location.hash.replace(/^#\/?/, '') || 'home';

export function App() {
  const [pageId, setPageId] = useState(currentHash);
  const auth = useAuthStatus();
  const demo = useQuery({ queryKey: ['demo'], queryFn: () => api<{ demo: boolean }>('/api/demo'), staleTime: Infinity });

  useEffect(() => {
    const onHash = () => setPageId(currentHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const Page = (PAGES.find((p) => p.id === pageId) ?? PAGES[0]!).component;

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 sm:px-6">
      {demo.data?.demo && (
        <div className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-1.5 text-center text-sm text-amber-200">
          Demo mode — fake library, nothing is sent to Spotify. Run <code className="text-amber-100">npm run dev</code> for your own
          library.
        </div>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 py-4">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 rounded-full bg-brand" />
          <span className="font-semibold">Curator for Spotify</span>
        </div>
        <nav className="flex flex-wrap gap-1">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`#/${p.id}`}
              className={cx(
                'rounded-full px-3 py-1 text-sm',
                p.id === pageId ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
              )}
            >
              {p.label}
            </a>
          ))}
        </nav>
        <div className="text-sm text-zinc-400">
          {auth.data?.connected ? `● ${auth.data.user?.displayName ?? 'connected'}` : '○ not connected'}
        </div>
      </header>
      <main className="flex-1 py-6">
        <Page />
      </main>
    </div>
  );
}
