#!/usr/bin/env node
/* ============================================================
   Headless smoke test.

   Boots public/index.html in jsdom against a fake Supabase client and drives
   the real UI: sign in, onboarding, add a transaction, transfer, budget,
   report, theme, sign out, and a realtime push from a second device. It
   asserts on rendered DOM, not on internals.

   Requires jsdom:  npm install jsdom --no-save
   Run:             node scripts/smoke.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

let passed = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failures.push(label + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- fake Supabase ---------------- */
function makeFakeSupabase(store) {
  const listeners = [];
  let session = null;
  const users = new Map();          // email -> {id, password}
  let realtimeHandler = null;

  const auth = {
    async signUp({ email, password }) {
      if (users.has(email)) return { data: {}, error: { message: 'User already registered' } };
      if (password.length < 6) return { data: {}, error: { message: 'Password should be at least 6 characters' } };
      const user = { id: 'uid-' + users.size + '-' + email.replace(/\W/g, ''), email };
      users.set(email, { ...user, password });
      session = { user, access_token: 'tok_' + user.id };
      listeners.forEach(fn => fn('SIGNED_IN', session));
      return { data: { session, user }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const rec = users.get(email);
      if (!rec || rec.password !== password) return { data: {}, error: { message: 'Invalid login credentials' } };
      session = { user: { id: rec.id, email }, access_token: 'tok_' + rec.id };
      listeners.forEach(fn => fn('SIGNED_IN', session));
      return { data: { session }, error: null };
    },
    async signOut() { session = null; listeners.forEach(fn => fn('SIGNED_OUT', null)); return { error: null }; },
    async getSession() { return { data: { session } }; },
    async resetPasswordForEmail() { return { error: null }; },
    async updateUser({ password }) {
      if (!session) return { data: {}, error: { message: 'Auth session missing!' } };
      if (password.length < 6) return { data: {}, error: { message: 'Password should be at least 6 characters' } };
      const rec = users.get(session.user.email);
      if (rec && rec.password === password) {
        return { data: {}, error: { message: 'New password should be different from the old password.' } };
      }
      if (rec) rec.password = password;
      return { data: { user: session.user }, error: null };
    },
    onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    __emit(event) { listeners.forEach(fn => fn(event, session)); }
  };

  const client = {
    auth,
    from() {
      const q = {
        _uid: null,
        select() { return q; },
        eq(_col, v) { q._uid = v; return q; },
        async maybeSingle() { return { data: store.get(q._uid) || null, error: null }; },
        async upsert(row) {
          store.set(row.user_id, { data: row.data, updated_at: row.updated_at, device_id: row.device_id });
          client.__pushCount++;
          return { error: null };
        }
      };
      return q;
    },
    channel() {
      const ch = {
        on(_evt, _filter, handler) { realtimeHandler = handler; return ch; },
        subscribe(cb) { if (cb) cb('SUBSCRIBED'); return ch; }
      };
      return ch;
    },
    removeChannel() {},
    __pushCount: 0,
    __emitRealtime(row) { if (realtimeHandler) realtimeHandler({ new: row }); }
  };
  return client;
}

/* ---------------- boot ---------------- */
async function boot(opts) {
  opts = opts || {};
  const store = new Map();
  const vc = new VirtualConsole();
  const consoleErrors = [];
  vc.on('jsdomError', e => consoleErrors.push('jsdomError: ' + (e.detail || e.message)));
  vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), {
    url: opts.url || 'https://finyourtin.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    resources: undefined            // block network; we inject scripts ourselves
  });
  const { window } = dom;

  // Minimal browser APIs jsdom lacks that the app touches.
  window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  window.HTMLCanvasElement.prototype.getContext = () => null;   // app guards for this
  window.scrollTo = () => {};
  window.fetch = async () => ({ ok: true, json: async () => ({}) });
  // jsdom has no Blob URL support; capture downloads instead of writing them.
  const downloads = [];
  window.URL.createObjectURL = blob => {
    const idx = downloads.push({ blob, text: null, bytes: null }) - 1;
    // Blob.text() UTF-8-decodes and therefore strips a leading BOM, so keep
    // the raw bytes too — the BOM is what makes Excel read Vietnamese right.
    blob.text().then(t => { downloads[idx].text = t; });
    blob.arrayBuffer().then(b => { downloads[idx].bytes = new Uint8Array(b); });
    return 'blob:mock/' + idx;
  };
  window.URL.revokeObjectURL = () => {};
  window.__downloads = downloads;
  if (!window.crypto || !window.crypto.subtle) {
    Object.defineProperty(window, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  }

  const fake = makeFakeSupabase(store);
  window.supabase = { createClient: () => fake };
  window.__ENV__ = opts.noConfig
    ? { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }
    : { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'x'.repeat(60),
        VERSION: require('../package.json').version };

  // Run the app's own scripts, in order, as real <script> elements. Injecting
  // them matters: top-level `let` in a classic script goes to the global
  // lexical environment, whereas window.eval() would scope it to the eval.
  for (const rel of ['js/sync.js', 'js/app.js']) {
    const el = window.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
    window.document.body.appendChild(el);
  }
  await sleep(60);
  return { window, store, fake, consoleErrors };
}

