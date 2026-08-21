#!/usr/bin/env node
/* ============================================================
   Static wiring check for the split build.

   The app glues HTML to JS through inline handlers and getElementById, so a
   rename in one file fails silently in the other. This walks both directions
   and syntax-checks every script. Run it before committing.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'public', 'index.html');
const SCRIPTS = ['public/js/sync.js', 'public/js/app.js'].map(p => path.join(ROOT, p));

const read = f => fs.readFileSync(f, 'utf8');
const html = read(HTML);
const js = SCRIPTS.map(read).join('\n');

const errors = [];
const warnings = [];

/* ---------- 1. every script parses ---------- */
for (const f of SCRIPTS) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    errors.push(`Lỗi cú pháp trong ${path.relative(ROOT, f)}:\n${e.stderr.toString().trim()}`);
  }
}

/* ---------- 2. ids referenced by JS must exist in HTML ---------- */
// Static markup plus ids the app injects itself (uiSheet, renderCloudSection,
// the rates editor...). Those are just as real once rendered.
const htmlIds = new Set([
  ...[...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]),
  ...[...js.matchAll(/\bid="([^"$\\]+)"/g)].map(m => m[1])
]);
const jsIds = new Set([...js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]));
for (const id of [...jsIds].sort()) {
  if (!htmlIds.has(id)) errors.push(`JS gọi getElementById('${id}') nhưng HTML không có id đó.`);
}

/* ---------- 3. inline handlers must resolve to a defined function ---------- */
// Names defined anywhere in the scripts, plus the browser builtins used inline.
const defined = new Set([
  ...[...js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
  ...[...js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g)].map(m => m[1]),
  ...[...js.matchAll(/global\.(\w+)\s*=/g)].map(m => m[1]),
  'Sync', 'console', 'document', 'window', 'location', 'alert'
]);

const handlerAttr = /\bon(?:click|change|input|submit|error|keydown)="([^"]*)"/g;
const called = new Map();
for (const m of html.matchAll(handlerAttr)) {
  // Bare calls only — `foo(` counts, `obj.foo(` is a method on something else.
  for (const c of m[1].matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!called.has(c[2])) called.set(c[2], m[1]);
  }
}
for (const [fn, snippet] of [...called].sort()) {
  if (!defined.has(fn)) errors.push(`Inline handler gọi ${fn}() — không tìm thấy định nghĩa.  (${snippet.slice(0, 60)})`);
}

/* ---------- 4. leftovers from the pre-cloud build ---------- */
const banned = [
  // `delete state.users` is the intended migration cleanup, not a leftover read.
  [/(?<!delete )\bstate\.users\b/, 'state.users vẫn còn — tài khoản cục bộ đã bị bỏ'],
  [/login-username/, 'tham chiếu tới #login-username đã bị thay bằng #login-email'],
  [/\bresetDemoData\b/, 'resetDemoData đã đổi tên thành loadDemoData'],
  [/\bmigrateFromLegacy\s*\(/, 'migrateFromLegacy đã thay bằng normalizeLegacyArchive']
];
for (const [re, msg] of banned) {
  if (re.test(js)) errors.push(`app.js/sync.js: ${msg}`);
  if (re.test(html)) errors.push(`index.html: ${msg}`);
}

/* ---------- 5. no credentials committed ---------- */
if (/eyJ[A-Za-z0-9_-]{30,}/.test(html)) {
  errors.push('index.html có vẻ chứa một JWT — đừng commit anon key vào HTML, dùng biến môi trường.');
}
if (fs.existsSync(path.join(ROOT, '.env'))) {
  const ignored = read(path.join(ROOT, '.gitignore'));
  if (!/^\.env$/m.test(ignored)) errors.push('.env tồn tại nhưng .gitignore không loại trừ nó.');
}

/* ---------- 6. assets referenced by index.html exist ---------- */
for (const m of html.matchAll(/(?:href|src)="(?!https?:|data:)([^"]+)"/g)) {
  const rel = m[1].split('?')[0];
  const abs = path.join(ROOT, 'public', rel);
  if (!fs.existsSync(abs)) {
    (rel.endsWith('js/env.js') ? warnings : errors)
      .push(`index.html trỏ tới "${rel}" nhưng file không tồn tại.`);
  }
}

