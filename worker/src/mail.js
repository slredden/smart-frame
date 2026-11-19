const ADMIN_URL = 'https://smart-frame.sredden.workers.dev/admin/';

function problemWords(problems) {
  const groups = [];
  if (problems.some((p) => p.startsWith('grant_'))) groups.push('a Google connection needs attention');
  if (problems.some((p) => p === 'frame_offline' || p === 'frame_never_seen')) groups.push('the frame is offline');
  if (problems.some((p) => p === 'weather_stale' || p === 'calendar_stale')) groups.push('weather or calendar data is stale');
  if (problems.some((p) => p.startsWith('reflection_'))) groups.push('the reflection guide needs publishing');
  if (problems.includes('health_check_error')) groups.push('the health check could not run');
  const known = new Set(['weather_stale', 'calendar_stale', 'health_check_error']);
  const other = problems.filter((p) => !known.has(p) && !p.startsWith('grant_') && p !== 'frame_offline' && p !== 'frame_never_seen' && !p.startsWith('reflection_'));
  if (other.length) groups.push('some frame services need attention');
  return groups.join(', ') || 'the frame health check found an issue';
}

function fixStep(problems) {
  if (problems.some((p) => p.startsWith('grant_'))) return `Reconnect Google at ${ADMIN_URL}.`;
  if (problems.some((p) => p === 'frame_offline' || p === 'frame_never_seen')) return 'Check that the frame has power and Wi-Fi.';
  if (problems.some((p) => p === 'weather_stale' || p === 'calendar_stale')) return `This usually clears itself; otherwise reconnect Google at ${ADMIN_URL}.`;
  if (problems.some((p) => p.startsWith('reflection_'))) return 'Publish the current reflection guide.';
  if (problems.includes('health_check_error')) return 'Look at the Worker logs in Cloudflare.';
  return 'Look at the Worker logs in Cloudflare.';
}

/** Plain, content-free mail copy shared by the Worker job and its external watchdog. */
export function buildHealthMail(action, problems = [], { watchdog = false } = {}) {
  const subject = `Smart frame: ${action === 'recovered' ? 'recovered' : 'alert'}`;
  if (watchdog) {
    const first = action === 'recovered' ? 'The Worker answers health checks again.' : 'The Worker is not answering health checks.';
    return { subject, text: `${first} Check the Worker in the Cloudflare dashboard and its recent deploys.` };
  }
  const words = problemWords(problems);
  if (action === 'recovered') return { subject, text: `The smart frame is healthy again. It had ${words}. ${fixStep(problems)}` };
  return { subject, text: `The smart frame has a problem: ${words}. ${fixStep(problems)}` };
}

/** Sends AgentMail without exposing configuration or provider responses to logs. */
export async function sendAgentMail(env, message, { fetchImpl = fetch } = {}) {
  const key = env.AGENTMAIL_API_KEY;
  const to = String(env.ALERT_TO || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!key || !to.length) return { ok: false, reason: 'mail_not_configured' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const inbox = env.ALERT_FROM_INBOX || 'sr-grokbot@agentmail.to';
    const r = await fetchImpl(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject: message.subject, text: message.text }),
      signal: controller.signal,
    });
    return r.ok ? { ok: true } : { ok: false, reason: 'mail_http_' + r.status };
  } catch {
    return { ok: false, reason: 'mail_error' };
  } finally {
    clearTimeout(timeout);
  }
}
