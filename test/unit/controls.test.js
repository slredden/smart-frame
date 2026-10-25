import { describe, it, expect } from 'vitest';
import { spotifyErrorText, absentText, ageLabel, isStale, POLL_MS, STALE_CAM_MS } from '../../frame/src/screens/controls.js';
import { controlsSummary } from '../../frame/src/screens/settings.js';

const NOW = Date.parse('2026-10-24T18:00:00Z');
const ago = (s) => new Date(NOW - s * 1000).toISOString();

describe('Controls screen helpers (PLAN-v2.md §11.4-§11.7)', () => {
  it('polls every 5 s and calls a picture stale after 15 min', () => {
    expect(POLL_MS).toBe(5000);
    expect(STALE_CAM_MS).toBe(900000);
    expect(isStale(ago(899), NOW)).toBe(false);
    expect(isStale(ago(901), NOW)).toBe(true);
  });
  it('labels picture age in s, min and h', () => {
    expect(ageLabel(ago(40), NOW)).toBe('updated 40 s ago');
    expect(ageLabel(ago(1500), NOW)).toBe('updated 25 min ago');
    expect(ageLabel(ago(7300), NOW)).toBe('updated 2 h ago');
  });
  it('says what to do when the remembered speaker is gone', () => {
    expect(absentText('Kitchen')).toBe('Kitchen not available; say "Alexa, Spotify Connect" or play once from the Spotify app');
  });
  it('maps Spotify errors to plain text, with a fallback', () => {
    expect(spotifyErrorText('premium_needed')).toMatch(/Premium/);
    expect(spotifyErrorText('whatever')).toBe("Spotify didn't answer. Try again.");
  });
  it('summarises the indoor-camera setting', () => {
    expect(controlsSummary({ indoor: false, revealSec: 45 })).toBe('Off');
    expect(controlsSummary({ indoor: true, revealSec: 30 })).toBe('Shown 30 s per tap');
  });
});
