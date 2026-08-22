#!/usr/bin/env node
/* ============================================================
   Refresh public/js/vendor/supabase.js.

   The client library is vendored rather than pulled from a CDN because the
   app has to boot with no network — a cold PWA start, and the APK, where
   there is no jsDelivr to fall back to. That means updating it is a
   deliberate act, so here is the one command that does it:

     npm run vendor:supabase            # latest
     npm run vendor:supabase 2.112.3    # a specific version

   Run `npm test` afterwards: the smoke suite boots the real app against the
   real bundle, so a broken download fails loudly rather than at runtime.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const OUT = path.resolve(__dirname, '..', 'public', 'js', 'vendor', 'supabase.js');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} cho ${url}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

(async () => {
  let version = process.argv[2];
  if (!version) {
    version = execFileSync('npm', ['view', '@supabase/supabase-js', 'version'],
      { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
  }
  const url = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${version}/dist/umd/supabase.js`;
  console.log('· tải ' + url);
  const code = await get(url);

  /* A CDN can hand back an HTML error page with a 200. Refuse to write it. */
  if (!/^\s*var supabase\s*=/.test(code)) {
    throw new Error('Nội dung tải về không phải UMD bundle của supabase-js.');
  }
  const banner = `/* @supabase/supabase-js ${version} — UMD bundle, vendored on purpose.\n` +
    `   The app must open with no network at all: as a PWA on a cold start and as\n` +
    `   an APK where there is no CDN to fall back to. Refresh with:\n` +
    `     npm run vendor:supabase\n*/\n`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, banner + code, 'utf8');
  execFileSync(process.execPath, ['--check', OUT], { stdio: 'pipe' });

  console.log(`✓ public/js/vendor/supabase.js  →  v${version}  ${(code.length / 1024).toFixed(0)} KB`);
  console.log('  chạy `npm test` để chắc app vẫn boot với bản này.');
})().catch(err => { console.error('\n✖ ' + err.message + '\n'); process.exit(1); });
