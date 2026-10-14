import { useQuery } from '@tanstack/react-query';
import type { EnrichCoverage } from '@curator/shared';
import { api } from '../../api.ts';
import { Badge, Button, Card, ErrorNote, JobProgress, Stat } from '../../components/ui.tsx';
import { EnrichPanel } from './EnrichPanel.tsx';
import { useJobRunner } from './useJobRunner.ts';

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—');

export function CoveragePanel() {
  const enrich = useJobRunner('enrich', '/api/enrich');
  const snapshot = useJobRunner('snapshot', '/api/enrich/snapshot');
  const coverage = useQuery({
    queryKey: ['library', 'coverage'],
    queryFn: () => api<EnrichCoverage>('/api/enrich/coverage'),
    // Numbers grow while Enrich runs.
    refetchInterval: enrich.running ? 5000 : false,
  });
  const c = coverage.data;

  return (
    <div className="space-y-4">
      <ErrorNote error={coverage.error} />
      {c && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Tracks" value={c.tracks.toLocaleString()} hint="Liked Songs, Owned Playlists, top tracks and recent plays" />
          <Stat
            label="With BPM"
            value={pct(c.withBpm, c.tracks)}
            hint={`${c.withBpm} tracks · ReccoBeats ${c.featuresBySource.reccobeats}, Deezer ${c.featuresBySource.deezer}`}
          />
          <Stat label="With key" value={pct(c.withKey, c.tracks)} hint={`${c.withKey} tracks (ReccoBeats only)`} />
          <Stat
            label="With tags"
            value={pct(c.withTags, c.tracks)}
            hint={`Artists tagged: MusicBrainz ${c.artistTagsBySource.musicbrainz}, Spotify genres ${c.artistTagsBySource.spotifyGenre} of ${c.artists}`}
          />
          <Stat
            label="History plays (12 m)"
            value={c.history.rows ? c.history.plays12m.toLocaleString() : '—'}
            hint={c.history.rows ? `${c.history.tracksWithPlays} Library tracks were played` : 'No Streaming History imported yet'}
          />
        </div>
      )}

      <EnrichPanel />

      <div>
        <Card
          title="2. Build Snapshot"
          actions={
            <Button variant="primary" onClick={snapshot.start} disabled={snapshot.running || !c?.tracks}>
              {snapshot.running ? 'Building…' : 'Build snapshot'}
            </Button>
          }
        >
          <p className="mb-3 text-sm text-zinc-400">
            Writes <code className="text-zinc-300">data/snapshot.json</code>, the Library copy that your AI agent reads. Build it
            after Enrich (and after a Streaming History import). Then ask your AI agent to propose playlists.
          </p>
          {c?.snapshot ? (
            <p className="mb-3 text-sm text-zinc-400">
              Last built {new Date(c.snapshot.generatedAt).toLocaleString()} · {c.snapshot.tracks.toLocaleString()} tracks ·{' '}
              {Math.round(c.snapshot.bytes / 1024).toLocaleString()} KB
              {c.snapshot.tracks !== c.tracks && (
                <>
                  {' '}
                  <Badge tone="warn">out of date</Badge>
                </>
              )}
            </p>
          ) : (
            <p className="mb-3 text-sm text-zinc-500">No Snapshot yet.</p>
          )}
          <ErrorNote error={snapshot.error} />
          <JobProgress job={snapshot.job} />
        </Card>
      </div>
    </div>
  );
}
