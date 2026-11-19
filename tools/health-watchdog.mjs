#!/usr/bin/env node
// A second monitor for the Worker itself; its run history is the small, durable state store.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildHealthMail, sendAgentMail } from '../worker/src/mail.js';

const DEFAULT_URL = 'https://smart-frame.sredden.workers.dev/api/health';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function previousFailures(runs, currentId) {
  let count = 0;
  for (const run of runs) {
    if (String(run.id) === String(currentId)) continue;
    if (run.conclusion !== 'failure') break;
    count++;
  }
  return count;
}

export function watchdogDecision(up, prevFailures) {
  if (!up) return { exitCode: 1, action: prevFailures === 1 ? 'alert' : 'none' };
  return { exitCode: 0, action: prevFailures >= 2 ? 'recovered' : 'none' };
}

export async function checkHealth(url, healthToken, { fetchImpl = fetch, tries = 3, gapMs = Number(process.env.SFH_GAP || 20000) } = {}) {
  let reason = 'unreachable';
  for (let attempt = 0; attempt < tries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${healthToken || ''}` }, signal: controller.signal });
      if (r.status === 200) {
        try {
          JSON.parse(await r.text());
          return { up: true, reason: 'ok' };
        } catch {
          reason = 'unreachable';
        }
      } else {
        reason = r.status === 401 ? 'health token rejected' : `http ${r.status}`;
      }
    } catch {
      reason = 'unreachable';
    } finally {
      clearTimeout(timeout);
    }
    if (attempt + 1 < tries) await wait(gapMs);
  }
  return { up: false, reason };
}

export function historyFromGh(repository, workflow, currentId, execImpl = execFileSync) {
  const path = `repos/${repository}/actions/workflows/${workflow}/runs?event=schedule&status=completed&per_page=20`;
  const raw = execImpl('gh', ['api', path], { encoding: 'utf8' });
  return previousFailures(JSON.parse(raw).workflow_runs || [], currentId);
}

export async function main(env = process.env, deps = {}) {
  const dispatch = env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const url = env.INPUT_URL || env.HEALTH_URL || DEFAULT_URL;
  const result = await checkHealth(url, env.HEALTH_TOKEN, deps);
  let prevFailures = 0;
  let historyKnown = true;
  if (!dispatch) {
    try {
      prevFailures = historyFromGh(env.GITHUB_REPOSITORY, 'health-watchdog.yml', env.GITHUB_RUN_ID, deps.execImpl);
    } catch {
      historyKnown = false;
      console.log('watchdog history unavailable; treating previous failures as zero');
    }
  }
  const decision = watchdogDecision(result.up, prevFailures);
  console.log(`watchdog: ${result.up ? 'UP' : 'DOWN'} (${result.reason}); previous failures: ${prevFailures}; action: ${decision.action}`);
  if (!dispatch && historyKnown && decision.action !== 'none') {
    const sent = await sendAgentMail(env, buildHealthMail(decision.action, [], { watchdog: true }), { fetchImpl: deps.mailFetchImpl || fetch });
    if (!sent.ok) console.log(`watchdog mail failed: ${sent.reason}`);
  }
  return decision.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
