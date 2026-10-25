// PLAN-v2.md §11.3: the Worker only ever reads from Home Assistant.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL('../../worker/src/' + p, import.meta.url), 'utf8');

describe('HA is read-only', () => {
  it('ha.js sends GET and has no other method', () => {
    expect(src('ha.js')).toMatch(/method: 'GET'/);
    expect(src('ha.js')).not.toMatch(/'(POST|PUT|PATCH|DELETE)'/);
  });

  it('only ha.js touches the HA binding, and only /api/states and /api/camera_proxy and /api/config are asked for', () => {
    for (const f of ['controls.js', 'index.js', 'admin.js', 'health.js']) expect(src(f)).not.toMatch(/HA\.fetch/);
    const paths = [...src('controls.js').matchAll(/haGet\(env, '([^']+)'/g)].map((m) => m[1]).sort();
    expect(paths).toEqual(['/api/camera_proxy/', '/api/config', '/api/states', '/api/states/']);
    expect(src('controls.js')).not.toMatch(/\/api\/services/);
  });
});
