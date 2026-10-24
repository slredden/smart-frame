// smart-frame Worker: routes, auth gates, and the cron (PLAN.md §5, §7).
import { ensureSchema } from './db.js';
import { json, error, empty, unauthorized, forbidden, notFound, readJson, redirect, log } from './http.js';
import { authDevice, rateLimited, touchDevice, recordHeartbeat } from './auth/device.js';
import { checkHashedToken } from './auth/tokens.js';
import { verifyAccess } from './auth/access.js';
import { buildState } from './state.js';
import { buildHealth } from './health.js';
import { servePhoto } from './photos.js';
import { publishReflection } from './reflection.js';
import { handleAdmin } from './admin.js';
import { refreshWeather } from './weather.js';
import { refreshCalendar } from './google/calendar.js';

export async function route(request, env, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const db = env.FRAME_DB;

  if (path.startsWith('/p/')) {
    if (method !== 'GET' && method !== 'HEAD') return empty(405);
    await ensureSchema(db);
    return servePhoto(env, url);
  }

  if (path === '/api/health') {
    if (!(await checkHashedToken(request, env.HEALTH_TOKEN_HASH))) return unauthorized();
    if (method !== 'GET') return empty(405);
    await ensureSchema(db);
    return json(await buildHealth(env));
  }

  if (path === '/api/publish/reflection') {
    if (!(await checkHashedToken(request, env.PUBLISH_TOKEN_HASH))) return unauthorized();
    if (method !== 'PUT') return empty(405);
    await ensureSchema(db);
    const body = await readJson(request);
    if (body.error) return error(400, body.error);
    const r = await publishReflection(env, body.value);
    log('reflection_publish', { ok: r.ok, weeks: r.ok ? r.weeks.length : 0 });
    return r.ok ? json(r) : json({ error: 'invalid_guide', problems: r.problems }, 400);
  }

  if (path.startsWith('/api/')) {
    await ensureSchema(db);
    const device = await authDevice(request, db);
    if (!device) return unauthorized();
    if (rateLimited(device.id)) return empty(429);
    if (path === '/api/state' && method === 'GET') {
      await touchDevice(db, device.id, request.headers.get('x-frame-build'));
      return json(await buildState(env, device));
    }
    if (path === '/api/heartbeat' && method === 'POST') {
      const body = await readJson(request, 8192);
      await recordHeartbeat(db, device.id, body.value || {});
      return empty(204);
    }
    return notFound();
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    const admin = await verifyAccess(request, env, deps.fetchImpl || fetch);
    if (!admin) return forbidden();
    if (path === '/admin') return redirect('/admin/');
    await ensureSchema(db);
    const r = await handleAdmin(request, env, url, admin);
    if (r) return r;
    if (path.startsWith('/admin/api/')) return notFound();
    // The admin page itself (static), only after Access passes.
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'no-store');
    out.headers.set('X-Robots-Tag', 'noindex');
    return out;
  }

  return env.ASSETS.fetch(request);
}

export async function runCron(env, nowMs = Date.now(), fetchImpl = fetch) {
  await ensureSchema(env.FRAME_DB);
  const [w, c] = await Promise.all([refreshWeather(env, { fetchImpl, nowMs }), refreshCalendar(env, { fetchImpl, nowMs })]);
  log('cron', { weather: w.skipped ? 'skip' : w.ok ? 'ok' : 'fail', calendar: c.ok ? 'ok' : c.reason || 'fail' });
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      log('unhandled', { name: e && e.name ? String(e.name).slice(0, 40) : 'Error' });
      return error(500, 'internal');
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCron(env, controller.scheduledTime || Date.now()));
  },
};