/* ---------------- drive it ---------------- */
(async () => {
  console.log('\nSoFin — smoke test\n');
  const { window, store, fake, consoleErrors } = await boot();
  const d = window.document;
  const $ = id => d.getElementById(id);
  const visible = id => $(id) && !$(id).classList.contains('hidden');
  // app.js declares `state` with `let`, so it is global-lexical, not a window
  // property. eval in page scope is the only way to read it from outside.
  const S = () => window.eval('state');
  const txt = id => ($(id) ? $(id).textContent.trim() : '');

  console.log('· boot');
  check('màn hình đăng nhập hiện ra', visible('view-login'));
  check('màn hình cấu hình bị ẩn', !visible('view-config'));
  check('không có lỗi console khi boot', consoleErrors.length === 0, consoleErrors[0]);

  console.log('\n· giao diện màn đăng nhập');
  {
    check('tên thương hiệu đầy đủ', txt('view-login').includes('SoFin Finance'));
    check('có slogan', d.querySelector('.auth-tagline').textContent.includes('an toàn'));
    check('thẻ đăng nhập dùng lớp auth-card', !!d.querySelector('.card.auth-card'));
    check('hai tab đăng nhập / tạo tài khoản', $('auth-segment').children.length === 2);

    const groups = [...d.querySelectorAll('#view-login .auth-input-group')];
    check('cả hai ô đều nằm trong nhóm có icon', groups.length === 2
      && groups.every(g => !!g.querySelector('.auth-input-icon .ic-svg') && !!g.querySelector('input')));
    check('icon là SVG thừa kế màu, không phải emoji',
      !/[✀-➿️\u{1F300}-\u{1FAFF}]/u.test(
        groups.map(g => g.querySelector('.auth-input-icon').textContent).join('')));

    /* Con mắt: đổi cả type lẫn nhãn cho trình đọc màn hình. */
    const pw = $('login-password'), eye = $('auth-pw-toggle');
    check('mật khẩu mặc định bị che', pw.type === 'password');
    check('nút con mắt là type=button, không submit form', eye.type === 'button');
    eye.click();
    check('bấm con mắt thì hiện mật khẩu', pw.type === 'text');
    check('nhãn trợ năng đổi theo', eye.getAttribute('aria-label') === 'Ẩn mật khẩu',
      eye.getAttribute('aria-label'));
    eye.click();
    check('bấm lại thì che lại', pw.type === 'password'
      && eye.getAttribute('aria-label') === 'Hiện mật khẩu');
    check('icon con mắt cũng đổi hình', !!eye.querySelector('svg'));

    /* Dòng bảo mật là cố định; phần đổi theo tab phải là #auth-hint. Trước đây
       setAuthMode() gán textContent thẳng vào khối này — làm vậy là xoá luôn
       icon bên trong ngay lần đổi tab đầu tiên. */
    const note = d.querySelector('.auth-security-note');
    check('có dòng bảo mật ở chân trang', !!note && /mã hoá|mã hóa/.test(note.textContent));
    check('dòng bảo mật có icon khiên', !!note.querySelector('.security-icon .ic-svg'));
    window.setAuthMode('register', $('auth-segment').children[1]);
    check('đổi tab thì đổi dòng gợi ý trong thẻ', txt('auth-hint').includes('tối thiểu 6 ký tự'));
    check('… và KHÔNG đụng vào dòng bảo mật', !!note.querySelector('.security-icon .ic-svg'));
    window.setAuthMode('login', $('auth-segment').children[0]);
    check('quay lại tab đăng nhập thì gợi ý trở lại', txt('auth-hint').includes('offline'));
    check('dòng bảo mật vẫn nguyên vẹn', !!note.querySelector('.security-icon .ic-svg'));

    const shell = fs.readFileSync(path.join(PUBLIC, 'css', 'shell.css'), 'utf8');
    check('dòng bảo mật không nền, không khung',
      /\.auth-security-note\{[^}]*background:\s*none[^}]*border:\s*0/.test(shell));
    check('ô nhập chừa chỗ cho icon mà không cần !important',
      /\.auth-input-group \.input\{ padding-left: 40px; \}/.test(shell)
      && !/auth-input-group[^}]*!important/.test(shell));
    /* Hex cứng ở đây nghĩa là dark mode vỡ ngay màn hình đầu tiên. */
    check('màu auth lấy từ biến theme',
      /\.auth-title\{[^}]*color: var\(--primary\)/.test(shell)
      && /\.auth-card\{[^}]*border: 1px solid var\(--border\)/.test(shell)
      && /\.auth-input-icon\{[^}]*color: var\(--muted\)/.test(shell));
  }

  console.log('\n· auth');
  $('login-email').value = 'not-an-email';
  $('login-password').value = 'x';
  await window.handleAuthSubmit(); await sleep(20);
  check('email sai bị chặn', /không hợp lệ/i.test(txt('auth-error')), txt('auth-error'));

  $('login-email').value = 'demo@finyourtin.test';
  $('login-password').value = '123';
  window.setAuthMode('register', $('auth-segment').children[1]);
  await window.handleAuthSubmit(); await sleep(20);
  check('mật khẩu ngắn bị chặn', /tối thiểu 6/i.test(txt('auth-error')), txt('auth-error'));

  $('login-password').value = 'secret123';
  await window.handleAuthSubmit(); await sleep(120);
  check('đăng ký xong thì rời màn đăng nhập', !visible('view-login'));
  check('tài khoản mới vào onboarding', visible('view-onboarding'));
  check('tên hiển thị lấy từ email', txt('user-display-name') === 'demo');

  console.log('\n· onboarding');
  window.obGoStep(2); await sleep(10);
  d.querySelectorAll('.ob-bal-input').forEach((inp, i) => { inp.value = String((i + 1) * 1000000); });
  window.obGoStep(3); await sleep(10);
  window.finishOnboarding(); await sleep(30);
  check('sang dashboard sau onboarding', visible('view-dashboard'));
  check('bottom nav hiện ra', visible('main-nav'));
  check('ví đã được tạo', S().wallets.length === 4, 'wallets=' + S().wallets.length);
  check('mọi ví gắn đúng userId', S().wallets.every(w => w.userId === S().currentUser));

  console.log('\n· loại ví');
  {
    const byName = n => S().wallets.find(w => w.name === n);
    check('preset "Ví điện tử" được gán đúng loại, không phải cash',
      byName('Ví điện tử') && byName('Ví điện tử').type === 'ewallet',
      byName('Ví điện tử') && byName('Ví điện tử').type);
    check('"Ngân hàng" vẫn là bank', byName('Ngân hàng').type === 'bank');
    check('"Tiết kiệm" vẫn là savings', byName('Tiết kiệm').type === 'savings');
    /* Nhãn phụ trên thẻ ví ở Tổng quan — chỗ người dùng nhìn thấy lỗi. */
    const cards = [...$('db-wallet-scroll').querySelectorAll('.wallet-card:not(.add)')];
    const ew = cards.find(c => c.querySelector('.wname').textContent === 'Ví điện tử');
    check('thẻ Tổng quan ghi "Ví điện tử" chứ không phải "Tiền mặt"',
      !!ew && ew.querySelector('.wsub').textContent.trim() === 'Ví điện tử',
      ew && ew.querySelector('.wsub').textContent);
    check('mọi thẻ đều có nhãn loại, không thẻ nào trống',
      cards.every(c => c.querySelector('.wsub').textContent.trim().length > 0));

    /* Màn hình Ví gom theo loại từ WALLET_TYPE_META, không từ danh sách chép tay:
       một loại thiếu trong vòng lặp là ví biến mất khỏi chính màn quản lý nó. */
    window.switchTab('wallets'); await sleep(20);
    const list = $('wallets-list').textContent;
    check('màn hình Ví có nhóm "Ví điện tử"', list.includes('Ví điện tử'));
    check('màn hình Ví hiện đủ 4 ví',
      $('wallets-list').querySelectorAll('.wallet-item, .cc-visual').length === 4,
      String($('wallets-list').querySelectorAll('.wallet-item, .cc-visual').length));
    check('modal ví có chip chọn Ví điện tử', !!$('mw-type-ewallet'));
    window.openWalletModal(byName('Ví điện tử').id); await sleep(20);
    check('sửa ví điện tử thì chip đó sáng', $('mw-type-ewallet').classList.contains('active'));
    window.closeModal('modal-wallet');

    /* Sửa dữ liệu cũ đúng một lần: ví tạo trước khi có loại này vẫn đang là cash. */
    const w = byName('Ví điện tử');
    w.type = 'cash'; delete S().app.walletTypeFixV1;
    window.migrateState();
    check('ví cũ tên "Ví điện tử" được sửa loại một lần', w.type === 'ewallet', w.type);
    w.type = 'cash';
    window.migrateState();
    check('nhưng không đè lại lựa chọn của người dùng ở lần sau', w.type === 'cash', w.type);
    w.type = 'ewallet';
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· sync');
  await sleep(950);                                  // clear the 800ms debounce
  check('đã đẩy snapshot lên cloud', fake.__pushCount > 0, 'pushes=' + fake.__pushCount);
  const row = store.get(S().currentUser);
  check('row cloud có dữ liệu ví', row && row.data.wallets.length === 4);
  check('currentUser không bị ghi lên cloud', row && row.data.currentUser === null);
  check('trạng thái đồng bộ là synced', window.Sync.status().phase === 'synced', window.Sync.status().phase);

  console.log('\n· transactions');
  const wid = S().wallets[0].id;
  const before = window.getWalletBalance(wid);
  S().transactions.push({
    id: 'tx_smoke', userId: S().currentUser, type: 'expense', amount: 250000,
    walletId: wid, categoryId: 'c_food', note: 'Cà phê', date: window.todayISO()
  });
  window.saveStorage();
  check('số dư ví giảm đúng', window.getWalletBalance(wid) === before - 250000);
  window.switchTab('transactions'); await sleep(20);
  check('giao dịch hiện trong danh sách', d.body.innerHTML.includes('Cà phê'));

  console.log('\n· dự kiến phải chi — tick ✓');
  {
    const uid0 = S().currentUser, today = window.todayISO();
    S().recurring.push({ id: 'r_ok', userId: uid0, name: 'Tiền nhà', type: 'expense', amount: 4000000,
      walletId: wid, categoryId: 'c_bill', subcategoryId: 's_rent', frequency: 'monthly',
      interval: 1, dueDate: today, endDate: '', autoProcess: false });
    S().debts.push({ id: 'd_ok', userId: uid0, kind: 'borrow', party: 'Anh Hùng', amount: 2000000,
      walletId: wid, date: today, dueDate: today, note: '', payments: [] });
    window.saveStorage();
    window.switchTab('dashboard'); await sleep(20);
    const upRows = () => d.querySelectorAll('#upcoming-list .upcoming-row').length;
    check('cả 2 khoản đến hạn đều hiện ra', upRows() === 2, 'rows=' + upRows());

    // định kỳ: ✓ tạo giao dịch vào ví hiển thị trên sheet
    let bal0 = window.getWalletBalance(wid), tx0 = S().transactions.length;
    window.payRecurring('r_ok'); await sleep(20);
    check('✓ định kỳ mở sheet xác nhận', visible('modal-sheet') && !!$('pr-wallet') && !!$('pr-date'));
    check('ví mặc định là ví của khoản định kỳ', $('pr-wallet').value === wid);
    check('ngày mặc định là ngày đến hạn', $('pr-date').value === today);
    // đổi cả ngày lẫn ví: ghi vào ví thứ 2, lùi 3 ngày (trả muộn/trả sớm)
    const wid2 = S().wallets[1].id, backdate = window.addDaysISO(today, -3);
    const bal2 = window.getWalletBalance(wid2);
    $('pr-date').value = backdate;
    $('pr-wallet').value = wid2;
    window.confirmPayRecurring('r_ok'); await sleep(30);
    const rtx = S().transactions.slice(-1)[0];
    check('tạo đúng 1 giao dịch', S().transactions.length === tx0 + 1);
    check('giao dịch mang ngày đã chọn', rtx.date === backdate, rtx.date);
    check('giao dịch vào ví đã chọn', rtx.walletId === wid2);
    check('trừ đúng ví đã chọn', window.getWalletBalance(wid2) === bal2 - 4000000);
    check('ví gốc không bị đụng vào', window.getWalletBalance(wid) === bal0);
    check('giao dịch gắn với lịch định kỳ', rtx.recurringId === 'r_ok');
    check('lịch nhớ ví mới', S().recurring.find(r => r.id === 'r_ok').walletId === wid2);
    check('kỳ kế tiếp neo theo ngày đến hạn, không theo ngày trả',
      S().recurring.find(r => r.id === 'r_ok').dueDate === window.addMonthsISO(today, 1),
      S().recurring.find(r => r.id === 'r_ok').dueDate);
    check('dashboard cập nhật ngay', upRows() === 1, 'rows=' + upRows());

    // nợ: ✓ mở modal, lưu xong dashboard phải tự cập nhật (không cần đổi tab)
    bal0 = window.getWalletBalance(wid); tx0 = S().transactions.length;
    window.openDebtPayModal('d_ok'); await sleep(20);
    window.saveDebtPayment(); await sleep(30);
    check('trả nợ tạo giao dịch chi', S().transactions.length === tx0 + 1
      && S().transactions.slice(-1)[0].type === 'expense');
    check('trả nợ trừ đúng ví', window.getWalletBalance(wid) === bal0 - 2000000);
    check('dashboard cập nhật ngay sau khi trả nợ', upRows() === 0, 'rows=' + upRows());

    // ví đã bị xoá: ✓ vẫn phải ghi nhận được, và sửa luôn lịch
    S().recurring.push({ id: 'r_orphan', userId: uid0, name: 'Netflix', type: 'expense', amount: 260000,
      walletId: 'w_da_bi_xoa', categoryId: 'c_fun', subcategoryId: 's_movie', frequency: 'monthly',
      interval: 1, dueDate: today, endDate: '', autoProcess: true });
    window.saveStorage(); window.switchTab('dashboard'); await sleep(20);
    check('khoản mất ví vẫn hiện, có cảnh báo', d.getElementById('upcoming-list').innerHTML.includes('Ví đã xóa'));
    bal0 = window.getWalletBalance(wid);
    window.payRecurring('r_orphan'); await sleep(20);
    check('sheet báo ví cũ đã bị xóa', $('sheet-body').innerHTML.includes('đã bị xóa'));
    check('chọn sẵn một ví có thật', !!window.getWallet($('pr-wallet').value));
    $('pr-wallet').value = wid;
    window.confirmPayRecurring('r_orphan'); await sleep(30);
    check('ghi nhận được vào ví đã chọn', window.getWalletBalance(wid) === bal0 - 260000);
    check('lịch được sửa về ví hợp lệ', S().recurring.find(r => r.id === 'r_orphan').walletId === wid);

    // autoProcess không được ghi vào ví không tồn tại
    S().recurring.push({ id: 'r_auto_orphan', userId: uid0, name: 'Spotify', type: 'expense', amount: 59000,
      walletId: 'w_cung_da_xoa', categoryId: 'c_fun', subcategoryId: 's_movie', frequency: 'monthly',
      interval: 1, dueDate: today, endDate: '', autoProcess: true });
    tx0 = S().transactions.length;
    window.autoProcessRecurring(); await sleep(20);
    check('autoProcess bỏ qua ví đã xoá', S().transactions.length === tx0);
    check('không có giao dịch nào trỏ vào ví không tồn tại',
      S().transactions.filter(t => t.walletId && !window.getWallet(t.walletId)).length === 0);
    S().recurring = S().recurring.filter(r => r.id !== 'r_auto_orphan');
    window.saveStorage();
  }

  console.log('\n· điều hướng ví → tab giao dịch');
  {
    const w0 = S().wallets[0], w1 = S().wallets[1];
    S().transactions.push({ id: 'tx_w1', userId: S().currentUser, type: 'expense', amount: 90000,
      walletId: w1.id, categoryId: 'c_food', note: 'Bún bò', date: window.todayISO() });
    window.saveStorage();

    window.switchTab('dashboard'); await sleep(20);
    const cards = d.querySelectorAll('#db-wallet-scroll .wallet-card:not(.add)');
    check('thẻ ví trên tổng quan trỏ sang giao dịch',
      (cards[0].getAttribute('onclick') || '').startsWith('jumpToWallet('),
      cards[0].getAttribute('onclick'));

    // bẩn hoá bộ lọc trước, để chắc chắn cú nhảy dọn sạch phần còn lại
    window.setTxFilter('type', 'income', d.querySelector('#tx-filter-type .chip[data-val="income"]'));
    $('tx-search').value = 'không-khớp-gì-cả';
    window.jumpToWallet(w1.id); await sleep(30);
    check('nhảy sang tab giao dịch', window.eval('currentTab') === 'transactions' && visible('view-transactions'));
    check('select ví hiện đúng ví vừa chọn', $('tx-filter-wallet').value === w1.id);
    check('select ví nằm ngoài panel lọc ẩn', !$('tx-filter-wallet').closest('#tx-advanced-filters'));
    check('thanh lọc ví được đánh dấu đang bật', $('tx-wallet-bar').classList.contains('on'));
    check('các bộ lọc khác được dọn', window.eval('JSON.stringify(txFilters)')
      === JSON.stringify({ type: 'all', walletId: w1.id, catId: 'all', eventId: 'all', range: 'all', status: 'all' }),
      window.eval('JSON.stringify(txFilters)'));
    check('ô tìm kiếm được xoá', $('tx-search').value === '');
    check('chip "Tất cả" sáng lại', d.querySelector('#tx-filter-type .chip[data-val="all"]').classList.contains('active'));
    // 'Cà phê' cũng là tên danh mục con nên phải soi đúng khung danh sách
    const listHtml = () => $('tx-list-container').innerHTML;
    check('danh sách chỉ còn giao dịch của ví đó',
      listHtml().includes('Bún bò') && !listHtml().includes('Cà phê'));

    // đổi ví bằng chính select ngoài giao diện
    $('tx-filter-wallet').value = w0.id;
    window.renderTransactionsList(); await sleep(20);
    check('đổi ví bằng select cập nhật danh sách',
      listHtml().includes('Cà phê') && !listHtml().includes('Bún bò'));
    check('txFilters theo kịp select', window.eval('txFilters.walletId') === w0.id);

    // ví đang lọc bị xoá → không được để danh sách trống câm lặng
    const ghost = { id: 'w_ghost', userId: S().currentUser, name: 'Ví tạm', icon: '👛',
      type: 'cash', currency: 'VND', startingBalance: 0 };
    S().wallets.push(ghost); window.saveStorage();
    window.jumpToWallet('w_ghost'); await sleep(20);
    S().wallets = S().wallets.filter(w => w.id !== 'w_ghost');
    window.renderTransactionsList(true); await sleep(20);
    check('ví đã xoá thì bộ lọc tự về "tất cả"', window.eval('txFilters.walletId') === 'all');
    check('danh sách hiện lại đầy đủ', listHtml().includes('Cà phê') && listHtml().includes('Bún bò'));

    window.resetTxFilters(); await sleep(20);
  }

  console.log('\n· điều hướng danh mục → tab giao dịch');
  {
    window.switchTab('dashboard'); await sleep(20);
    const rows = [...$('db-cat-mini').querySelectorAll('.category-item')];
    check('hàng danh mục ở Tổng quan bấm được', rows.length > 0, 'rows=' + rows.length);
    check('mỗi hàng mang data-cat-id', rows.every(r => !!r.dataset.catId), rows[0] && rows[0].dataset.catId);
    check('hàng danh mục có ripple như mọi nút khác',
      rows.every(r => r.classList.contains('ripple-host')));

    /* Con số trên hàng là chi tiêu THÁNG NÀY đã chốt. Cú nhảy phải mang theo
       đúng phạm vi đó, không thì màn Giao dịch trả về một tổng khác hẳn. */
    const row = rows[0];
    const catId = row.dataset.catId;
    const shown = row.querySelector('.tabular').textContent.trim();
    row.dispatchEvent(new window.Event('click', { bubbles: true }));
    await sleep(30);
    check('nhảy sang tab giao dịch', window.eval('currentTab') === 'transactions' && visible('view-transactions'));
    check('select danh mục hiện đúng danh mục vừa bấm', $('tx-filter-cat').value === catId,
      $('tx-filter-cat').value);
    check('panel lọc nâng cao mở ra để thấy bộ lọc đang bật',
      !$('tx-advanced-filters').classList.contains('hidden'));
    check('mang theo phạm vi tháng này, khoản chi, đã chốt',
      window.eval('JSON.stringify(txFilters)') === JSON.stringify(
        { type: 'expense', walletId: 'all', catId, eventId: 'all', range: 'thismonth', status: 'completed' }),
      window.eval('JSON.stringify(txFilters)'));
    check('chip "Tháng này" sáng',
      d.querySelector('#tx-filter-range .chip[data-val="thismonth"]').classList.contains('active'));
    /* Tổng Chi trên màn Giao dịch phải khớp con số vừa bấm — đây mới là điều
       người dùng kiểm chứng được bằng mắt. */
    check('tổng Chi khớp đúng con số trên thẻ danh mục',
      $('tx-summary').children[1].textContent.includes(shown), shown + ' ≠ ' + $('tx-summary').children[1].textContent);

    /* Danh mục đã bị xoá: renderTransactionsList() sẽ hạ bộ lọc về "all", nên
       một hàng bấm được lúc đó là lời hứa sai — nó phải trơ. */
    S().transactions.push({ id: 'tx_ghostcat', userId: S().currentUser, type: 'expense',
      amount: 12000000, walletId: S().wallets[0].id, categoryId: 'c_deleted',
      note: 'Danh mục đã xoá', date: window.todayISO() });
    window.saveStorage();
    window.switchTab('dashboard'); await sleep(20);
    const ghostRow = [...$('db-cat-mini').querySelectorAll('.row-c')]
      .find(r => r.textContent.includes('Khác'));
    check('hàng của danh mục đã xoá vẫn hiện số', !!ghostRow);
    check('nhưng không bấm được', !!ghostRow && !ghostRow.classList.contains('category-item'));
    S().transactions = S().transactions.filter(t => t.id !== 'tx_ghostcat');
    window.saveStorage();
    window.resetTxFilters(); await sleep(20);
  }

  console.log('\n· ô nhập tiền: phân cách nghìn + nút 000');
  {
    const type = (id, v) => {
      const el = $(id);
      el.value = v;
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
      return el.value;
    };
    const press000 = id => {
      $(id).parentNode.querySelector('.btn-000').click();
      return $(id).value;
    };

    check('format thuần: 1000000 → 1.000.000', window.formatMoneyText('1000000') === '1.000.000',
      window.formatMoneyText('1000000'));
    check('format giữ phần thập phân', window.formatMoneyText('1234,56') === '1.234,56',
      window.formatMoneyText('1234,56'));
    check('format bỏ số 0 thừa ở đầu', window.formatMoneyText('007') === '7');
    check('parseAmount đảo ngược được', window.parseAmount('1.234.567') === 1234567);

    /* Quét toàn bộ tài liệu thay vì điểm danh từng modal: mọi modal đều nằm
       sẵn trong index.html, nên một ô tiền thêm sau này mà quên gì đó sẽ lộ ra
       ở đây chứ không đợi người dùng gặp. */
    {
      const all = [...d.querySelectorAll('input.money')];
      check('app có đủ các ô tiền để quét', all.length >= 12, 'money inputs=' + all.length);
      const orphan = all.filter(i => !i.parentNode.classList.contains('money-field')
        || !i.parentNode.querySelector('.btn-000'));
      check('KHÔNG ô tiền nào thiếu nút 000', orphan.length === 0,
        orphan.map(i => '#' + i.id).join(', '));
      check('mọi ô tiền là type=text (number từ chối hiện dấu phân cách)',
        all.every(i => i.getAttribute('type') === 'text'),
        all.filter(i => i.getAttribute('type') !== 'text').map(i => '#' + i.id).join(', '));
      check('mọi ô tiền bật bàn phím số', all.every(i => i.getAttribute('inputmode') === 'decimal'),
        all.filter(i => i.getAttribute('inputmode') !== 'decimal').map(i => '#' + i.id).join(', '));
      check('mỗi ô tiền đúng một nút, không nhân đôi khi render lại',
        [...d.querySelectorAll('.btn-000')].length === all.length,
        d.querySelectorAll('.btn-000').length + ' nút / ' + all.length + ' ô');
      /* gọi lại lần nữa: hàm này chạy mỗi khi có panel render động */
      window.attachMoneyButtons();
      check('gọi attachMoneyButtons() lần hai vẫn không nhân đôi nút',
        [...d.querySelectorAll('.btn-000')].length === all.length,
        String(d.querySelectorAll('.btn-000').length));
      check('nút nằm lọt trong ô: input chừa chỗ bên phải',
        /\.money-field>input\.money\{[^}]*padding-right:\d+px/.test(
          fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8')));

      /* Lề phải nằm trên khung bao. Nút canh giữa theo khung (top:50%), nên một
         mt12 còn sót trên input làm khung cao hơn ô và đẩy nút lệch khỏi tâm. */
      check('lề của ô tiền được dời sang khung bao',
        all.every(i => ![...i.classList].some(c => /^m[tb](4|8|12|16)$/.test(c))),
        all.filter(i => [...i.classList].some(c => /^m[tb]\d/.test(c))).map(i => '#' + i.id).join(', '));
      check('khung bao giữ lại đúng lề đó',
        !!$('tx-amount-raw').parentNode.classList.contains('mt12'),
        $('tx-amount-raw').parentNode.className);

      /* Cascade thật, không phải đọc chuỗi CSS. Nút mang cả .ripple-host, mà
         `.ripple-host{position:relative}` nằm SAU `.btn-000` và cùng độ ưu
         tiên — nên nó từng thắng, nút rơi về relative, thành flex item đứng
         sau input và bị đẩy hẳn ra ngoài khung nhập. */
      {
        const css = fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8');
        const probe = new JSDOM(`<!doctype html><style>${css}</style>` +
          `<div class="money-field"><input id="p1" class="input money"><button class="btn-000 ripple-host">000</button></div>` +
          `<div class="money-field"><input id="p2" class="input money money-lg"><button class="btn-000 ripple-host">000</button></div>`);
        const pw = probe.window;
        const cs = sel => pw.getComputedStyle(pw.document.querySelector(sel));
        check('khung bao là mốc định vị', cs('.money-field').position === 'relative');
        check('nút 000 THỰC SỰ absolute sau khi cascade xong — không bị .ripple-host kéo về relative',
          cs('.btn-000').position === 'absolute', cs('.btn-000').position);
        check('ripple vẫn bị cắt gọn trong nút', cs('.btn-000').overflow === 'hidden');
        /* Nút rộng ~44px + 8px lề: dưới 56px là chữ chạm mép nút. */
        check('ô thường chừa đủ chỗ bên phải cho nút',
          parseInt(cs('#p1').paddingRight, 10) >= 56, cs('#p1').paddingRight);
        /* Ô căn giữa: lệch một bên là con số nhìn không còn ở giữa thẻ. */
        check('ô căn giữa đệm cân hai bên',
          cs('#p2').paddingLeft === cs('#p2').paddingRight,
          cs('#p2').paddingLeft + ' / ' + cs('#p2').paddingRight);
        pw.close();
      }
    }

    window.switchTab('add'); await sleep(20);
    check('ô số tiền có nút 000', !!$('tx-amount-raw').parentNode.querySelector('.btn-000'));
    check('nút 000 không submit form', $('tx-amount-raw').parentNode.querySelector('.btn-000').type === 'button');

    check('gõ số thì tự chèn dấu chấm', type('tx-amount-raw', '50000') === '50.000');
    check('display lớn cũng cập nhật theo', txt('tx-amount-display').includes('50.000'));

    type('tx-amount-raw', '50');
    check('bấm 000 lần 1: 50 → 50.000', press000('tx-amount-raw') === '50.000');
    check('bấm 000 lần 2: → 50.000.000', press000('tx-amount-raw') === '50.000.000');
    check('state theo kịp nút 000', window.eval('txAmount') === 50000000, window.eval('txAmount'));

    type('tx-amount-raw', '50,5');
    check('000 nhân đúng cả số thập phân: 50,5 → 50.500', press000('tx-amount-raw') === '50.500');

    type('tx-amount-raw', '');
    check('000 khi ô trống thì không làm gì', press000('tx-amount-raw') === '');

    window.clearAmount();
    check('xoá số tiền thì ô trống lại', $('tx-amount-raw').value === '' && window.eval('txAmount') === 0);

    // lưu xuống state phải là number sạch
    const tx0 = S().transactions.length;
    type('tx-amount-raw', '1250000');
    $('tx-note').value = 'Kiểm tra format';
    $('tx-date').value = window.todayISO();
    window.saveTransaction(); await sleep(30);
    const saved = S().transactions.find(t => t.note === 'Kiểm tra format');
    check('lưu được giao dịch từ ô đã format', S().transactions.length === tx0 + 1);
    check('state giữ number sạch, không có dấu chấm',
      !!saved && saved.amount === 1250000 && typeof saved.amount === 'number', saved && saved.amount);
    check('localStorage cũng là number', (() => {
      const raw = JSON.parse(window.localStorage.getItem('FINYOURTIN_STATE_V4::' + S().currentUser));
      const t = raw.transactions.find(x => x.note === 'Kiểm tra format');
      return t && t.amount === 1250000;
    })());

    // sửa giao dịch cũ → ô input phải hiện lại có phân cách
    window.startEditTx(saved.id); await sleep(30);
    check('sửa giao dịch cũ thì ô tiền được format lại', $('tx-amount-raw').value === '1.250.000',
      $('tx-amount-raw').value);
    window.clearAmount();
    window.eval('editingTxId = null');

    // các modal khác cũng phải có
    window.switchTab('wallets'); await sleep(20);
    window.openWalletModal(); await sleep(20);
    check('modal Tạo ví: số dư đầu kỳ có 000', !!$('mw-starting-balance').parentNode.querySelector('.btn-000'));
    check('modal Tạo ví: số dư đầu kỳ format khi gõ', type('mw-starting-balance', '2500000') === '2.500.000');
    check('ô "ngày chốt sao kê" KHÔNG bị gắn 000',
      !$('mw-statement-date').parentNode.querySelector('.btn-000'));
    window.closeModal('modal-wallet');

    for (const [id, opener, closer] of [
      ['mb-limit', () => window.openBudgetModal(), 'modal-budget'],
      ['md-amount', () => window.openDebtModal(), 'modal-debt'],
      ['mr-amount', () => window.openRecurringModal(), 'modal-recurring'],
      ['me-budget', () => window.openEventModal(), 'modal-event']
    ]) {
      opener(); await sleep(15);
      check('ô ' + id + ' có nút 000 và format được',
        !!$(id).parentNode.querySelector('.btn-000') && type(id, '750000') === '750.000');
      window.closeModal(closer);
    }
  }

  console.log('\n· màn nhập số tiền (bàn phím riêng)');
  {
    /* Bàn phím này là đường nhập chính, ô <input class="money"> chỉ còn giữ
       giá trị phía sau. Nên phải kiểm cả hai đầu: gõ đúng, và số chốt được
       ghi ngược vào ô cũ để saveTransaction() đọc như trước. */
    const key = label => {
      const b = [...d.querySelectorAll('#amount-sheet .tcb-keypad-wrapper button')]
        .find(x => x.textContent.trim() === label);
      if (!b) throw new Error('bàn phím không có phím "' + label + '"');
      b.click();
    };
    const hero = () => txt('amt-val');
    const quick = () => [...d.querySelectorAll('#amt-quick .tcb-quick-item')].map(x => x.textContent.trim());

    window.switchTab('add'); await sleep(20);
    window.setTxType('expense');
    const w0 = S().wallets[0];
    window.selectTxWallet(w0.id);
    window.selectTxCategory('c_food');
    window.clearAmount();

    check('ô tiền cũ nằm trong khung bị ẩn', !!$('tx-amount-raw').closest('.amount-raw'));
    check('CSS thật sự ẩn khung đó',
      /\.amount-raw\{[^}]*display:none/.test(fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8')));

    window.openAmountSheet('tx'); await sleep(20);
    check('chạm thẻ số tiền mở được bàn phím', visible('amount-sheet'));
    check('nhắc rõ đang nhập cho giao dịch nào', txt('amt-hello').length > 0);
    check('hiện danh mục đích', txt('amt-target').includes('Ăn uống'), txt('amt-target'));
    check('hiện ví nguồn', txt('amt-from').includes(w0.name), txt('amt-from'));
    check('hiện số dư khả dụng của ví đó',
      txt('amt-from').includes(window.fmtW(window.getWalletBalance(w0.id), w0)), txt('amt-from'));
    check('mở ra là 0', hero() === '0');
    check('nút Tiếp tục mờ khi chưa có số', $('amt-next').classList.contains('is-off'));
    check('gợi ý mặc định là ba mệnh giá quen thuộc',
      quick().join('|') === '50.000|100.000|500.000', quick().join('|'));

    key('1'); key('2');
    check('gõ 1 rồi 2 ra 12', hero() === '12', hero());
    check('gợi ý biến thiên theo số đang gõ',
      quick().join('|') === '12.000|120.000|1.200.000', quick().join('|'));
    check('nút Tiếp tục sáng lên', !$('amt-next').classList.contains('is-off'));

    d.querySelectorAll('#amt-quick .tcb-quick-item')[1].click();
    check('bấm gợi ý thì điền thẳng số đó', hero() === '120.000', hero());

    key('000');
    check('phím 000 nối thêm ba số 0', hero() === '120.000.000', hero());
    key('⌫');
    check('phím ⌫ xoá một chữ số', hero() === '12.000.000', hero());

    check('chưa bấm Tiếp tục thì số cũ còn nguyên', window.eval('txAmount') === 0);
    $('amt-next').click(); await sleep(20);
    check('Tiếp tục chốt số vào state', window.eval('txAmount') === 12000000, window.eval('txAmount'));
    check('và ghi ngược vào ô tiền có phân cách', $('tx-amount-raw').value === '12.000.000',
      $('tx-amount-raw').value);
    check('chốt xong thì đóng bàn phím', !visible('amount-sheet'));
    check('con số to trên thẻ cũng theo kịp', txt('tx-amount-display').includes('12.000.000'));

    /* Thoát giữa chừng KHÔNG được đụng vào số cũ — buffer là bản nháp. */
    window.openAmountSheet('tx'); await sleep(10);
    check('mở lại thì thấy đúng số đang có', hero() === '12.000.000', hero());
    key('⌫'); key('⌫');
    window.closeAmountSheet();
    check('bấm ‹ thoát thì số cũ giữ nguyên', window.eval('txAmount') === 12000000);

    /* Phần thập phân: dấu phẩy kiểu vi-VN, tối đa 2 chữ số. */
    window.clearAmount();
    window.openAmountSheet('tx'); await sleep(10);
    key('5'); key(','); key(','); key('2'); key('5'); key('9');
    check('chỉ một dấu phẩy và tối đa 2 số lẻ', hero() === '5,25', hero());

    $('amt-next').click(); await sleep(10);
    check('số lẻ chốt đúng', window.eval('txAmount') === 5.25, window.eval('txAmount'));

    window.clearAmount();
    window.openAmountSheet('tx'); await sleep(10);
    $('amt-next').click(); await sleep(10);
    check('Tiếp tục khi chưa nhập gì thì không đóng', visible('amount-sheet'));
    window.switchTab('dashboard'); await sleep(20);
    check('đổi màn hình thì bàn phím tự đóng', !visible('amount-sheet'));

    /* Form chuyển ví mượn cùng bàn phím đó. */
    window.switchTab('add'); await sleep(20);
    window.setTxType('transfer'); await sleep(20);
    window.openAmountSheet('tf'); await sleep(10);
    check('bàn phím phục vụ cả form chuyển ví', visible('amount-sheet'));
    check('ví nguồn là ví "Từ" của lần chuyển',
      txt('amt-from').includes(window.getWallet($('tf-from-wallet').value).name));
    key('7'); key('5'); key('000');
    $('amt-next').click(); await sleep(10);
    check('chốt được số tiền chuyển', window.eval('tfAmount') === 75000, window.eval('tfAmount'));
    check('ô tf-amount-raw cũng được điền', $('tf-amount-raw').value === '75.000', $('tf-amount-raw').value);
    window.setTxType('expense');
    window.clearAmount();
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· giao dịch tương lai = "dự kiến"');
  {
    const today = window.todayISO();
    const future = window.addDaysISO(today, 5);
    const w = S().wallets[0].id;
    const balBefore = window.getWalletBalance(w);
    const assetsBefore = window.getUserTotalAssets();

    // nhập một khoản chi ở ngày tương lai qua chính form Thêm giao dịch
    window.switchTab('add'); await sleep(20);
    window.setTxType('expense');
    window.selectTxWallet(w);
    window.selectTxCategory('c_food');
    $('tx-amount-raw').value = '900000';
    $('tx-amount-raw').dispatchEvent(new window.Event('input', { bubbles: true }));
    $('tx-note').value = 'Vé máy bay';
    $('tx-date').value = future;
    window.saveTransaction(); await sleep(30);

    const ptx = S().transactions.find(t => t.note === 'Vé máy bay');
    check('giao dịch tương lai có status pending', !!ptx && ptx.status === 'pending', ptx && ptx.status);
    check('KHÔNG trừ vào số dư ví', window.getWalletBalance(w) === balBefore, window.getWalletBalance(w) - balBefore);
    check('KHÔNG trừ vào tổng tài sản ròng', window.getUserTotalAssets() === assetsBefore);

    // báo cáo: mặc định bỏ qua, bật "gồm dự kiến" thì tính
    window.switchTab('reports'); await sleep(30);
    const repExpense = () => window.parseAmount(txt('rep-expense'));
    const withoutPending = repExpense();
    window.toggleReportPending(); await sleep(30);
    check('báo cáo mặc định bỏ qua khoản dự kiến',
      repExpense() === withoutPending + 900000, withoutPending + ' → ' + repExpense());
    check('chip "Gồm dự kiến" sáng khi bật', $('report-pending-chip').classList.contains('active'));
    window.toggleReportPending(); await sleep(30);
    check('tắt lại thì báo cáo trở về số thực tế', repExpense() === withoutPending);

    // ngân sách cũng chỉ tính tiền đã chi thật
    const bSpent = window.getBudgetSpent({
      userId: S().currentUser, categoryId: 'c_food', period: 'monthly',
      periodKey: window.currentPeriodKey('monthly'), limit: 9e9, walletId: 'all', repeat: true });
    check('ngân sách không tính khoản dự kiến', bSpent < 900000 || !String(bSpent).includes('900000'));

    // dashboard: khối "Sắp đến hạn"
    window.switchTab('dashboard'); await sleep(30);
    const upList = () => $('upcoming-list').innerHTML;
    check('hiện trong "Sắp đến hạn"', upList().includes('Vé máy bay'));
    check('cộng vào widget "Dự kiến phải chi"', window.parseAmount(txt('upcoming-total')) >= 900000,
      txt('upcoming-total'));

    // các tab thời gian
    window.setUpcomingFilter('nextweek', d.querySelector('#upcoming-filter .chip[data-val="nextweek"]'));
    await sleep(20);
    check('tab "7 ngày tới" có khoản cách đây 5 ngày', upList().includes('Vé máy bay'));
    // giữa tháng sau — cố định trong khoảng "Tháng tới" mọi ngày trong năm.
    // "+40 ngày" từng dùng ở đây là bẫy: chạy vào cuối tháng là rơi qua tháng kế nữa.
    const nxt = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 15);
    const far = window.isoOf(nxt);
    S().transactions.push({ id: 'tx_far', userId: S().currentUser, type: 'expense', amount: 300000,
      walletId: w, categoryId: 'c_fun', note: 'Concert', date: far, status: 'pending' });
    window.saveStorage();
    window.setUpcomingFilter('nextweek', d.querySelector('#upcoming-filter .chip[data-val="nextweek"]'));
    await sleep(20);
    check('tab "7 ngày tới" bỏ khoản 40 ngày nữa', !upList().includes('Concert'));
    window.setUpcomingFilter('nextmonth', d.querySelector('#upcoming-filter .chip[data-val="nextmonth"]'));
    await sleep(20);
    check('tab "Tháng tới" có khoản 40 ngày nữa', upList().includes('Concert'));
    window.setUpcomingFilter('thismonth', d.querySelector('#upcoming-filter .chip[data-val="thismonth"]'));
    await sleep(20);

    // danh sách giao dịch: vẫn thấy, có nhãn, lọc được
    window.switchTab('transactions'); await sleep(20);
    check('vẫn nằm trong sổ giao dịch', $('tx-list-container').innerHTML.includes('Vé máy bay'));
    check('có nhãn "Dự kiến"', $('tx-list-container').innerHTML.includes('Dự kiến'));
    $('tx-filter-status').value = 'completed';
    window.renderTransactionsList(); await sleep(20);
    check('lọc "Đã ghi nhận" ẩn khoản dự kiến', !$('tx-list-container').innerHTML.includes('Vé máy bay'));
    $('tx-filter-status').value = 'pending';
    window.renderTransactionsList(); await sleep(20);
    check('lọc "Dự kiến" chỉ còn khoản dự kiến', $('tx-list-container').innerHTML.includes('Vé máy bay')
      && !$('tx-list-container').innerHTML.includes('Cà phê'));
    window.resetTxFilters(); await sleep(20);
    check('bộ lọc trạng thái nằm ngoài panel lọc ẩn',
      !$('tx-filter-status').closest('#tx-advanced-filters'));

    // "Xem tất cả ›" ở khối Sắp đến hạn
    window.switchTab('dashboard'); await sleep(20);
    /* "Tháng tới" chứ không phải "Trong tháng": mốc +5 ngày rơi sang tháng sau
       nếu hôm nay gần cuối tháng, và test thì không được phụ thuộc ngày chạy. */
    window.setUpcomingFilter('nextmonth', d.querySelector('#upcoming-filter .chip[data-val="nextmonth"]'));
    await sleep(20);
    window.viewAllUpcoming(); await sleep(30);
    check('Xem tất cả → sang tab Giao dịch', window.eval('currentTab') === 'transactions');
    check('lọc trạng thái nhảy sang "Dự kiến"', $('tx-filter-status').value === 'pending');
    check('mang theo đúng hạn cuối của khối Sắp đến hạn',
      $('tx-to').value === window.getUpcomingRange(), $('tx-to').value);
    /* Cận dưới phải để trống. Kẹp từ hôm nay thì mọi giao dịch đã ghi nhận
       (luôn ≤ hôm nay) biến mất, và ô Trạng thái đổi sang "Đã ghi nhận" hay
       "Tất cả" vẫn ra đúng danh sách cũ — nhìn như bộ lọc không hoạt động. */
    check('không kẹp cận dưới, để ô Trạng thái còn đổi được', $('tx-from').value === '',
      $('tx-from').value);
    check('mở sẵn khối ngày tùy chọn để thấy phạm vi', visible('tx-custom-range'));
    check('thanh lọc trạng thái được đánh dấu đang bật', $('tx-status-bar').classList.contains('on'));
    {
      const rows = [...d.querySelectorAll('#tx-list-container .tx-row')];
      check('danh sách chỉ còn khoản dự kiến', rows.length > 0 && rows.every(r => r.classList.contains('tx-pending')),
        rows.length + ' hàng');
      check('có cả khoản của tháng sau', $('tx-list-container').innerHTML.includes('Concert'));
    }
    /* Lịch định kỳ / thẻ / nợ đến hạn KHÔNG phải giao dịch — chúng chỉ thành
       giao dịch khi bấm ✓. Lọc "Dự kiến" phải dựng chúng thành dòng ảo, không
       thì màn Giao dịch hiện ít hơn hẳn thẻ "Sắp đến hạn" mà không ai hiểu vì
       sao. Chúng chỉ được sống trong danh sách hiển thị. */
    {
      const due = window.addDaysISO(today, 4);
      S().recurring.push({ id: 'r_virt', userId: S().currentUser, type: 'expense', name: 'Tiền mạng',
        amount: 330000, walletId: w, categoryId: 'c_bill', frequency: 'monthly', interval: 1,
        dueDate: due, autoProcess: false });
      window.saveStorage();
      window.viewAllUpcoming(); await sleep(40);

      const rowOf = name => [...d.querySelectorAll('#tx-list-container .tx-row')]
        .find(r => r.textContent.includes(name));
      const vRow = rowOf('Tiền mạng');
      check('lịch định kỳ hiện ra trong danh sách Dự kiến', !!vRow);
      check('dòng ảo được đánh dấu để phân biệt', !!vRow && vRow.classList.contains('tx-virtual')
        && !!vRow.querySelector('.tag-virtual'), vRow && vRow.className);
      check('dòng ảo có nút ✓', !!vRow && !!vRow.querySelector('.btn-pay'));
      check('giao dịch dự kiến thật cũng có nút ✓',
        !!rowOf('Vé máy bay') && !!rowOf('Vé máy bay').querySelector('.btn-pay'));
      check('dòng ảo KHÔNG lọt vào sổ', !S().transactions.some(t => t.id && t.id.startsWith('v_')));
      check('… và không đụng vào số dư ví', window.getWalletBalance(w) === balBefore);

      /* Không đếm trùng: xác nhận một kỳ thì kỳ đó thành giao dịch thật và
         dueDate nhảy sang kỳ sau, nên tổng phải giữ nguyên. */
      const chiTruoc = window.parseAmount(txt('tx-summary').split('Chi')[1]);
      /* Qua đúng nút ✓ chứ không gọi thẳng confirmPayRecurring(): sheet xác
         nhận là nơi #pr-date được dựng lại, gọi tắt thì hàm đọc phải ô ngày
         còn sót của lần mở trước. */
      vRow.querySelector('.btn-pay').click(); await sleep(30);
      check('nút ✓ mở sheet xác nhận', !$('modal-sheet').classList.contains('hidden'));
      window.confirmPayRecurring('r_virt'); await sleep(40);
      const real = S().transactions.find(t => t.recurringId === 'r_virt');
      check('bấm ✓ tạo giao dịch thật', !!real && real.date === due, real && real.date);
      check('ngày còn ở tương lai nên vẫn là "dự kiến"', !!real && real.status === 'pending');
      check('lịch nhảy sang kỳ sau', S().recurring.find(r => r.id === 'r_virt').dueDate > due);
      window.viewAllUpcoming(); await sleep(40);
      check('tổng Chi dự kiến không đổi sau khi xác nhận — không đếm trùng',
        window.parseAmount(txt('tx-summary').split('Chi')[1]) === chiTruoc,
        chiTruoc + ' → ' + window.parseAmount(txt('tx-summary').split('Chi')[1]));

      S().recurring = S().recurring.filter(r => r.id !== 'r_virt');
      S().transactions = S().transactions.filter(t => t.recurringId !== 'r_virt');
      window.saveStorage();
      window.viewAllUpcoming(); await sleep(40);
    }

    /* Sau cú nhảy, ô Trạng thái vẫn phải sống: đổi sang "Đã ghi nhận" thì thấy
       giao dịch đã chi, chứ không đứng im ở danh sách dự kiến. */
    $('tx-filter-status').value = 'completed';
    $('tx-filter-status').dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(20);
    {
      const rows = [...d.querySelectorAll('#tx-list-container .tx-row')];
      check('đổi sang "Đã ghi nhận" ngay sau cú nhảy thì danh sách đổi theo',
        rows.length > 0 && rows.every(r => !r.classList.contains('tx-pending')),
        rows.length + ' hàng');
    }
    window.resetTxFilters(); await sleep(20);

    // xác nhận thủ công
    window.switchTab('dashboard'); await sleep(20);
    window.settlePendingTx(ptx.id); await sleep(20);
    $('confirm-yes').click(); await sleep(40);
    const settled = S().transactions.find(t => t.note === 'Vé máy bay');
    check('xác nhận tay → status completed', settled.status === 'completed');
    check('xác nhận tay → ngày kéo về hôm nay', settled.date === today, settled.date);
    check('lúc này mới trừ tiền', window.getWalletBalance(w) === balBefore - 900000);
    check('biến khỏi "Sắp đến hạn"', !$('upcoming-list').innerHTML.includes('Vé máy bay'));

    // tự động chốt khi tới ngày
    S().transactions.push({ id: 'tx_due', userId: S().currentUser, type: 'expense', amount: 120000,
      walletId: w, categoryId: 'c_food', note: 'Đến hạn hôm nay', date: today, status: 'pending' });
    const balNow = window.getWalletBalance(w);
    check('trước khi chốt vẫn chưa trừ', window.getWalletBalance(w) === balNow);
    window.autoSettlePending(); await sleep(20);
    check('autoSettlePending chốt khoản đã tới ngày',
      S().transactions.find(t => t.id === 'tx_due').status === 'completed');
    check('sau khi chốt thì trừ tiền', window.getWalletBalance(w) === balNow - 120000);
    check('khoản còn xa vẫn để nguyên', S().transactions.find(t => t.id === 'tx_far').status === 'pending');

    // chuyển ví trong tương lai: hai chân phải cùng trạng thái
    const w2 = S().wallets[1].id;
    S().transactions.push(
      { id: 'tf_a', userId: S().currentUser, type: 'transfer_out', amount: 500000, walletId: w,
        note: 'Chuyển trước', date: future, transferId: 'trg', status: 'pending' },
      { id: 'tf_b', userId: S().currentUser, type: 'transfer_in', amount: 500000, walletId: w2,
        note: 'Nhận trước', date: future, transferId: 'trg', status: 'pending' });
    window.saveStorage();
    const balW2 = window.getWalletBalance(w2);
    window.settlePendingTx('tf_a'); await sleep(20);
    $('confirm-yes').click(); await sleep(40);
    check('cặp chuyển ví chốt cùng lúc',
      S().transactions.find(t => t.id === 'tf_b').status === 'completed');
    check('ví nhận cộng đúng', window.getWalletBalance(w2) === balW2 + 500000);

    /* Định kỳ: bấm ✓ mở sheet với ngày mặc định là HẠN KẾ TIẾP, có thể còn ở
       tương lai. Bản ghi sinh ra phải là "dự kiến", không thì số dư bị trừ
       trước khi tiền thật sự đi. */
    const recur = { id: 'r_smoke', userId: S().currentUser, type: 'expense', amount: 150000,
      walletId: w, categoryId: 'c_food', name: 'Thuê bao thử', dueDate: future };
    window.createRecurringTx(recur, future, w);
    window.createRecurringTx(recur, today, w);
    const rtxs = S().transactions.filter(t => t.recurringId === 'r_smoke');
    check('định kỳ ghi ở ngày tương lai là "dự kiến"',
      rtxs.find(t => t.date === future).status === 'pending');
    check('định kỳ xác nhận hôm nay là "đã ghi nhận"',
      rtxs.find(t => t.date === today).status === 'completed');

    S().transactions = S().transactions.filter(t => t.id !== 'tx_far' && t.recurringId !== 'r_smoke');
    window.saveStorage();
  }

  console.log('\n· thứ tự hiển thị ví');
  {
    const order = () => window.getUserWallets().map(w => w.name + ':' + w.displayOrder);
    const seq = () => window.getUserWallets().map(w => w.displayOrder).join(',');
    const n = window.getUserWallets().length;
    check('migration đánh số 1..N liền mạch, không trùng',
      seq() === Array.from({ length: n }, (_, i) => i + 1).join(','), seq());

    // tạo ví mới → xếp cuối
    window.switchTab('wallets'); await sleep(20);
    window.openWalletModal(); await sleep(20);
    check('form tạo ví gợi ý sẵn thứ tự cuối', Number($('mw-order').value) === n + 1, $('mw-order').value);
    $('mw-name').value = 'Ví cuối hàng';
    $('mw-starting-balance').value = '0';
    window.saveWalletModal(); await sleep(30);
    const created = window.getUserWallets().find(w => w.name === 'Ví cuối hàng');
    check('ví mới nhận displayOrder = tổng + 1', created.displayOrder === n + 1);
    check('nằm cuối danh sách', window.getUserWallets()[n].id === created.id);

    // đẩy nó lên số 1 → các ví khác lùi xuống, không trùng số
    const wasFirst = window.getUserWallets()[0].id;
    window.openWalletModal(created.id); await sleep(20);
    $('mw-order').value = '1';
    window.saveWalletModal(); await sleep(30);
    check('đổi thành #1 thì nó lên đầu', window.getUserWallets()[0].id === created.id);
    check('ví #1 cũ bị đẩy xuống #2',
      window.getUserWallets()[1].id === wasFirst && window.getWallet(wasFirst).displayOrder === 2);
    check('chuỗi vẫn liền mạch, không trùng',
      seq() === Array.from({ length: n + 1 }, (_, i) => i + 1).join(','), seq());

    // mọi màn hình dùng chung một thứ tự
    window.switchTab('dashboard'); await sleep(20);
    const firstCard = d.querySelector('#db-wallet-scroll .wallet-card .wname');
    check('Tổng quan xếp theo đúng thứ tự', firstCard.textContent.trim() === 'Ví cuối hàng',
      firstCard.textContent);
    window.switchTab('transactions'); await sleep(20);
    check('select lọc ví theo đúng thứ tự',
      $('tx-filter-wallet').options[1].textContent.includes('Ví cuối hàng'),
      $('tx-filter-wallet').options[1].textContent);
    window.openRecurringModal(); await sleep(20);
    check('dropdown ví ở modal Định kỳ cũng vậy',
      $('mr-wallet').options[0].textContent.includes('Ví cuối hàng'));
    window.closeModal('modal-recurring');

    // xoá thì lấp chỗ trống
    window.switchTab('wallets'); await sleep(20);
    window.deleteWallet(created.id); await sleep(20);
    $('confirm-yes').click(); await sleep(40);
    check('xoá ví thì đánh số lại, không để lỗ hổng',
      seq() === Array.from({ length: n }, (_, i) => i + 1).join(','), seq());
    check('ví đứng đầu cũ trở lại #1', window.getUserWallets()[0].id === wasFirst, order().join(' | '));
  }

  console.log('\n· thẻ ví ở màn hình Ví');
  {
    window.switchTab('wallets'); await sleep(20);
    const card = () => $('wallets-list').querySelector('.wallet-card-item');
    check('thẻ ví dùng bố cục hai bên', !!card()
      && !!card().querySelector('.wallet-info-main') && !!card().querySelector('.wallet-balance-group'));
    /* Ba nút xếp dọc cũ ăn một phần ba chiều ngang trên máy 360px. */
    check('KHÔNG còn ba nút Báo cáo/Sửa/Xóa nằm ngay trên thẻ',
      $('wallets-list').querySelectorAll('.wallet-item button.btn-xs').length === 0,
      String($('wallets-list').querySelectorAll('.wallet-item button.btn-xs').length));
    check('bên trái: icon + tên + số dư đầu kỳ',
      !!card().querySelector('.w-avatar') && !!card().querySelector('.wi-name')
      && card().querySelector('.wi-open').textContent.includes('Đầu kỳ'));
    check('bên phải: số dư hiện tại + nút ⋮',
      !!card().querySelector('.wallet-amount') && !!card().querySelector('.btn-wallet-more'));
    check('cả thẻ là vùng chạm', (card().getAttribute('onclick') || '').startsWith('openWalletMenu('));

    const wid2 = window.getUserWallets()[0].id;
    window.openWalletMenu(wid2); await sleep(20);
    const items = () => [...$('sheet-body').querySelectorAll('.pick-item')];
    check('mở sheet menu của đúng ví', visible('modal-sheet')
      && txt('sheet-title').includes(window.getWallet(wid2).name), txt('sheet-title'));
    check('đủ ba tuỳ chọn', items().length === 3
      && /Báo cáo/.test(items()[0].textContent)
      && /Chỉnh sửa/.test(items()[1].textContent)
      && /Xóa/.test(items()[2].textContent),
      items().map(i => i.textContent.trim()).join(' | '));
    check('mục Xóa được đánh dấu nguy hiểm', items()[2].classList.contains('danger'));

    items()[1].click(); await sleep(20);
    check('bấm Chỉnh sửa: đóng sheet, mở modal sửa đúng ví',
      !visible('modal-sheet') && visible('modal-wallet')
      && $('mw-wallet-id').value === wid2, $('mw-wallet-id').value);
    window.closeModal('modal-wallet');

    /* Ví đã có giao dịch thì chặn từ đầu, không hỏi han gì — xoá nó là bỏ rơi
       cả một mớ giao dịch không còn ví nào đọc tới. */
    window.openWalletMenu(wid2); await sleep(15);
    items()[2].click(); await sleep(20);
    check('ví đã có giao dịch: chặn ngay, không mở hộp xác nhận',
      !visible('modal-confirm') && window.getUserWallets().some(w => w.id === wid2));

    /* Ví trống thì mới có đường xoá — và vẫn phải hỏi. */
    S().wallets.push({ id: 'w_menu', userId: S().currentUser, name: 'Ví trống', icon: '👛',
      type: 'cash', currency: 'VND', startingBalance: 0, displayOrder: window.nextWalletOrder() });
    window.saveStorage(); window.renderWalletsView(); await sleep(20);
    window.openWalletMenu('w_menu'); await sleep(15);
    items()[2].click(); await sleep(20);
    check('bấm Xóa: hỏi xác nhận trước, chưa xoá gì', visible('modal-confirm')
      && window.getUserWallets().some(w => w.id === 'w_menu'));
    $('confirm-no').click(); await sleep(20);
    check('huỷ thì ví còn nguyên', window.getUserWallets().some(w => w.id === 'w_menu'));
    window.openWalletMenu('w_menu'); await sleep(15);
    items()[2].click(); await sleep(20);
    $('confirm-yes').click(); await sleep(30);
    check('đồng ý thì ví bị xoá thật', !window.getUserWallets().some(w => w.id === 'w_menu'));

    check('nút tạo ví trên tiêu đề là nút tròn, không phải khối xanh đặc',
      !!$('btn-add-wallet') && $('btn-add-wallet').classList.contains('icon-btn')
      && !$('btn-add-wallet').classList.contains('btn-primary'),
      $('btn-add-wallet') && $('btn-add-wallet').className);
    $('btn-add-wallet').click(); await sleep(20);
    check('… và vẫn mở được form tạo ví', visible('modal-wallet') && $('mw-wallet-id').value === '');
    window.closeModal('modal-wallet');
  }

  console.log('\n· giao diện: màu, nav, icon SVG');
  {
    const css = fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8');
    check('primary là xanh VietinBank #00529C', /--primary:#00529C/.test(css));
    check('ví xếp lưới 2 cột', /\.wallet-grid\{display:grid;grid-template-columns:repeat\(2,1fr\)/.test(css));
    /* Ô "Thêm ví" là con cuối; rơi vào ô lẻ nghĩa là số ví chẵn và nó đứng
       một mình nửa hàng — lúc đó cho trải hết hàng thay vì chừa lỗ hổng. */
    check('số ví chẵn thì ô "Thêm ví" trải hết hàng',
      /\.wallet-card\.add:nth-child\(odd\)\{grid-column:1 \/ -1/.test(css));
    check('hàng danh mục bấm được có con trỏ tay và phản hồi khi nhấn',
      /\.category-item\{[^}]*cursor:pointer/.test(css) && /\.category-item:active\{[^}]*transform:scale\(\.98\)/.test(css));
    check('hàng chip chọn loại ví đủ chỗ cho 5 loại',
      /\.type-select-row\{display:grid;grid-template-columns:repeat\(3,1fr\)/.test(css));
    check('có đỏ VietinBank #ED1C24 làm màu nhấn', /--brand-red:#ED1C24/.test(css));
    check('nền light là xám xanh #F4F7FA', /--bg:#F4F7FA/.test(css));
    check('gradient header đúng công thức',
      /--gradient:linear-gradient\(135deg,#003B70 0%,#00529C 50%,#0073E6 100%\)/.test(css));
    check('gradient thẻ ví đúng công thức',
      /--gradient-card:linear-gradient\(110deg,#00529C 0%,#1A75D2 100%\)/.test(css));
    check('card có shadow nổi 0 8px 24px rgba(0,82,156,.12)',
      /--shadow-lift:0 8px 24px rgba\(0,82,156,\.12\)/.test(css));
    check('header là app bar gradient', /header\{[^}]*background:var\(--gradient\)/.test(css));
    // App bar ghim ở đỉnh khi cuộn.
    const zHeader = Number((/header\{[^}]*z-index:(\d+)/.exec(css) || [])[1]);
    const zView = Number((/#main-header:not\(\.hidden\) ~ \.view\{[^}]*z-index:(\d+)/.exec(css) || [])[1]);
    const zNav = Number((/\.nav-bar\{[^}]*z-index:(\d+)/.exec(css) || [])[1]);
    /* FIXED, không phải sticky: sticky neo vào scrollport gần nhất, mà bất kỳ
       tổ tiên nào có overflow khác `visible` cũng thành scrollport — .app có
       overflow-x nên nó nhận vai đó rồi không bao giờ cuộn, và thanh bar trôi
       theo trang. .nav-bar đã fixed từ đầu và chưa bao giờ dính lỗi này. */
    check('header ghim bằng position:fixed, không phụ thuộc overflow của tổ tiên',
      /header\{position:fixed;top:0;left:50%/.test(css));
    check('header canh giữa và giới hạn đúng bề rộng cột như thanh nav',
      /header\{[^}]*transform:translateX\(-50%\)[^}]*max-width:520px/.test(css));
    check('header vẽ trên nội dung cuộn qua', zHeader > zView, `header z=${zHeader} vs view z=${zView}`);
    check('header và nav đều dưới modal',
      Math.max(zHeader, zNav) < Number((/\.modal\{[^}]*z-index:(\d+)/.exec(css) || [])[1]),
      `header=${zHeader} nav=${zNav}`);
    /* Bar ra khỏi luồng thì không gì bên dưới biết nó cao bao nhiêu. */
    check('mọi trang chừa đúng chiều cao header đo được lúc chạy',
      /#main-header:not\(\.hidden\) ~ \.view\{padding-top:calc\(var\(--hd-h/.test(css));
    check('có JS đo và công bố --hd-h', /function syncHeaderHeight\(\)/.test(
      fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8')));
    check('màn hình ẩn header thì không chừa khoảng thừa',
      /#main-header:not\(\.hidden\) ~ \.view\{padding-top/.test(css));
    /* Desktop: cột cuộn chứ không phải trang, bar nằm ngoài vùng cuộn nên
       fixed sẽ ghim nó vào viewport và văng khỏi khung. */
    check('khung desktop trả header về luồng thường', (() => {
      const shell = fs.readFileSync(path.join(PUBLIC, 'css', 'shell.css'), 'utf8');
      return /header\{ position: static/.test(shell);
    })());
    check('thẻ số dư không còn margin âm, nằm dưới header như mọi trang',
      /\.hero\{[^}]*padding:16px;margin-top:0/.test(css)
      && !/margin-top:-\d+px\}/.test(css.match(/#main-header[^\n]*/g).join('\n')));

    check('không còn quy tắc kéo view lên đè header',
      !/:not\(\.hd-flat\) ~ \.view\{margin-top:-/.test(css));
    check('mọi trang đều chừa khoảng dưới header',
      /#main-header:not\(\.hidden\) ~ \.view\{padding-top:calc\(var\(--hd-h/.test(css));
    check('header thu gọn còn một hàng ~70px',
      /header\{[^}]*padding:calc\(9px \+ env\(safe-area-inset-top,0px\)\) 14px 26px/.test(css)
      && /header \.hd-who\{display:flex/.test(css));
    check('ví xếp lưới 2 cột, không cuộn ngang',
      /\.wallet-grid\{display:grid;grid-template-columns:repeat\(2,1fr\)/.test(css)
      && !/\.wallet-scroll\{/.test(css));
    check('thẻ ví gọn, chống tràn khi số tiền dài',
      /\.wallet-card\{width:100%;min-width:0;min-height:72px/.test(css)
      && /\.wallet-card \.wbal\.amt-xs\{/.test(css));
    check('nav bar dùng glassmorphism', /\.nav-bar\{[^}]*backdrop-filter:blur\(14px\)/.test(css));
    check('vạch chỉ báo tab active màu đỏ',
      /\.nav-item::before\{[^}]*background:var\(--brand-red\)/.test(css));
    check('lưới tiện ích 4 cột', /\.menu-grid\{display:grid;grid-template-columns:repeat\(4,1fr\)/.test(css));
    check('ô icon có inner shadow tạo khối', /\.menu-tile \.mt-ic\{[^}]*inset 0 1px 0/.test(css));
    check('có hiệu ứng ripple', /@keyframes rippleOut/.test(css));
    check('font stack ưu tiên SF Pro \/ Inter \/ Roboto',
      /font-family:"SF Pro Display",[^;]*"Inter"[^;]*Roboto/.test(css));
    check('nav item có transition và chỉ báo active',
      /\.nav-item\.active::before/.test(css) && /transition:color \.22s/.test(css));
    check('FAB tròn nổi, gradient xanh-đỏ, có glow',
      /\.fab\{[^}]*border-radius:50%/.test(css) && /top:-27px/.test(css)
      && /background:var\(--gradient-fab\)/.test(css) && /@keyframes fabGlow/.test(css));

    // thanh nav dùng SVG, không còn emoji
    const nav = $('main-nav');
    check('mỗi mục nav là một SVG', nav.querySelectorAll('.nav-item .ic svg.ic-svg').length === 4,
      nav.querySelectorAll('.nav-item .ic svg.ic-svg').length);
    check('nút + là SVG chứ không phải ký tự "+"',
      !!d.querySelector('.fab svg.ic-svg') && d.querySelector('.fab').textContent.trim() === '');
    check('không còn emoji trong thanh nav', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(nav.textContent));

    window.switchTab('dashboard'); await sleep(20);
    const marked = d.querySelector('#main-nav .nav-item[data-tab="dashboard"]');
    check('tab đang chọn được đánh dấu active', marked.classList.contains('active'));
    check('ô tiện ích dùng SVG',
      $('db-quick-access').querySelectorAll('.mt-ic svg.ic-svg').length === 5,
      $('db-quick-access').querySelectorAll('.mt-ic svg.ic-svg').length);

    window.switchTab('settings'); await sleep(20);
    const rows = $('view-settings').querySelectorAll('.sr-ic');
    check('mọi hàng Cài đặt dùng SVG hoặc chấm trạng thái',
      [...rows].every(r => r.querySelector('svg.ic-svg') || r.querySelector('.dot')),
      [...rows].filter(r => !r.querySelector('svg.ic-svg') && !r.querySelector('.dot')).length + ' hàng còn emoji');
    check('trạng thái đồng bộ là chấm CSS', !!$('cloud-status').querySelector('.dot'));
    check('nút đổi theme là SVG', !!$('btn-theme').querySelector('svg.ic-svg'));

    // emoji do người dùng chọn phải giữ nguyên — đó là dữ liệu
    check('emoji của ví vẫn nguyên', /[\u{1F300}-\u{1FAFF}]/u.test(S().wallets[0].icon), S().wallets[0].icon);
    check('bảng chọn emoji vẫn còn', window.eval('EMOJI_POOL.length') > 30);
  }

  console.log('\n· nút con mắt ẩn/hiện số dư');
  {
    window.switchTab('dashboard'); await sleep(20);
    const eye = $('privacy-btn');
    check('nút con mắt nằm cạnh con số, không cạnh nhãn',
      eye.parentNode.classList.contains('amt-row')
      && eye.previousElementSibling && eye.previousElementSibling.id === 'db-total-balance');

    const shown = { total: txt('db-total-balance'), inc: txt('db-month-income'), exp: txt('db-month-expense') };
    check('mặc định hiện số thật', /[0-9]/.test(shown.total) && /[0-9]/.test(shown.inc));
    const eyeIcon = () => eye.innerHTML;
    const openEye = eyeIcon();

    window.togglePrivacy(); await sleep(30);
    const masked = id => { const v = txt(id); return v.indexOf('•') >= 0 && !/[0-9]/.test(v); };
    check('tổng số dư bị che', masked('db-total-balance'), txt('db-total-balance'));
    check('thu tháng này bị che', masked('db-month-income'), txt('db-month-income'));
    check('chi tháng này bị che', masked('db-month-expense'), txt('db-month-expense'));
    const bals = () => [...d.querySelectorAll('#db-wallet-scroll .wbal')].map(e => e.textContent);
    check('số dư trên thẻ ví bị che',
      bals().length > 0 && bals().every(b => b.indexOf('•') >= 0 && !/[0-9]/.test(b)),
      bals().join(' | '));
    check('icon đổi sang con mắt gạch chéo',
      eyeIcon() !== openEye && eyeIcon().indexOf('m3 3 18 18') >= 0);
    check('trạng thái ẩn được lưu xuống localStorage', JSON.parse(
      window.localStorage.getItem('FINYOURTIN_STATE_V4::' + S().currentUser)).app.privacy === true);

    window.togglePrivacy(); await sleep(30);
    check('bấm lại thì số hiện lại đúng như cũ',
      txt('db-total-balance') === shown.total && txt('db-month-income') === shown.inc
      && txt('db-month-expense') === shown.exp);
    check('icon trở lại con mắt mở', eyeIcon() === openEye);
  }

  console.log('\n· bản Android (Capacitor)');
  {
    const cap = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
    check('capacitor.config.json hợp lệ', cap.appId === 'com.sofin.app' && cap.appName === 'SoFin');
    check('webDir trỏ vào public — một nguồn duy nhất cho web lẫn mobile',
      cap.webDir === 'public', cap.webDir);
    check('StatusBar dùng xanh VietinBank',
      cap.plugins.StatusBar.backgroundColor === '#00529C' && cap.plugins.StatusBar.style === 'LIGHT');
    check('Keyboard resize body', cap.plugins.Keyboard.resize === 'body');

    const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    check('dự án native không commit vào repo (sinh lại trong CI)',
      /^\/android\/$/m.test(ignore) && /^\/ios\/$/m.test(ignore));

    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-apk.yml'), 'utf8');
    check('CI chạy npm test trước khi đóng gói', /run: npm test/.test(wf));
    check('CI sinh env bằng --strict, không ra APK thiếu key',
      /generate-env\.js --strict/.test(wf));
    check('CI tự dựng android/ rồi mới build — cap sync một mình sẽ lỗi',
      /npx cap add android/.test(wf) && wf.indexOf('cap add android') < wf.indexOf('cap sync android')
      && /assembleDebug/.test(wf));
    check('CI dùng JDK 21 — Capacitor 8 đặt sourceCompatibility 21, JDK 17 sẽ fail',
      /java-version: 21/.test(wf));
    check('CI chỉ phát hành khi có tag v*, không phải mỗi lần push',
      /softprops\/action-gh-release/.test(wf)
      && /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/.test(wf)
      && !/tag_name: latest/.test(wf));
    check('CI đối chiếu tag với version TRƯỚC khi build', (() => {
      const chk = wf.indexOf('Đối chiếu tag với package.json');
      const rel = wf.indexOf('softprops/action-gh-release');
      return chk > 0 && chk < rel;
    })());
    check('CI bỏ qua commit chỉ sửa tài liệu', /paths-ignore/.test(wf));
    /* `git push origin main v5.0.2` đẩy cả nhánh lẫn tag một lượt → hai run
       cùng lúc. Nhóm concurrency chung thì cái chạy sau giết cái chạy trước, và
       đã có lần cái bị giết là run của tag: tag lên nhưng không có release nào
       được tạo, không một dòng báo lỗi. Nhóm phải kèm ref. */
    check('nhóm concurrency tách theo ref — push nhánh không được giết build của tag',
      /concurrency:\s*\n\s*group:\s*apk-\$\{\{\s*github\.ref\s*\}\}/.test(wf),
      (/group:.*/.exec(wf) || [])[0]);
    /* Runner là máy sạch: không có debug.keystore thì Gradle sinh khoá ngẫu
       nhiên mỗi lần build, và Android từ chối cài đè khi chữ ký đổi — mỗi bản
       phát hành lại bắt người dùng gỡ app, tức xoá sạch localStorage. */
    /* Ghi khoá vào ~/.android/debug.keystore là KHÔNG đủ — đã thử ở v5.0.4 và
       Gradle vẫn ký bằng khoá tự sinh của nó. Nên CI ký đè bằng apksigner. */
    check('CI ký đè APK bằng khoá từ secret, không phó mặc Gradle', (() => {
      const ks = wf.indexOf('ANDROID_DEBUG_KEYSTORE_B64');
      const sign = wf.indexOf('APKSIGNER" sign');
      const verify = wf.indexOf('verify --print-certs');
      return ks > 0 && ks < sign && sign < verify
        && /--ks-key-alias androiddebugkey/.test(wf);
    })());
    check('thiếu khoá thì CHẶN phát hành, không lặng lẽ ra bản không cài đè được',
      /::error::Thiếu secret ANDROID_DEBUG_KEYSTORE_B64/.test(wf));
    /* Nạp được file khoá không có nghĩa Gradle đã dùng đúng file đó. Sai chữ ký
       thì APK vẫn cài và chạy bình thường — chỉ vỡ ở lần cập nhật sau. */
    check('CI đối chiếu vân tay chữ ký của APK vừa dựng', (() => {
      const v = wf.indexOf('apksigner');
      const rel = wf.indexOf('softprops/action-gh-release');
      return v > 0 && v < rel && /f73a128dce734c3d0b68107598cb41bf5d7d030a645dc42b2d3ad845ac920017/.test(wf);
    })());

    // nút tải trong Cài đặt
    window.switchTab('settings'); await sleep(20);
    const apk = $('btn-download-latest-apk');
    check('Cài đặt có nút tải APK', !!apk, $('app-info').textContent.slice(0, 60));
    check('nút dùng bí danh /releases/latest/download nên không đổi theo phiên bản',
      !!apk && apk.getAttribute('href') ===
        'https://github.com/bamin7718/yourfin/releases/latest/download/sofin.apk',
      apk && apk.getAttribute('href'));
    /* Cặp này lệch nhau là nút 404 mà không có gì báo — nên khoá lại. */
    check('tên file trong CI và trong nút tải khớp nhau', (() => {
      const inWf = /files: (\S+\.apk)/.exec(wf);
      return !!apk && !!inWf && apk.getAttribute('href').endsWith('/' + inWf[1]);
    })(), (/files: (\S+\.apk)/.exec(wf) || [])[1]);
    check('không còn tag cố định `latest` để lệch với số phiên bản',
      !/tag_name:/.test(wf));

    // trong chính app native thì không mời tải lại
    const realCap = window.Capacitor;
    window.Capacitor = { isNativePlatform: () => true };
    window.renderAppInfo();
    check('chạy trong app native thì ẩn nút tải', !$('btn-download-latest-apk'));
    check('native được coi là đã cài, không mời cài PWA nữa',
      $('app-info').innerHTML.includes('Đã cài trên thiết bị này'));
    check('native không đăng ký service worker', window.eval('isNativeApp()') === true);
    window.Capacitor = realCap;
    window.renderAppInfo();
    check('quay lại web thì nút tải hiện lại', !!$('btn-download-latest-apk'));
  }

  console.log('\n· kiểm tra bản cập nhật');
  {
    const PKG = require('../package.json').version;
    check('APP_VERSION lấy từ __ENV__ do build sinh ra',
      window.eval('APP_VERSION') === PKG, window.eval('APP_VERSION'));
    /* Mở thẳng thư mục không qua build thì rơi về hằng số này — để nó cũ đi
       là app tự thấy mình lỗi thời và đòi cập nhật vô cớ. */
    check('hằng số dự phòng trong app.js chưa lạc hậu',
      fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8')
        .includes("__ENV__.VERSION) || '" + PKG + "'"));
    check('generate-env.js có phát VERSION từ package.json',
      /VERSION:\s*require\('\.\.\/package\.json'\)\.version/
        .test(fs.readFileSync(path.join(ROOT, 'scripts', 'generate-env.js'), 'utf8')));

    const cmp = (a, b) => window.compareVersions(a, b);
    check('so sánh phiên bản: mới hơn', cmp('5.0.1', '5.0.0') === 1 && cmp('5.1.0', '5.0.9') === 1);
    check('so sánh phiên bản: cũ hơn', cmp('5.0.0', '5.0.1') === -1);
    check('so sánh phiên bản: bằng nhau', cmp('5.0.0', '5.0.0') === 0);
    check('bỏ qua tiền tố v', cmp('v5.0.1', '5.0.0') === 1 && cmp('v5.0.0', 'v5.0.0') === 0);
    check('so theo số chứ không so chuỗi', cmp('5.0.10', '5.0.9') === 1, '5.0.10 vs 5.0.9');

    /* giả lập GitHub API */
    const realFetch = window.fetch;
    let calls = 0;
    const reply = body => { window.fetch = async () => { calls++; return { ok:true, json: async () => body }; }; };
    try { window.localStorage.removeItem('FINYOURTIN_UPDATE_DISMISSED'); } catch (e) {}

    reply({ tag_name: 'v9.9.9', body: '## Tính năng mới\n- Thêm ví điện tử\n* Sửa nút 000\n\n\n',
      assets: [{ name: 'sofin.apk', size: 4400000, browser_download_url: 'https://x/sofin.apk' }] });
    let tag = await window.checkAppUpdate(); await sleep(20);
    check('phát hiện bản mới hơn', tag === 'v9.9.9', String(tag));
    /* Modal riêng, không dùng sheet chung: sheet chung đang phục vụ luồng đặt
       lại mật khẩu và bộ chọn dữ liệu cũ, mà hộp này tự bật sau 3 giây. */
    check('hiện modal cập nhật riêng, không chiếm sheet chung',
      visible('update-modal') && !visible('modal-sheet'));
    check('tiêu đề mang số phiên bản mới', txt('update-title').includes('v9.9.9'), txt('update-title'));
    check('có đối chiếu bản đang dùng', txt('update-meta').includes('v' + window.eval('APP_VERSION')),
      txt('update-meta'));
    check('có hiển thị dung lượng', txt('update-meta').includes('4.2 MB'), txt('update-meta'));

    /* Release notes: chuỗi Markdown từ mạng, phải dọn và phải esc. */
    const notes = () => $('update-notes').textContent;
    check('hiện ghi chú phát hành từ API',
      notes().includes('Thêm ví điện tử') && notes().includes('Sửa nút 000'), notes());
    check('bỏ ký tự Markdown thô', !/[#*]/.test(notes()), notes());
    check('gạch đầu dòng thành ký hiệu đọc được', notes().includes('· Thêm ví điện tử'));
    check('bỏ dòng trống', $('update-notes').querySelectorAll('.un-line').length === 3,
      String($('update-notes').querySelectorAll('.un-line').length));

    check('nút tải trỏ đúng asset của release',
      $('update-download').getAttribute('href') === 'https://x/sofin.apk',
      $('update-download').getAttribute('href'));
    check('nút tải có thuộc tính download', $('update-download').hasAttribute('download'));
    check('có trấn an chuyện cài đè không mất dữ liệu',
      /cài đè/i.test(txt('update-modal')) && /không mất dữ liệu/.test(txt('update-modal')),
      txt('update-modal').slice(-90));
    /* Chữ ký đổi thì Android từ chối cài đè. Đã xảy ra thật, nên câu trấn an
       phải kèm lối thoát chứ không hứa suông. */
    check('… kèm lối thoát khi máy từ chối cài đè',
      /gỡ bản cũ rồi cài lại/.test(txt('update-modal'))
      && /đám mây/.test(txt('update-modal')), txt('update-modal').slice(-120));

    /* Bấm "Tải" cũng phải ghi nhớ: người dùng rời app sang trình cài đặt rồi
       quay lại, không hỏi lại họ về đúng bản vừa tải. */
    /* chặn điều hướng thật: jsdom không mở được URL ngoài, và ta chỉ quan tâm
       tới phần xử lý của mình */
    $('update-download').addEventListener('click', e => e.preventDefault(), { once: true });
    $('update-download').click(); await sleep(20);
    check('bấm Tải thì đóng modal', !visible('update-modal'));
    check('… và nhớ luôn phiên bản đó',
      window.localStorage.getItem('FINYOURTIN_UPDATE_DISMISSED') === '9.9.9',
      window.localStorage.getItem('FINYOURTIN_UPDATE_DISMISSED'));
    tag = await window.checkAppUpdate(); await sleep(20);
    check('đã bấm "để sau" thì không hỏi lại cùng phiên bản', tag === null && !visible('update-modal'));

    reply({ tag_name: 'v10.0.0', assets: [] });
    tag = await window.checkAppUpdate(); await sleep(20);
    check('nhưng phiên bản mới hơn nữa thì vẫn báo', tag === 'v10.0.0');
    check('không có asset thì lùi về link mặc định',
      $('update-download').getAttribute('href').includes('releases/latest/download/sofin.apk'),
      $('update-download').getAttribute('href'));
    check('release không có ghi chú thì vẫn có một dòng thay thế',
      $('update-notes').textContent.trim().length > 0, notes());
    $('update-later').click(); await sleep(20);
    check('bấm "Để sau" thì đóng modal', !visible('update-modal'));
    try { window.localStorage.removeItem('FINYOURTIN_UPDATE_DISMISSED'); } catch (e) {}

    reply({ tag_name: 'v1.0.0', assets: [] });
    tag = await window.checkAppUpdate(); await sleep(20);
    check('bản cũ hơn thì im lặng', tag === null && !visible('update-modal'));

    window.fetch = async () => { throw new Error('mất mạng'); };
    let threw = null;
    try { tag = await window.checkAppUpdate(); } catch (e) { threw = e.message; }
    await sleep(20);
    check('mất mạng thì không ném lỗi, không làm phiền', !threw && tag === null, threw);
    window.fetch = realFetch;

    const src = fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8');
    check('chỉ tự kiểm tra trên bản native, sau 3 giây',
      /if\(isNativeApp\(\)\) setTimeout\(\(\)=>checkAppUpdate\(\), 3000\)/.test(src));
  }

  console.log('\n· PWA');
  {
    const head = d.head.innerHTML;
    check('có link manifest', /rel="manifest"/.test(head));
    check('có apple-touch-icon', /rel="apple-touch-icon"/.test(head));
    check('có meta apple-mobile-web-app-capable', /apple-mobile-web-app-capable/.test(head));
    check('có meta theme-color đúng màu SoFin',
      d.querySelector('meta[name="theme-color"]').content === '#00529C');
    check('favicon trỏ vào icon thương hiệu, không phải emoji',
      /rel="icon"[^>]*icons\/icon-192\.png/.test(head) && !/font-size='90'/.test(head));
    check('có thẻ OpenGraph + Twitter card',
      !!d.querySelector('meta[property="og:title"]') && !!d.querySelector('meta[property="og:image"]')
      && !!d.querySelector('meta[name="twitter:card"]'));
    check('og:image được resolve thành URL tuyệt đối',
      /^https?:\/\//.test(d.getElementById('og-image').content),
      d.getElementById('og-image').content);
    check('số tiền dài thì thu nhỏ chứ không cắt cụt', (() => {
      const long = window.amtClass('-159.800.000.000 đ'), mid = window.amtClass('-159.800.000 đ');
      return long === ' amt-xs' && mid === ' amt-sm' && window.amtClass('250.000 đ') === '';
    })(), window.amtClass('-159.800.000 đ'));

    const mf = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.json'), 'utf8'));
    check('manifest: display standalone', mf.display === 'standalone');
    check('manifest: start_url và scope là gốc', mf.start_url === '/' && mf.scope === '/');
    check('manifest: orientation portrait', mf.orientation === 'portrait');
    check('manifest: đủ 192 + 512 + maskable',
      mf.icons.some(i => i.sizes === '192x192') && mf.icons.some(i => i.sizes === '512x512')
      && mf.icons.some(i => (i.purpose || '').includes('maskable')));
    check('manifest: mọi icon là PNG có thật', mf.icons.every(i =>
      fs.existsSync(path.join(PUBLIC, i.src)) &&
      fs.readFileSync(path.join(PUBLIC, i.src)).slice(1, 4).toString() === 'PNG'));

    const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
    check('sw: bỏ qua request không phải GET', /req\.method !== 'GET'/.test(sw));
    check('sw: không đụng vào Supabase', /isSupabase\(url\)\) return;/.test(sw));
    check('sw: env.js đi network-first', /isEnv\(url\)[\s\S]{0,80}networkFirst/.test(sw));
    check('sw: activate xoá cache cũ', /caches\.delete/.test(sw) && /n !== CACHE/.test(sw));
    check('sw: precache đủ shell để chạy offline',
      ['/index.html', '/css/styles.css', '/js/app.js', '/js/sync.js'].every(f => sw.includes(`'${f}'`)));
    check('sw: precache bundle Supabase đã vendor tại chỗ',
      sw.includes("'/js/vendor/supabase.js'"));
    check('index.html không còn phụ thuộc CDN bên thứ ba khi khởi động',
      !/<script src="https?:\/\//.test(head), (head.match(/<script src="https?:[^"]*"/) || [''])[0]);

    // mục "Thông tin ứng dụng" trong Cài đặt
    window.switchTab('settings'); await sleep(20);
    check('Cài đặt có khối Thông tin ứng dụng', !!$('app-info') && $('app-info').innerHTML.length > 0);
    check('chưa cài thì không hiện nút cài (trình duyệt chưa mời)',
      !$('app-info').innerHTML.includes('promptInstall()'));

    // giả lập trình duyệt mời cài đặt
    let prompted = 0, choice = 'accepted';
    const evt = new window.Event('beforeinstallprompt');
    evt.prompt = () => { prompted++; };
    evt.userChoice = Promise.resolve({ outcome: choice });
    window.dispatchEvent(evt);
    await sleep(20);
    check('bắt beforeinstallprompt → hiện nút cài', $('app-info').innerHTML.includes('promptInstall()'));
    check('nút có nhãn đúng', $('app-info').innerHTML.includes('Tải / Cài đặt ứng dụng lên thiết bị'));

    await window.promptInstall(); await sleep(20);
    check('bấm nút thì bung pop-up cài đặt của trình duyệt', prompted === 1);
    check('dùng xong thì ẩn nút (sự kiện chỉ dùng được một lần)',
      !$('app-info').innerHTML.includes('promptInstall()'));

    // đã cài / đang chạy standalone thì phải ẩn hẳn
    const realMM = window.matchMedia;
    window.matchMedia = q => ({ matches: /standalone/.test(q), media: q,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    window.renderAppInfo();
    check('chạy standalone thì báo đã cài, không mời nữa',
      $('app-info').innerHTML.includes('Đã cài trên thiết bị này')
      && !$('app-info').innerHTML.includes('promptInstall()'));
    window.matchMedia = realMM;
    window.renderAppInfo();
  }

  console.log('\n· Báo cáo: bộ lọc, thẻ tổng quan, xếp hạng');
  {
    window.switchTab('reports'); await sleep(40);
    const chips = [...d.querySelectorAll('#report-range-seg .chip')];
    check('có đủ 5 mốc thời gian',
      chips.map(c => c.dataset.val).join() === 'thismonth,lastmonth,3months,thisyear,custom',
      chips.map(c => c.dataset.val).join());
    check('mặc định là Tháng này',
      chips[0].classList.contains('active') && window.eval('reportRangeKey') === 'thismonth');
    check('nhãn kỳ hiện đúng tháng hiện tại',
      txt('report-period-label') === 'Tháng ' + (new Date().getMonth() + 1) + '/' + new Date().getFullYear(),
      txt('report-period-label'));

    // thẻ biến động số dư: đầu kỳ → thu/chi → ròng → cuối kỳ
    check('thẻ biến động số dư có đủ 4 con số',
      !!d.querySelector('.report-balance-card') && !!$('rep-opening') && !!$('rep-income')
      && !!$('rep-expense') && !!$('rep-net') && !!$('rep-closing'));
    const incNow = window.parseAmount(txt('rep-income'));
    const expNow = window.parseAmount(txt('rep-expense'));
    check('dòng ròng đánh dấu đúng dấu âm/dương',
      $('rep-net-card').classList.contains(incNow - expNow >= 0 ? 'pos' : 'neg'),
      $('rep-net-card').className);
    check('thẻ ròng có dòng phụ diễn giải', txt('rep-net-sub').length > 0, txt('rep-net-sub'));

    /* Bốn con số phải CỘNG ĐÚNG với nhau — thẻ này chỉ có giá trị khi người
       dùng nhẩm lại được: đầu kỳ + thu − chi (+ chuyển ví) = cuối kỳ. */
    {
      const m = window.calculateReportMetrics();
      const shown = id => window.parseAmount(txt(id));
      check('cuối kỳ = đầu kỳ + thu − chi + chuyển ví ròng',
        Math.round(m.closing) === Math.round(m.opening + m.inc - m.exp + m.transfer),
        m.opening + ' + ' + m.inc + ' − ' + m.exp + ' + ' + m.transfer + ' ≠ ' + m.closing);
      check('số dư đầu kỳ chính là sổ phát lại tới trước ngày đầu kỳ',
        Math.round(m.opening) === Math.round(window.balanceAsOf(
          window.reportBalanceScope(), window.reportRange().start, false)));
      check('con số trên màn hình khớp với phép tính',
        shown('rep-opening') === Math.round(Math.abs(m.opening))
        || Math.abs(shown('rep-opening') - Math.abs(m.opening)) < 1,
        txt('rep-opening') + ' vs ' + m.opening);
      /* Lọc theo một ví: chuyển ví không phải thu cũng không phải chi, nhưng
         nó làm số dư ví đổi — dòng "Chuyển ví ròng" là chỗ duy nhất nói ra. */
      check('dòng "Chuyển ví ròng" chỉ hiện khi thật sự có chuyển ví',
        visible('rep-transfer-row') === (Math.round(m.transfer) !== 0),
        'transfer=' + m.transfer);
    }

    /* "Gồm dự kiến" phải chi phối cả hai đầu. Chỉ cộng khoản dự kiến vào biến
       động mà không cộng vào số dư thì thẻ tự mâu thuẫn với chính nó. */
    {
      window.toggleReportPending(); await sleep(30);
      const mp = window.calculateReportMetrics();
      check('bật "Gồm dự kiến" thì thẻ vẫn cộng đúng',
        Math.round(mp.closing) === Math.round(mp.opening + mp.inc - mp.exp + mp.transfer));
      window.toggleReportPending(); await sleep(30);
    }

    // đổi mốc thời gian
    window.setReportRange('lastmonth', chips[1]); await sleep(40);
    check('chọn Tháng trước thì nhãn đổi theo',
      txt('report-period-label') !== 'Tháng ' + (new Date().getMonth() + 1) + '/' + new Date().getFullYear(),
      txt('report-period-label'));
    check('chip Tháng trước sáng, Tháng này tắt',
      chips[1].classList.contains('active') && !chips[0].classList.contains('active'));

    window.setReportRange('custom', chips[4]); await sleep(30);
    check('chọn Tùy chỉnh thì hiện 2 ô ngày', visible('report-custom-range'));
    check('ô ngày được điền sẵn', !!$('rep-from').value && !!$('rep-to').value);
    // đảo ngược ngày vẫn phải ra kết quả, không phải khoảng rỗng
    $('rep-from').value = window.todayISO();
    $('rep-to').value = window.addDaysISO(window.todayISO(), -20);
    window.renderReportsView(); await sleep(30);
    check('nhập ngược ngày vẫn tính đúng khoảng',
      window.parseAmount(txt('rep-expense')) > 0, txt('rep-expense'));

    window.setReportRange('thismonth', chips[0]); await sleep(40);
    check('quay lại Tháng này thì ẩn ô ngày', !visible('report-custom-range'));

    // xếp hạng chi tiêu
    const rows = [...d.querySelectorAll('#rep-cat-list .rank-row')];
    check('danh sách xếp hạng có số thứ tự và progress bar',
      rows.length > 0 && rows[0].querySelector('.rank-no').textContent === '1'
      && !!rows[0].querySelector('.progress-track'), rows.length + ' hàng');
    check('xếp từ cao xuống thấp', (() => {
      const vals = rows.map(r => window.parseAmount(r.querySelector('.rank-amt').textContent));
      return vals.every((v, i) => i === 0 || vals[i - 1] >= v);
    })());

    // con mắt phải che cả màn báo cáo
    window.togglePrivacy(); await sleep(40);
    const hidden = v => v.indexOf('•') >= 0 && !/[0-9]/.test(v);
    check('ẩn số dư thì tổng thu/chi/ròng bị che',
      hidden(txt('rep-income')) && hidden(txt('rep-expense')) && hidden(txt('rep-net')),
      txt('rep-income') + ' / ' + txt('rep-expense') + ' / ' + txt('rep-net'));
    check('số tiền từng danh mục cũng bị che',
      [...d.querySelectorAll('#rep-cat-list .rank-amt')].every(e => hidden(e.textContent)));
    check('nhãn trục biểu đồ cũng bị che', window.shortMoney(1500000) === '•••');
    window.togglePrivacy(); await sleep(40);
    check('bỏ ẩn thì số quay lại', window.parseAmount(txt('rep-income')) === incNow);

    // --- canvas: kích thước phải theo CSS, không tự ghim cứng ---
    const donut = $('chart-donut'), bar = $('chart-bar');
    check('canvas đặt width theo phần trăm, không ghim pixel',
      donut.style.width === '100%' && bar.style.width === '100%',
      donut.style.width + ' / ' + bar.style.width);
    check('donut lấp đầy khung vuông, cột giữ chiều cao thuộc tính',
      donut.style.height === '100%' && bar.style.height === '200px',
      donut.style.height + ' / ' + bar.style.height);
    check('donut nằm trong khung vuông có giới hạn bề rộng',
      donut.parentNode.classList.contains('chart-donut-container') && donut.hasAttribute('data-fill'));

    // đổi bộ lọc nhiều lần không được làm bitmap phình ra
    const w0 = donut.width;
    window.setReportRange('thisyear', chips[3]); await sleep(30);
    window.setDonutMode('income', $('seg-donut-income')); await sleep(30);
    window.setDonutMode('expense', $('seg-donut-expense')); await sleep(30);
    window.setReportRange('thismonth', chips[0]); await sleep(30);
    check('vẽ lại nhiều lần: bitmap giữ nguyên kích thước, không cộng dồn',
      donut.width === w0, w0 + ' → ' + donut.width);

    // devicePixelRatio được chặn trần ở 3x
    const realDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { value: 4, configurable: true });
    window.renderReportsView(); await sleep(30);
    check('devicePixelRatio bị chặn trần ở 3x, không để 4x đốt bộ nhớ',
      donut.width === Math.round((donut.getBoundingClientRect().width || 300) * 3),
      'width=' + donut.width);
    if (realDpr) Object.defineProperty(window, 'devicePixelRatio', realDpr);
    else Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    window.renderReportsView(); await sleep(30);

    // --- CSS chống sập chiều cao và chống đè chữ ---
    const css = fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8');
    check('khung chứa canvas có position/width/min-height',
      /\.chart-wrap\{position:relative;width:100%;min-height:200px/.test(css));
    check('khung donut vuông, canh giữa, chặn bề rộng 240px',
      /\.chart-donut-container\{width:100%;max-width:240px;aspect-ratio:1\/1;margin:12px auto/.test(css));
    check('canvas donut co giãn trong khung, không ghim pixel cứng',
      /\.chart-donut-container>canvas\{width:100%;height:100%/.test(css)
      && !/#chart-donut\{[^}]*!important/.test(css));
    check('biểu đồ cột có min-height riêng', /#chart-bar\{min-height:200px/.test(css));
    check('có safeDraw để một biểu đồ hỏng không kéo sập danh sách',
      /function safeDraw\(/.test(fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8')));
    check('tab Thu \/ Chi không bị co ép',
      /\.segment\{display:flex;flex:0 0 auto/.test(css)
      && /\.segment \.seg\{flex:1 1 0;min-width:0/.test(css));
    check('có nhánh responsive cho máy hẹp dưới 380px',
      /@media \(max-width:380px\)/.test(css));

    // chỉ tính giao dịch đã ghi nhận
    check('báo cáo mặc định không gộp khoản dự kiến', window.eval('reportIncludePending') === false);
    check('nguồn dữ liệu báo cáo là các giao dịch completed',
      window.eval('reportSource().every(t => t.status !== "pending")'));
  }

  console.log('\n· "Sắp đến hạn": mốc 3 tháng và 6 tháng');
  {
    window.switchTab('dashboard'); await sleep(20);
    const chips = [...d.querySelectorAll('#upcoming-filter .chip')];
    check('đủ 5 mốc thời gian',
      chips.map(c => c.dataset.val).join() === 'thismonth,nextweek,nextmonth,3m,6m',
      chips.map(c => c.dataset.val).join());
    check('hàng chip cuộn ngang, không xuống dòng',
      $('upcoming-filter').classList.contains('chip-scroll'));

    // một khoản định kỳ hằng tháng, 2.000.000 mỗi kỳ, bắt đầu từ hôm nay
    S().recurring.length = 0;
    S().transactions = S().transactions.filter(t => t.id !== 'tx_far');
    S().recurring.push({ id: 'r_m', userId: S().currentUser, name: 'Tiền nhà', type: 'expense',
      amount: 2000000, walletId: S().wallets[0].id, categoryId: 'c_bill', subcategoryId: 's_rent',
      frequency: 'monthly', interval: 1, dueDate: window.todayISO(), endDate: '', autoProcess: false });
    window.saveStorage();

    const pick = v => { window.setUpcomingFilter(v, chips.find(c => c.dataset.val === v)); };
    const row = () => [...d.querySelectorAll('#upcoming-list .upcoming-row')]
      .find(r => r.querySelector('.up-title').textContent.includes('Tiền nhà'));
    const amount = () => window.parseAmount(row().querySelector('.up-amt').textContent);

    pick('thismonth'); await sleep(25);
    check('trong tháng: đúng 1 kỳ = 2.000.000', amount() === 2000000, String(amount()));
    check('một kỳ thì không hiện nhãn ×N', !/×/.test(row().querySelector('.up-title').textContent));

    pick('3m'); await sleep(25);
    check('chip "3 tháng" sáng lên',
      chips.find(c => c.dataset.val === '3m').classList.contains('active'));
    /* 90 ngày kể từ hôm nay ôm trọn 3 hoặc 4 kỳ tuỳ ngày trong tháng */
    const n3 = amount() / 2000000;
    check('3 tháng: cộng dồn nhiều kỳ, không phải một kỳ',
      n3 >= 3 && n3 <= 4 && Number.isInteger(n3), n3 + ' kỳ');
    check('hiện nhãn ×N khi có nhiều kỳ',
      row().querySelector('.up-title').textContent.includes('×' + n3),
      row().querySelector('.up-title').textContent);

    pick('6m'); await sleep(25);
    const n6 = amount() / 2000000;
    check('6 tháng: nhiều kỳ hơn 3 tháng', n6 > n3, n3 + ' → ' + n6 + ' kỳ');
    check('6 tháng ≈ gấp đôi 3 tháng', Math.abs(n6 - n3 * 2) <= 1, n3 + ' vs ' + n6);
    check('tổng "Dự kiến phải chi" khớp số kỳ',
      window.parseAmount(txt('upcoming-total')) >= n6 * 2000000,
      txt('upcoming-total'));

    // ngày kết thúc phải chặn việc đếm quá tay
    S().recurring[0].endDate = window.addDaysISO(window.todayISO(), 45);
    window.saveStorage(); pick('6m'); await sleep(25);
    check('ngày kết thúc giới hạn số kỳ được đếm',
      amount() / 2000000 <= 2, amount() / 2000000 + ' kỳ');

    S().recurring.length = 0; window.saveStorage();
    pick('thismonth'); await sleep(20);
  }


  console.log('\n· "Ví của bạn": lưới 2 cột');
  {
    window.switchTab('dashboard'); await sleep(20);
    const uid0 = S().currentUser;
    const before = S().wallets.length;
    /* đủ 6 ví để thấy hình dạng 2x3, kèm một số dư rất lớn và một tên rất dài */
    while (S().wallets.length < 6) {
      const n = S().wallets.length + 1;
      S().wallets.push({ id: 'wg' + n, userId: uid0, name: 'Ví số ' + n, icon: '👛',
        type: 'cash', currency: 'VND', startingBalance: 1000000 * n, displayOrder: n + 10 });
    }
    S().wallets[S().wallets.length - 1].name = 'Ngân hàng Thương mại Cổ phần Ngoại thương';
    S().wallets[S().wallets.length - 1].startingBalance = -159800000000;
    window.saveStorage();
    window.switchTab('dashboard'); await sleep(30);

    const grid = $('db-wallet-scroll');
    const cards = [...grid.querySelectorAll('.wallet-card:not(.add)')];
    check('render đủ 6 ví, không giấu bớt', cards.length === 6, cards.length + ' thẻ');
    check('container là lưới, không phải carousel',
      grid.classList.contains('wallet-grid') && !grid.classList.contains('wallet-scroll'));
    check('thẻ nằm trực tiếp trong lưới, không bọc div thừa',
      cards.every(c => c.parentNode === grid));
    check('ô "Thêm ví" cũng là một ô lưới',
      !!grid.querySelector('.wallet-card.add') && grid.querySelector('.wallet-card.add').parentNode === grid);

    const last = cards[cards.length - 1];
    /* jsdom không layout nên không đo được pixel; kiểm hợp đồng CSS thay vào đó */
    check('tên ví dài dựa vào ellipsis chứ không xuống dòng làm vỡ thẻ',
      last.querySelector('.wname').textContent.length > 20
      && /\.wallet-card \.wname\{[^}]*text-overflow:ellipsis/.test(
           fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8')));
    check('số âm rất lớn được thu nhỏ font thay vì cắt cụt', (() => {
      const bal = last.querySelector('.wbal');
      return bal.className.includes('amt-') && /159\.800\.000\.000/.test(bal.textContent);
    })(), last.querySelector('.wbal').textContent + ' | ' + last.querySelector('.wbal').className);
    check('mỗi thẻ có icon và cột nội dung xếp dọc',
      cards.every(c => c.querySelector('.wicon') && c.querySelector('.w-body')
        && c.querySelector('.w-body .wname') && c.querySelector('.w-body .wbal')));

    S().wallets = S().wallets.filter(w => !/^wg\d/.test(w.id));
    window.saveStorage();
    window.switchTab('dashboard'); await sleep(20);
    check('dọn dẹp: về lại số ví ban đầu', S().wallets.length === before);
  }


  console.log('\n· views render');
  for (const tab of ['dashboard', 'transactions', 'add', 'reports', 'wallets', 'budget', 'debts', 'recurring', 'events', 'categories', 'settings']) {
    const errBefore = consoleErrors.length;
    let threw = null;
    try { window.switchTab(tab); } catch (e) { threw = e.message; }
    await sleep(15);
    check('tab ' + tab, !threw && consoleErrors.length === errBefore, threw || consoleErrors[errBefore]);
  }

  console.log('\n· form khoản định kỳ');
  {
    const before = S().recurring.length;
    window.openRecurringModal(); await sleep(20);
    check('mở được form', visible('modal-recurring'));

    /* Danh mục: một dòng bấm được, danh sách nằm trong sheet — không còn hai
       băng chip cuộn ngang giấu mất lựa chọn ngoài mép phải. */
    check('danh mục là dòng chọn, không phải băng chip',
      !!$('mr-cat-row') && !$('mr-cat-chips') && !$('mr-sub-chips'));
    check('dòng danh mục hiện sẵn lựa chọn mặc định', txt('mr-cat-name').length > 0, txt('mr-cat-name'));

    window.openRecurCatPicker(); await sleep(20);
    check('bấm vào thì mở sheet chọn', visible('modal-sheet')
      && $('sheet-body').querySelectorAll('.cat-tile').length > 0);
    /* c_bill có danh mục con (s_rent) → phải hỏi tiếp chứ không chọn vội */
    window.openRecurCatPicker('c_bill'); await sleep(20);
    check('danh mục có con thì hỏi tiếp danh mục con',
      visible('modal-sheet') && $('sheet-body').querySelectorAll('.pick-item').length > 1);
    check('luôn có lối bỏ qua danh mục con',
      $('sheet-body').textContent.includes('Không chọn danh mục con'));
    const subItem = [...$('sheet-body').querySelectorAll('.pick-item')]
      .find(i => i.textContent.includes('Thuê nhà'));
    check('danh mục con của c_bill hiện ra', !!subItem, $('sheet-body').textContent.slice(0, 70));
    subItem.click(); await sleep(20);
    check('chọn xong thì đóng sheet', !visible('modal-sheet'));
    check('dòng danh mục cập nhật cả cha lẫn con',
      txt('mr-cat-name') === 'Hóa đơn' && txt('mr-cat-sub') === 'Thuê nhà',
      txt('mr-cat-name') + ' / ' + txt('mr-cat-sub'));

    /* Tần suất: 4 nút bằng nhau thay cho chip "Hàng ngày/Hàng tuần…" */
    const segs = [...$('mr-freq-seg').querySelectorAll('button')];
    check('4 nút tần suất', segs.map(b => b.textContent).join('|') === 'Ngày|Tuần|Tháng|Năm',
      segs.map(b => b.textContent).join('|'));
    check('mặc định là Tháng', segs.find(b => b.classList.contains('active')).dataset.val === 'monthly');
    segs.find(b => b.dataset.val === 'weekly').click(); await sleep(15);
    check('đổi tần suất thì nút đó sáng',
      segs.find(b => b.classList.contains('active')).dataset.val === 'weekly'
      && segs.filter(b => b.classList.contains('active')).length === 1);
    check('đơn vị "lặp mỗi" đổi theo', txt('mr-interval-unit') === 'tuần', txt('mr-interval-unit'));

    /* Ngày kết thúc là tuỳ chọn, ẩn sau công tắc. */
    check('ô ngày kết thúc ẩn khi chưa bật', $('mr-enddate').classList.contains('hidden'));
    $('mr-has-end').checked = true; window.toggleRecurEnd(); await sleep(10);
    check('bật công tắc thì hiện ô ngày', !$('mr-enddate').classList.contains('hidden'));
    const endDay = window.isoOf(new Date(new Date().getFullYear() + 1, 0, 15));
    $('mr-enddate').value = endDay;
    $('mr-has-end').checked = false; window.toggleRecurEnd(); await sleep(10);
    check('tắt lại thì XOÁ luôn giá trị, không lưu lén ngày trong ô ẩn',
      $('mr-enddate').value === '', $('mr-enddate').value);
    $('mr-has-end').checked = true; window.toggleRecurEnd();
    $('mr-enddate').value = endDay;

    $('mr-name').value = 'Netflix';
    $('mr-amount').value = '260000';
    $('mr-interval').value = '2';
    $('mr-auto').checked = false;
    window.saveRecurringModal(); await sleep(30);
    check('lưu được', S().recurring.length === before + 1 && !visible('modal-recurring'));
    const r = S().recurring[S().recurring.length - 1];
    check('lưu đúng danh mục và danh mục con',
      r.categoryId === 'c_bill' && r.subcategoryId === 's_rent',
      r.categoryId + ' / ' + r.subcategoryId);
    check('lưu đúng tần suất và số kỳ', r.frequency === 'weekly' && r.interval === 2,
      r.frequency + ' / ' + r.interval);
    check('lưu đúng ngày kết thúc', r.endDate === endDay, r.endDate);
    check('số tiền là number sạch', r.amount === 260000 && typeof r.amount === 'number', r.amount);

    /* Mở lại để sửa: form phải dựng lại đúng trạng thái vừa lưu. */
    window.openRecurringModal(r.id); await sleep(20);
    check('sửa: công tắc ngày kết thúc bật sẵn', $('mr-has-end').checked
      && !$('mr-enddate').classList.contains('hidden'));
    check('sửa: đúng nút tần suất sáng',
      $('mr-freq-seg').querySelector('button.active').dataset.val === 'weekly');
    check('sửa: dòng danh mục dựng lại đúng',
      txt('mr-cat-sub') === 'Thuê nhà', txt('mr-cat-name') + ' / ' + txt('mr-cat-sub'));
    window.closeModal('modal-recurring');
    S().recurring = S().recurring.filter(x => x.id !== r.id);
    window.saveStorage();

    const css3 = fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8');
    check('cụm lịch lặp dùng màu theo theme, không hex cứng',
      /\.recurring-card-group\{background:var\(--card-2\)/.test(css3)
      && /\.frequency-segmented-control button\.active\{background:var\(--card\)/.test(css3));
  }

  console.log('\n· settings');
  check('panel đồng bộ có nội dung', $('cloud-status').innerHTML.includes('demo@finyourtin.test'));
  window.setTheme('dark');
  await sleep(10);
  check('đổi sang dark theme', d.documentElement.getAttribute('data-theme') === 'dark');
  check('theme được mirror ra ngoài state', window.localStorage.getItem('FINYOURTIN_THEME') === 'dark');

  console.log('\n· đặt lại mật khẩu');
  fake.auth.__emit('PASSWORD_RECOVERY');
  await sleep(40);
  check('sheet đặt mật khẩu mới hiện ra', visible('modal-sheet') && !!$('pw-new'));
  $('pw-new').value = '123';
  await window.submitNewPassword(); await sleep(20);
  check('mật khẩu mới quá ngắn bị chặn', /tối thiểu 6/i.test(txt('pw-error')), txt('pw-error'));
  $('pw-new').value = 'secret123';
  await window.submitNewPassword(); await sleep(20);
  check('mật khẩu trùng mật khẩu cũ bị chặn', /khác mật khẩu cũ/i.test(txt('pw-error')), txt('pw-error'));
  check('nút lưu bật lại sau lỗi', !$('pw-submit').disabled);
  $('pw-new').value = 'brandnew456';
  await window.submitNewPassword(); await sleep(30);
  check('đổi xong thì đóng sheet', !visible('modal-sheet'));
  check('mật khẩu mới có hiệu lực',
    (await fake.auth.signInWithPassword({ email: 'demo@finyourtin.test', password: 'brandnew456' })).error == null);
  await sleep(20);

  console.log('\n· thanh nav 4 mục, không còn "Thêm"');
  {
    const tabsInNav = [...d.querySelectorAll('#main-nav .nav-item')].map(b => b.dataset.tab);
    check('nav đúng 4 mục theo thứ tự',
      tabsInNav.join() === 'dashboard,transactions,reports,settings', tabsInNav.join());
    check('không còn nút Thêm', !d.querySelector('#main-nav .nav-item[data-tab="more"]'));
    check('không còn màn hình view-more', !$('view-more'));
    check('không còn chỗ nào trỏ tới tab "more"', !d.body.innerHTML.includes("switchTab('more')"));

    // các màn hình phụ vẫn phải tới được, từ lưới Truy cập nhanh ở Tổng quan
    window.switchTab('dashboard'); await sleep(20);
    const quick = $('db-quick-access').innerHTML;
    check('lưới tiện ích gọn còn 5 ô',
      $('db-quick-access').querySelectorAll('.menu-tile').length === 5,
      $('db-quick-access').querySelectorAll('.menu-tile').length);
    check('bỏ 3 ô trùng với nút + trên nav',
      !quick.includes('openAddTransaction'), 'còn ô ghi thu/chi/chuyển ví');
    check('lưới dẫn thẳng tới các màn hình chính',
      ['wallets', 'budget', 'debts', 'recurring'].every(t => quick.includes(`switchTab('${t}')`)));
    check('khối Tiện ích nằm dưới khối Ví của bạn', (() => {
      const html = $('view-dashboard').innerHTML;
      return html.indexOf('db-wallet-scroll') < html.indexOf('db-quick-access');
    })());
    check('phần còn lại vào được qua "Tất cả tiện ích"', (() => {
      window.openAllFeatures();
      const html = $('sheet-body').innerHTML;
      const ok = ['events', 'categories', 'reports', 'transactions']
        .every(t => html.includes(`switchTab('${t}')`));
      window.closeSheet();
      return ok;
    })());
    check('không có ô Cài đặt trùng trong Truy cập nhanh', !quick.includes("switchTab('settings')"));

    window.switchTab('wallets'); await sleep(20);
    check('màn hình phụ giữ nav sáng ở Tổng quan',
      d.querySelector('#main-nav .nav-item[data-tab="dashboard"]').classList.contains('active'));
    check('nút ‹ của màn hình phụ quay về Tổng quan', (() => {
      d.querySelector('#view-wallets .sub-view-head .icon-btn').click();
      return window.eval('currentTab') === 'dashboard';
    })());

    // một kiểu header duy nhất: phẳng ở mọi trang, không trang nào bị nuốt tiêu đề
    for (const tab of ['dashboard', 'settings', 'reports', 'transactions', 'wallets']) {
      window.switchTab(tab); await sleep(15);
      check('trang ' + tab + ': header phẳng',
        $('main-header').classList.contains('hd-flat'));
    }

    window.switchTab('settings'); await sleep(20);
    check('mở đúng trang Cài đặt', visible('view-settings'));
    check('ẩn hết các trang khác', [...d.querySelectorAll('.view')]
      .filter(v => !v.classList.contains('hidden')).map(v => v.id).join() === 'view-settings');
    check('nav sáng ở Cài đặt', d.querySelector('#main-nav .nav-item[data-tab="settings"]').classList.contains('active'));
    check('Cài đặt tiếp quản đăng xuất', $('view-settings').innerHTML.includes('logout()'));
    check('Cài đặt tiếp quản tổng quan tài khoản', $('account-summary').innerHTML.includes('Ví đang quản lý'));

    /* Khối "Tiền tệ" đã gỡ — nhưng chỉ gỡ phần giao diện, lớp quy đổi bên dưới
       phải sống nguyên vẹn, nếu không ví ngoại tệ sẽ đọc sai vào tổng tài sản. */
    check('Cài đặt không còn ô chọn tiền tệ chính', !$('set-main-currency'));
    check('Cài đặt không còn bảng tỷ giá',
      !$('rates-view') && !$('rates-editor')
      && !$('view-settings').textContent.includes('Tỷ giá quy đổi'));
    check('không còn hàm nào của khối đó sót lại',
      ['renderRatesView', 'toggleRatesEditor', 'saveRates', 'changeMainCurrency']
        .every(fn => typeof window[fn] === 'undefined'),
      ['renderRatesView', 'toggleRatesEditor', 'saveRates', 'changeMainCurrency']
        .filter(fn => typeof window[fn] !== 'undefined').join(', '));
    check('mở lại Cài đặt vẫn không lỗi console', consoleErrors.length === 0, consoleErrors[0]);

    check('tiền tệ chính mặc định vẫn là VND', window.mainCurrency() === 'VND');
    delete S().app.mainCurrency;
    check('mất giá trị trong state cũng không undefined', window.mainCurrency() === 'VND');
    const keepRates = S().app.rates;
    delete S().app.rates;
    check('mất luôn bảng tỷ giá thì quy đổi 1:1, không ném lỗi',
      window.rateOf('USD') === 1 && window.toMain(100, 'USD') === 100);
    S().app.rates = keepRates;
    S().app.mainCurrency = 'VND';
    check('quy đổi ngoại tệ vẫn chạy bằng tỷ giá mặc định',
      window.toMain(1, 'USD') === window.eval('DEFAULT_RATES.USD'),
      String(window.toMain(1, 'USD')));
    check('ví vẫn chọn được tiền tệ riêng ở màn hình Ví', !!$('mw-currency'));
  }

  console.log('\n· chân trang Cài đặt');
  {
    window.switchTab('settings'); await sleep(20);
    const f = $('app-footer');
    check('có khối footer', !!f && f.classList.contains('app-footer-bank'));
    check('không còn dòng chữ cũ',
      !$('view-settings').textContent.includes('Supabase cloud sync'));
    check('đủ ba tầng: thương hiệu · trạng thái · bản quyền',
      !!f.querySelector('.footer-brand') && !!f.querySelector('.footer-status')
      && !!f.querySelector('.footer-copyright'));
    check('tên sản phẩm đúng', f.querySelector('.footer-logo-title').textContent === 'SoFin Finance');

    /* Số phiên bản phải là số THẬT của bản build. Một chuỗi cứng ở đây sẽ lệch
       khỏi APP_VERSION, mà chính APP_VERSION mới là thứ checkAppUpdate() đem so
       với release — footer nói một đằng, app tự nghĩ một nẻo. */
    const PKG2 = require('../package.json').version;
    check('badge phiên bản lấy từ bản build, không phải chữ cứng',
      f.querySelector('.footer-version-badge').textContent === 'v' + PKG2,
      f.querySelector('.footer-version-badge').textContent);

    /* Phiên bản hiện ở hai nơi: màn đăng nhập và chân trang Cài đặt. Hai nơi
       nói hai số khác nhau thì người dùng không biết tin chỗ nào — mà lúc cần
       biết chính là ngay sau khi cập nhật. */
    const lv = $('login-version');
    check('màn đăng nhập cũng hiện phiên bản', !!lv && lv.textContent.includes('v' + PKG2),
      lv && lv.textContent.trim());
    check('hai nơi nói cùng một số',
      lv.querySelector('.footer-version-badge').textContent
        === f.querySelector('.footer-version-badge').textContent);

    check('năm bản quyền theo đồng hồ, không đóng cứng',
      f.querySelector('.footer-copyright').textContent.includes('© ' + window.todayISO().slice(0, 4)),
      f.querySelector('.footer-copyright').textContent);

    /* Dòng trạng thái phải nói thật. Đèn xanh "đã kết nối" trong lúc máy đang
       offline là chi tiết làm người dùng hết tin phần còn lại của màn hình. */
    const realStatus = window.Sync.status;
    const setPhase = p => { window.Sync.status = () => ({ phase: p }); window.renderAppFooter(); };
    const dot = () => f.querySelector('.status-dot-active');
    const line = () => f.querySelector('.footer-status').textContent;

    setPhase('synced');
    check('đã đồng bộ: đèn xanh, nói đã kết nối',
      dot().classList.contains('dot-synced') && /Đã kết nối/.test(line()), line());
    setPhase('offline');
    check('mất mạng: đèn xám, KHÔNG nói đã kết nối',
      dot().classList.contains('dot-offline') && !/Đã kết nối/.test(line())
      && /Ngoại tuyến/.test(line()), line());
    setPhase('pending');
    check('đang gửi: đèn vàng', dot().classList.contains('dot-pending'), line());
    setPhase('error');
    check('lỗi đồng bộ: đèn đỏ, nói chưa gửi được',
      dot().classList.contains('dot-error') && /[Cc]hưa gửi được/.test(line()), line());
    window.Sync.status = realStatus;
    window.renderAppFooter();

    const css2 = fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8');
    check('chỉ chấm "đã kết nối" mới nhấp nháy',
      /\.status-dot-active\.dot-synced\{[^}]*animation:footerPulse/.test(css2)
      && !/\.status-dot-active\{[^}]*animation:/.test(css2));
    check('tôn trọng prefers-reduced-motion',
      /prefers-reduced-motion:reduce\)\{\s*\.status-dot-active\.dot-synced\{animation:none/.test(css2));
  }

  console.log('\n· đổi mã PIN');
  {
    // bật PIN 1234 trực tiếp qua state để khỏi bấm bàn phím số
    S().app.pinEnabled = true;
    S().app.pinHash = await window.hashPin('1234');
    window.saveStorage();
    window.switchTab('settings'); await sleep(20);
    check('hàng "Đổi mã PIN" hiện ra khi đã bật PIN', !$('pin-change-row').classList.contains('hidden'));

    window.openCredentialModal('pin'); await sleep(20);
    check('modal đổi PIN mở với đủ 3 ô',
      visible('modal-credential') && !!$('cred-current') && !!$('cred-new') && !!$('cred-confirm'));
    check('nhãn đổi theo chế độ PIN', txt('cred-current-label') === 'Mã PIN hiện tại');

    const fill = (c, n, cf) => { $('cred-current').value = c; $('cred-new').value = n; $('cred-confirm').value = cf; };
    fill('9999', '5678', '5678');
    await window.submitCredentialChange(); await sleep(20);
    check('PIN cũ sai bị chặn', /hiện tại không đúng/i.test(txt('cred-error')), txt('cred-error'));
    check('PIN không đổi khi sai mã cũ', S().app.pinHash === await window.hashPin('1234'));

    fill('1234', '5678', '8765');
    await window.submitCredentialChange(); await sleep(20);
    check('PIN mới không khớp xác nhận bị chặn', /không khớp/i.test(txt('cred-error')), txt('cred-error'));

    fill('1234', '567', '567');
    await window.submitCredentialChange(); await sleep(20);
    check('PIN không đủ 4 chữ số bị chặn', /4 chữ số/i.test(txt('cred-error')), txt('cred-error'));

    fill('1234', '1234', '1234');
    await window.submitCredentialChange(); await sleep(20);
    check('PIN mới trùng PIN cũ bị chặn', /trùng/i.test(txt('cred-error')), txt('cred-error'));

    fill('1234', '5678', '5678');
    await window.submitCredentialChange(); await sleep(40);
    check('đổi PIN thành công thì đóng modal', !visible('modal-credential'));
    check('PIN mới được lưu vào state', S().app.pinHash === await window.hashPin('5678'));
    check('PIN mới nằm trong localStorage', JSON.parse(
      window.localStorage.getItem('FINYOURTIN_STATE_V4::' + S().currentUser)).app.pinHash
      === await window.hashPin('5678'));
    check('mở khóa được bằng PIN mới', (() => {
      window.showLockScreen('verify');
      '5678'.split('').forEach(k => window.pinPress(k));
      return true;
    })());
    await sleep(200);
    check('lock screen mở ra sau khi nhập đúng', $('lock-screen').classList.contains('hidden'));
  }

  console.log('\n· đổi mật khẩu đăng nhập');
  {
    window.switchTab('settings'); await sleep(20);
    window.openCredentialModal('password'); await sleep(20);
    check('chuyển sang chế độ mật khẩu', txt('cred-current-label') === 'Mật khẩu hiện tại');

    const fill = (c, n, cf) => { $('cred-current').value = c; $('cred-new').value = n; $('cred-confirm').value = cf; };
    fill('sai-mat-khau', 'another-pass', 'another-pass');
    await window.submitCredentialChange(); await sleep(40);
    check('mật khẩu hiện tại sai bị chặn', /hiện tại không đúng/i.test(txt('cred-error')), txt('cred-error'));

    fill('brandnew456', 'short', 'short');
    await window.submitCredentialChange(); await sleep(20);
    check('mật khẩu mới quá ngắn bị chặn', /tối thiểu 6/i.test(txt('cred-error')), txt('cred-error'));

    fill('brandnew456', 'final-pass-1', 'final-pass-2');
    await window.submitCredentialChange(); await sleep(20);
    check('xác nhận không khớp bị chặn', /không khớp/i.test(txt('cred-error')), txt('cred-error'));

    fill('brandnew456', 'final-pass-1', 'final-pass-1');
    await window.submitCredentialChange(); await sleep(60);
    check('đổi mật khẩu xong thì đóng modal', !visible('modal-credential'));
    check('mật khẩu mới đăng nhập được',
      (await fake.auth.signInWithPassword({ email: 'demo@finyourtin.test', password: 'final-pass-1' })).error == null);
    check('mật khẩu cũ hết hiệu lực',
      (await fake.auth.signInWithPassword({ email: 'demo@finyourtin.test', password: 'brandnew456' })).error != null);
    await sleep(20);
  }

  console.log('\n· realtime từ thiết bị khác');
  const remote = JSON.parse(JSON.stringify(S()));
  remote.updatedAt = Date.now() + 60000;
  remote.wallets.push({ id: 'w_remote', userId: S().currentUser, name: 'Ví từ máy khác', icon: '📱', type: 'cash', currency: 'VND', startingBalance: 7000000 });
  fake.__emitRealtime({ user_id: S().currentUser, data: remote, device_id: 'other-device' });
  await sleep(40);
  check('nhận ví mới từ thiết bị khác', S().wallets.some(w => w.id === 'w_remote'));
  check('bỏ qua echo của chính mình', (() => {
    const n = S().wallets.length;
    const echo = JSON.parse(JSON.stringify(S()));
    echo.updatedAt = Date.now() + 120000;
    echo.wallets.push({ id: 'w_echo', userId: S().currentUser, name: 'echo', icon: '👛', type: 'cash', currency: 'VND', startingBalance: 0 });
    fake.__emitRealtime({ user_id: S().currentUser, data: echo, device_id: window.Sync.deviceId });
    return S().wallets.length === n;
  })());

  console.log('\n· backup');
  const csvBefore = S().transactions.length;
  const tryCall = fn => { try { fn(); return null; } catch (e) { return e.message; } };
  const csvErr = tryCall(window.exportCSV);
  const jsonErr = tryCall(window.exportJSON);
  check('export CSV không ném lỗi', !csvErr, csvErr);
  check('export JSON không ném lỗi', !jsonErr, jsonErr);
  await sleep(30);
  const [csvFile, jsonFile] = window.__downloads;
  check('CSV mở đầu bằng BOM UTF-8 (Excel đọc đúng tiếng Việt)',
    !!csvFile && !!csvFile.bytes && csvFile.bytes[0] === 0xEF && csvFile.bytes[1] === 0xBB && csvFile.bytes[2] === 0xBF,
    csvFile && csvFile.bytes && Array.from(csvFile.bytes.slice(0, 3)).join(','));
  check('CSV đúng header',
    !!csvFile && (csvFile.text || '').startsWith('Ngay,Loai,SoTien,TienTe,Vi,DanhMuc,DanhMucCon,GhiChu,SuKien'),
    csvFile && (csvFile.text || '').slice(0, 40));
  check('CSV chứa giao dịch vừa thêm', !!csvFile && (csvFile.text || '').includes('Cà phê'));
  check('JSON backup có đủ các nhóm dữ liệu', (() => {
    if (!jsonFile || !jsonFile.text) return false;
    const o = JSON.parse(jsonFile.text);
    return o.app === 'sofin' && Array.isArray(o.wallets) && Array.isArray(o.transactions) && !!o.categories;
  })());
  check('không mất giao dịch khi export', S().transactions.length === csvBefore);

  console.log('\n· demo data + sign out');
  const uid = S().currentUser;
  window.loadDemoData();
  await sleep(10);
  $('confirm-yes').click();
  await sleep(40);
  check('nạp được dữ liệu mẫu', S().transactions.length > 10, 'tx=' + S().transactions.length);
  check('dữ liệu mẫu gắn về user hiện tại', S().wallets.every(w => w.userId === uid));
  check('không còn userId demo sót lại', !JSON.stringify(S().wallets).includes('chi.a'));

  check('localStorage tách theo tài khoản', !!window.localStorage.getItem('FINYOURTIN_STATE_V4::' + uid));

  await window.Sync.flush();
  window.jumpToWallet(S().wallets[0].id); await sleep(20);   // để lại một bộ lọc "bẩn"
  await fake.auth.signOut();
  await sleep(40);
  check('đăng xuất quay về màn đăng nhập', visible('view-login'));
  check('state bị dọn khi đăng xuất', S().currentUser === null);
  check('bộ lọc không rò sang tài khoản sau', window.eval('txFilters.walletId') === 'all'
    && window.eval('reportWalletId') === 'all', window.eval('txFilters.walletId'));

  /* ---- second scenario: build with no Supabase keys ---- */
  console.log('\n· build thiếu SUPABASE_URL / ANON_KEY');
  {
    const { window: w2 } = await boot({ noConfig: true });
    const $2 = id => w2.document.getElementById(id);
    const vis2 = id => $2(id) && !$2(id).classList.contains('hidden');
    check('hiện màn hình cấu hình thay vì trắng trang', vis2('view-config'));
    check('không hiện màn đăng nhập', !vis2('view-login'));
    check('có nêu lý do', ($2('config-reason').textContent || '').length > 0, $2('config-reason').textContent);

    $2('cfg-url').value = 'không-phải-url';
    $2('cfg-key').value = 'short';
    w2.saveManualConfig();
    check('URL sai bị từ chối', !w2.localStorage.getItem('FINYOURTIN_SUPABASE_CFG'));

    $2('cfg-url').value = 'https://abcdefghijkl.supabase.co';
    $2('cfg-key').value = 'e'.repeat(60);
    try { w2.saveManualConfig(); } catch (e) { /* location.reload is a no-op in jsdom */ }
    const saved = JSON.parse(w2.localStorage.getItem('FINYOURTIN_SUPABASE_CFG') || '{}');
    check('cấu hình hợp lệ được lưu lại', saved.url === 'https://abcdefghijkl.supabase.co');
  }

  /* ---- third scenario: a dead reset link ---- */
  console.log('\n· liên kết đặt lại hết hạn');
  {
    const { window: w3 } = await boot({
      url: 'https://finyourtin.test/#error=access_denied&error_code=otp_expired'
           + '&error_description=Email+link+is+invalid+or+has+expired'
    });
    const $3 = id => w3.document.getElementById(id);
    check('vẫn về màn đăng nhập, không trắng trang', !$3('view-login').classList.contains('hidden'));
    check('nói rõ liên kết đã hết hạn', /hết hạn/i.test($3('auth-error').textContent), $3('auth-error').textContent);
    check('không hiện sheet đặt mật khẩu', $3('modal-sheet').classList.contains('hidden'));
  }

  /* ---- report ---- */
  console.log('\n' + '─'.repeat(52));
  if (failures.length) {
    console.log(`✗ ${failures.length} thất bại / ${passed + failures.length} kiểm tra\n`);
    failures.forEach(f => console.log('  · ' + f));
    console.log('');
    process.exit(1);
  }
  console.log(`✓ ${passed}/${passed} kiểm tra đạt\n`);
  process.exit(0);
})().catch(e => { console.error('\n✗ Smoke test crashed:\n', e); process.exit(1); });
