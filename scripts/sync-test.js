/* ============================================================
   Sync contract test.

   smoke.js drives the UI; this one holds the network open on purpose so we can
   inspect the app *while* a request is still in flight. That is the only way
   to prove the claims the architecture rests on:

     · the cache paints before Supabase answers  (0ms first render)
     · a write lands in the UI before the server acknowledges it
     · going offline degrades instead of crashing, and coming back online
       drains by itself
     · closing the tab mid-outage loses nothing — the snapshot in localStorage
       is the queue, and the next boot pushes it because its clock is newer
     · a newer cloud snapshot wins and is not clobbered on the way in

   Requires jsdom:  npm install jsdom --no-save
   Run:             npm run sync-test
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const PUBLIC = path.resolve(__dirname, '..', 'public');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UID = 'uid-hybrid';
const KEY = 'FINYOURTIN_STATE_V4::' + UID;

let pass = 0, fail = 0;
const check = (l, ok, d) => { console.log((ok ? '  ✓ ' : '  ✗ ') + l + (ok || !d ? '' : ' — ' + d)); ok ? pass++ : fail++; };

function snapshot(txCount, stamp) {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = iso(new Date());
  return {
    version:4, currentUser:null, updatedAt:stamp,
    app:{theme:'light', pinEnabled:false, pinHash:null, privacy:false, mainCurrency:'VND', rates:{VND:1}},
    wallets:[{id:'w1', userId:UID, name:'Tiền mặt', icon:'👛', type:'cash', currency:'VND',
              startingBalance:10000000, displayOrder:1}],
    transactions: Array.from({length:txCount}, (_,i)=>({
      id:'t'+i, userId:UID, type:'expense', amount:100000, walletId:'w1',
      categoryId:'c_food', note:'Ghi '+i, date:today, status:'completed'})),
    budgets:[], recurring:[], debts:[], events:[], categories:{}, onboardingStatus:{[UID]:true}
  };
}

/* A double we can stall at will. `gate.hold` keeps every call pending. */
function makeSupabase(gate) {
  let session = { user:{id:UID, email:'a@b.co'}, access_token:'t' };
  const wait = async () => { while (gate.hold) await sleep(5); };
  return {
    auth:{
      async signInWithPassword(){ return {data:{session}, error:null}; },
      async signUp(){ return {data:{session}, error:null}; },
      async signOut(){ session=null; return {error:null}; },
      async getSession(){ return {data:{session}}; },
      async resetPasswordForEmail(){ return {error:null}; },
      async updateUser(){ return {data:{}, error:null}; },
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }
    },
    from(){
      const q = { select:()=>q, eq:()=>q,
        async maybeSingle(){ await wait(); gate.pulls++; return {data: gate.remote, error:null}; },
        async upsert(row){
          await wait();
          if(gate.failWrites) return {error:{message:'network down'}};
          gate.remote = {data:row.data, updated_at:row.updated_at, device_id:row.device_id};
          gate.writes++;
          return {error:null};
        } };
      return q;
    },
    channel(){ const c={on:()=>c, subscribe:cb=>{ if(cb) cb('SUBSCRIBED'); return c; }}; return c; },
    removeChannel(){}
  };
}

async function boot(seed, gate) {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e=>errs.push(String(e.detail||e.message)));
  vc.on('error', (...a)=>errs.push(a.join(' ')));
  const dom = new JSDOM(fs.readFileSync(path.join(PUBLIC,'index.html'),'utf8'), {
    url:'https://sofin.test/', runScripts:'dangerously', pretendToBeVisual:true,
    virtualConsole:vc, resources:undefined });
  const { window } = dom;
  window.matchMedia = q=>({matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}});
  window.HTMLCanvasElement.prototype.getContext = ()=>null;
  window.scrollTo = ()=>{};
  window.fetch = async ()=>({ok:true, json:async()=>({})});
  window.URL.createObjectURL = ()=>'blob:x';
  if(!window.crypto || !window.crypto.subtle)
    Object.defineProperty(window,'crypto',{value:require('crypto').webcrypto, configurable:true});
  for(const [k,v] of Object.entries(seed)) window.localStorage.setItem(k,v);
  window.supabase = { createClient: ()=>makeSupabase(gate) };
  window.__ENV__ = {SUPABASE_URL:'https://t.supabase.co', SUPABASE_ANON_KEY:'x'.repeat(60)};
  for(const rel of ['js/sync.js','js/app.js']){
    const el = window.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(PUBLIC, rel),'utf8');
    window.document.body.appendChild(el);
  }
  return { window, errs };
}

