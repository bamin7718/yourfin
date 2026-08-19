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
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
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
