import { describe, it, expect } from 'vitest';
import { checkText, hasNesting } from '../../tools/compat-check.mjs';

describe('Chrome 106 compat check', () => {
  it('flags banned CSS', () => {
    expect(checkText('css', 'a{color:oklch(50% 0.1 20)}').length).toBeGreaterThan(0);
    expect(checkText('css', 'a:has(b){color:red}').length).toBeGreaterThan(0);
    expect(checkText('css', 'a{height:100dvh}').length).toBeGreaterThan(0);
    expect(checkText('css', 'a{color:#ffffff80}').length).toBeGreaterThan(0);
    expect(checkText('css', 'a{color:rgba(0,0,0,.5);height:100vh}')).toEqual([]);
  });

  it('detects nesting', () => {
    expect(hasNesting('a{color:red; b{color:blue}}')).toBe(true);
    expect(hasNesting('@media (min-width:1px){a{color:red}}')).toBe(false);
  });

  it('flags banned JS', () => {
    expect(checkText('js', 'x.toSorted()').length).toBeGreaterThan(0);
    expect(checkText('js', 'Object.groupBy(a,f)').length).toBeGreaterThan(0);
    expect(checkText('js', 'x.slice().sort()')).toEqual([]);
  });
});
