import { CoveragePanel } from './library/CoveragePanel.tsx';
import { TrackTable } from './library/TrackTable.tsx';

// Owned by the enrich feature.
export function LibraryPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Library</h1>
        <p className="mt-1 text-sm text-zinc-400">
          See how much the tool knows about your tracks, fill the gaps with Enrich, and build the Snapshot for your AI agent.
          Order: Sync → Enrich → Build snapshot → ask your AI agent to propose playlists.
        </p>
      </div>
      <CoveragePanel />
      <TrackTable />
    </div>
  );
}
