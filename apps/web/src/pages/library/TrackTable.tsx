import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { LibraryMissing, LibrarySort, LibraryTrackRow, LibraryTracksPage } from '@curator/shared';
import { api } from '../../api.ts';
import { Badge, Button, Card, Empty, ErrorNote, cx } from '../../components/ui.tsx';

const PAGE = 100;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function TrackTable() {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 250);
  const [missing, setMissing] = useState<LibraryMissing | ''>('');
  const [sort, setSort] = useState<LibrarySort>('artist');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [offset, setOffset] = useState(0);

  useEffect(() => setOffset(0), [q, missing, sort, dir]);

  const params = new URLSearchParams({ q, sort, dir, offset: String(offset), limit: String(PAGE), missing });
  const page = useQuery({
    queryKey: ['library', 'tracks', params.toString()],
    queryFn: () => api<LibraryTracksPage>(`/api/enrich/tracks?${params}`),
    placeholderData: keepPreviousData,
  });

  const sortBy = (key: LibrarySort) => {
    if (key === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      // Numbers and dates read best biggest/newest first.
      setDir(key === 'name' || key === 'artist' || key === 'key' ? 'asc' : 'desc');
    }
  };
  const header = (key: LibrarySort, label: string, className?: string) => (
    <th className={cx('px-2 py-2 font-medium', className)}>
      <button className="hover:text-zinc-100" onClick={() => sortBy(key)}>
        {label}
        {sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );

  const data = page.data;
  return (
    <Card
      title="Tracks"
      actions={
        <>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search title, artist, album, tag"
            className="w-56 rounded-full bg-zinc-800 px-3 py-1.5 text-sm outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-brand"
          />
          <select
            value={missing}
            onChange={(e) => setMissing(e.target.value as LibraryMissing | '')}
            className="rounded-full bg-zinc-800 px-3 py-1.5 text-sm outline-none"
          >
            <option value="">All tracks</option>
            <option value="features">Missing features</option>
            <option value="bpm">Missing BPM</option>
            <option value="tags">Missing tags</option>
          </select>
        </>
      }
    >
      <p className="mb-3 text-sm text-zinc-400">
        Every track the tool knows about. Click a column to sort. Use "Missing features" to see what Enrich could not find.
      </p>
      <ErrorNote error={page.error} />
      {data && data.total === 0 && (
        <Empty>{q || missing ? 'No tracks match this filter.' : 'No tracks yet. Run Sync on the Setup page first.'}</Empty>
      )}
      {data && data.total > 0 && (
        <>
          <div className={cx('overflow-x-auto', page.isPlaceholderData && 'opacity-60')}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  {header('name', 'Title')}
                  {header('artist', 'Artists')}
                  {header('bpm', 'BPM', 'text-right')}
                  {header('key', 'Key')}
                  {header('energy', 'Energy')}
                  <th className="px-2 py-2 font-medium">Tags</th>
                  {header('liked', 'Liked')}
                  {header('plays', 'Plays', 'text-right')}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Row key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-zinc-400">
            <span className="tabular-nums">
              {data.offset + 1}–{data.offset + data.rows.length} of {data.total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Previous
              </Button>
              <Button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function Row({ r }: { r: LibraryTrackRow }) {
  return (
    <tr className="border-b border-zinc-900 align-top hover:bg-zinc-900/60">
      <td className="max-w-64 px-2 py-1.5">
        <div className="truncate" title={r.album ? `${r.name} · ${r.album}${r.year ? ` (${r.year})` : ''}` : r.name}>
          {r.name}
        </div>
      </td>
      <td className="max-w-48 truncate px-2 py-1.5 text-zinc-400" title={r.artists.join(', ')}>
        {r.artists.join(', ')}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums" title={r.featuresSource ? `Source: ${r.featuresSource}` : undefined}>
        {r.bpm != null ? Math.round(r.bpm) : <Dash />}
      </td>
      <td className="px-2 py-1.5 tabular-nums" title={r.keyName ?? undefined}>
        {r.camelot ?? <Dash />}
      </td>
      <td className="px-2 py-1.5">{r.energy != null ? <EnergyBar value={r.energy} /> : <Dash />}</td>
      <td className="px-2 py-1.5">
        <div className="flex max-w-72 flex-wrap gap-1">
          {r.tags.slice(0, 3).map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
          {r.tags.length > 3 && <span className="text-xs text-zinc-500" title={r.tags.join(', ')}>+{r.tags.length - 3}</span>}
        </div>
      </td>
      <td className="whitespace-nowrap px-2 py-1.5">
        <Indicators r={r} />
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{r.plays12m || ''}</td>
    </tr>
  );
}

const Dash = () => <span className="text-zinc-600">—</span>;

function EnergyBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5" title={`Energy ${value.toFixed(2)}`}>
      <div className="h-1.5 w-14 overflow-hidden rounded bg-zinc-800">
        <div className="h-full bg-brand" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
      </div>
    </div>
  );
}

function Indicators({ r }: { r: LibraryTrackRow }) {
  const items: ReactNode[] = [];
  if (r.likedAt) items.push(<Badge key="liked" tone="good" title={`Liked ${r.likedAt.slice(0, 10)}`}>♥</Badge>);
  if (r.topRank != null) items.push(<Badge key="top" tone="info" title="Best rank in your top tracks">#{r.topRank}</Badge>);
  if (r.playlists > 0)
    items.push(
      <Badge key="pl" title={`In ${r.playlists} Owned Playlist${r.playlists === 1 ? '' : 's'}`}>
        {r.playlists} pl
      </Badge>,
    );
  return <div className="flex gap-1">{items}</div>;
}
