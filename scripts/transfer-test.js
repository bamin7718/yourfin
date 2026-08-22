#!/usr/bin/env node
/* ============================================================
   Transfer contract test.

   A transfer is the one operation that must keep two wallets agreeing with
   each other, so it gets its own file. Nothing in this app stores a `balance`
   field: getWalletBalance() replays the ledger, which is why a transfer moves
   money the moment its two rows exist. These checks pin that down — including
   the awkward cases: a fee, a currency change, a future date, and a delete
   that has to unwind every row the transfer created.

   Requires jsdom:  npm install jsdom --no-save
   Run:             npm run transfer-test
   ============================================================ */

'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const PUBLIC = path.resolve(__dirname, '..', 'public');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UID = 'uid-tf';
const KEY = 'FINYOURTIN_STATE_V4::' + UID;

let pass = 0, fail = 0;
const check = (l, ok, d) => { console.log((ok ? '  ✓ ' : '  ✗ ') + l + (ok || !d ? '' : ' — ' + d)); ok ? pass++ : fail++; };

function seed() {
  return {
    version: 4, currentUser: null, updatedAt: Date.now(),
    app: { theme:'light', pinEnabled:false, pinHash:null, privacy:false, mainCurrency:'VND',
           rates:{ VND:1, USD:25000 } },
    wallets: [
      { id:'wA', userId:UID, name:'Tiền mặt',    icon:'👛', type:'cash', currency:'VND', startingBalance:10000000, displayOrder:1 },
      { id:'wB', userId:UID, name:'Vietcombank', icon:'🏦', type:'bank', currency:'VND', startingBalance:2000000,  displayOrder:2 },
      { id:'wU', userId:UID, name:'Ví USD',      icon:'💵', type:'bank', currency:'USD', startingBalance:100,      displayOrder:3 }
    ],
    transactions: [], budgets: [], recurring: [], debts: [], events: [],
    categories: {}, onboardingStatus: { [UID]: true }
  };
}

function fakeSupabase() {
  let session = { user:{ id:UID, email:'a@b.co' }, access_token:'t' };
  return {
    auth: {
      async signInWithPassword(){ return { data:{session}, error:null }; },
      async signUp(){ return { data:{session}, error:null }; },
      async signOut(){ session = null; return { error:null }; },
      async getSession(){ return { data:{session} }; },
      async resetPasswordForEmail(){ return { error:null }; },
      async updateUser(){ return { data:{}, error:null }; },
      onAuthStateChange(){ return { data:{subscription:{unsubscribe(){}}} }; }
    },
    from(){ const q = { select:()=>q, eq:()=>q,
      async maybeSingle(){ return { data:null, error:null }; },
      async upsert(){ return { error:null }; } }; return q; },
    channel(){ const c = { on:()=>c, subscribe:cb=>{ if(cb) cb('SUBSCRIBED'); return c; } }; return c; },
    removeChannel(){}
  };
}

