import { z } from 'zod';
import {
  EFFECTS_OPTIONS,
  EQ_OPTIONS,
  FILTER_OPTIONS,
  LOOPING_OPTIONS,
  MIX_PRESETS,
  VOLUME_OPTIONS,
  toBars,
  type AiPassResult,
  type TransitionSettings,
} from '@curator/shared';
import { MAX_REASON } from './prompt.ts';

export type ParsedAnswer = Pick<AiPassResult, 'summary' | 'transitions' | 'rejected'>;

/** Thrown when the answer holds no usable JSON at all. */
export class AiAnswerError extends Error {}

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Finds the answer object in the CLI output: plain JSON, JSON inside ```json
 * fences or prose, or a CLI envelope (claude's `result`, gemini's `response`).
 */
export function extractAnswer(output: string, depth = 0): Record<string, unknown> {
  const text = output.trim();
  const candidates = [
    text,
    ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!.trim()),
    text.includes('{') ? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) : '',
  ];
  for (const c of candidates) {
    const v = c ? tryJson(c) : undefined;
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.transitions)) return o;
    if (depth < 2) {
      if (o.is_error === true) throw new AiAnswerError(`The agent reported an error: ${String(o.result ?? 'unknown').slice(0, 300)}`);
      const inner = typeof o.result === 'string' ? o.result : typeof o.response === 'string' ? o.response : null;
      if (inner != null) return extractAnswer(inner, depth + 1);
    }
  }
  throw new AiAnswerError('The agent did not answer with the JSON the AI pass needs. Try again.');
}

const option = <T extends readonly [string, ...string[]]>(values: T, name: string) =>
  z.enum(values, { error: (iss) => `${name} "${String(iss.input)}" is not a Spotify option` }).nullable();

const entrySchema = z.object({
  index: z.number().int(),
  preset: z.enum(MIX_PRESETS, { error: (iss) => `preset "${String(iss.input)}" is not a Spotify preset` }),
  bars: z.number().positive().nullable().optional(),
  volume: option(VOLUME_OPTIONS, 'volume').optional(),
  eq: option(EQ_OPTIONS, 'eq').optional(),
  filter: option(FILTER_OPTIONS, 'filter').optional(),
  effects: option(EFFECTS_OPTIONS, 'effects').optional(),
  looping: option(LOOPING_OPTIONS, 'looping').optional(),
  reason: z.string().optional(),
});

const MAX_SUMMARY = 400;
const shorten = (s: string, max = MAX_REASON) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * Validates the agent's answer pair by pair against Spotify's option lists.
 * Invalid pairs go to `rejected` with the problem; the rule version stays.
 */
export function parseAiAnswer(output: string, pairs: number): ParsedAnswer {
  const answer = extractAnswer(output);
  const summary = typeof answer.summary === 'string' ? shorten(answer.summary.trim(), MAX_SUMMARY) : '';
  const transitions: ParsedAnswer['transitions'] = [];
  const rejected: ParsedAnswer['rejected'] = [];
  const seen = new Set<number>();

  (answer.transitions as unknown[]).forEach((raw, n) => {
    const rawIndex = raw && typeof raw === 'object' ? (raw as { index?: unknown }).index : undefined;
    const index = typeof rawIndex === 'number' && Number.isInteger(rawIndex) ? rawIndex : -1;
    const reject = (problem: string) => rejected.push({ index, problem });
    if (index < 0 || index >= pairs) return reject(`Entry ${n + 1}: index ${String(rawIndex)} is not a pair of this set.`);
    if (seen.has(index)) return reject('This pair came twice; the first answer counts.');
    seen.add(index);

    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) return reject(parsed.error.issues.map((i) => i.message).join('; '));
    const e = parsed.data;
    let settings: TransitionSettings;
    if (e.preset === 'Custom') {
      const { volume, eq, filter, effects, looping } = e;
      const missing = Object.entries({ bars: e.bars, volume, eq, filter, effects, looping })
        .filter(([, v]) => v == null)
        .map(([k]) => k);
      if (missing.length || !volume || !eq || !filter || !effects || !looping) {
        return reject(`Custom needs all values; missing ${missing.join(', ')}.`);
      }
      settings = { preset: 'Custom', bars: toBars(e.bars), volume, eq, filter, effects, looping };
    } else {
      // A named preset decides its own values.
      settings = { preset: e.preset, bars: null, volume: null, eq: null, filter: null, effects: null, looping: null };
    }
    transitions.push({ index, settings, reason: shorten((e.reason ?? '').trim()) });
  });

  transitions.sort((a, b) => a.index - b.index);
  return { summary, transitions, rejected };
}
