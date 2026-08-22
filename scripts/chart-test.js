#!/usr/bin/env node
/* ============================================================
   Chart contract test.

   smoke.js stubs getContext() to null, so every drawing path is skipped there
   and the hit-testing behind the donut tooltip has never actually run. This
   file hands the app a recording 2D context instead: the draw code executes
   for real, records its geometry into chartHit, and we can aim a pointer at
   a known angle and check which slice answers.

   The bug that prompted it: switching Chi tiêu → Thu nhập with no income left
   the previous chart's slices in chartHit, so touching the empty ring popped
   a tooltip naming categories that were not on screen.

   Requires jsdom:  npm install jsdom --no-save
   Run:             npm run chart-test
   ============================================================ */

'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const PUBLIC = path.resolve(__dirname, '..', 'public');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UID = 'uid-chart';
const KEY = 'FINYOURTIN_STATE_V4::' + UID;

let pass = 0, fail = 0;
const check = (l, ok, d) => { console.log((ok ? '  ✓ ' : '  ✗ ') + l + (ok || !d ? '' : ' — ' + d)); ok ? pass++ : fail++; };

/* A 2D context that swallows every call and remembers the text it drew. Enough
   for the draw functions to run end to end without a real rasteriser. */
function recordingContext() {
  const texts = [];
  const ctx = {
    __texts: texts,
    fillText: (t) => texts.push(String(t)),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 10 })
  };
  for (const m of ['beginPath','closePath','arc','arcTo','moveTo','lineTo','rect','fill','stroke',
                   'clearRect','fillRect','setTransform','save','restore','scale','translate']) {
    ctx[m] = () => {};
  }
  return ctx;
}

function seed() {
  const now = new Date();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = iso(now);
  const tx = (id, type, amount, cat) => ({ id, userId:UID, type, amount, walletId:'w1',
    categoryId:cat, note:id, date:today, status:'completed' });
  return {
    version:4, currentUser:null, updatedAt:Date.now(),
    app:{theme:'light',pinEnabled:false,pinHash:null,privacy:false,mainCurrency:'VND',rates:{VND:1}},
    wallets:[{id:'w1',userId:UID,name:'Tiền mặt',icon:'👛',type:'cash',currency:'VND',
              startingBalance:50000000,displayOrder:1}],
    /* 6.000.000 chi, chia 50 / 33.33 / 16.67 % — góc dễ tính để nhắm chuột.
       Cố ý KHÔNG có khoản thu nào: đó là kịch bản sinh ra lỗi. */
    transactions:[ tx('e1','expense',3000000,'c_food'),
                   tx('e2','expense',2000000,'c_transport'),
                   tx('e3','expense',1000000,'c_bill') ],
    budgets:[], recurring:[], debts:[], events:[], categories:{}, onboardingStatus:{[UID]:true}
  };
}

function fakeSupabase(){
  let session={user:{id:UID,email:'a@b.co'},access_token:'t'};
  return { auth:{ async signInWithPassword(){return{data:{session},error:null}},
      async signUp(){return{data:{session},error:null}}, async signOut(){session=null;return{error:null}},
      async getSession(){return{data:{session}}}, async resetPasswordForEmail(){return{error:null}},
      async updateUser(){return{data:{},error:null}}, onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}} },
    from(){const q={select:()=>q,eq:()=>q,async maybeSingle(){return{data:null,error:null}},
      async upsert(){return{error:null}}};return q;},
    channel(){const c={on:()=>c,subscribe:cb=>{if(cb)cb('SUBSCRIBED');return c}};return c;}, removeChannel(){} };
}

