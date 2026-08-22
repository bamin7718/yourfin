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
    : { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'x'.repeat(60) };

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

    // các nút nhanh cũ phải nguyên vẹn
    window.clearAmount();
    window.addQuickAmount(10000); window.addQuickAmount(50000);
    check('+10k / +50k vẫn cộng dồn đúng', window.eval('txAmount') === 60000);
    check('nút nhanh cũng hiển thị có phân cách', $('tx-amount-raw').value === '60.000');

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

    S().transactions = S().transactions.filter(t => t.id !== 'tx_far');
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

  console.log('\n· giao diện: màu, nav, icon SVG');
  {
    const css = fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8');
    check('primary là xanh VietinBank #00529C', /--primary:#00529C/.test(css));
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
    check('header ghim ở đỉnh màn hình', /header\{position:sticky;top:0/.test(css));
    check('header vẽ trên nội dung đang cuộn qua', zHeader > zView, `header z=${zHeader} vs view z=${zView}`);
    check('thanh nav vẫn nằm trên header', zNav > zHeader, `nav z=${zNav}`);
    /* Cái bẫy: overflow-x:hidden khiến trình duyệt tính overflow-y thành auto,
       .app thành scroll container — và sticky bên trong một scrollport không
       bao giờ cuộn thì không bao giờ dính. Phải là `clip`. */
    check('.app dùng overflow-x:clip, không phải hidden (nếu không sticky chết lặng)',
      /\.app\{[^}]*overflow-x:clip/.test(css) && !/\.app\{[^}]*overflow-x:hidden/.test(css));
    check('không tổ tiên nào của header đặt overflow ẩn', (() => {
      const body = /^body\{[^}]*\}/m.exec(css);
      return !body || !/overflow/.test(body[0]);
    })());
    check('thẻ số dư không còn margin âm, nằm dưới header như mọi trang',
      /\.hero\{[^}]*padding:16px;margin-top:0/.test(css)
      && !/margin-top:-\d+px\}/.test(css.match(/#main-header[^\n]*/g).join('\n')));

    check('không còn quy tắc kéo view lên đè header',
      !/:not\(\.hd-flat\) ~ \.view\{margin-top:-/.test(css));
    check('mọi trang đều chừa khoảng dưới header',
      /#main-header\.hd-flat ~ \.view\{padding-top:20px/.test(css));
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
    check('sw: precache cả bundle Supabase trên CDN', sw.includes('cdn.jsdelivr.net'));

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

    // thẻ tổng quan
    check('có 3 thẻ tổng quan Thu / Chi / Ròng',
      !!d.querySelector('.sum-card.in') && !!d.querySelector('.sum-card.out') && !!$('rep-net-card'));
    const incNow = window.parseAmount(txt('rep-income'));
    const expNow = window.parseAmount(txt('rep-expense'));
    check('thẻ ròng đánh dấu đúng dấu âm/dương',
      $('rep-net-card').classList.contains(incNow - expNow >= 0 ? 'pos' : 'neg'),
      $('rep-net-card').className);
    check('thẻ ròng có dòng phụ diễn giải', txt('rep-net-sub').length > 0, txt('rep-net-sub'));

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
