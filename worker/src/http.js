// Response helpers. Every response is no-store unless a handler says otherwise.

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, BASE_HEADERS, extra),
  });
}

export function empty(status) {
  return new Response(null, { status, headers: BASE_HEADERS });
}

export function error(status, code) {
  return json({ error: code }, status);
}

export const unauthorized = () => empty(401);
export const forbidden = () => empty(403);
export const notFound = () => error(404, 'not_found');
export const methodNotAllowed = () => error(405, 'method_not_allowed');

export function redirect(location, status = 302) {
  return new Response(null, { status, headers: Object.assign({ Location: location }, BASE_HEADERS) });
}

export async function readJson(request, maxBytes = 256 * 1024) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) return { error: 'too_large' };
  const text = await request.text();
  if (text.length > maxBytes) return { error: 'too_large' };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: 'bad_json' };
  }
}

export function bearer(request) {
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

/** Structured, content-free log line. Only pass ids, statuses, durations and error codes. */
export function log(event, fields = {}) {
  console.log(JSON.stringify(Object.assign({ event }, fields)));
}