(async () => {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => errs.push(String(e.detail || e.message)));
  vc.on('error', (...a) => errs.push(a.join(' ')));
  const dom = new JSDOM(fs.readFileSync(path.join(PUBLIC,'index.html'),'utf8'),
    { url:'https://sofin.test/', runScripts:'dangerously', pretendToBeVisual:true,
      virtualConsole:vc, resources:undefined });
  const { window } = dom;
  window.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
  window.scrollTo = () => {};
  window.fetch = async () => ({ ok:true, json: async () => ({}) });
  window.URL.createObjectURL = () => 'blob:x';
  if (!window.crypto || !window.crypto.subtle)
    Object.defineProperty(window,'crypto',{value:require('crypto').webcrypto,configurable:true});

  /* the point of this file: a context that actually answers */
  const ctxByCanvas = new WeakMap();
  window.HTMLCanvasElement.prototype.getContext = function(){
    if (!ctxByCanvas.has(this)) ctxByCanvas.set(this, recordingContext());
    return ctxByCanvas.get(this);
  };
  /* jsdom lays nothing out; pin a phone-width box so geometry is deterministic */
  const CSS_W = 320;
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function(){
    /* mirror the CSS: the donut sits in a square box, the others keep the
       height from their own attribute */
    const h = this.hasAttribute('data-fill') ? CSS_W : (Number(this.getAttribute('height')) || 200);
    return { left:0, top:0, right:CSS_W, bottom:h, width:CSS_W, height:h, x:0, y:0 };
  };

  window.localStorage.setItem(KEY, JSON.stringify(seed()));
  window.supabase = { createClient: () => fakeSupabase() };
  window.__ENV__ = { SUPABASE_URL:'https://t.supabase.co', SUPABASE_ANON_KEY:'x'.repeat(60) };
  for (const rel of ['js/sync.js','js/app.js']) {
    const el = window.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(PUBLIC, rel),'utf8');
    window.document.body.appendChild(el);
  }
  await sleep(200);

  const d = window.document, $ = id => d.getElementById(id);
  const hit = () => window.eval('chartHit');
  const donutCtx = () => ctxByCanvas.get($('chart-donut'));

  window.switchTab('reports'); await sleep(60);

  console.log('\n--- donut vẽ thật, hình học được ghi lại ---');
  const g = hit().donut;
  check('chartHit.donut được điền sau khi vẽ', !!g && g.slices.length === 3,
    g ? g.slices.length + ' lát' : 'null');
  check('canvas dùng đúng bề rộng CSS đo được', !!g && g.cx === CSS_W/2, g && g.cx);
  check('khung donut vuông nên tâm nằm giữa cả hai chiều',
    !!g && g.cx === g.cy, g && (g.cx + ' / ' + g.cy));
  check('bán kính lấy theo cạnh vuông, không bị bóp theo chiều thấp',
    !!g && Math.abs(g.rOuter - (CSS_W/2 - 8)) < 1e-9, g && g.rOuter);
  check('tỷ lệ các lát đúng 50 / 33 / 17',
    !!g && g.slices.map(s=>s.pct).join('/') === '50/33/17', g && g.slices.map(s=>s.pct).join('/'));
  check('lát đầu bắt đầu từ mốc -90°', !!g && Math.abs(g.slices[0].from + Math.PI/2) < 1e-9);
  check('các lát khép kín đúng một vòng tròn',
    !!g && Math.abs((g.slices[2].to - g.slices[0].from) - 2*Math.PI) < 1e-9);

  console.log('\n--- hit-test: chạm vào đúng lát nào ---');
  /* Điểm nằm giữa bán kính, ở góc giữa của từng lát. */
  const aim = i => {
    const s = g.slices[i], mid = (s.from + s.to)/2, r = (g.rInner + g.rOuter)/2;
    return { x: g.cx + Math.cos(mid)*r, y: g.cy + Math.sin(mid)*r };
  };
  const probe = pt => {
    const cv = $('chart-donut');
    const ev = new window.Event('pointermove', { bubbles:true });
    Object.defineProperty(ev, 'clientX', { value: pt.x });
    Object.defineProperty(ev, 'clientY', { value: pt.y });
    cv.dispatchEvent(ev);
    return $('tip-donut');
  };
  for (let i = 0; i < 3; i++) {
    const tip = probe(aim(i));
    check(`chạm lát ${i+1} hiện đúng "${g.slices[i].label}"`,
      !tip.classList.contains('hidden') && tip.innerHTML.includes(g.slices[i].label),
      tip.textContent.slice(0, 40));
  }
  const centre = probe({ x: g.cx, y: g.cy });
  check('chạm vào lỗ giữa thì không hiện tooltip', centre.classList.contains('hidden'));
  const outside = probe({ x: g.cx + g.rOuter + 20, y: g.cy });
  check('chạm ra ngoài vành thì không hiện tooltip', outside.classList.contains('hidden'));

  console.log('\n--- phần trăm ở tâm đổi theo lát đang chạm ---');
  donutCtx().__texts.length = 0;
  probe(aim(0));
  check('tâm hiện phần trăm của lát đang chạm',
    donutCtx().__texts.some(t => t === g.slices[0].pct + '%'), donutCtx().__texts.join(' | '));
  donutCtx().__texts.length = 0;
  const cv = $('chart-donut');
  cv.dispatchEvent(new window.Event('pointerleave', { bubbles:true }));
  check('rời tay khỏi biểu đồ thì tâm quay lại tổng số',
    !donutCtx().__texts.some(t => /%$/.test(t)), donutCtx().__texts.join(' | '));

  console.log('\n--- ĐỔI TAB Chi tiêu → Thu nhập (không có dữ liệu thu) ---');
  window.setDonutMode('income'); await sleep(60);
  check('nút Thu nhập sáng, Chi tiêu tắt',
    $('seg-donut-income').classList.contains('active') && !$('seg-donut-expense').classList.contains('active'));
  check('canvas vẽ chữ "Không có dữ liệu"',
    donutCtx().__texts.some(t => t.includes('Không có dữ liệu')), donutCtx().__texts.join(' | '));
  check('hình học cũ ĐƯỢC XOÁ, không còn lát nào sống sót', hit().donut === null,
    hit().donut ? hit().donut.slices.length + ' lát cũ vẫn còn' : 'null');
  const ghost = probe({ x: g.cx + (g.rInner + g.rOuter)/2, y: g.cy });
  check('chạm vào vành rỗng KHÔNG bung tooltip của danh mục cũ',
    ghost.classList.contains('hidden'), ghost.textContent.slice(0, 50));
  check('danh sách xếp hạng cũng rỗng theo', $('rep-cat-list').textContent.includes('Không có dữ liệu'));

  console.log('\n--- quay lại Chi tiêu ---');
  window.setDonutMode('expense'); await sleep(60);
  check('nút Chi tiêu sáng lại',
    $('seg-donut-expense').classList.contains('active') && !$('seg-donut-income').classList.contains('active'));
  check('hình học được dựng lại đủ 3 lát', hit().donut && hit().donut.slices.length === 3);
  const back = probe(aim(0));
  check('tooltip hoạt động trở lại', !back.classList.contains('hidden'));

  console.log('\n--- biểu đồ hỏng không được kéo sập danh sách ---');
  {
    const real = window.drawDonut;
    window.drawDonut = function(){ throw new Error('canvas nổ'); };
    let threw = null;
    try { window.renderReportsView(); } catch (e) { threw = e.message; }
    await sleep(40);
    check('renderReportsView không ném lỗi ra ngoài', !threw, threw);
    check('danh sách xếp hạng VẪN render dù biểu đồ nổ',
      $('rep-cat-list').querySelectorAll('.rank-row').length === 3,
      $('rep-cat-list').querySelectorAll('.rank-row').length + ' hàng');
    check('thẻ tổng quan vẫn có số', /[0-9]/.test($('rep-income').textContent));
    window.drawDonut = real;
    window.renderReportsView(); await sleep(40);
    check('khôi phục thì biểu đồ vẽ lại bình thường',
      !!hit().donut && hit().donut.slices.length === 3);
  }

  console.log('\n--- biểu đồ cột ---');
  const b = hit().bars;
  check('chartHit.bars được điền, 6 tháng', !!b && b.series.length === 6, b ? b.series.length : 'null');
  const barCv = $('chart-bar');
  const barEv = new window.Event('pointermove', { bubbles:true });
  Object.defineProperty(barEv, 'clientX', { value: b.padL + b.groupW*5.5 });
  Object.defineProperty(barEv, 'clientY', { value: b.padT + 10 });
  barCv.dispatchEvent(barEv);
  check('chạm cột tháng này hiện cả Thu, Chi và Ròng', (() => {
    const h = $('tip-bar').innerHTML;
    return !$('tip-bar').classList.contains('hidden') && /Thu/.test(h) && /Chi/.test(h) && /Ròng/.test(h);
  })(), $('tip-bar').textContent.slice(0, 60));

  console.log('\n--- đổi bộ lọc rồi chạm lại ---');
  window.setReportRange('thisyear', d.querySelector('#report-range-seg .chip[data-val="thisyear"]'));
  await sleep(60);
  const after = hit().donut;
  check('hình học được dựng lại sau khi đổi mốc thời gian', !!after && after.slices.length === 3);
  const tip2 = probe({ x: after.cx + Math.cos((after.slices[0].from+after.slices[0].to)/2)*((after.rInner+after.rOuter)/2),
                       y: after.cy + Math.sin((after.slices[0].from+after.slices[0].to)/2)*((after.rInner+after.rOuter)/2) });
  check('tooltip vẫn nhắm đúng lát sau khi lọc lại', !tip2.classList.contains('hidden'));

  check('không lỗi console suốt quá trình', errs.length === 0, errs[0]);
  console.log('\n' + (fail ? `✗ ${fail} lỗi / ${pass+fail}` : `✓ ${pass}/${pass} đạt`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('crash', e); process.exit(1); });
