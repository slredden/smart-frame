#!/usr/bin/env node
// Copies the Worker's secrets from the environment (GitHub Actions secrets) into the smart-frame
// Worker with one `wrangler secret bulk` call. Run only by .github/workflows/worker-secrets.yml.
// Never prints a value: output is names, checks and wrangler's own result lines.
// Refuses when any required secret is missing, any secret is malformed, or the Worker doesn't exist yet
// (`wrangler secret bulk` would otherwise create an empty one). OPTIONAL secrets (Controls) are skipped
// while unset; `secret bulk` only touches the names it is given, so a skipped one is never deleted.
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WORKER = "smart-frame";

const b64len = (v) => {
  try {
    return Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64")
      .length;
  } catch {
    return -1;
  }
};

/** name -> validator returning an error string or null. Errors never include the value. */
export const SECRETS = {
  URL_SIGNING_KEY: (v) =>
    v.length >= 32 ? null : "must be at least 32 characters",
  TOKEN_ENC_KEY: (v) =>
    /^[A-Za-z0-9+/_-]+={0,2}$/.test(v) && b64len(v) === 32
      ? null
      : "must be 32 bytes, base64",
  HEALTH_TOKEN_HASH: (v) =>
    /^[0-9a-f]{64}$/.test(v) ? null : "must be a lowercase SHA-256 hex digest",
  PUBLISH_TOKEN_HASH: (v) =>
    /^[0-9a-f]{64}$/.test(v) ? null : "must be a lowercase SHA-256 hex digest",
  ADMIN_EMAILS: (v) =>
    v
      .split(/[,\s]+/)
      .filter(Boolean)
      .every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      ? null
      : "must be comma-separated email addresses",
  GOOGLE_CLIENT_SECRET: (v) =>
    v.length >= 16 && !/\s/.test(v)
      ? null
      : "looks wrong (too short or has whitespace)",
};

/**
 * Controls secrets (PLAN-v2 §11.3, §11.5): optional until Stephen has made them. Checked when present.
 * HA long-lived tokens are JWTs; Spotify client secrets are 32 hex characters.
 */
export const OPTIONAL = {
  HA_TOKEN: (v) =>
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v) && v.length >= 100
      ? null
      : "must be a Home Assistant long-lived access token (a JWT)",
  SPOTIFY_CLIENT_SECRET: (v) =>
    /^[0-9a-f]{32}$/.test(v) ? null : "must be 32 lowercase hex characters",
};

/** Returns { values, problems, skipped } where problems are "NAME: reason" strings (no values). */
export function collectSecrets(env) {
  const values = {};
  const problems = [];
  const skipped = [];
  for (const [name, check] of [...Object.entries(SECRETS), ...Object.entries(OPTIONAL)]) {
    const v = (env[name] || "").trim();
    if (!v) {
      if (name in OPTIONAL) skipped.push(name);
      else problems.push(`${name}: missing`);
      continue;
    }
    const err = check(v);
    if (err) problems.push(`${name}: ${err}`);
    else values[name] = v;
  }
  return { values, problems, skipped };
}

/** Drops any line that contains one of the values (belt and braces; wrangler prints names only). */
export function scrub(line, values) {
  for (const v of Object.values(values))
    if (v && line.includes(v)) return "[line hidden]";
  return line;
}

async function workerExists(accountId, token) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER}/settings`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (r.status === 404) return false;
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const errs = (body.errors || [])
      .map((e) => `[${e.code}] ${e.message}`)
      .join("; ");
    throw new Error(`could not check the Worker (HTTP ${r.status}) ${errs}`);
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const token = process.env.CLOUDFLARE_API_TOKEN || "";
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  if (!token || !/^[0-9a-f]{32}$/.test(accountId)) {
    console.error(
      "refusing: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set",
    );
    process.exit(2);
  }
  const { values, problems, skipped } = collectSecrets(process.env);
  if (problems.length) {
    console.error(
      "refusing: secrets not ready, nothing was changed:\n  " +
        problems.join("\n  "),
    );
    process.exit(2);
  }
  let exists;
  try {
    exists = await workerExists(accountId, token);
  } catch (e) {
    console.error("refusing: " + e.message);
    process.exit(2);
  }
  if (!exists) {
    console.error(
      `refusing: the Worker "${WORKER}" doesn't exist yet. Deploy it once first, then run this again. Nothing was changed.`,
    );
    process.exit(3);
  }
  console.log(
    `setting ${Object.keys(values).length} secrets on ${WORKER}: ${Object.keys(values).join(", ")}`,
  );
  if (skipped.length)
    console.log(`not set yet (optional, left as they are): ${skipped.join(", ")}`);
  const bin = path.join(ROOT, "node_modules/.bin/wrangler");
  const child = spawn(
    bin,
    ["secret", "bulk", "--config", "worker/wrangler.jsonc"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        FORCE_COLOR: "0",
        WRANGLER_LOG: "log",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const pipe = (src, dst) =>
    new Promise((done) =>
      readline
        .createInterface({ input: src, crlfDelay: Infinity })
        .on("line", (l) => dst.write(scrub(l, values) + "\n"))
        .on("close", done),
    );
  const drained = Promise.all([
    pipe(child.stdout, process.stdout),
    pipe(child.stderr, process.stderr),
  ]);
  child.stdin.end(JSON.stringify(values));
  const code = await new Promise((res) => {
    child.on("error", (e) => {
      console.error("could not start wrangler: " + e.message);
      res(1);
    });
    child.on("exit", (c, sig) => res(c ?? (sig ? 1 : 0)));
  });
  await drained;
  process.exitCode = code === 0 ? 0 : code || 1;
}
