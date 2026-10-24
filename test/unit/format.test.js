import { describe, it, expect } from 'vitest';
import { clockParts, photoCaption, temp, staleLabel } from '../../frame/src/format.js';

const TZ = 'America/Denver';

describe('format', () => {
  it('12-hour clock', () => {
    expect(clockParts(Date.parse('2026-10-24T13:42:00Z'), TZ)).toEqual(['7:42', 'AM']);
    expect(clockParts(Date.parse('2026-10-24T22:05:00Z'), TZ)).toEqual(['4:05', 'PM']);
    expect(clockParts(Date.parse('2026-10-24T06:00:00Z'), TZ)).toEqual(['12:00', 'AM']);
  });

  it('photo caption and temperature', () => {
    expect(photoCaption('2019-06')).toBe('June 2019');
    expect(photoCaption('')).toBe('');
    expect(temp(54)).toBe('54°');
  });

  it('stale label only after 30 minutes', () => {
    const now = Date.parse('2026-10-24T18:00:00Z');
    expect(staleLabel(new Date(now - 10 * 60000).toISOString(), now)).toBe('');
    expect(staleLabel(new Date(now - 45 * 60000).toISOString(), now)).toMatch(/45 min/);
  });
});
