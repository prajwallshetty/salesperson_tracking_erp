import { describe, it, expect } from 'vitest';
import { toCsv } from '@/lib/http/csv';
import { hit } from '@/lib/http/rateLimit';
import { pagination } from '@/lib/http/request';

describe('http helpers', () => {
  it('escapes CSV and neutralises formula injection', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'He said "hi"']])).toBe('a,b\n"x,y","He said ""hi"""');
    expect(toCsv(['n'], [['=HYPERLINK("http://evil")']])).toBe(`n\n"'=HYPERLINK(""http://evil"")"`);
    expect(toCsv(['n'], [[-42]])).toBe('n\n-42');
  });

  it('rate limits per key within a window', () => {
    const rule = { name: `t${Math.random()}`, windowMs: 1000, max: 2, message: 'slow' };
    expect(hit(rule, 'ip', 0).allowed).toBe(true);
    expect(hit(rule, 'ip', 1).allowed).toBe(true);
    expect(hit(rule, 'ip', 2).allowed).toBe(false);
    expect(hit(rule, 'other', 2).allowed).toBe(true);
    expect(hit(rule, 'ip', 1001).allowed).toBe(true);
  });

  it('bounds pagination', () => {
    expect(pagination(new URLSearchParams('limit=100000&offset=-5'), { limit: 50, max: 500 })).toEqual({ limit: 500, offset: 0 });
    expect(pagination(new URLSearchParams('limit=abc'), { limit: 50 })).toEqual({ limit: 50, offset: 0 });
  });
});