(async () => {
  /* ---------- 1. READ: cache paints before the network answers ---------- */
  console.log('\n--- luồng ĐỌC: cache trước, mạng sau ---');
  {
    const gate = { hold:true, pulls:0, writes:0, remote:null };
    const { window, errs } = await boot({[KEY]: JSON.stringify(snapshot(4, Date.now()-5000))}, gate);
    await sleep(120);                        // request tới Supabase vẫn đang bị giữ
    const S = () => window.eval('state');
    const $ = id => window.document.getElementById(id);
    check('UI đã render trong khi request Supabase còn treo',
      !$('view-dashboard').classList.contains('hidden') && gate.pulls === 0,
      'pulls=' + gate.pulls);
    check('số liệu lấy từ cache, không chờ mạng', S().transactions.length === 4);
    check('số dư đã tính xong: 10.000.000 - 4×100.000',
      window.getWalletBalance('w1') === 9600000, String(window.getWalletBalance('w1')));
    check('không lỗi console', errs.length === 0, errs[0]);

    /* remote mới hơn → thả cổng ra thì UI phải tự cập nhật */
    gate.remote = { data: Object.assign(snapshot(9, Date.now()+60000), {currentUser:null}) };
    gate.hold = false;
    await sleep(200);
    check('mạng trả về bản mới hơn thì UI re-render theo',
      S().transactions.length === 9, 'tx=' + S().transactions.length);
    check('cache cũng được ghi đè bằng bản mới',
      JSON.parse(window.localStorage.getItem(KEY)).transactions.length === 9);
  }

  /* ---------- 2. WRITE: optimistic ---------- */
  console.log('\n--- luồng GHI: optimistic update ---');
  {
    const gate = { hold:false, pulls:0, writes:0, remote:null };
    const { window } = await boot({[KEY]: JSON.stringify(snapshot(2, Date.now()))}, gate);
    await sleep(150);
    const S = () => window.eval('state');
    const before = window.getWalletBalance('w1');
    gate.hold = true;                       // chặn mọi request từ lúc này
    const w = gate.writes;
    S().transactions.push({id:'t_new', userId:UID, type:'expense', amount:500000, walletId:'w1',
      categoryId:'c_food', note:'Mới', date:window.todayISO(), status:'completed'});
    window.saveStorage();
    window.switchTab('transactions'); await sleep(30);
    check('số dư đổi ngay dù Supabase chưa phản hồi',
      window.getWalletBalance('w1') === before - 500000 && gate.writes === w);
    check('đã ghi xuống localStorage ngay lập tức',
      JSON.parse(window.localStorage.getItem(KEY)).transactions.some(t=>t.id==='t_new'));
    check('danh sách hiển thị giao dịch mới ngay',
      window.document.getElementById('tx-list-container').innerHTML.includes('Mới'));
    gate.hold = false; await sleep(950);
    check('sau đó mới thực sự đẩy lên Supabase', gate.writes > w, 'writes=' + gate.writes);
  }

  /* ---------- 3. OFFLINE → ONLINE ---------- */
  console.log('\n--- mất mạng rồi có lại ---');
  {
    const gate = { hold:false, pulls:0, writes:0, remote:null, failWrites:false };
    const { window } = await boot({[KEY]: JSON.stringify(snapshot(1, Date.now()))}, gate);
    await sleep(150);
    const S = () => window.eval('state');
    gate.failWrites = true;
    window.dispatchEvent(new window.Event('offline'));
    for(let i=0;i<3;i++){
      S().transactions.push({id:'off'+i, userId:UID, type:'expense', amount:70000, walletId:'w1',
        categoryId:'c_food', note:'Offline '+i, date:window.todayISO(), status:'completed'});
      window.saveStorage(); await sleep(30);
    }
    await sleep(950);
    check('offline: trạng thái đồng bộ báo lỗi/ngoại tuyến, không crash',
      ['offline','error','pending'].includes(window.Sync.status().phase), window.Sync.status().phase);
    check('offline: 3 thao tác vẫn nằm trong localStorage',
      JSON.parse(window.localStorage.getItem(KEY)).transactions.length === 4);

    gate.failWrites = false;
    const w = gate.writes;
    window.dispatchEvent(new window.Event('online'));
    await sleep(400);
    check('có mạng lại: tự đẩy lên Supabase, không cần thao tác tay', gate.writes > w);
    check('bản trên cloud có đủ 4 giao dịch',
      gate.remote && gate.remote.data.transactions.length === 4,
      gate.remote ? gate.remote.data.transactions.length : 'null');
    check('trạng thái quay lại synced', window.Sync.status().phase === 'synced', window.Sync.status().phase);
  }

  /* ---------- 4. ĐÓNG TAB LÚC OFFLINE — phép thử thật của "queue" ---------- */
  console.log('\n--- đóng tab lúc offline rồi mở lại ---');
  {
    const gate = { hold:false, pulls:0, writes:0, remote:null, failWrites:false };
    const s1 = await boot({[KEY]: JSON.stringify(snapshot(1, Date.now()-10000))}, gate);
    await sleep(150);
    gate.failWrites = true;                      // rớt mạng
    const S1 = () => s1.window.eval('state');
    S1().transactions.push({id:'ghost', userId:UID, type:'expense', amount:123000, walletId:'w1',
      categoryId:'c_food', note:'Ghi rồi đóng tab', date:s1.window.todayISO(), status:'completed'});
    s1.window.saveStorage();
    await sleep(950);
    const carried = s1.window.localStorage.getItem(KEY);
    check('thao tác nằm an toàn trong localStorage trước khi tab chết',
      JSON.parse(carried).transactions.some(t=>t.id==='ghost'));
    s1.window.close();                           // tab biến mất — pendingSnapshot trong RAM mất theo

    gate.failWrites = false;                     // mở lại khi đã có mạng
    const s2 = await boot({[KEY]: carried}, gate);
    await sleep(400);
    check('mở lại: cache cũ vẫn còn nguyên thao tác offline',
      s2.window.eval('state').transactions.some(t=>t.id==='ghost'));
    check('KHÔNG mất dữ liệu: bản local mới hơn được đẩy lên cloud',
      gate.remote && gate.remote.data.transactions.some(t=>t.id==='ghost'),
      gate.remote ? 'remote có ' + gate.remote.data.transactions.length + ' tx' : 'remote null');
  }

  /* ---------- 5. cloud thắng khi cloud mới hơn ---------- */
  console.log('\n--- thiết bị khác ghi đè khi bản cloud mới hơn ---');
  {
    const gate = { hold:false, pulls:0, writes:0,
      remote:{ data: Object.assign(snapshot(7, Date.now()+120000), {currentUser:null}) } };
    const { window } = await boot({[KEY]: JSON.stringify(snapshot(2, Date.now()-60000))}, gate);
    await sleep(400);
    check('bản cloud mới hơn thì local nhận về', window.eval('state').transactions.length === 7,
      'tx=' + window.eval('state').transactions.length);
    check('không đẩy ngược đè lên bản mới của thiết bị kia', gate.writes === 0, 'writes=' + gate.writes);
  }

  console.log('\n' + (fail ? `✗ ${fail} lỗi / ${pass+fail}` : `✓ ${pass}/${pass} đạt`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('crash', e); process.exit(1); });
