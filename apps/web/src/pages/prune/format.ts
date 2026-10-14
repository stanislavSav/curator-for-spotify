export const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '—');

/** "3 days ago", "5 months ago", "2 years ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 45) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30.4);
  if (months < 24) return `${months} months ago`;
  return `${Math.floor(months / 12)} years ago`;
}

export const playlistUrl = (id: string) => `https://open.spotify.com/playlist/${id}`;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
