import { describe, expect, it } from 'vitest';
import { AiAnswerError, extractAnswer, parseAiAnswer } from './parse.ts';

const entry = (index: number, over: Record<string, unknown> = {}) => ({
  index,
  preset: 'Custom',
  bars: 8,
  volume: 'Smooth crossfade',
  eq: 'Center bass swap',
  filter: 'High pass filter in',
  effects: 'Reverb out end',
  looping: 'None',
  reason: 'Neighbour keys and a gentle lift.',
  ...over,
});
const answer = (transitions: unknown[], summary = 'A smooth warm-up.') => JSON.stringify({ summary, transitions });

describe('extractAnswer', () => {
  const body = answer([entry(0)]);

  it('reads plain JSON, fenced JSON and JSON in prose', () => {
    expect(extractAnswer(body).summary).toBe('A smooth warm-up.');
    expect(extractAnswer('```json\n' + body + '\n```').summary).toBe('A smooth warm-up.');
    expect(extractAnswer('Here you go:\n' + body + '\nEnjoy!').summary).toBe('A smooth warm-up.');
  });

  it('unwraps the claude (`result`) and gemini (`response`) envelopes', () => {
    const claude = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '```json\n' + body + '\n```', session_id: 'x' });
    expect(extractAnswer(claude).transitions).toHaveLength(1);
    const gemini = JSON.stringify({ response: body, stats: {} });
    expect(extractAnswer(gemini).transitions).toHaveLength(1);
  });

  it('fails clearly without JSON or on an agent error', () => {
    expect(() => extractAnswer('I cannot help with that.')).toThrow(AiAnswerError);
    expect(() => extractAnswer(JSON.stringify({ is_error: true, result: 'Credit balance is too low' }))).toThrow(/Credit balance is too low/);
  });
});

describe('parseAiAnswer', () => {
  it('accepts valid pairs and clamps bars to 2/4/8', () => {
    const r = parseAiAnswer(answer([entry(1), entry(0, { bars: 16 }), entry(2, { bars: 3 })]), 3);
    expect(r.rejected).toEqual([]);
    expect(r.transitions.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(r.transitions[0]!.settings).toEqual({
      preset: 'Custom',
      bars: 8,
      volume: 'Smooth crossfade',
      eq: 'Center bass swap',
      filter: 'High pass filter in',
      effects: 'Reverb out end',
      looping: 'None',
    });
    expect(r.transitions[2]!.settings.bars).toBe(4);
    expect(r.summary).toBe('A smooth warm-up.');
  });

  it('Auto, No transition and named presets carry no values', () => {
    const r = parseAiAnswer(answer([entry(0, { preset: 'Auto', bars: null, volume: null }), entry(1, { preset: 'No transition' }), entry(2, { preset: 'Rise' })]), 3);
    expect(r.rejected).toEqual([]);
    expect(r.transitions.map((t) => t.settings)).toEqual(
      ['Auto', 'No transition', 'Rise'].map((preset) => ({ preset, bars: null, volume: null, eq: null, filter: null, effects: null, looping: null })),
    );
  });

  it('rejects pairs with unknown option names, missing values, bad or repeated indexes', () => {
    const r = parseAiAnswer(
      answer([
        entry(0, { volume: 'Slow crossfade' }),
        entry(1, { eq: undefined }),
        entry(2, { preset: 'Mystery' }),
        entry(7),
        entry(3),
        entry(3, { bars: 2 }),
        'nonsense',
      ]),
      4,
    );
    expect(r.transitions.map((t) => [t.index, t.settings.bars])).toEqual([[3, 8]]);
    expect(r.rejected).toEqual([
      { index: 0, problem: 'volume "Slow crossfade" is not a Spotify option' },
      { index: 1, problem: 'Custom needs all values; missing eq.' },
      { index: 2, problem: 'preset "Mystery" is not a Spotify preset' },
      { index: 7, problem: 'Entry 4: index 7 is not a pair of this set.' },
      { index: 3, problem: 'This pair came twice; the first answer counts.' },
      { index: -1, problem: 'Entry 7: index undefined is not a pair of this set.' },
    ]);
  });

  it('shortens long reasons to 140 characters', () => {
    const r = parseAiAnswer(answer([entry(0, { reason: 'x'.repeat(300) })]), 1);
    expect(r.transitions[0]!.reason).toHaveLength(140);
    expect(r.transitions[0]!.reason.endsWith('…')).toBe(true);
  });
});
