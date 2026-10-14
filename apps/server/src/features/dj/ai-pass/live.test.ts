import { describe, expect, it } from 'vitest';
import { detectAgents, runAgentCli } from './agents.ts';
import { sampleSet } from './fixtures.ts';
import { runAiPass } from './run.ts';

// Opt-in: runs the real agent CLI on a tiny set of public songs.
//   AI_PASS_LIVE=1 npx vitest run apps/server/src/features/dj/ai-pass/live.test.ts
describe.skipIf(process.env.AI_PASS_LIVE !== '1')('AI pass with the real agent CLI', () => {
  it('answers with valid suggestions for every pair', { timeout: 300_000 }, async () => {
    const cli = detectAgents().selected;
    expect(cli, 'no agent CLI on PATH').not.toBeNull();
    const set = sampleSet();
    const r = await runAiPass(set, cli!, (c, prompt) => runAgentCli(c, prompt));
    expect(r.summary.length).toBeGreaterThan(0);
    expect(r.transitions.length + r.rejected.length).toBeGreaterThanOrEqual(set.transitions.length);
    expect(r.transitions.length).toBeGreaterThan(0);
  });
});
