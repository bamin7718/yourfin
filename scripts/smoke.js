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
  /* Luật 1 của lịch sử điều hướng: có state gốc từ lúc app load, chưa cần
     biết ai đăng nhập. Thiếu nó thì popstate đầu tiên nhận event.state=null
     và không còn gì để dựa vào ngoài việc đoán. */
  check('history có state gốc ngay khi chưa đăng nhập',
    !!window.history.state && 'activeTab' in window.history.state,
    JSON.stringify(window.history.state));
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
    /* ĐÃ ĐẢO NGƯỢC quyết định cũ (lưới 2 cột): từ khi Giao dịch gần đây và
       Tiện ích lên đầu trang chủ, chiều dọc đắt hơn chiều ngang. Thứ phải
       khoá lại là mảnh hở của thẻ thứ ba — không có nó thì không ai biết là
       cuộn được, và đó đúng là lỗi mà lưới 2 cột ngày trước dựng lên để sửa. */
    check('thanh ví cuộn ngang, ẩn thanh cuộn',
      new RegExp('\\.wallet-strip{[^}]*display:flex').test(css)
      && new RegExp('\\.wallet-strip{[^}]*overflow-x:auto').test(css)
      && new RegExp('\\.wallet-strip::-webkit-scrollbar{display:none').test(css));
    check('thẻ ví rộng 46% để luôn hở phần thẻ kế tiếp (tín hiệu cuộn được)',
      new RegExp('\\.wallet-strip > \\*{flex:0 0 46%').test(css));
    /* Trong một hàng flex cuộn ngang thì "ô lẻ đứng một mình nửa hàng" không
       còn là vấn đề, nên luật grid-column của thời lưới 2 cột đã bỏ. */
    check('ô "Thêm ví" xếp ngang, hẹp hơn một thẻ ví',
      new RegExp('\\.wallet-card.add{flex-direction:row').test(css)
      && new RegExp('\\.wallet-strip > \\.wallet-card.add{flex:0 0 30%').test(css)
      && !/nth-child\(odd\)\{grid-column/.test(css));
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
    check('ví xếp thành thanh cuộn ngang, không còn lưới 2 cột',
      new RegExp('\\.wallet-strip{[^}]*overflow-x:auto').test(css)
      && !/\.wallet-grid\{/.test(css));
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
      new RegExp('isNativeApp\\(\\)\\){[\\s\\S]{0,300}?setTimeout\\(\\(\\)=>checkAppUpdate\\(\\), 3000\\)').test(src));
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
    /* Engine OCR nặng hàng chục MB và tải theo yêu cầu — để nó rơi vào cache
       của shell là mỗi deploy xoá đi tải lại, và ăn chung quota với dữ liệu. */
    check('sw: không cache tài nguyên khác origin',
      /url\.origin !== self\.location\.origin\) return;/.test(sw));
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
    check('container là thanh cuộn ngang',
      grid.classList.contains('wallet-strip') && !grid.classList.contains('wallet-grid'));
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
    check('khối Tiện ích nằm TRÊN khối Ví của bạn', (() => {
      const html = $('view-dashboard').innerHTML;
      return html.indexOf('db-quick-access') < html.indexOf('db-wallet-scroll');
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

  console.log('\n· trợ lý chat: bóc tách số tiền, ngày, loại');
  {
    const amt = window.parseChatAmount;
    check('“35k” = 35.000', amt('cà phê 35k') === 35000, String(amt('cà phê 35k')));
    check('“1.2tr” = 1.200.000', amt('tiền nhà 1.2tr') === 1200000, String(amt('tiền nhà 1.2tr')));
    check('“1.2m” = 1.200.000', amt('thưởng 1.2m') === 1200000, String(amt('thưởng 1.2m')));
    check('“50000” = 50.000', amt('ăn trưa 50000') === 50000);
    check('“50.000đ” = 50.000 (dấu chấm là ngăn nghìn)', amt('ăn trưa 50.000đ') === 50000, String(amt('ăn trưa 50.000đ')));
    check('“1.200.000” = 1.200.000', amt('học phí 1.200.000') === 1200000, String(amt('học phí 1.200.000')));
    check('“2 triệu” = 2.000.000', amt('mua điện thoại 2 triệu') === 2000000, String(amt('mua điện thoại 2 triệu')));
    /* Ngày phải bị bóc ra TRƯỚC số tiền, không thì 2026 là con số lớn nhất
       trong câu và nó thắng "35k". */
    check('năm trong ngày không bị đọc thành số tiền', amt('cà phê 35k ngày 12/03/2026') === 35000,
      String(amt('cà phê 35k ngày 12/03/2026')));
    check('“35 khách” không bị đọc thành đơn vị nghìn của chữ k', amt('đặt bàn cho 8 khách 35k') === 35000,
      String(amt('đặt bàn cho 8 khách 35k')));

    const today = window.todayISO();
    check('không nói ngày thì lấy hôm nay', window.parseChatDate('cà phê 35k') === today);
    check('“hôm qua” lùi một ngày', window.parseChatDate('cà phê 35k hôm qua') === window.addDaysISO(today, -1));
    /* Mốc cố định, không phụ thuộc ngày chạy test. */
    check('“12/03/2026” → 2026-03-12 (ngày trước, tháng sau)',
      window.parseChatDate('chi 500k ngày 12/03/2026') === '2026-03-12', window.parseChatDate('chi 500k ngày 12/03/2026'));
    check('ngày 31/02 bị kẹp trong tháng, không nhảy sang tháng 3',
      window.parseChatDate('chi 500k 31/02/2026') === '2026-02-28', window.parseChatDate('chi 500k 31/02/2026'));

    check('mặc định là chi tiêu', window.detectChatType('cà phê 35k') === 'expense');
    check('“nhận lương” là thu nhập', window.detectChatType('nhận lương tháng 9 15tr') === 'income');
    check('“thu tiền nhà” là thu nhập', window.detectChatType('thu tiền nhà 3tr') === 'income');
    check('“trả tiền điện” vẫn là chi', window.detectChatType('trả tiền điện 500k') === 'expense');
  }

  console.log('\n· trợ lý chat: tự học từ khoá từ lịch sử');
  {
    /* Dạy đúng một lần, qua chính form thêm giao dịch — đây là toàn bộ bài học. */
    window.switchTab('add'); await sleep(20);
    window.setTxType('expense');
    window.selectTxWallet(S().wallets[0].id);
    window.selectTxCategory('c_food');
    window.selectTxSub('s_lunch');
    window.applyTxAmount(45000);
    $('tx-note').value = 'Bún bò Huế';
    $('tx-date').value = window.todayISO();
    window.saveTransaction(); await sleep(30);

    const idx = window.buildHistoryMappingIndex();
    check('ma trận học được cả từ đơn lẫn cụm từ trong ghi chú', idx.has('bun') && idx.has('bun bo'));

    const m1 = window.matchWalletAndCategory('bún bò 40k', 'expense');
    check('khớp từ khoá → danh mục đã dùng trong quá khứ', m1.catId === 'c_food' && m1.matched === true, m1.catId);
    check('… nhớ luôn cả danh mục con đã chọn lần trước', m1.subId === 's_lunch', String(m1.subId));
    check('… bỏ dấu vẫn khớp', window.matchWalletAndCategory('bun bo 40k', 'expense').catId === 'c_food');

    const m2 = window.matchWalletAndCategory('zzz qwerty 40k', 'expense');
    check('không khớp từ nào → về "Khác", và nói rõ là chưa nhận diện được',
      m2.catId === 'c_other_exp' && m2.matched === false, m2.catId + '/' + m2.matched);
    /* Một từ học từ chi tiêu mà trả về cho khoản thu là sai hẳn chiều tiền. */
    check('từ khoá chi tiêu không rò sang thu nhập',
      window.matchWalletAndCategory('bún bò 40k', 'income').matched === false);
    check('tài khoản chưa có lịch sử vẫn khớp được theo tên danh mục',
      window.matchWalletAndCategory('tiền điện 500k', 'expense').catId === 'c_bill',
      window.matchWalletAndCategory('tiền điện 500k', 'expense').catId);
  }

  console.log('\n· trợ lý chat: gợi ý ví thông minh');
  {
    /* Dạy cùng một từ khoá với hai ví khác nhau, lệch tần suất 2-1: ví HAY
       DÙNG phải thắng, không phải ví ghi gần nhất. */
    const ws = S().wallets;
    const w1 = ws[0].id, w2 = ws[1].id;
    const teach = (note, walletId, catId) => {
      window.switchTab('add');
      window.setTxType('expense');
      window.selectTxWallet(walletId);
      window.selectTxCategory(catId);
      window.applyTxAmount(60000);
      $('tx-note').value = note;
      $('tx-date').value = window.todayISO();
      window.saveTransaction();
    };
    teach('Xăng xe máy', w2, 'c_transport'); await sleep(20);
    teach('Xăng xe máy', w2, 'c_transport'); await sleep(20);
    teach('Xăng xe máy', w1, 'c_transport'); await sleep(20);

    const m = window.matchWalletAndCategory('xăng 50k', 'expense');
    check('ma trận nhớ cả ví hay dùng cho từ khoá đó', m.walletId === w2, m.walletId + ' vs ' + w2);
    check('… và đánh dấu là suy từ lịch sử', m.walletMatched === true);
    check('… danh mục vẫn đúng', m.catId === 'c_transport', m.catId);
    const gone = window.matchWalletAndCategory('zzz qwerty', 'expense');
    check('không khớp gì thì không bịa ra ví', gone.walletId === null && gone.walletMatched === false,
      String(gone.walletId));

    const draft = await window.processChatMessage('xăng 50k', null);
    check('draft dùng ví học được, không phải ví mặc định', draft.walletId === w2, draft.walletId);
    const draft2 = await window.processChatMessage('zzz qwerty 50k', null);
    check('không học được thì về ví mặc định (vẫn là ví có thật)',
      !!S().wallets.find(w => w.id === draft2.walletId) && draft2.walletMatched === false);
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· trợ lý chat: ngăn chat và thẻ xác nhận');
  {
    window.switchTab('dashboard'); await sleep(20);
    check('nút nổi hiện trong phiên', visible('chat-fab'));
    check('nút nổi dùng icon SVG thừa kế màu, không phải emoji', !!$('chat-fab').querySelector('svg'));

    window.openChatDrawer(); await sleep(20);
    check('mở được ngăn chat', visible('chat-drawer'));
    check('nút nổi ẩn đi khi ngăn chat mở', !visible('chat-fab'));
    check('ngăn chat đủ ba tầng: header · body · footer',
      !!$('chat-drawer').querySelector('.chat-head') && !!$('chat-body') && !!$('chat-drawer').querySelector('.chat-foot'));
    check('footer có nút đính kèm, ô nhập và nút Gửi',
      !!$('chat-attach') && !!$('chat-input') && txt('chat-send') === 'Gửi');
    check('bot chào trước khi người dùng gõ gì', $('chat-body').children.length === 1);

    $('chat-input').value = 'bún bò 40k';
    window.chatSend(); await sleep(80);
    const bubbles = [...$('chat-body').children];
    check('tin nhắn người dùng là bong bóng .user',
      bubbles.some(b => b.classList.contains('user') && /bún bò 40k/.test(b.textContent)));
    check('ô nhập được dọn sau khi gửi', $('chat-input').value === '');

    const card = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    check('bot trả về thẻ hành động', !!card);
    check('thẻ nêu số tiền đã bóc tách', /40\.000/.test(card.textContent), card.textContent.slice(0, 80));
    check('thẻ nêu danh mục học được từ lịch sử', /Ăn uống/.test(card.textContent));
    check('thẻ nêu một ví có thật', S().wallets.some(w => card.textContent.includes(w.name)));
    const labels = [...card.querySelectorAll('button')].map(b => b.textContent.trim());
    check('đủ hai nút hành động', labels.includes('Tự động lưu') && labels.includes('Tùy chỉnh thêm'), labels.join(' | '));

    const before = S().transactions.length;
    card.querySelector('.btn-primary').click(); await sleep(40);
    const t = S().transactions[S().transactions.length - 1];
    check('“Tự động lưu” ghi thẳng vào sổ', S().transactions.length === before + 1);
    check('… đúng số tiền', t.amount === 40000, String(t.amount));
    check('… đúng danh mục đã học', t.categoryId === 'c_food', t.categoryId);
    check('… status suy ra từ ngày, không đặt tay', t.status === 'completed' && t.date === window.todayISO());
    check('… walletId trỏ vào ví có thật', !!S().wallets.find(w => w.id === t.walletId));
    check('… ghi chú giữ nguyên câu người dùng gõ (chính nó là dữ liệu học lần sau)',
      t.note === 'bún bò 40k', t.note);
    check('thẻ đổi thành dòng đã lưu, không lưu được hai lần', !!$('chat-body').querySelector('.bca-saved'));

    /* Ca "Khác": phải NÓI RA là chưa nhận diện được, không im lặng nhận bừa. */
    $('chat-input').value = 'zzz qwerty 88k';
    window.chatSend(); await sleep(80);
    const card2 = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    check('không khớp thì thẻ ghi rõ "Chưa nhận diện được, bấm để đổi"',
      /Chưa nhận diện được, bấm để đổi/.test(card2.textContent));
    check('… và tạm gán danh mục Khác', /Khác/.test(card2.textContent));

    card2.querySelector('.btn-secondary').click(); await sleep(40);
    check('“Tùy chỉnh thêm” mở form thêm giao dịch đầy đủ', visible('view-add'));
    check('… và tự đóng ngăn chat lại', !visible('chat-drawer'));
    check('… nạp sẵn số tiền', window.eval('txAmount') === 88000, String(window.eval('txAmount')));
    check('… nạp sẵn ghi chú', $('tx-note').value === 'zzz qwerty 88k');

    window.openChatDrawer(); await sleep(10);
    check('thu nhỏ rồi mở lại thì hội thoại còn nguyên', $('chat-body').children.length > 1);
    window.closeChatDrawer(true); await sleep(10);
    check('bấm ✕ thì xoá hội thoại', $('chat-body').children.length === 0);
    check('… và trả lại nút nổi', visible('chat-fab'));
    window.cancelAddTx(); await sleep(20);
  }

  console.log('\n· trợ lý chat: lưu xong là xong ngay, không cần mở lại app');
  {
    window.closeChatDrawer(true);
    window.switchTab('dashboard'); await sleep(20);
    window.openChatDrawer(); await sleep(20);
    const balBefore = window.getUserTotalAssets();
    const nBefore = S().transactions.length;

    $('chat-input').value = 'bún bò 55k';
    window.chatSend(); await sleep(80);
    const card = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    card.querySelector('.btn-primary').click(); await sleep(60);

    /* 1. Bản ghi vào sổ ngay và ở trạng thái đã hoàn thành. */
    const t = S().transactions[S().transactions.length - 1];
    check('lưu xong là bản ghi có ngay trong sổ',
      S().transactions.length === nBefore + 1 && t.amount === 55000);
    check('… và đã hoàn thành, không phải dự kiến',
      t.status === 'completed' && !window.eval(`isPending(state.transactions[state.transactions.length-1])`),
      t.status);

    /* 2. Thẻ trong chat đổi thành thẻ giao dịch ĐẦY ĐỦ THÔNG TIN ngay tại
       chỗ — trước đây nó chỉ in một dòng "✓ Đã lưu", nên muốn xem thông tin
       hay tạo lại thì phải tắt app mở lại cho lịch sử vẽ lại thẻ. */
    const saved = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    check('thẻ trong chat xác nhận đã ghi vào sổ', !!saved.querySelector('.bca-saved'));
    check('… và hiện luôn thông tin giao dịch (số tiền, ghi chú, ví, danh mục)',
      /55\.000/.test(saved.textContent) && /bún bò 55k/.test(saved.textContent)
      && /💳/.test(saved.textContent) && /🏷️/.test(saved.textContent),
      saved.textContent.replace(/\s+/g, ' ').slice(0, 120));
    check('… kèm nút "Tạo lại" ngay tại đó, không phải mở lại app',
      !!saved.querySelector('.hist-clone') && /Tạo lại/.test(saved.querySelector('.hist-clone').textContent));

    /* 3. Số dư và các khối phía sau ngăn chat đã cập nhật, không chờ reload. */
    check('tổng tài sản cập nhật ngay', window.getUserTotalAssets() === balBefore - 55000,
      balBefore + ' -> ' + window.getUserTotalAssets());
    window.closeChatDrawer(false); await sleep(20);
    check('khối "Giao dịch gần đây" có ngay bản ghi mới, không cần reload',
      /bún bò 55k/.test($('recent-transactions-list').textContent),
      $('recent-transactions-list').textContent.replace(/\s+/g, ' ').slice(0, 80));

    /* 4. Bấm "Tạo lại" ngay trên thẻ vừa lưu. */
    window.openChatDrawer(); await sleep(20);
    const clone = [...$('chat-body').querySelectorAll('.hist-clone')].pop();
    const n2 = S().transactions.length;
    clone.click(); await sleep(60);
    const newCard = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    check('bấm "Tạo lại" trên thẻ vừa lưu thì ra thẻ xác nhận mới',
      !!newCard && !!newCard.querySelector('.btn-primary') && S().transactions.length === n2);
    newCard.querySelector('.btn-primary').click(); await sleep(60);
    check('… xác nhận thì có bản ghi thứ hai y như vậy',
      S().transactions.length === n2 + 1
      && S().transactions[S().transactions.length - 1].amount === 55000);

    /* 5. Nút "Tạo lại" phải trỏ đúng bản ghi kể cả sau khi lịch sử bị cắt còn
       100 — trước đây nó dùng CHỈ SỐ mảng, mà slice(-100) làm mọi chỉ số
       trượt đi, nên nút cũ sẽ dựng lại nhầm một giao dịch khác. */
    const src = fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8');
    check('nút "Tạo lại" khoá theo id ổn định, không theo chỉ số mảng',
      /cloneChatTransaction\('\$\{lid\}'\)/.test(src) && /lid: uid\('lg'\)/.test(src));
    check('… và mỗi bản ghi lịch sử có lid riêng',
      window.eval('chatLog.filter(m=>m.role==="tx").every(m=>!!m.lid)'));

    check('không có lỗi console', consoleErrors.length === 0, consoleErrors[0]);
    window.closeChatDrawer(true);
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· trợ lý chat: lịch sử 100 bản ghi + nút Tạo lại');
  {
    const KEY = 'sofin_chat_history::' + S().currentUser;
    const stored = () => JSON.parse(window.localStorage.getItem(KEY) || '[]');

    window.closeChatDrawer(false);
    window.eval('saveChatHistory([])');
    window.openChatDrawer(); await sleep(20);
    $('chat-body').innerHTML = '';

    /* Ghi một giao dịch qua chat rồi đóng/mở lại ngăn chat: hội thoại phải
       còn nguyên, không phải một tờ giấy trắng. */
    $('chat-input').value = 'bún bò 40k';
    window.chatSend(); await sleep(80);
    const card = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    card.querySelector('.btn-primary').click(); await sleep(40);

    check('lịch sử được lưu vào localStorage theo tài khoản',
      stored().length > 0 && !window.localStorage.getItem('sofin_chat_history'),
      'entries=' + stored().length);
    check('câu người dùng nhắn được lưu', stored().some(m => m.role === 'user' && /bún bò 40k/.test(m.text)));
    check('giao dịch đã lưu vào sổ cũng vào lịch sử dưới dạng bản ghi tx',
      stored().some(m => m.role === 'tx' && m.tx && m.tx.amount === 40000),
      JSON.stringify(stored().filter(m => m.role === 'tx').slice(-1)));
    /* Lưu CHỮ, không lưu HTML: HTML ôm theo id của draft trong RAM, nạp lại là
       một cái thẻ có nút bấm không làm gì cả. */
    check('lịch sử lưu chữ, không lưu HTML',
      !stored().some(m => /<[a-z]/i.test(m.text || '')), JSON.stringify(stored().slice(-1)));

    window.closeChatDrawer(false); await sleep(10);
    $('chat-body').innerHTML = '';
    window.openChatDrawer(); await sleep(30);
    check('mở lại ngăn chat thì hội thoại được khôi phục',
      $('chat-body').children.length === stored().length,
      $('chat-body').children.length + '/' + stored().length);
    check('… và không chào lại từ đầu', !/Chào /.test($('chat-body').textContent));
    /* Khôi phục KHÔNG được ghi log lần nữa, không thì mỗi lần mở lại nhân đôi. */
    const n = stored().length;
    $('chat-body').innerHTML = '';
    window.openChatDrawer(); await sleep(20);
    check('khôi phục không nhân đôi lịch sử', stored().length === n, n + ' -> ' + stored().length);

    /* Thẻ "Giao dịch cũ" có nút Tạo lại. */
    const hist = $('chat-body').querySelector('.hist-clone');
    check('giao dịch cũ hiện thành thẻ có nút "Tạo lại"',
      !!hist && /Tạo lại/.test(hist.textContent));
    check('… kèm nhãn "Giao dịch cũ" và ngày', !!$('chat-body').querySelector('.hist-badge'));

    const txBefore = S().transactions.length;
    hist.click(); await sleep(60);
    const clone = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    check('bấm "Tạo lại" thì ra thẻ xác nhận MỚI, chưa ghi vào sổ',
      !!clone && S().transactions.length === txBefore);
    check('… đúng số tiền của bản ghi cũ', /40\.000/.test(clone.textContent), clone.textContent.slice(0, 60));
    /* Tạo lại nghĩa là LẦN NÀY: ngày phải là hôm nay, không phải ngày cũ. */
    check('… nhưng ngày là hôm nay, không phải ngày của giao dịch cũ',
      clone.textContent.includes(window.fmtDate(window.todayISO())),
      clone.textContent.slice(0, 120));
    clone.querySelector('.btn-primary').click(); await sleep(40);
    const t = S().transactions[S().transactions.length - 1];
    check('xác nhận thì lưu thành giao dịch mới',
      S().transactions.length === txBefore + 1 && t.amount === 40000 && t.date === window.todayISO());

    /* Trần 100: cắt từ đầu, giữ 100 bản ghi cuối. */
    window.eval(`saveChatHistory(Array.from({length:130}, (_,i)=>({role:'bot', text:'m'+i, at:Date.now()})))`);
    check('luôn cắt còn 100 bản ghi gần nhất', stored().length === 100, String(stored().length));
    check('… giữ phần MỚI nhất, bỏ phần cũ',
      stored()[0].text === 'm30' && stored()[99].text === 'm129',
      stored()[0].text + ' … ' + stored()[99].text);

    /* Xoá hội thoại là một hành động riêng, có hỏi lại — nút ✕ chỉ đóng. */
    check('nút ✕ chỉ đóng, không xoá lịch sử',
      /closeChatDrawer\(false\)/.test($('chat-drawer').innerHTML));
    check('có nút xoá hội thoại riêng', /clearChatHistory\(\)/.test($('chat-drawer').innerHTML));
    window.clearChatHistory(); await sleep(20);
    $('confirm-yes').click(); await sleep(30);
    check('xoá hội thoại thì localStorage cũng sạch', stored().length <= 1, String(stored().length));

    window.closeChatDrawer(false);
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· trợ lý chat: thiếu số tiền thì hỏi lại, không tạo bản ghi lỗi');
  {
    window.closeChatDrawer(true);
    window.openChatDrawer(); await sleep(20);
    const bubbles = () => [...$('chat-body').children];
    const lastText = () => bubbles()[bubbles().length - 1].textContent;

    /* Bước 1: câu không có số tiền. */
    const txBefore = S().transactions.length;
    $('chat-input').value = 'Vừa mua áo mới';
    window.chatSend(); await sleep(80);
    check('không có số tiền thì KHÔNG dựng thẻ xác nhận',
      !bubbles()[bubbles().length - 1].querySelector('.bot-card-action'), lastText().slice(0, 50));
    check('bot hỏi lại số tiền một cách tự nhiên',
      /bao nhiêu/i.test(lastText()) && /\?/.test(lastText()), lastText().slice(0, 80));
    check('… và nhắc lại phần đã hiểu được, để không phải gõ lại cả câu',
      /Vừa mua áo mới/.test(lastText()), lastText().slice(0, 80));
    check('… chưa ghi gì vào sổ', S().transactions.length === txBefore);
    check('… và giữ ý định dở dang lại', window.eval('!!pendingChatContext'));

    /* Bước 2: trả lời chỉ bằng con số → gộp vào context. */
    $('chat-input').value = '200k';
    window.chatSend(); await sleep(80);
    const card = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    check('trả lời "200k" thì ra thẻ xác nhận hoàn chỉnh', !!card);
    check('… đúng số tiền vừa nhắn', /200\.000/.test(card.textContent), card.textContent.slice(0, 60));
    /* Ghi chú phải là câu GỐC, không phải "200k": nó vừa là thứ hiện trong sổ,
       vừa là dữ liệu học cho lần sau. */
    check('… và giữ ghi chú của câu đầu, không phải chuỗi "200k"', (() => {
      const d = window.eval(`JSON.stringify([...chatDrafts.values()].pop())`);
      return /Vừa mua áo mới/.test(d) && !/"note":"200k"/.test(d);
    })(), window.eval(`JSON.stringify([...chatDrafts.values()].pop()||{}).slice(0,120)`));
    check('… và dọn context sau khi gộp', window.eval('!pendingChatContext'));

    /* Một câu MỚI có số tiền không được gộp vào context cũ. */
    $('chat-input').value = 'Đổ xăng';
    window.chatSend(); await sleep(80);
    check('câu mới thiếu tiền: lại hỏi lại', /bao nhiêu/i.test(lastText()));
    $('chat-input').value = 'cà phê 30k';
    window.chatSend(); await sleep(80);
    const card2 = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    check('câu mới CÓ số tiền thì là giao dịch mới, không dính vào "Đổ xăng"',
      /cà phê 30k/.test(window.eval(`JSON.stringify([...chatDrafts.values()].pop()||{})`)),
      window.eval(`JSON.stringify([...chatDrafts.values()].pop()||{}).slice(0,100)`));
    check('… và context cũ bị bỏ, không treo lại', window.eval('!pendingChatContext'));

    /* Hạn của context: một ý định của nửa tiếng trước không được lặng lẽ dính
       vào con số bây giờ. */
    check('context có hạn 10 phút', /CHAT_CONTEXT_TTL = 10 \* 60 \* 1000/.test(
      fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8')));
    $('chat-input').value = 'Ăn trưa';
    window.chatSend(); await sleep(80);
    window.eval('pendingChatContext.at = Date.now() - 11*60*1000');
    check('context hết hạn thì không còn sống', window.eval('!chatContextAlive()'));

    /* validateChatPayload + câu hỏi */
    check('validateChatPayload nêu đúng trường còn thiếu',
      window.eval(`JSON.stringify(validateChatPayload({amount:0, walletId:null, catId:null}))`)
        === JSON.stringify(['amount','wallet','category']));
    check('câu hỏi thiếu tiền luôn là một câu hỏi thật',
      window.eval(`[0,1,2].every(()=>/\\?|nhé/.test(generateMissingInfoPrompt('amount', {note:'x'})))`));

    window.closeChatDrawer(true);
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· trợ lý chat: hỏi dữ liệu + chuyển trang kèm bộ lọc');
  {
    const pi = window.parseQueryIntent;
    check('“chi nhiều nhất” → HIGHEST_EXPENSE', pi('tháng này chi nhiều nhất vào đâu?').kind === 'HIGHEST_EXPENSE',
      JSON.stringify(pi('tháng này chi nhiều nhất vào đâu?')));
    check('“nhỏ nhất” → LOWEST_EXPENSE', pi('khoản chi nhỏ nhất tháng trước').kind === 'LOWEST_EXPENSE');
    check('“còn bao nhiêu” → BALANCE_CHECK', pi('còn bao nhiêu tiền?').kind === 'BALANCE_CHECK');
    check('“bao nhiêu” → CATEGORY_TOTAL', pi('ăn uống tháng này bao nhiêu?').kind === 'CATEGORY_TOTAL');
    check('câu không phải hỏi thì trả null (để rơi về luồng tạo giao dịch)',
      pi('cà phê 35k') === null);
    /* Chữ "tổng cộng" nằm trên mọi tờ bill — có số tiền rõ ràng thì đây là
       giao dịch, không phải câu hỏi. */
    check('có số tiền rõ ràng thì không bị hiểu thành câu hỏi',
      window.chatHasExplicitAmount('trà sữa tổng cộng 45k') === true
      && window.chatHasExplicitAmount('chi nhiều nhất tháng 9') === false);

    check('mốc mặc định là tháng này', pi('chi nhiều nhất').period === 'this_month');
    check('“tháng trước” → last_month', pi('chi nhiều nhất tháng trước').period === 'last_month');
    check('“năm nay” → this_year', pi('chi nhiều nhất năm nay').period === 'this_year');
    check('“7 ngày” → last_7_days', pi('chi nhiều nhất 7 ngày qua').period === 'last_7_days');

    /* Ví bóc theo TÊN, danh mục bóc qua ma trận từ khoá (nên "xăng" cũng ra
       Di chuyển chứ không cần gõ đúng chữ "di chuyển"). */
    const w0 = S().wallets[0];
    check('bóc được ví theo tên', pi('còn bao nhiêu tiền trong ' + w0.name).walletId === w0.id,
      String(pi('còn bao nhiêu tiền trong ' + w0.name).walletId));
    check('bóc được danh mục qua ma trận từ khoá',
      pi('xăng tháng này bao nhiêu').categoryId === 'c_transport',
      String(pi('xăng tháng này bao nhiêu').categoryId));

    /* executeQuery tính bằng chính hàm mà báo cáo dùng, nên không thể ra một
       con số khác với tab Báo cáo. */
    const res = window.executeQuery(pi('tháng này chi nhiều nhất'));
    const mine = window.eval(`(function(){
      const k = monthKey(todayISO());
      const e = getUserTransactions().filter(t=>t.type==='expense' && monthKey(t.date)===k);
      return e.length ? e.reduce((a,t)=>txMain(t)>txMain(a)?t:a).id : null;
    })()`);
    check('trả đúng khoản chi lớn nhất trong kỳ', res.nav.highlightTxId === mine,
      res.nav.highlightTxId + ' vs ' + mine);
    check('nav mang đủ hợp đồng {view, period, categoryId, walletId, highlightTxId}',
      ['view','period','categoryId','walletId','highlightTxId'].every(k => k in res.nav),
      Object.keys(res.nav).join(','));

    const bal = window.executeQuery(pi('tổng tài sản còn bao nhiêu'));
    check('BALANCE_CHECK trả tổng tài sản ròng', bal.title.includes(window.fmt(window.getUserTotalAssets())),
      bal.title);
    check('… và dẫn sang màn Ví', bal.nav.view === 'wallets');

    /* Bot trả lời bằng thẻ có hyperlink, và KHÔNG tạo giao dịch nháp nào. */
    window.openChatDrawer(); await sleep(20);
    const txBefore = S().transactions.length;
    $('chat-input').value = 'tháng này chi nhiều nhất vào đâu?';
    window.chatSend(); await sleep(60);
    const card = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    check('bot trả lời bằng thẻ kết quả', !!card && !!card.querySelector('.chat-link'));
    check('… không có nút "Tự động lưu" (đây là câu hỏi, không phải giao dịch)',
      !/Tự động lưu/.test(card.textContent));
    check('… và không ghi gì vào sổ', S().transactions.length === txBefore);

    /* Bấm hyperlink: sang tab đã lọc sẵn, đúng kỳ, và mở chi tiết bản ghi. */
    card.querySelector('.chat-link').click(); await sleep(60);
    check('bấm link thì sang tab Giao dịch', visible('view-transactions'));
    check('… đóng ngăn chat lại', !visible('chat-drawer'));
    check('… và mang theo bộ lọc đúng kỳ + chỉ khoản chi',
      window.eval('txFilters.range') === 'thismonth' && window.eval('txFilters.type') === 'expense',
      window.eval('JSON.stringify(txFilters)'));
    check('… mở luôn chi tiết khoản được hỏi', visible('modal-tx-detail'));
    window.closeModal('modal-tx-detail'); await sleep(20);

    /* Câu hỏi theo danh mục dẫn sang tab Giao dịch (nơi có bộ lọc danh mục),
       còn câu hỏi không danh mục thì sang Báo cáo. */
    const catQ = window.executeQuery(pi('xăng tháng trước bao nhiêu'));
    check('hỏi theo danh mục → tab Giao dịch', catQ.nav.view === 'transactions', catQ.nav.view);
    const allQ = window.executeQuery(pi('tháng trước chi bao nhiêu'));
    check('hỏi tổng cả kỳ → tab Báo cáo', allQ.nav.view === 'report', allQ.nav.view);
    window.chatNavigate(allQ.nav); await sleep(60);
    check('link báo cáo đặt đúng mốc tháng trước',
      visible('view-reports') && window.eval('reportRangeKey') === 'lastmonth',
      window.eval('reportRangeKey'));

    window.closeChatDrawer(true);
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· trợ lý chat: đọc hoá đơn');
  {
    /* Phần bóc tách văn bản chạy được mà không cần engine OCR — đó cũng chính
       là lý do nó tách riêng khỏi chatOcrImage(). */
    const bill = window.parseBillText(
      'CƠM TẤM PHÚC LỘC\n123 Lê Lợi, Q1\nNgày: 05/09/2026  19:30\n'
      + 'Cơm tấm  2 x 55.000\nNước ngọt  15.000\nTỔNG CỘNG: 125.000\nTiền khách đưa 200.000');
    check('bill: lấy số ở dòng có nhãn TỔNG CỘNG, không phải số lớn nhất',
      bill.amount === 125000, String(bill.amount));
    check('bill: đọc được ngày trên hoá đơn', bill.date === '2026-09-05', String(bill.date));
    check('bill: ghi chú lấy tên cửa hàng', /CƠM TẤM PHÚC LỘC/.test(bill.note), bill.note);

    const noLabel = window.parseBillText('QUÁN NƯỚC\nTrà đào 45.000\nBánh 30.000\n75.000');
    check('bill không nhãn: lấy con số lớn nhất', noLabel.amount === 75000, String(noLabel.amount));
    check('bill trống: không đoán bừa', window.parseBillText('').amount === 0);

    /* Boot không được kéo theo engine OCR nào — offline-first là ràng buộc
       cứng của app, Tesseract chỉ được nạp khi người dùng gửi ảnh và đồng ý. */
    check('boot không nạp engine OCR', !window.Tesseract);
  }

  console.log('\n· trợ lý chat: chuyển ví & định kỳ bằng lời');
  {
    const pci = window.parseChatIntent;
    const byName = n => S().wallets.find(w => w.name === n);
    const bank = byName('Ngân hàng'), cash = byName('Tiền mặt');

    check('“chuyển … sang …” → TRANSFER', pci('chuyển 2tr từ Ngân hàng sang Tiền mặt').kind === 'TRANSFER');
    check('“hàng tháng” → RECURRING', pci('tiền nhà 4tr hàng tháng').kind === 'RECURRING');
    check('câu thu/chi thường vẫn là SINGLE_TRANSACTION', pci('cà phê 35k').kind === 'SINGLE_TRANSACTION');

    /* Hướng đi của tiền đọc theo chữ dẫn ("từ" / "sang"), không theo thứ tự. */
    const i1 = pci('chuyển 2tr từ Ngân hàng sang Tiền mặt');
    check('bóc đúng ví nguồn và ví đích', i1.fromWalletId === bank.id && i1.toWalletId === cash.id,
      i1.fromWalletId + ' -> ' + i1.toWalletId);
    const i2 = pci('chuyển 1tr sang Tiền mặt từ Ngân hàng');
    check('… đảo thứ tự trong câu vẫn đúng hướng',
      i2.fromWalletId === bank.id && i2.toWalletId === cash.id, i2.fromWalletId + ' -> ' + i2.toWalletId);
    /* "rút" là lấy tiền RA, "nạp" là đưa tiền VÀO — một ví trong câu thì chữ
       đó quyết định nó là nguồn hay đích. */
    check('“rút … Ngân hàng” ⇒ ví đó là NGUỒN',
      pci('rút 500k từ Ngân hàng').fromWalletId === bank.id && !pci('rút 500k từ Ngân hàng').toWalletId);
    check('“nạp … Tiền mặt” ⇒ ví đó là ĐÍCH',
      pci('nạp 500k Tiền mặt').toWalletId === cash.id);

    /* Kịch bản A: thiếu ví đích thì HỎI kèm nút, không đoán. */
    window.openChatDrawer(); await sleep(20);
    $('chat-input').value = 'rút 500k từ Ngân hàng';
    window.chatSend(); await sleep(60);
    let last = [...$('chat-body').children].pop();
    check('thiếu ví đích thì bot hỏi lại', /sang ví nào/i.test(last.textContent), last.textContent.slice(0, 60));
    const chips = last.querySelectorAll('.chat-chip');
    check('… kèm một chip cho mỗi ví', chips.length === S().wallets.length, String(chips.length));

    /* Bấm chip là điền nốt và hiện thẻ xác nhận. */
    [...chips].find(c => c.textContent.includes('Tiền mặt')).click(); await sleep(40);
    const card = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    check('bấm chip xong thì ra thẻ xác nhận chuyển tiền', !!card && /Xác nhận chuyển/.test(card.textContent));
    check('… thẻ nêu đúng đường đi', /Ngân hàng/.test(card.textContent) && /Tiền mặt/.test(card.textContent));

    const balBefore = [window.getWalletBalance(bank.id), window.getWalletBalance(cash.id)];
    const nBefore = S().transactions.length;
    card.querySelector('.btn-primary').click(); await sleep(40);
    const added = S().transactions.slice(nBefore);
    check('xác nhận thì ghi ĐÚNG MỘT CẶP transfer_out + transfer_in', added.length === 2
      && added.some(t => t.type === 'transfer_out') && added.some(t => t.type === 'transfer_in'), String(added.length));
    check('… hai chân chung một transferId', added[0].transferId && added[0].transferId === added[1].transferId);
    check('… và chung một status', added[0].status === added[1].status && added[0].status === 'completed');
    check('… số dư hai ví đổi đúng chiều',
      window.getWalletBalance(bank.id) === balBefore[0] - 500000
      && window.getWalletBalance(cash.id) === balBefore[1] + 500000,
      window.getWalletBalance(bank.id) + '/' + balBefore[0]);

    /* Kịch bản A cho định kỳ: thiếu chu kỳ thì hỏi bằng ba nút. */
    $('chat-input').value = 'định kỳ tiền nhà 4tr';
    window.chatSend(); await sleep(60);
    last = [...$('chat-body').children].pop();
    check('thiếu chu kỳ thì bot hỏi lại', /chu kỳ nào/i.test(last.textContent), last.textContent.slice(0, 60));
    const freqBtns = [...last.querySelectorAll('.chat-chip')].map(b => b.textContent.trim());
    check('… kèm ba nút Hàng tuần / Hàng tháng / Hàng năm',
      freqBtns.join('|') === 'Hàng tuần|Hàng tháng|Hàng năm', freqBtns.join('|'));

    [...last.querySelectorAll('.chat-chip')].find(b => /tháng/.test(b.textContent)).click(); await sleep(40);
    const rcard = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    check('chọn chu kỳ xong thì ra thẻ xác nhận lịch', /Xác nhận lịch định kỳ|Chu kỳ/.test(rcard.textContent));
    const rBefore = S().recurring.length;
    rcard.querySelector('.btn-primary').click(); await sleep(40);
    const r = S().recurring[S().recurring.length - 1];
    check('xác nhận thì tạo khoản định kỳ', S().recurring.length === rBefore + 1);
    check('… đúng số tiền và chu kỳ', r.amount === 4000000 && r.frequency === 'monthly',
      r.amount + '/' + r.frequency);
    check('… hạn kế tiếp ở tương lai, không phải quá khứ', r.dueDate > window.todayISO(), r.dueDate);
    check('… bản ghi đủ field như form tạo ra',
      ['name','type','amount','walletId','categoryId','frequency','interval','dueDate','endDate','autoProcess']
        .every(k => k in r), Object.keys(r).join(','));
    /* Bot tạo LỊCH NHẮC, không tự bật đường ghi tiền định kỳ. */
    check('… và KHÔNG tự bật tự động ghi', r.autoProcess === false);
    check('… ví trỏ vào ví có thật', !!window.getWallet(r.walletId));

    /* "ngày 5 hàng tháng": số 5 là ngày, không phải tiền. */
    const i3 = pci('tiền nhà 4tr hàng tháng ngày 5');
    check('bóc được ngày lặp trong tháng', i3.recurringDay === 5, String(i3.recurringDay));
    const due = window.recurringDueDate('monthly', 5);
    check('hạn kế tiếp là đúng ngày 5 của kỳ tới', due.slice(-2) === '05' && due > window.todayISO(), due);

    window.closeChatDrawer(true);
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· trợ lý chat: biên lai Techcombank / MoMo');
  {
    /* OCR đọc dấu rất tệ, nên bộ bóc tách chạy trên chuỗi đã bỏ dấu — mẫu
       dưới đây cố tình trộn cả có dấu và không dấu. */
    const tcb = window.parseBankReceiptOCR(
      'Techcombank\nChuyển tiền thành công\nSố tiền: 2,000,000 VND\n'
      + 'Đến: NGUYEN VAN A - 1903 6688 8888\nNội dung: Tra tien nha thang 9\nThời gian: 11/09/2026 14:32');
    check('TCB: nhận ra nhà phát hành', tcb.bank === 'Techcombank', tcb.bank);
    check('TCB: bóc đúng số tiền có dấu phẩy nghìn', tcb.amount === 2000000, String(tcb.amount));
    check('TCB: lấy đúng nội dung chuyển khoản', tcb.note === 'Tra tien nha thang 9', JSON.stringify(tcb.note));
    check('TCB: đọc được ngày', tcb.date === '2026-09-11', String(tcb.date));
    check('TCB: map sang ví ngân hàng trong sổ',
      !!tcb.walletId && window.eval(`walletTypeOf(getWallet('${tcb.walletId}'))`) === 'bank', String(tcb.walletId));

    const momo = window.parseBankReceiptOCR(
      'Vi MoMo\nThanh toan thanh cong\n-55.000d\nNoi dung: Tra tien dien thang 9\n10/09/2026 09:15');
    check('MoMo: nhận ra nhà phát hành', momo.bank === 'MoMo', momo.bank);
    check('MoMo: số âm vẫn ra số tiền dương', momo.amount === 55000, String(momo.amount));
    check('MoMo: không dấu vẫn lấy được nội dung', /Tra tien dien/.test(momo.note), JSON.stringify(momo.note));
    check('MoMo: map sang ví điện tử trong sổ',
      !!momo.walletId && window.eval(`walletTypeOf(getWallet('${momo.walletId}'))`) === 'ewallet', String(momo.walletId));

    /* Không phải biên lai ngân hàng thì về luật chung của hoá đơn. */
    const shop = window.parseBankReceiptOCR('QUAN COM TAM\nMon 55.000\nTONG CONG: 125.000\nTien khach 200.000');
    check('không nhận ra nhà phát hành thì vẫn bóc được hoá đơn thường',
      shop.bank === 'Khác' && shop.amount === 125000, shop.bank + '/' + shop.amount);
    check('rỗng thì không đoán bừa', window.parseBankReceiptOCR('').amount === 0);

    check('findWalletByNameOrType khớp theo tên trước, rồi mới tới loại ví',
      window.findWalletByNameOrType('Ngân hàng') === S().wallets.find(w => w.name === 'Ngân hàng').id);
    check('… tên lạ hoàn toàn thì trả null, không đoán ví',
      window.findWalletByNameOrType('Nganhangkhongtontai') === null);
  }

  console.log('\n· biên lai THẬT: Techcombank + MoMo (ảnh mẫu)');
  {
    /* Hai fixture dưới đây là văn bản đọc từ ảnh chụp màn hình THẬT của app
       Techcombank và MoMo (techcom.jpg / momo.jpg — KHÔNG commit vào repo vì
       chứa tên người và số tài khoản thật; xem .gitignore). Tên người đã thay
       bằng giá trị giả, còn số tài khoản / mã giao dịch giữ nguyên ĐỘ DÀI và
       HÌNH DẠNG, vì chính chúng mới là thứ làm bộ bóc tách đọc sai: một dãy
       14 chữ số, hay một mã đơn hàng 40 ký tự nằm ngay sau "Nội dung".

       Số tiền, nhãn, thứ tự các khối và dấu phân cách giữ đúng như trên ảnh:
       `-VND 262,000` (đơn vị đứng TRƯỚC số, dấu trừ dính vào đơn vị) và
       `-39.000đ` (dấu chấm ngăn nghìn, đơn vị dính sau số). */
    const TCB = 'Tài khoản thanh toán\nTECHCOMBANK\n-VND 262,000\n15:26 10/09/2026\n'
      + 'Từ tài khoản\nNGUYEN VAN A\nTechcombank\n19027323500017\n'
      + 'Tới tài khoản\nTRAN THI B\nNGAN HANG TMCP NGOAI THUONG VIET NAM (VIETCOMBANK)\n1054425144\n'
      + 'Lời nhắn\nNam Nguyen chuyen khoan nhanh qua Zalo\nMã giao dịch: FT26253811322360';
    const MOMO = 'Chi Tiết Giao Dịch\nCÔNG TY TNHH TM DV MỸ PHÚC\n-39.000đ\n'
      + 'Trạng thái Thành công\nThời gian 10:58 - 06/09/2026\nMã giao dịch 145509989601\n'
      + 'Tài khoản/thẻ Ví MoMo\nTổng phí Miễn phí\nDanh mục Ăn uống\n'
      + 'Thông tin đơn hàng\nCửa hàng The Orange Coffee - 259 Man Thiện\n'
      + 'Địa chỉ 259, Man Thiện, Hiệp Phú, Thủ Đức, Hồ Chí Minh\n'
      + 'Nội dung Nguyen Van A Thanh toan cho The Orange Coffee - 259 Man Thien\n'
      + 'Mã đơn hàng qrc-MOMOKTR620250917-6ad44d42-e9b6-4a65-9d54-6c9be31b2fa29418';
    const wtype = id => window.eval(`walletTypeOf(getWallet('${id}'))`);

    const tcb = window.parseBankReceiptOCR(TCB);
    /* "-VND 262,000": đơn vị đứng TRƯỚC số — dạng này không khớp luật "số rồi
       tới đơn vị", mà trên tờ đó còn hai dãy 14 chữ số và một mã giao dịch để
       đọc nhầm thành tiền. */
    check('TCB thật: đọc đúng 262.000 dù đơn vị đứng trước số', tcb.amount === 262000, String(tcb.amount));
    /* Tờ này có CẢ "TECHCOMBANK" (ví nguồn) lẫn "VIETCOMBANK" (ngân hàng
       người nhận). Tên xuất hiện sớm nhất mới là nhà phát hành — duyệt theo
       thứ tự BANK_SIGNS thì kết quả phụ thuộc thứ tự ta gõ cái bảng đó. */
    check('TCB thật: chọn nhà phát hành, không phải ngân hàng người nhận',
      tcb.bank === 'Techcombank', tcb.bank);
    check('TCB thật: lấy "Lời nhắn", dừng trước "Mã giao dịch"',
      tcb.note === 'Nam Nguyen chuyen khoan nhanh qua Zalo', JSON.stringify(tcb.note));
    check('TCB thật: đọc ngày 10/09/2026, không nhầm với giờ 15:26', tcb.date === '2026-09-10', String(tcb.date));
    check('TCB thật: map sang ví ngân hàng', !!tcb.walletId && wtype(tcb.walletId) === 'bank');
    check('TCB thật: dấu trừ ⇒ khoản chi', tcb.type === 'expense');
    /* Bẫy tìm ra từ chính tờ này: "chuyển khoản" chứa "chuyển", mà danh mục
       "Di chuyển" cũng chứa "chuyển" — trước khi sửa thì MỌI biên lai chuyển
       tiền đều bị gán vào Di chuyển. */
    check('TCB thật: "chuyển khoản" KHÔNG bị hiểu thành danh mục Di chuyển',
      tcb.categoryId !== 'c_transport', String(tcb.categoryId));
    check('TCB thật: memo chỉ có chữ nghiệp vụ thì về Khác và nói rõ chưa nhận diện được',
      tcb.categoryId === 'c_other_exp' && tcb.matched === false, tcb.categoryId + '/' + tcb.matched);

    const momo = window.parseBankReceiptOCR(MOMO);
    check('MoMo thật: đọc đúng 39.000 từ "-39.000đ"', momo.amount === 39000, String(momo.amount));
    check('MoMo thật: nhận ra nhà phát hành', momo.bank === 'MoMo', momo.bank);
    check('MoMo thật: đọc ngày 06/09/2026', momo.date === '2026-09-06', String(momo.date));
    check('MoMo thật: map sang ví điện tử', !!momo.walletId && wtype(momo.walletId) === 'ewallet');
    /* Ghi chú lấy TÊN CỬA HÀNG, không lấy dòng "Nội dung". Dòng "Nội dung"
       của MoMo là chữ máy sinh và mở đầu bằng tên người TRẢ ("Nguyen Van A
       Thanh toan cho…") — đưa vào sổ thì vừa khó đọc, vừa nhồi tên của chính
       mình vào ma trận từ khoá. "The Orange Coffee" thì học lại được. */
    check('MoMo thật: ghi chú lấy tên cửa hàng, không phải dòng "Nội dung" máy sinh',
      momo.note === 'The Orange Coffee - 259 Man Thiện', JSON.stringify(momo.note));
    check('MoMo thật: không lẫn tên người trả vào ghi chú',
      !/Nguyen Van|Nguyễn Văn/.test(momo.note), JSON.stringify(momo.note));
    check('MoMo thật: không cắt đứt giữa từ, không ăn sang mã đơn hàng',
      !/ Th$/.test(momo.note) && !/qrc|MOMOKTR/.test(momo.note), JSON.stringify(momo.note));
    /* Biên lai nói "Ăn uống", nó KHÔNG nói "Ăn sáng". Lấy subs[0] cho đủ ô là
       dựng ra một danh mục con không có trên giấy, rồi nó hiện lên thẻ xác
       nhận như thể ta biết — và người dùng lưu luôn. */
    check('MoMo thật: không bịa danh mục con', momo.subId === null, String(momo.subId));
    /* MoMo tự in "Danh mục: Ăn uống" — đó là phân loại của chính giao dịch,
       đáng tin hơn mọi phép đoán từ tên cửa hàng ("The Orange Coffee" không
       có từ nào trong lịch sử người dùng). */
    check('MoMo thật: lấy danh mục từ dòng "Danh mục" của biên lai',
      momo.categoryId === 'c_food' && momo.matched === true, momo.categoryId + '/' + momo.matched);
    check('MoMo thật: dấu trừ ⇒ khoản chi', momo.type === 'expense');

    /* Số tài khoản và mã giao dịch không bao giờ được đọc thành số tiền. */
    check('dãy số dài không có dấu phân cách không bị đọc thành tiền',
      window.parseBankReceiptOCR('Techcombank\nSo tai khoan 19027323500017\nMa giao dich FT26253811322360').amount === 0);
    /* Dấu cộng ⇒ tiền vào. Kiểm riêng vì hai ảnh mẫu đều là tiền ra. */
    check('dấu cộng ⇒ khoản thu',
      window.parseBankReceiptOCR('Techcombank\n+VND 5,000,000\nLoi nhan Luong thang 9').type === 'income');
  }




  console.log('\n· biên lai: chiều tiền do TỜ GIẤY quyết, không do từ khoá');
  {
    /* Đây là ca người dùng báo: giao dịch MoMo bị ghi thành khoản THU.
       OCR trên máy thật không trả về đẹp như transcript — nó làm mất mấy chữ
       gợi ý chi, và những gì còn lại thì có "Thủ Đức" (chứa "thu"). */
    const NOISY = 'Vi MoMo\n-39.000d\nCua hang Orange Coffee\nDia diem Thu Duc';
    /* Bẫy có thật, và test này chứng minh nó tồn tại: bộ đoán theo từ khoá
       đọc tên một QUẬN và kết luận đây là tiền vào. */
    check('bẫy: đoán theo từ khoá đọc "Thủ Đức" thành khoản thu',
      window.detectChatType(NOISY) === 'income', window.detectChatType(NOISY));
    /* Còn tờ giấy thì nói rõ: -39.000đ. Dấu thắng từ khoá. */
    const r = window.parseBankReceiptOCR(NOISY);
    check('biên lai: dấu trừ thắng từ khoá ⇒ vẫn là khoản CHI',
      r.type === 'expense' && r.typeFromSign === true, r.type + '/' + r.typeFromSign);

    /* Và luồng thật phải giữ nguyên kết luận đó tới lúc lưu vào sổ. */
    const realOcr = window.chatOcrImage;
    window.chatOcrImage = async () => NOISY;
    const d = await window.processChatMessage('', {name:'momo.jpg', type:'image/jpeg'});
    check('draft từ ảnh lấy chiều tiền của biên lai, không đoán lại trên toàn văn OCR',
      d.type === 'expense', d.type);
    const n0 = S().transactions.length;
    window.chatAutoSave(d.id); await sleep(30);
    const t = S().transactions[S().transactions.length - 1];
    check('bản ghi vào sổ là khoản CHI', S().transactions.length === n0 + 1 && t.type === 'expense',
      t.type);
    check('… và trừ đúng vào ví điện tử của biên lai',
      window.eval(`walletTypeOf(getWallet('${t.walletId}'))`) === 'ewallet');
    /* "Mã đơn hàng" chứa "hàng", và đoán trên toàn văn thì nó khớp vào danh
       mục con "Nhà hàng" — một quán cà phê thành nhà hàng. */
    check('không bịa danh mục con từ chữ "đơn hàng"', t.subcategoryId !== 's_restaurant',
      String(t.subcategoryId));
    window.chatOcrImage = realOcr;

    /* Dấu cộng thì vẫn phải ra khoản thu — không phải cứ mặc định chi. */
    check('dấu cộng ⇒ khoản thu',
      window.parseBankReceiptOCR('Techcombank\n+VND 5,000,000\nLoi nhan Luong thang 9').type === 'income');
    /* OCR làm mất dấu là chuyện thường; khi đó từ khoá NÓI VỀ HƯỚNG mới được
       lên tiếng, còn không có gì thì mặc định CHI (lỗi nghiêng về phía an
       toàn: số dư thiếu chứ không phình). */
    check('mất dấu + có "nhận từ" ⇒ khoản thu',
      window.parseBankReceiptOCR('Vi MoMo\n500.000d\nNhan tu NGUYEN VAN A').type === 'income');
    check('mất dấu, không có dấu hiệu hướng nào ⇒ mặc định CHI',
      window.parseBankReceiptOCR('Vi MoMo\n500.000d\nCua hang Circle K').type === 'expense');
    check('OCR đọc dấu trừ thành gạch dài ⇒ vẫn là CHI',
      window.parseBankReceiptOCR('Vi MoMo\n—39.000d\nNhan tu ai do').type === 'expense');
  }

  console.log('\n· trợ lý chat: CSS theo biến theme');
  {
    const css = fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8');
    check('bong bóng và ngăn chat lấy màu từ biến theme (dark mode)',
      /\.chat-bubble\.bot\{[^}]*background:var\(--card\)/.test(css)
      && /\.chat-drawer\{[^}]*background:var\(--card\)/.test(css));
    /* 99 nằm trên nav (30) nhưng dưới modal (100), bàn phím số (120), màn khoá
       (200) và toast (300) — một con số như 1000 sẽ nuốt mất chính cái toast
       "Đã lưu giao dịch" mà trợ lý vừa bắn ra. */
    check('ngăn chat xếp dưới modal và toast', /\.chat-drawer\{[^}]*z-index:99;/.test(css));
    check('nút nổi xếp dưới modal', /\.chat-fab\{[^}]*z-index:99;/.test(css));
  }

  console.log('\n· lịch sử điều hướng: Back cứng / vuốt lùi');
  {
    /* jsdom có session history thật, kể cả pushState và popstate — nên đây là
       cùng một đường mà nút Back của Android đi qua (Capacitor gọi
       webView.goBack() khi canGoBack()). */
    const hist = () => window.history;
    /* 150ms: một cú Back có thể phải nhảy nhiều nhịp khi gộp các entry trùng
       (xem bên dưới), mỗi nhịp là một task. */
    const back = async () => { hist().back(); await sleep(150); };
    const navS = () => window.eval('navState');

    window.switchTab('dashboard'); await sleep(20);
    check('vào phiên là có mốc gốc trong history', !!hist().state && hist().state.activeTab === 'dashboard',
      JSON.stringify(hist().state && hist().state.activeTab));
    check('schema đủ bốn trường', (() => {
      const s = hist().state || {};
      return 'activeTab' in s && 'activeModal' in s && 'filterState' in s && 'subView' in s;
    })(), Object.keys(hist().state || {}).join(','));

    const len0 = hist().length;
    window.switchTab('transactions'); await sleep(20);
    check('đổi tab là một bước lịch sử', hist().state.activeTab === 'transactions' && hist().length === len0 + 1,
      hist().state.activeTab + ' len=' + hist().length + '/' + len0);
    /* Bấm lại đúng tab đang mở mà cũng đẩy entry thì người dùng phải Back hai
       lần cho một bước. */
    window.switchTab('transactions'); await sleep(20);
    check('bấm lại đúng tab đang mở thì không đẻ thêm entry', hist().length === len0 + 1, String(hist().length));

    await back();
    check('Back đưa về tab trước', visible('view-dashboard') && !visible('view-transactions'));
    check('… và navState đi theo', navS().activeTab === 'dashboard', navS().activeTab);

    /* Màn hình con của Tổng quan: Back phải về Tổng quan, không phải thoát. */
    window.switchTab('wallets'); await sleep(20);
    check('màn hình con được đánh dấu subView', hist().state.subView === 'wallets', String(hist().state.subView));
    await back();
    check('Back từ màn hình con về Tổng quan', visible('view-dashboard'));

    /* Modal: một cú Back đóng modal, KHÔNG thoát màn hình. */
    window.switchTab('wallets'); await sleep(20);
    window.openWalletModal(); await sleep(20);
    check('mở modal thì lịch sử biết', visible('modal-wallet') && navS().activeModal === 'modal-wallet', navS().activeModal);
    await back();
    check('Back đóng modal', !visible('modal-wallet'));
    check('… và vẫn đứng nguyên màn hình đang xem', visible('view-wallets'), 'currentTab=' + window.eval('currentTab'));

    /* Mở rồi đóng modal bằng tay để lại một entry trùng với entry đang đứng.
       Đó là cái giá của việc đóng bằng replaceState (đồng bộ, không có bẫy
       thứ tự như history.back()); bù lại popstate phải GỘP các entry trùng,
       không thì người dùng bấm Back ba lần mà màn hình đứng im. */
    for (let i = 0; i < 3; i++) { window.openWalletModal(); await sleep(5); window.closeModal('modal-wallet'); await sleep(5); }
    await back();
    check('mở/đóng modal ba lần rồi Back vẫn ra đúng một bước nhìn thấy được',
      visible('view-dashboard'), 'currentTab=' + window.eval('currentTab'));

    /* Bàn phím số và ngăn chat là overlay ngoài .view — cũng phải lùi được. */
    window.switchTab('add'); await sleep(20);
    window.openAmountSheet('tx'); await sleep(20);
    check('bàn phím số là một bước lịch sử', visible('amount-sheet') && navS().activeModal === 'amount-sheet');
    await back();
    check('Back đóng bàn phím số, giữ nguyên form', !visible('amount-sheet') && visible('view-add'));
    check('… và gỡ luôn trạng thái bàn phím', window.eval('amtKind') === null);

    window.switchTab('dashboard'); await sleep(20);
    window.openChatDrawer(); await sleep(20);
    check('ngăn chat là một bước lịch sử', visible('chat-drawer') && navS().activeModal === 'chat-drawer');
    await back();
    check('Back đóng ngăn chat', !visible('chat-drawer'));
    check('… và trả lại nút nổi', visible('chat-fab'));

    /* uiConfirm trả lời bằng Promise: đóng bằng Back mà không resolve thì
       luồng gọi (xoá ví, nhập CSV…) đứng chờ mãi mãi. */
    let answered = 'chưa';
    window.uiConfirm('Thử', 'Bấm Back thay vì trả lời', 'OK').then(v => { answered = v; });
    await sleep(20);
    check('uiConfirm mở được', visible('modal-confirm'));
    await back();
    check('Back đóng hộp xác nhận', !visible('modal-confirm'));
    check('… và promise được trả lời "không", không treo', answered === false, String(answered));

    /* filterState: quay lại một tab là thấy đúng bộ lọc lúc rời đi. */
    window.switchTab('transactions'); await sleep(20);
    window.setTxFilter('type', 'expense', d.querySelector('#tx-filter-type .chip[data-val="expense"]'));
    await sleep(20);
    window.switchTab('settings'); await sleep(20);
    check('bộ lọc được chốt vào entry trước khi rời tab', hist().state.activeTab === 'settings');
    await back();
    check('Back về đúng tab Giao dịch', visible('view-transactions'));
    check('… và bộ lọc được khôi phục', window.eval('txFilters.type') === 'expense', window.eval('txFilters.type'));
    check('… chip cũng sáng đúng chỗ, không lệch với danh sách',
      d.querySelector('#tx-filter-type .chip[data-val="expense"]').classList.contains('active'));
    window.resetTxFilters(); await sleep(20);

    /* Panel lọc gập: không nổi lên trên nhưng vẫn là một bước "đang mở". */
    window.switchTab('transactions'); await sleep(20);
    window.toggleTxFilters(); await sleep(10);
    check('mở panel lọc là một bước lịch sử',
      !$('tx-advanced-filters').classList.contains('hidden') && navS().activeModal === 'tx-advanced-filters',
      String(navS().activeModal));
    await back();
    check('Back gấp panel lọc lại, không rời tab',
      $('tx-advanced-filters').classList.contains('hidden') && visible('view-transactions'));

    /* Luồng đã hoàn tất thì không để lại bước chết: lưu giao dịch xong mà
       Back lại mở đúng cái form vừa gửi (giờ đã trống) là vô nghĩa. */
    window.switchTab('dashboard'); await sleep(20);
    const lenBefore = hist().length;
    window.openAddTransaction('expense'); await sleep(20);
    window.selectTxWallet(S().wallets[0].id);
    window.selectTxCategory('c_food');
    window.applyTxAmount(12000);
    $('tx-date').value = window.todayISO();
    window.saveTransaction(); await sleep(30);
    check('lưu xong thì về Tổng quan', visible('view-dashboard'));
    check('… và không đẻ thêm bước (form đã gửi không được Back về)',
      hist().length === lenBefore + 1 && hist().state.activeTab === 'dashboard',
      hist().length + '/' + lenBefore + ' ' + hist().state.activeTab);
    await back();
    check('Back sau khi lưu về thẳng màn hình trước đó, không quay lại form',
      !visible('view-add'), 'currentTab=' + window.eval('currentTab'));

    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· nút Back cứng của Android (@capacitor/app)');
  {
    /* Bản đóng gói: nút cứng đi qua tầng native trước. Có listener backButton
       là Capacitor giao hẳn quyết định cho JS — nên listener phải tự lo cả
       việc thoát app, không thì người dùng kẹt trong app. */
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    check('@capacitor/app nằm trong devDependencies (CI tự wire vào APK)',
      !!(pkg.devDependencies || {})['@capacitor/app'],
      Object.keys(pkg.devDependencies || {}).join(','));

    const realCap = window.Capacitor;
    let handler = null, exited = 0, listened = null;
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { App: {
        addListener(name, fn){ listened = name; handler = fn; return {remove(){}}; },
        exitApp(){ exited++; }
      } }
    };
    const bound = window.navBindNativeBack();
    check('đăng ký được listener backButton', bound === true && listened === 'backButton', String(listened));

    /* Còn entry để lùi ⇒ đi đúng một đường với cú vuốt trên trình duyệt. */
    window.switchTab('dashboard'); await sleep(20);
    window.switchTab('settings'); await sleep(20);
    handler({ canGoBack: true }); await sleep(150);
    check('còn entry thì nút cứng lùi một bước, KHÔNG thoát app',
      visible('view-dashboard') && exited === 0, 'currentTab=' + window.eval('currentTab'));

    /* Hết entry nhưng còn overlay mở ⇒ đóng overlay, tuyệt đối không thoát:
       thoát app trong lúc người dùng đang gõ dở là mất dữ liệu không sửa lại
       được. */
    window.openWalletModal(); await sleep(20);
    handler({ canGoBack: false }); await sleep(20);
    check('hết entry mà còn modal thì đóng modal, không thoát app',
      !visible('modal-wallet') && exited === 0, 'exited=' + exited);

    /* Hết entry, không còn gì mở ⇒ mới thoát. */
    handler({ canGoBack: false }); await sleep(20);
    check('ở màn gốc, không còn gì mở thì mới gọi exitApp', exited === 1, 'exited=' + exited);

    /* Thiếu plugin thì im lặng nhường cho hành vi mặc định của Capacitor,
       không ném lỗi. */
    window.Capacitor = { isNativePlatform: () => true };
    check('thiếu plugin thì không đăng ký gì và không crash', window.navBindNativeBack() === false);
    window.Capacitor = realCap;
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· Tổng quan: khối "Giao dịch gần đây"');
  {
    window.switchTab('dashboard'); await sleep(30);
    /* Bố cục mới: Tổng tài sản → Giao dịch gần đây → Tiện ích → Ví → cảnh
       báo. Giao dịch gần đây lên vị trí 2 để biến động dòng tiền là thứ đọc
       được ngay, không phải cuộn xuống cuối trang mới thấy. */
    check('khối nằm ngay trên lưới Tiện ích', (() => {
      const util = $('db-quick-access'), rec = $('recent-transactions-section');
      if (!util || !rec) return false;
      /* compareDocumentPosition: 2 = util đứng TRƯỚC rec; ta cần ngược lại. */
      return !!(rec.compareDocumentPosition(util) & 4);
    })());
    check('thứ tự trang chủ: tổng tài sản → gần đây → tiện ích → ví → cảnh báo', (() => {
      const html = $('view-dashboard').innerHTML;
      const at = k => html.indexOf(k);
      return at('db-total-balance') < at('recent-transactions-list')
        && at('recent-transactions-list') < at('db-quick-access')
        && at('db-quick-access') < at('db-wallet-scroll')
        && at('db-wallet-scroll') < at('db-alert-zone');
    })());
    check('có tiêu đề và link Xem tất cả',
      /Giao dịch gần đây/.test($('recent-transactions-section').textContent) && !!$('btn-view-all-recent'));

    const rows = $('recent-transactions-list').querySelectorAll('.tx-row');
    check('hiện tối đa 5 dòng', rows.length > 0 && rows.length <= 5, String(rows.length));
    check('dùng lại .tx-row của tab Giao dịch, không dựng dòng riêng',
      !!$('recent-transactions-list').querySelector('.tx-row .tx-ic'));

    /* Mới nhất lên đầu, và KHÔNG được lẫn khoản dự kiến: sortTxDesc xếp ngày
       lớn trước, nên một khoản ngày mai sẽ chiếm đầu danh sách "gần đây" và
       người dùng đọc ra một khoản chi chưa hề xảy ra. */
    const today = window.todayISO();
    const shown = [...rows].map(r => r.querySelector('.tx-sub').textContent);
    check('không có dòng nào mang nhãn Dự kiến',
      !$('recent-transactions-list').querySelector('.tag-pending'), shown.join(' | '));
    const done = window.eval('getUserTransactions().slice().sort(sortTxDesc)');
    check('dòng đầu là giao dịch mới nhất đã ghi nhận',
      rows.length === 0 || rows[0].textContent.includes(String(done[0].note || '')),
      (done[0] && done[0].note) + ' vs ' + rows[0].textContent.slice(0, 40));
    check('mọi ngày hiển thị đều không ở tương lai',
      done.slice(0, 5).every(t => t.date <= today));

    /* Xem tất cả: sang tab Giao dịch và KHÔNG mang theo bộ lọc nào. */
    window.setTxFilter('type', 'income', d.querySelector('#tx-filter-type .chip[data-val="income"]'));
    await sleep(10);
    $('btn-view-all-recent').click(); await sleep(30);
    check('"Xem tất cả" sang tab Giao dịch', visible('view-transactions'));
    check('… và hạ mọi bộ lọc về "tất cả"',
      window.eval("JSON.stringify(txFilters)") === JSON.stringify(
        {type:'all', walletId:'all', catId:'all', eventId:'all', range:'all', status:'all'}),
      window.eval("JSON.stringify(txFilters)"));
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· Trung tâm thông báo (cảnh báo ngân sách)');
  {
    window.switchTab('dashboard'); await sleep(30);
    /* Banner cảnh báo đã rời khỏi Trang chủ: nó vừa chiếm chỗ của Giao dịch
       gần đây và Ví trên màn hình đầu, vừa không có trạng thái "đã đọc" nên
       hiện lại y nguyên mỗi lần mở app cho tới khi xử lý xong — và người ta
       học cách nhìn xuyên qua nó. */
    check('Trang chủ không còn khối banner cảnh báo', !$('db-alerts'));
    check('… và không còn thẻ .alert nào trên Trang chủ',
      $('view-dashboard').querySelectorAll('.alert').length === 0);
    check('quả chuông trên app bar có id và mở trung tâm thông báo',
      !!$('notification-bell') && /openNotifications\(\)/.test($('notification-bell').getAttribute('onclick')));

    /* Ngân sách hạn mức 1.000đ cho Ăn uống — sổ đã có chi tiêu ăn uống tháng
       này nên nó vượt 100% ngay. */
    window.eval(`state.budgets = state.budgets.filter(b=>b.id!=='bg_notif');
      state.budgets.push({id:'bg_notif', userId:state.currentUser, categoryId:'c_food', walletId:'all',
        period:'monthly', periodKey:currentPeriodKey('monthly'), limit:1000, repeat:true});
      state.notifications = []; saveStorage();`);
    const added = window.checkBudgetAndPushNotifications();
    check('vượt ngưỡng thì đẩy thông báo vào store', added >= 1, 'added=' + added);

    const notifs = window.eval('JSON.stringify(getNotifications())');
    const list = JSON.parse(notifs);
    const bud = list.find(n => n.type === 'budget_warning');
    check('thông báo đủ trường theo hợp đồng',
      !!bud && ['id','type','title','message','createdAt','read','action'].every(k => k in bud),
      bud ? Object.keys(bud).join(',') : 'không có');
    check('message nêu tên danh mục và phần trăm đã dùng',
      /Ăn uống/.test(bud.message) && /%/.test(bud.message), bud.message);
    /* createdAt phải là CHUỖI: state đi qua JSON.stringify vào localStorage và
       lên Supabase, nên một object Date sẽ thành string sau lần nạp đầu —
       kiểu khác nhau trước/sau reload là một lớp lỗi không đáng có. */
    check('createdAt là chuỗi ISO, sống được qua JSON', typeof bud.createdAt === 'string'
      && !isNaN(new Date(bud.createdAt).getTime()), typeof bud.createdAt);
    check('chưa đọc', bud.read === false);

    /* Quét lại KHÔNG được đẻ thêm bản trùng — đó là lý do id không chứa
       Date.now(): hai lần quét trong cùng một tháng phải ra cùng một id. */
    const n1 = window.eval('getNotifications().length');
    window.checkBudgetAndPushNotifications();
    window.checkBudgetAndPushNotifications();
    check('quét lại nhiều lần không sinh thông báo trùng',
      window.eval('getNotifications().length') === n1, n1 + ' -> ' + window.eval('getNotifications().length'));
    check('id mang theo kỳ và mốc ngưỡng, không mang Date.now()',
      /^budget-alert-c_food-\d{4}-\d{2}-(80|100)$/.test(bud.id), bud.id);

    /* Chấm đỏ theo "chưa đọc", không theo "có cảnh báo". */
    window.syncAlertDot();
    check('có thông báo chưa đọc thì chuông hiện chấm đỏ', visible('alert-dot'));

    window.openNotifications(); await sleep(20);
    check('bấm chuông thì mở danh sách thông báo', visible('modal-sheet')
      && /Thông báo/.test(txt('sheet-title')), txt('sheet-title'));
    const rows = $('sheet-body').querySelectorAll('.notif-item');
    check('… liệt kê đủ thông báo', rows.length === list.length, rows.length + '/' + list.length);
    check('… tin chưa đọc được đánh dấu riêng',
      $('sheet-body').querySelectorAll('.notif-item.is-unread').length === list.filter(n => !n.read).length);

    /* Bấm vào tin: đánh dấu đã đọc, tắt chấm đỏ, và đi tới chỗ trả lời được
       câu hỏi "tôi đã chi gì trong danh mục này" — tab Giao dịch, vì Báo cáo
       không có bộ lọc danh mục. */
    window.openNotification(bud.id); await sleep(40);
    check('bấm tin thì đánh dấu đã đọc', window.eval(`(state.notifications.find(n=>n.id==='${bud.id}')||{}).read`) === true);
    check('… tắt chấm đỏ khi không còn tin chưa đọc nào',
      window.eval('unreadNotifications().length') === 0 ? !visible('alert-dot') : true);
    check('… đóng sheet lại', !visible('modal-sheet'));
    check('… và chuyển sang tab đã lọc đúng danh mục',
      visible('view-transactions') && window.eval('txFilters.catId') === 'c_food',
      window.eval('JSON.stringify(txFilters)'));

    /* Mốc 80% và 100% là hai tin khác nhau: vượt hạn mức rồi thì phải được
       nhắc lại dù đã đọc tin 80%. */
    window.eval(`state.notifications = []; state.budgets.find(b=>b.id==='bg_notif').limit =
      Math.round(getBudgetSpent(state.budgets.find(b=>b.id==='bg_notif')) / 0.9); saveStorage();`);
    window.checkBudgetAndPushNotifications();
    const at90 = JSON.parse(window.eval('JSON.stringify(getNotifications())')).find(n => n.type === 'budget_warning');
    check('dùng 90% thì gắn mốc 80, chưa phải mốc 100', /-80$/.test(at90.id), at90.id);
    window.eval(`state.budgets.find(b=>b.id==='bg_notif').limit = 1000; saveStorage();`);
    window.checkBudgetAndPushNotifications();
    check('vượt 100% thì có thêm tin mốc 100 bên cạnh tin mốc 80',
      window.eval("getNotifications().filter(n=>/-100$/.test(n.id)).length") === 1
      && window.eval("getNotifications().filter(n=>/-80$/.test(n.id)).length") === 1);

    /* Trần: state đi cả gói lên Supabase mỗi lần ghi. */
    check('có trần số thông báo để snapshot không phình mãi',
      /const NOTIF_MAX = \d+/.test(fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8')));
    window.eval(`state.notifications = []; state.budgets = state.budgets.filter(b=>b.id!=='bg_notif'); saveStorage();`);
    window.syncAlertDot();
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· vuốt ngang đổi tab');
  {
    /* jsdom không có TouchEvent thật; dựng event rồi gắn changedTouches vào —
       handler chỉ đọc `changedTouches[0].screenX/Y` và `e.target`, nên đây là
       đúng những gì nó thấy trên máy thật. */
    const touch = (type, el, x, y, n) => {
      const ev = new window.Event(type, {bubbles: true});
      const list = [];
      for (let i = 0; i < (n || 1); i++) list.push({screenX: x, screenY: y});
      Object.defineProperty(ev, 'changedTouches', {value: list});
      el.dispatchEvent(ev);
    };
    const swipe = async (el, dx, dy, opts) => {
      const o = opts || {};
      const x0 = o.from == null ? 200 : o.from;
      touch('touchstart', el, x0, 300, o.fingers);
      touch('touchend', el, x0 + dx, 300 + (dy || 0), o.fingers);
      await sleep(30);
    };
    const view = () => window.eval('currentTab');

    window.switchTab('dashboard'); await sleep(20);
    const canvasArea = $('view-dashboard');

    /* Vuốt sang TRÁI là đi tiếp theo đúng thứ tự nav bar. */
    await swipe(canvasArea, -120, 0);
    check('vuốt trái: Tổng quan → Giao dịch', view() === 'transactions', view());
    await swipe($('view-transactions'), -120, 0);
    check('vuốt trái tiếp: Giao dịch → Báo cáo', view() === 'reports', view());
    await swipe($('view-reports'), 120, 0);
    check('vuốt phải: Báo cáo → Giao dịch', view() === 'transactions', view());

    /* Mỗi cú vuốt là MỘT bước lịch sử: Back phải lùi đúng một tab.
       switchTab(tab, true) sẽ ghi đè entry — đúng nghĩa tham số thứ hai của
       app này là `replaceStep`, ngược với ý "pushState" — nên cú vuốt gọi
       switchTab(tab) không tham số. */
    const len = window.history.length;
    await swipe($('view-transactions'), -120, 0);
    check('vuốt đẩy một bước lịch sử mới, không ghi đè',
      window.history.length === len + 1, window.history.length + '/' + len);
    window.history.back(); await sleep(150);
    check('Back sau khi vuốt lùi đúng một tab', view() === 'transactions', view());

    /* Hai đầu dãy: không có tab kế bên thì không làm gì. */
    window.switchTab('dashboard'); await sleep(20);
    await swipe($('view-dashboard'), 150, 0);
    check('ở tab đầu, vuốt phải không đi đâu cả', view() === 'dashboard', view());
    window.switchTab('settings'); await sleep(20);
    await swipe($('view-settings'), -150, 0);
    check('ở tab cuối, vuốt trái không đi đâu cả', view() === 'settings', view());

    /* Cuộn dọc hơi chéo tay không được nhảy tab. */
    window.switchTab('dashboard'); await sleep(20);
    await swipe($('view-dashboard'), -100, -140);
    check('vuốt chéo (dọc nhiều hơn ngang) bị bỏ qua', view() === 'dashboard', view());
    await swipe($('view-dashboard'), -40, 0);
    check('vuốt quá ngắn (<60px) bị bỏ qua', view() === 'dashboard', view());
    await swipe($('view-dashboard'), -120, 0, {fingers: 2});
    check('hai ngón (pinch/zoom) không phải vuốt đổi tab', view() === 'dashboard', view());

    /* Vùng cử chỉ Back của hệ điều hành: không được nhận thêm một bước nữa. */
    await swipe($('view-dashboard'), 150, 0, {from: 10});
    check('vuốt từ sát mép trái nhường cho cử chỉ Back của OS, không đổi tab',
      view() === 'dashboard', view());

    /* Vùng cuộn ngang phải giữ được cú vuốt của nó — nếu không thì thanh ví
       vừa dựng xong sẽ không cuộn được nữa, nó đổi tab. */
    await swipe($('db-wallet-scroll'), -120, 0);
    check('vuốt trong thanh ví cuộn thanh ví, không đổi tab', view() === 'dashboard', view());
    await swipe($('upcoming-filter'), -120, 0);
    check('vuốt trong băng chip lọc cũng vậy', view() === 'dashboard', view());

    /* Màn hình con vào từ lưới Tiện ích: không có "tab kế bên". */
    window.switchTab('wallets'); await sleep(20);
    await swipe($('view-wallets'), -150, 0);
    check('màn hình con không đổi tab khi vuốt', view() === 'wallets', view());

    /* Overlay đang mở: cú vuốt thuộc về nội dung bên trong. */
    window.switchTab('dashboard'); await sleep(20);
    window.openQuickEntry(); await sleep(20);
    await swipe($('amount-sheet'), -150, 0);
    check('bàn phím số đang mở thì không đổi tab', view() === 'dashboard' && visible('amount-sheet'));
    window.closeAmountSheet(); await sleep(20);
    window.openChatDrawer(); await sleep(20);
    await swipe($('chat-body'), -150, 0);
    check('ngăn chat đang mở thì không đổi tab', view() === 'dashboard' && visible('chat-drawer'));
    window.closeChatDrawer(false); await sleep(10);
    window.openWalletModal(); await sleep(20);
    await swipe($('view-dashboard'), -150, 0);
    check('modal đang mở thì không đổi tab, kể cả khi ngón tay đặt ngoài modal',
      view() === 'dashboard' && visible('modal-wallet'));
    window.closeModal('modal-wallet'); await sleep(30);

    check('không có lỗi console nào sau loạt vuốt', consoleErrors.length === 0, consoleErrors[0]);
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· Trang chủ: cụm cảnh báo tự thu gọn');
  {
    window.switchTab('dashboard'); await sleep(30);
    /* Kiểm bằng cách thay hai nguồn dữ liệu, KHÔNG xoá state thật: một bài
       test mà phải wipe rồi restore state là một bài test có thể làm hỏng
       những bài sau nó. */
    const realUpcoming = window.getUpcomingItems, realBudgets = window.getUserBudgets;

    window.getUpcomingItems = () => [];
    window.getUserBudgets = () => [];
    window.syncAlertZone();
    check('không còn gì để nhắc thì cụm cảnh báo tự ẩn', !visible('db-alert-zone'));
    /* Ẩn, KHÔNG xoá khỏi DOM: id và handler bên trong phải còn nguyên. */
    check('… nhưng vẫn còn trong DOM để lần vẽ sau hiện lại được',
      !!$('upcoming-list') && !!$('db-budget-mini') && !!$('btn-view-all-upcoming'));

    window.getUpcomingItems = () => [{id:'x', kind:'tx', name:'Thử', amount:1000, dueDate:window.todayISO(), walletId:null}];
    window.syncAlertZone();
    check('có khoản sắp đến hạn thì hiện lại', visible('db-alert-zone'));

    window.getUpcomingItems = () => [];
    window.getUserBudgets = () => [{id:'b', userId:S().currentUser, period:'monthly',
      periodKey:window.eval("currentPeriodKey('monthly')"), repeat:true, limit:1000000, categoryId:'__all__'}];
    window.syncAlertZone();
    check('chỉ có ngân sách đang theo dõi cũng đủ để hiện', visible('db-alert-zone'));

    window.getUpcomingItems = realUpcoming;
    window.getUserBudgets = realBudgets;
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· ghi nhanh: nút [+] mở thẳng bàn phím');
  {
    const navS = () => window.eval('navState');
    window.switchTab('dashboard'); await sleep(20);

    /* Nút [+] giữa nav bar là đường vào chính, và nó phải mở bàn phím chứ
       không phải form: con số là thứ người ta biết trước khi biết mình sẽ xếp
       nó vào đâu. */
    check('nút [+] gọi openQuickEntry, không phải switchTab(add)',
      /openQuickEntry\(\)/.test(d.querySelector('.fab').getAttribute('onclick')),
      d.querySelector('.fab').getAttribute('onclick'));

    d.querySelector('.fab').click(); await sleep(30);
    check('bấm [+] là bàn phím số hiện ra ngay', visible('amount-sheet'));
    check('… ở chế độ ghi nhanh', window.eval('amtKind') === 'quick', String(window.eval('amtKind')));
    check('… có thanh ghi chú + hai chip', visible('qe-inputs') && !!$('qe-chip-wallet') && !!$('qe-chip-cat'));
    check('… có công tắc Chi/Thu', visible('qe-type') && $('qe-type').children.length === 2);
    check('… phím hành động là "Lưu", không phải "Tiếp tục"', txt('amt-next') === 'Lưu', txt('amt-next'));
    check('… số tiền bắt đầu từ 0', window.eval('amtValue()') === 0);
    check('… và dùng lại đúng một bàn phím của app (không dựng bàn phím thứ hai)',
      d.querySelectorAll('.tcb-keypad-wrapper').length === 1);

    /* Vuốt lùi phải đóng bàn phím, không thoát app. */
    check('bàn phím là một bước lịch sử', navS().activeModal === 'amount-sheet', String(navS().activeModal));
    window.history.back(); await sleep(150);
    check('vuốt lùi đóng bàn phím thay vì thoát app', !visible('amount-sheet'));

    /* Gõ ghi chú → ví và danh mục tự nhảy theo lịch sử (đã dạy "Xăng xe máy"
       ở khối trên: 2 lần ví[1], 1 lần ví[0]). */
    const w1 = S().wallets[0].id, w2 = S().wallets[1].id;
    window.openQuickEntry(); await sleep(20);
    window.quickSetWallet(w1); await sleep(10);          /* chọn tay trước */
    $('qe-note').value = 'xăng';
    window.onQuickNote('xăng'); await sleep(10);
    check('tay người dùng thắng phỏng đoán: ví đã chọn không bị ghi đè',
      window.eval('txSelectedWalletId') === w1, window.eval('txSelectedWalletId'));

    window.openQuickEntry(); await sleep(20);            /* mở lại: cờ "đã chọn tay" phải reset */
    $('qe-note').value = 'xăng';
    window.onQuickNote('xăng'); await sleep(10);
    check('gõ ghi chú thì danh mục tự nhảy theo lịch sử',
      window.eval('txSelectedCatId') === 'c_transport', window.eval('txSelectedCatId'));
    check('… và ví cũng tự nhảy theo ví hay dùng cho khoản đó',
      window.eval('txSelectedWalletId') === w2, window.eval('txSelectedWalletId'));
    check('chip hiện đúng tên ví và danh mục',
      $('qe-chip-wallet').textContent.includes(S().wallets[1].name)
      && /Di chuyển/.test($('qe-chip-cat').textContent),
      $('qe-chip-wallet').textContent + ' | ' + $('qe-chip-cat').textContent);

    /* Bàn phím: 3 + 5 + 000 = 35.000 */
    window.amtKey('3'); window.amtKey('5'); window.amtKey('000'); await sleep(10);
    check('bàn phím dựng đúng con số', window.eval('amtValue()') === 35000, String(window.eval('amtValue()')));
    check('con số to hiển thị có dấu phân cách', txt('amt-val') === '35.000', txt('amt-val'));

    const before = S().transactions.length;
    $('qe-note').value = 'Xăng xe máy';
    $('amt-next').click(); await sleep(40);
    const t = S().transactions[S().transactions.length - 1];
    check('bấm "Lưu" ghi thẳng vào sổ', S().transactions.length === before + 1);
    check('… đúng số tiền', t.amount === 35000, String(t.amount));
    check('… ngày là hôm nay và status suy từ ngày',
      t.date === window.todayISO() && t.status === 'completed', t.date + '/' + t.status);
    check('… đúng ví và danh mục đã gợi ý', t.walletId === w2 && t.categoryId === 'c_transport',
      t.walletId + '/' + t.categoryId);
    check('… ghi chú đi theo', t.note === 'Xăng xe máy', t.note);
    check('lưu xong thì đóng bàn phím', !visible('amount-sheet'));
    check('… và dọn sạch số tiền cho lần sau',
      window.eval('amtValue()') === 0 && window.eval('txAmount') === 0 && $('qe-note').value === '');

    /* Chi/Thu: đổi loại thì danh mục phải sang bảng của loại đó */
    window.openQuickEntry(); await sleep(20);
    window.setQuickType('income'); await sleep(10);
    check('đổi sang Thu thì danh mục sang bảng khoản thu',
      !!window.eval("findCategory('income', txSelectedCatId)"), window.eval('txSelectedCatId'));
    check('… và công tắc sáng đúng ô',
      d.querySelector('#qe-type .qe-t[data-val="income"]').classList.contains('active'));
    window.setQuickType('expense'); await sleep(10);

    /* Đường ra form đầy đủ: mang theo số tiền và ghi chú, và KHÔNG để lại
       một bước lịch sử trỏ vào bàn phím đã đóng. */
    window.amtKey('9'); window.amtKey('000'); await sleep(10);
    $('qe-note').value = 'Cà phê sáng';
    window.quickToFullForm(); await sleep(40);
    check('"Thêm chi tiết" mở form đầy đủ', visible('view-add'));
    check('… đóng bàn phím lại', !visible('amount-sheet'));
    check('… mang theo số tiền', window.eval('txAmount') === 9000, String(window.eval('txAmount')));
    check('… mang theo ghi chú', $('tx-note').value === 'Cà phê sáng', $('tx-note').value);
    window.history.back(); await sleep(150);
    check('vuốt lùi từ form không quay lại bàn phím đã đóng', !visible('amount-sheet'));

    window.cancelAddTx(); await sleep(20);
  }

  console.log('\n· ghi nhanh: chọn ví ngay trên bàn phím + sheet không bị che');
  {
    const css = fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8');
    /* LỖI ĐÃ SỬA: .modal thấp hơn #amount-sheet nên mọi sheet mở TỪ bàn phím
       (chọn ví, chọn danh mục) nằm SAU bàn phím — người dùng bấm và không
       thấy gì, tưởng app đơ. jsdom không layout nên chỉ phép so hai z-index
       trong CSS bắt được. */
    const zOf = re => Number((re.exec(css) || [])[1] || 0);
    const zModal = zOf(/\.modal\{[^}]*z-index:(\d+)/);
    const zAmt = zOf(/\.amt-sheet\{[^}]*z-index:(\d+)/);
    check('modal nằm TRÊN bàn phím số, không thì sheet chọn danh mục bị che',
      zModal > zAmt && zAmt > 0, 'modal=' + zModal + ' amt-sheet=' + zAmt);
    check('… và vẫn dưới màn khoá PIN với toast',
      zModal < zOf(/\.lock-screen\{[^}]*z-index:(\d+)/)
      && zModal < zOf(/#toast-wrap\{[^}]*z-index:(\d+)/));

    window.openQuickEntry(); await sleep(20);
    /* Thẻ ví ở đầu bàn phím phải là một nút, và phải nói ra điều đó bằng ▾ */
    const wcard = $('amt-from').querySelector('.amt-from-card');
    check('thẻ ví ở đầu bàn phím bấm được',
      wcard.classList.contains('wallet-selector-header-card')
      && /quickPickWallet\(\)/.test(wcard.getAttribute('onclick') || ''), wcard.className);
    check('… có mũi tên ▾ để thấy là đổi được', !!wcard.querySelector('.wsel-caret'));

    const other = S().wallets.find(w => w.id !== window.eval('txSelectedWalletId'));
    wcard.click(); await sleep(20);
    check('bấm thẻ ví thì mở danh sách ví', visible('modal-sheet')
      && $('sheet-body').querySelectorAll('.pick-item').length === S().wallets.length);
    $('sheet-body').querySelectorAll('.pick-item').forEach(el => {
      if (el.textContent.includes(other.name)) el.click();
    });
    await sleep(20);
    check('chọn ví khác thì bàn phím cập nhật ngay',
      window.eval('txSelectedWalletId') === other.id
      && $('amt-from').textContent.includes(other.name), window.eval('txSelectedWalletId'));
    check('… và đóng sheet, bàn phím vẫn mở', !visible('modal-sheet') && visible('amount-sheet'));
    /* Đóng sheet mở TỪ bàn phím thì lịch sử phải biết bên dưới vẫn còn bàn
       phím, không thì cú Back kế tiếp đóng nhầm một lớp. */
    check('lịch sử điều hướng trả về đúng lớp bên dưới',
      window.eval('navState.activeModal') === 'amount-sheet', String(window.eval('navState.activeModal')));

    /* Chip danh mục cũng mở được — đây chính là "bấm loại giao dịch không load ra" */
    $('qe-chip-cat').click(); await sleep(20);
    check('bấm chip Danh mục thì danh sách hiện ra', visible('modal-sheet')
      && $('sheet-body').querySelectorAll('.pick-item').length > 0,
      $('sheet-body').querySelectorAll('.pick-item').length + ' mục');
    check('… và đúng bảng danh mục của loại đang chọn',
      $('sheet-body').querySelectorAll('.pick-item').length === window.eval("getCats('expense').length"));
    window.setQuickType('income'); await sleep(10);
    window.quickPickCategory(); await sleep(20);
    check('đổi sang Thu thì danh sách đổi theo',
      $('sheet-body').querySelectorAll('.pick-item').length === window.eval("getCats('income').length"));
    window.closeSheet();
    window.setQuickType('expense');
    window.closeAmountSheet(); await sleep(20);
  }

  console.log('\n· trợ lý chat: nút "Chỉnh sửa ➔" mở form thật');
  {
    /* Hai nút này từng gọi một hàm KHÔNG TỒN TẠI (navCloseSilently) — nó chỉ
       nổ khi người dùng bấm, mà test cũ chỉ bấm nút xác nhận. */
    window.openChatDrawer(); await sleep(20);
    const bank = S().wallets.find(w => w.name === 'Ngân hàng');
    $('chat-input').value = 'chuyển 1tr từ Ngân hàng sang Tiền mặt';
    window.chatSend(); await sleep(80);
    const card = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    const before = S().transactions.length;
    card.querySelector('.btn-secondary').click(); await sleep(60);
    check('"Chỉnh sửa ➔" của thẻ chuyển ví mở form chuyển tiền, không ném lỗi',
      visible('view-add') && !$('form-transfer').classList.contains('hidden'));
    check('… nạp sẵn số tiền và ví nguồn',
      window.eval('tfAmount') === 1000000 && $('tf-from-wallet').value === bank.id,
      window.eval('tfAmount') + '/' + $('tf-from-wallet').value);
    check('… và chưa ghi gì vào sổ', S().transactions.length === before);
    check('không có lỗi console nào', consoleErrors.length === 0, consoleErrors[0]);

    window.openChatDrawer(); await sleep(20);
    $('chat-input').value = 'tiền nhà 4tr hàng tháng';
    window.chatSend(); await sleep(80);
    const rcard = [...$('chat-body').querySelectorAll('.bot-card-action')].pop();
    rcard.querySelector('.btn-secondary').click(); await sleep(60);
    check('"Chỉnh sửa ➔" của thẻ định kỳ mở modal định kỳ', visible('modal-recurring'));
    check('… nạp sẵn tên và số tiền',
      /tiền nhà/i.test($('mr-name').value) && window.eval("readMoney('mr-amount')") === 4000000,
      $('mr-name').value + '/' + window.eval("readMoney('mr-amount')"));
    check('vẫn không có lỗi console', consoleErrors.length === 0, consoleErrors[0]);
    window.closeModal('modal-recurring');
    window.closeChatDrawer(true);
    window.switchTab('dashboard'); await sleep(20);
  }

  console.log('\n· ghi nhanh: CSS theo biến theme');
  {
    const css = fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8');
    check('thanh ghi nhanh lấy màu từ biến theme, không hex cứng',
      /\.quick-inputs-bar\{[^}]*background:var\(--card-2\)/.test(css)
      && /\.quick-note-input\{[^}]*background:var\(--card\)/.test(css)
      && /\.quick-chip\{[^}]*background:var\(--card\)/.test(css));
    check('màn thấp thì hạ chiều cao phím thay vì để bàn phím trôi khỏi màn hình',
      /@media \(max-height:700px\)\{[\s\S]{0,400}tcb-btn-key\{height:46px/.test(css));
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