/* ---------- 7. PWA: manifest + service worker point at files that exist ---------- */
const MANIFEST = path.join(ROOT, 'public', 'manifest.json');
if (!fs.existsSync(MANIFEST)) {
  errors.push('Thiếu public/manifest.json — app sẽ không cài được.');
} else {
  let mf = null;
  try { mf = JSON.parse(read(MANIFEST)); }
  catch (e) { errors.push('manifest.json không phải JSON hợp lệ: ' + e.message); }
  if (mf) {
    for (const ic of mf.icons || []) {
      if (!fs.existsSync(path.join(ROOT, 'public', ic.src))) {
        errors.push(`manifest.json trỏ tới icon "${ic.src}" nhưng file không tồn tại (chạy npm run icons).`);
      }
    }
    const big = (mf.icons || []).some(i => /512/.test(i.sizes || ''));
    const maskable = (mf.icons || []).some(i => /maskable/.test(i.purpose || ''));
    if (!big) errors.push('manifest.json cần một icon 512x512 thì Chrome mới cho cài.');
    if (!maskable) warnings.push('manifest.json chưa có icon purpose="maskable" — Android sẽ tự cắt viền.');
  }
}
const SW = path.join(ROOT, 'public', 'sw.js');
if (!fs.existsSync(SW)) {
  errors.push('Thiếu public/sw.js — sẽ không chạy được offline.');
} else {
  const sw = read(SW);
  try {
    execFileSync(process.execPath, ['--check', SW], { stdio: 'pipe' });
  } catch (e) {
    errors.push(`Lỗi cú pháp trong public/sw.js:\n${e.stderr.toString().trim()}`);
  }
  // every same-origin entry of the precache list must be a real file
  const block = (sw.match(/const PRECACHE = \[([\s\S]*?)\];/) || [])[1] || '';
  for (const m of block.matchAll(/'(\/[^']*)'/g)) {
    const rel = m[1] === '/' ? '/index.html' : m[1];
    if (!fs.existsSync(path.join(ROOT, 'public', rel))) {
      errors.push(`sw.js precache "${m[1]}" nhưng file không tồn tại.`);
    }
  }
  if (!/isSupabase/.test(sw)) {
    errors.push('sw.js phải bỏ qua request tới Supabase — cache lại auth/REST sẽ hỏng đăng nhập.');
  }

  /* Anything index.html loads must be precached, or the app boots broken with
     the radio off — and nothing else would tell us. js/env.js is the one
     deliberate exception: it goes network-first so a rotated anon key can
     never get pinned in a cache. */
  const OFFLINE_EXEMPT = ['/js/env.js'];
  const precached = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const referenced = [...new Set(
    [...html.matchAll(/(?:href|src)="(?!https?:|data:)([^"]+)"/g)]
      .map(m => '/' + m[1].replace(/^\//, '').split('?')[0]))];
  for (const ref of referenced) {
    if (OFFLINE_EXEMPT.includes(ref) || precached.includes(ref)) continue;
    errors.push(`index.html nạp "${ref}" nhưng sw.js không precache — app sẽ vỡ khi offline.`);
  }
}

/* ---------- report ---------- */
for (const w of warnings) console.warn('⚠ ' + w);
if (errors.length) {
  console.error('\n✖ ' + errors.length + ' vấn đề:\n');
  errors.forEach(e => console.error('  · ' + e));
  console.error('');
  process.exit(1);
}
console.log(`✓ Wiring OK — ${htmlIds.size} id, ${jsIds.size} tham chiếu DOM, ${called.size} handler inline, ${SCRIPTS.length} script parse sạch.`);
if (warnings.length) console.log(`  (${warnings.length} cảnh báo ở trên)`);
