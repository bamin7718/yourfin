/* ============================================================
   FINYOURTIN — Supabase configuration contract

   Single source of truth for how the app finds its Supabase project.
   Runs under Node (used by scripts/generate-env.js) and is safe to require
   from any tooling. The browser never loads this file: the build script
   bakes the resolved values into public/js/env.js instead.

   Resolution order (first hit wins):
     1. process.env.SUPABASE_URL / SUPABASE_ANON_KEY
     2. process.env.VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
     3. process.env.NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
     4. a .env file at the repo root (KEY=value, # comments allowed)

   The anon key is a public credential — it is meant to reach the browser.
   Row-level security in supabase/schema.sql is what actually protects data.
   Never put the service_role key anywhere near this file.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const URL_ALIASES = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const KEY_ALIASES = ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

/* Minimal .env reader — no dependency, no interpolation, no export lines. */
function readDotEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function pick(names, env) {
  for (const n of names) {
    if (env[n] && String(env[n]).trim()) return String(env[n]).trim();
  }
  return '';
}

function resolveConfig(opts) {
  const root = (opts && opts.root) || path.resolve(__dirname, '..');
  const env = Object.assign({}, readDotEnv(path.join(root, '.env')), process.env);
  const url = pick(URL_ALIASES, env).replace(/\/+$/, '');
  const anonKey = pick(KEY_ALIASES, env);
  return { url, anonKey, problems: validate(url, anonKey) };
}

function validate(url, anonKey) {
  const problems = [];
  if (!url) problems.push('SUPABASE_URL trống');
  else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
    problems.push(`SUPABASE_URL không đúng dạng https://<ref>.supabase.co (nhận được: ${url})`);
  }
  if (!anonKey) problems.push('SUPABASE_ANON_KEY trống');
  else if (anonKey.length < 40) problems.push('SUPABASE_ANON_KEY quá ngắn, có vẻ không phải anon key');
  else if (/service_role/.test(anonKey)) {
    problems.push('Đây là service_role key — TUYỆT ĐỐI không đưa vào bundle trình duyệt. Dùng anon public key.');
  }
  return problems;
}

module.exports = { resolveConfig, validate, readDotEnv, URL_ALIASES, KEY_ALIASES };