(async () => {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => errs.push(String(e.detail || e.message)));
  vc.on('error', (...a) => errs.push(a.join(' ')));
  const dom = new JSDOM(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), {
    url:'https://sofin.test/', runScripts:'dangerously', pretendToBeVisual:true,
    virtualConsole:vc, resources:undefined });
  const { window } = dom;
  window.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollTo = () => {};
  window.fetch = async () => ({ ok:true, json: async () => ({}) });
  window.URL.createObjectURL = () => 'blob:x';
  if (!window.crypto || !window.crypto.subtle) {
    Object.defineProperty(window, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  }
  window.localStorage.setItem(KEY, JSON.stringify(seed()));
  window.supabase = { createClient: () => fakeSupabase() };
  window.__ENV__ = { SUPABASE_URL:'https://t.supabase.co', SUPABASE_ANON_KEY:'x'.repeat(60) };
  for (const rel of ['js/sync.js', 'js/app.js']) {
    const el = window.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
    window.document.body.appendChild(el);
  }
  await sleep(200);

  const d = window.document, $ = id => d.getElementById(id), S = () => window.eval('state');
  const bal = id => window.getWalletBalance(id);
  const type = (id, v) => { $(id).value = v; $(id).dispatchEvent(new window.Event('input', { bubbles:true })); };

  /* Drive the real form rather than pushing rows by hand — the point is that
     the button a person presses ends up moving both balances. */
  async function transfer(from, to, amount, opts) {
    opts = opts || {};
    window.switchTab('add'); window.setTxType('transfer'); await sleep(30);
    $('tf-from-wallet').value = from; $('tf-to-wallet').value = to;
    window.onTransferWalletChange(); await sleep(25);
    type('tf-amount-raw', String(amount));
    window.onTfAmountTyped(String(amount));
    if (opts.fee) type('tf-fee', String(opts.fee));
    $('tf-date').value = opts.date || window.todayISO();
    await sleep(20);
    window.saveTransfer(); await sleep(60);
  }

  console.log('\n--- chuyển ví cùng tiền tệ, qua đúng form UI ---');
  const a0 = bal('wA'), b0 = bal('wB'), assets0 = window.getUserTotalAssets();
  await transfer('wA', 'wB', 1500000);
  check('ví nguồn bị TRỪ đúng 1.500.000', bal('wA') === a0 - 1500000, `${a0} → ${bal('wA')}`);
  check('ví đích được CỘNG đúng 1.500.000', bal('wB') === b0 + 1500000, `${b0} → ${bal('wB')}`);
  check('tổng tài sản không đổi — tiền chỉ đổi chỗ',
    window.getUserTotalAssets() === assets0, `${assets0} → ${window.getUserTotalAssets()}`);
  check('tạo đúng một cặp transfer_out + transfer_in',
    S().transactions.filter(t => t.type === 'transfer_out').length === 1 &&
    S().transactions.filter(t => t.type === 'transfer_in').length === 1);
  check('hai chân chung một transferId', (() => {
    const ids = [...new Set(S().transactions.map(t => t.transferId))];
    return ids.length === 1 && !!ids[0];
  })());
  check('cả hai chân đều status completed',
    S().transactions.every(t => t.status === 'completed'));
  check('ghi ngay xuống localStorage',
    JSON.parse(window.localStorage.getItem(KEY)).transactions.length === 2);
  window.switchTab('dashboard'); await sleep(20);
  check('thẻ ví trên Dashboard cập nhật ngay',
    d.querySelector('#db-wallet-scroll .wallet-card .wbal').textContent.includes('8.500.000'),
    d.querySelector('#db-wallet-scroll .wallet-card .wbal').textContent);

  console.log('\n--- chuyển kèm PHÍ ---');
  const a1 = bal('wA'), b1 = bal('wB');
  await transfer('wA', 'wB', 1000000, { fee: 11000 });
  check('ví nguồn trừ cả tiền lẫn phí', bal('wA') === a1 - 1000000 - 11000, `${a1} → ${bal('wA')}`);
  check('ví đích chỉ cộng tiền, không dính phí', bal('wB') === b1 + 1000000, `${b1} → ${bal('wB')}`);

  console.log('\n--- chi tiết giao dịch chuyển ví ---');
  const out = S().transactions.find(t => t.type === 'transfer_out' && t.amount === 1000000);
  window.openTxDetail(out.id); await sleep(30);
  const detail = $('tx-detail-content').innerHTML;
  check('chỉ đúng ví đích Vietcombank', detail.includes('Vietcombank'));
  check('KHÔNG nhận nhầm bản ghi phí làm chân còn lại', !/Phí chuyển tiền/.test(detail));

  console.log('\n--- XOÁ giao dịch chuyển ví ---');
  const a2 = bal('wA'), b2 = bal('wB');
  window.deleteTx(out.id); await sleep(30);
  check('hộp thoại nói rõ sẽ xoá cả hai chiều và khoản phí',
    /hai chiều/i.test($('confirm-msg').textContent) && /phí/i.test($('confirm-msg').textContent),
    $('confirm-msg').textContent);
  $('confirm-yes').click(); await sleep(60);
  check('ví nguồn được hoàn lại cả tiền lẫn phí',
    bal('wA') === a2 + 1000000 + 11000, `${a2} → ${bal('wA')}`);
  check('ví đích bị trừ lại đúng 1.000.000', bal('wB') === b2 - 1000000, `${b2} → ${bal('wB')}`);
  check('không sót bản ghi nào mang transferId đó',
    S().transactions.filter(t => t.transferId === out.transferId).length === 0);

  console.log('\n--- chuyển khác tiền tệ VND → USD ---');
  const a3 = bal('wA'), u3 = bal('wU');
  window.switchTab('add'); window.setTxType('transfer'); await sleep(30);
  $('tf-from-wallet').value = 'wA'; $('tf-to-wallet').value = 'wU';
  window.onTransferWalletChange(); await sleep(25);
  check('form hiện ô "số tiền nhận được" khi khác tiền tệ',
    !$('tf-fx-group').classList.contains('hidden'));
  type('tf-amount-raw', '2500000');
  window.onTfAmountTyped('2500000'); await sleep(30);
  $('tf-date').value = window.todayISO();
  window.saveTransfer(); await sleep(60);
  check('ví VND trừ đúng 2.500.000', bal('wA') === a3 - 2500000, `${a3} → ${bal('wA')}`);
  check('ví USD cộng 100 USD theo tỷ giá', bal('wU') === u3 + 100, `${u3} → ${bal('wU')}`);

  console.log('\n--- chuyển ví NGÀY TƯƠNG LAI ---');
  const a4 = bal('wA'), b4 = bal('wB');
  await transfer('wA', 'wB', 700000, { date: window.addDaysISO(window.todayISO(), 5) });
  check('chưa tới ngày thì KHÔNG trừ ví nguồn', bal('wA') === a4, `${a4} → ${bal('wA')}`);
  check('chưa tới ngày thì KHÔNG cộng ví đích', bal('wB') === b4, `${b4} → ${bal('wB')}`);
  check('cả hai chân cùng mang status pending — không nửa vời',
    S().transactions.filter(t => t.status === 'pending' && t.type.startsWith('transfer')).length === 2);

  check('không lỗi console suốt quá trình', errs.length === 0, errs[0]);
  console.log('\n' + (fail ? `✗ ${fail} lỗi / ${pass + fail}` : `✓ ${pass}/${pass} đạt`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('crash', e); process.exit(1); });
