import { describe, expect, it } from 'vitest';
import { EFFECTS_OPTIONS, EQ_OPTIONS, FILTER_OPTIONS, LOOPING_OPTIONS, MIX_PRESETS, VOLUME_OPTIONS } from '@curator/shared';
import { sampleSet } from './fixtures.ts';
import { buildAiPassPrompt } from './prompt.ts';

describe('buildAiPassPrompt', () => {
  const set = sampleSet();
  const prompt = buildAiPassPrompt({ ...set, focus: 'more echo, darker' });

  it('sets the role, the rules and the exact option lists', () => {
    expect(prompt).toMatch(/^You are an experienced DJ preparing Spotify Mix transitions/);
    for (const list of [MIX_PRESETS, VOLUME_OPTIONS, EQ_OPTIONS, FILTER_OPTIONS, EFFECTS_OPTIONS, LOOPING_OPTIONS]) {
      expect(prompt).toContain(list.map((x) => `"${x}"`).join(', '));
    }
    expect(prompt).toContain('"in" acts on the incoming (next) track, "out" on the outgoing (current) track.');
    expect(prompt).toContain('bars: 2, 4, 8, 16 only. Spotify offers 16 only for some tracks');
    expect(prompt).toContain('Sheet Style: Balanced');
    expect(prompt).toContain('Colour: Medium');
    expect(prompt).toContain("The user's focus: more echo, darker");
    expect(prompt).toContain('at most 140 characters');
    expect(prompt).toContain('Answer with STRICT JSON only');
    expect(prompt).toContain('{"name": ');
    expect(prompt).toContain('"summary": ');
    expect(prompt).toContain('suggest a name for the whole set');
    expect(prompt).toContain('index 0 to 2');
  });

  it('describes every pair with both tracks, tempo, key, position and the current settings', () => {
    expect(prompt).toContain('Pair 0:\n  out: One More Time — Daft Punk | 123 BPM | key 8A | energy 0.60 | valence 0.60 | danceability 0.75 | instrumentalness 0.10 | acousticness 0.05 | tags house');
    expect(prompt).toContain('  in:  Strings of Life — Rhythim Is Rhythim | 125 BPM');
    expect(prompt).toContain('tags techno, detroit techno');
    expect(prompt).toMatch(/Pair 1:[\s\S]*tempo -0\.8 %, key relation same, 50 % into the set, target energy 0\.85 \(near the peak\)/);
    expect(prompt).toContain(`  rule reason: ${set.transitions[0]!.reason}`);
    expect(prompt).toMatch(/current: preset Custom, bars 8, volume "[^"]+", eq "[^"]+"/);
    expect(prompt).toContain('Pair 2:');
    expect(prompt).not.toContain('Pair 3:');
  });

  it('is pure and says when no focus is given', () => {
    expect(buildAiPassPrompt({ ...set, focus: 'more echo, darker' })).toBe(prompt);
    expect(buildAiPassPrompt(set)).toContain("The user's focus: none given");
  });
});
