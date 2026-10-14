import type { AgentCli, DjSetRecord, TransitionSettings } from '@curator/shared';
import type { DB } from '../../../db/db.ts';
import { getDjSet, saveDjSetResult } from '../sets.ts';
import { AGENT_LABEL } from './agents.ts';
import { parseAiAnswer, type ParsedAnswer } from './parse.ts';
import { buildAiPassPrompt, type AiPassInput } from './prompt.ts';

export type RunAgent = (cli: AgentCli, prompt: string, signal?: AbortSignal) => Promise<string>;

/** Asks the agent about every pair and validates its answer. */
export async function runAiPass(
  input: AiPassInput,
  cli: AgentCli,
  run: RunAgent,
  progress: (done: number, total: number, message?: string) => void = () => {},
  signal?: AbortSignal,
): Promise<ParsedAnswer> {
  progress(0, 2, `Asking ${AGENT_LABEL[cli]}…`);
  const output = await run(cli, buildAiPassPrompt(input), signal);
  progress(1, 2, `Checking ${input.transitions.length} suggestions…`);
  const parsed = parseAiAnswer(output, input.transitions.length);
  progress(2, 2, 'Done.');
  return parsed;
}

const same = (a: TransitionSettings, b: TransitionSettings) =>
  a.preset === b.preset && a.bars === b.bars && a.volume === b.volume && a.eq === b.eq && a.filter === b.filter && a.effects === b.effects && a.looping === b.looping;

/**
 * Stores the AI version on each accepted pair of a saved set. Pairs the user
 * has not edited (settings = rule suggestion or the previous AI version) take
 * the AI settings; edited pairs keep the user's settings.
 */
export function applyAiToSet(db: DB, setId: string, parsed: ParsedAnswer, agent: AgentCli): DjSetRecord | null {
  const set = getDjSet(db, setId);
  if (!set) return null;
  for (const { index, settings, reason } of parsed.transitions) {
    const t = set.result.transitions[index];
    if (!t) continue;
    const untouched = same(t.settings, t.suggested) || (t.ai != null && same(t.settings, t.ai.settings));
    set.result.transitions[index] = { ...t, ai: { settings, reason, agent }, settings: untouched ? { ...settings } : t.settings };
  }
  return saveDjSetResult(db, setId, set.result);
}
