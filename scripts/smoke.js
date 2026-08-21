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
  console.log('\nFinyourtin — smoke test\n');
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
      === JSON.stringify({ type: 'all', walletId: w1.id, catId: 'all', eventId: 'all', range: 'all' }),
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

  console.log('\n· views render');
  for (const tab of ['dashboard', 'transactions', 'add', 'reports', 'more', 'wallets', 'budget', 'debts', 'recurring', 'events', 'categories', 'settings']) {
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
    return o.app === 'finyourtin' && Array.isArray(o.wallets) && Array.isArray(o.transactions) && !!o.categories;
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
