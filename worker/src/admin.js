// /admin/api/* handlers. The router has already verified Access before calling these.
import { json, error, readJson, redirect } from './http.js';
import { createDevice, listDevices, revokeDevice } from './auth/device.js';
import { startAuth, finishAuth, disconnect, GRANTS } from './google/oauth.js';
import { startPicker, stepPicker } from './google/picker.js';
import { buildHealth } from './health.js';
import { publishReflection } from './reflection.js';

export async function handleAdmin(request, env, url, admin) {
  const path = url.pathname;
  const method = request.method;
  const db = env.FRAME_DB;

  if (path === '/admin/oauth/start' && method === 'GET') {
    const grant = url.searchParams.get('grant') || '';
    if (!GRANTS[grant]) return error(400, 'unknown_grant');
    try {
      return redirect(await startAuth(env, grant, url.origin));
    } catch (e) {
      return error(500, e.message === 'google_client_missing' ? 'google_client_missing' : 'oauth_start_failed');
    }
  }
  if (path === '/admin/oauth/callback' && method === 'GET') {
    const r = await finishAuth(env, url);
    return redirect('/admin/?oauth=' + (r.ok ? 'ok' : r.error) + (r.grant ? '&grant=' + r.grant : ''));
  }
  if (path === '/admin/api/status' && method === 'GET') {
    // An unfinished picker job (e.g. paused on the KV budget) so the page can resume it after a reload.
    const job = await db
      .prepare("SELECT id, status, count FROM picker_jobs WHERE status IN ('picking', 'ingesting') ORDER BY created_at DESC LIMIT 1")
      .first();
    return json({ admin: admin.email, health: await buildHealth(env), devices: await listDevices(db), job: job || null });
  }
  if (path === '/admin/api/devices' && method === 'POST') {
    const body = await readJson(request, 4096);
    const d = await createDevice(db, body.value && body.value.name);
    // Shown once. The fragment never reaches the server when the frame loads it.
    return json({ id: d.id, name: d.name, pairingUrl: url.origin + '/#d=' + d.token });
  }
  let m = /^\/admin\/api\/devices\/([A-Za-z0-9_-]{4,64})\/revoke$/.exec(path);
  if (m && method === 'POST') return json({ revoked: await revokeDevice(db, m[1]) });

  m = /^\/admin\/api\/grants\/(calendar|photos)\/disconnect$/.exec(path);
  if (m && method === 'POST') {
    await disconnect(env, m[1]);
    return json({ ok: true });
  }
  if (path === '/admin/api/picker' && method === 'POST') {
    const r = await startPicker(env);
    return r.ok ? json(r) : error(409, r.error);
  }
  m = /^\/admin\/api\/picker\/([A-Za-z0-9_-]{4,40})\/step$/.exec(path);
  if (m && method === 'POST') return json(await stepPicker(env, m[1]));

  // Fallback form for the reflection (same validation as Chief's publish endpoint).
  if (path === '/admin/api/reflection' && method === 'PUT') {
    const body = await readJson(request);
    if (body.error) return error(400, body.error);
    const r = await publishReflection(env, body.value);
    return r.ok ? json(r) : json({ error: 'invalid_guide', problems: r.problems }, 400);
  }
  return null;
}
