import { DEFAULT_DJ_CONFIG, type DjSetConfig } from '@curator/shared';

/** Set-shape presets. They keep the Pool, locks and exclusions the user chose. */
export const DJ_PRESETS: { id: string; label: string; about: string; apply: (c: DjSetConfig) => DjSetConfig }[] = [
  {
    id: 'friday',
    label: 'Friday warm-up',
    about: '90 min of house tempo, warm-up to a peak and back down. Long blends.',
    apply: (c) => ({
      ...c,
      length: { mode: 'minutes', minutes: 90 },
      curve: { preset: 'warmup-peak-cooldown' },
      bpmRange: { min: 112, max: 130 },
      maxBpmStepPct: 6,
      allowHalfDouble: true,
      keyStrictness: 'relaxed',
      artistSpacing: 4,
      transitions: { ...c.transitions, defaultBars: 16, styles: { Fade: true, Rise: true, Blend: true } },
    }),
  },
  {
    id: 'running',
    label: 'Running 170',
    about: '45 min at 160–180 steps per minute (85-BPM tracks count as 170). Steady and high.',
    apply: (c) => ({
      ...c,
      length: { mode: 'minutes', minutes: 45 },
      curve: { preset: 'custom', points: [0.7, 0.8, 0.85, 0.85, 0.8] },
      bpmRange: { min: 160, max: 180 },
      maxBpmStepPct: 4,
      allowHalfDouble: true,
      keyStrictness: 'relaxed',
      artistSpacing: 3,
      transitions: { ...c.transitions, defaultBars: 8 },
    }),
  },
  {
    id: 'dinner',
    label: 'Chill dinner',
    about: '2 hours, low energy, strict keys and slow Fades. No Rise.',
    apply: (c) => ({
      ...c,
      length: { mode: 'minutes', minutes: 120 },
      curve: { preset: 'custom', points: [0.35, 0.45, 0.4, 0.35] },
      bpmRange: { min: 70, max: 115 },
      maxBpmStepPct: 6,
      allowHalfDouble: false,
      keyStrictness: 'strict',
      artistSpacing: 5,
      transitions: { ...c.transitions, defaultBars: 16, styles: { Fade: true, Rise: false, Blend: true } },
    }),
  },
];

const STORAGE_KEY = 'dj-config-v1';

/** Restores the last config. Falls back to defaults when storage is empty or broken. */
export function loadConfig(): DjSetConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<DjSetConfig>;
      return {
        ...structuredClone(DEFAULT_DJ_CONFIG),
        ...saved,
        transitions: { ...DEFAULT_DJ_CONFIG.transitions, ...saved.transitions },
      };
    }
  } catch {
    // ignore: storage may be blocked or hold an old shape
  }
  return structuredClone(DEFAULT_DJ_CONFIG);
}

export function saveConfig(c: DjSetConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}
