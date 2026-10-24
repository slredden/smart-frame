import { describe, it, expect } from 'vitest';
import { route } from '../../worker/src/index.js';
import { signPhotoPath, photoManifest, photoKey } from '../../worker/src/photos.js';
import { revokeDevice } from '../../worker/src/auth/device.js';
import { testEnv, setup, req } from './helpers.js';

async function seedSet(env) {
  await env.FRAME_DB.prepare("INSERT INTO photo_sets (set_id, created_at, count, status) VALUES ('sTest01', '2026-10-24T00:00:00Z', 1, 'active')").run();
  await env.FRAME_DB.prepare("INSERT INTO photos (set_id, n, w, h, orient, taken, blur) VALUES ('sTest01', 1, 4, 3, 'l', '2019-06', '')").run();
  await env.FRAME_PHOTOS.put(photoKey('sTest01', 1), new Uint8Array([0xff, 0xd8, 0xff]), { metadata: { type: 'image/jpeg' } });
}

describe('signed photo URLs', () => {
  it('serves a valid signed URL and refuses tampering, expiry and revoked devices', async () => {
    const env = testEnv();
    const device = await setup(env);
    await seedSet(env);
    const m = await photoManifest(env, device.id);
    expect(m.setId).toBe('sTest01');
    expect(m.items[0]).toMatchObject({ id: '1', orient: 'l', taken: '2019-06' });
    const ok = await route(req(m.items[0].url), env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));

    expect((await route(req(m.items[0].url.replace('/1.jpg', '/2.jpg')), env)).status).toBe(403);
    expect((await route(req(m.items[0].url.replace(/sig=[^&]+/, 'sig=AAAA')), env)).status).toBe(403);
    expect((await route(req('/p/sTest01/1.jpg'), env)).status).toBe(403);

    const old = await signPhotoPath(env, 'sTest01', 1, device.id, Date.now() - 5 * 3600000);
    expect((await route(req(old), env)).status).toBe(403);

    await revokeDevice(env.FRAME_DB, device.id);
    expect((await route(req(m.items[0].url), env)).status).toBe(403);
  });

  it('URLs stay identical within the hour (browser cache friendly)', async () => {
    const env = testEnv();
    const t = Date.parse('2026-10-24T18:05:00Z');
    expect(await signPhotoPath(env, 'sA1234', 1, 'dev1', t)).toBe(await signPhotoPath(env, 'sA1234', 1, 'dev1', t + 40 * 60000));
  });
});
