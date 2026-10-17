import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildInventory } from '../../scripts/inventory';

describe('docs/INVENTORY.md', () => {
  it('is generated from the code and up to date (run `npm run inventory` after adding pages, endpoints or models)', () => {
    expect(readFileSync('docs/INVENTORY.md', 'utf8')).toBe(buildInventory());
  });

  it('every data model is classified for company scoping', () => {
    expect(buildInventory()).not.toContain('UNCLASSIFIED');
  });

  it('every endpoint declares who may call it, except the few that authenticate by hand', () => {
    const rows = buildInventory().split('\n').filter((l) => /^\| (GET|POST|PUT|PATCH|DELETE) /.test(l));
    expect(rows.length).toBeGreaterThan(60);
    const custom = rows.filter((r) => r.includes('custom (see file)')).map((r) => r.split('|')[2].trim());
    // public by design: app update config, API documentation, health; logout and session-ended authenticate by hand
    expect(custom.sort()).toEqual(['`/api/app/config`', '`/api/auth/logout`', '`/api/auth/session-ended`', '`/api/docs`', '`/api/docs/spec.json`', '`/api/health`'].sort());
  });
});
