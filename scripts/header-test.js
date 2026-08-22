#!/usr/bin/env node
/* ============================================================
   App-bar consistency test.

   One <header id="main-header"> serves every screen, so the thing that can
   drift is not its markup but its STATE — hidden or not, and .hd-flat or not.
   .hd-flat decides whether the next element gets pulled up under the bar's
   lip, which only the dashboard's balance card is built to survive.

   The gap this was written for: onboarding shows the bar without going
   through switchTab(), so it inherited whatever the flag happened to be and
   dragged "Tạo ví đầu tiên" into the blue. The bar now defaults to flat and
   only the dashboard opts out.

   Requires jsdom:  npm install jsdom --no-save
   Run:             npm run header-test
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const PUBLIC = path.resolve(__dirname, '..', 'public');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeSb(){
  const L=[]; let session=null; const users=new Map();
  return { auth:{
      async signUp({email,password}){ const u={id:'u1',email}; users.set(email,{...u,password});
        session={user:u,access_token:'t'}; L.forEach(f=>f('SIGNED_IN',session)); return {data:{session,user:u},error:null}; },
      async signInWithPassword({email,password}){ const r=users.get(email);
        if(!r||r.password!==password) return {data:{},error:{message:'Invalid login credentials'}};
        session={user:{id:r.id,email},access_token:'t'}; L.forEach(f=>f('SIGNED_IN',session)); return {data:{session},error:null}; },
      async signOut(){ session=null; L.forEach(f=>f('SIGNED_OUT',null)); return {error:null}; },
      async getSession(){ return {data:{session}}; },
      async resetPasswordForEmail(){ return {error:null}; },
      async updateUser(){ return {data:{},error:null}; },
      onAuthStateChange(f){ L.push(f); return {data:{subscription:{unsubscribe(){}}}}; } },
    from(){const q={select:()=>q,eq:()=>q,async maybeSingle(){return{data:null,error:null}},
      async upsert(){return{error:null}}};return q;},
    channel(){const c={on:()=>c,subscribe:cb=>{if(cb)cb('SUBSCRIBED');return c}};return c;}, removeChannel(){} };
}

async function boot(opts){
  opts = opts || {};
  const vc=new VirtualConsole(); const errs=[];
  vc.on('jsdomError',e=>errs.push(String(e.detail||e.message)));
  vc.on('error',(...a)=>errs.push(a.join(' ')));
  const dom=new JSDOM(fs.readFileSync(path.join(PUBLIC,'index.html'),'utf8'),
    {url:'https://sofin.test/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,resources:undefined});
  const {window}=dom;
  window.matchMedia=q=>({matches:false,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
  window.HTMLCanvasElement.prototype.getContext=()=>null;
  window.scrollTo=()=>{}; window.fetch=async()=>({ok:true,json:async()=>({})});
  window.URL.createObjectURL=()=>'blob:x';
  if(!window.crypto||!window.crypto.subtle) Object.defineProperty(window,'crypto',{value:require('crypto').webcrypto,configurable:true});
  window.supabase={createClient:()=>fakeSb()};
  window.__ENV__= opts.noKeys ? {SUPABASE_URL:'',SUPABASE_ANON_KEY:''}
                              : {SUPABASE_URL:'https://t.supabase.co',SUPABASE_ANON_KEY:'x'.repeat(60)};
  for(const rel of ['js/sync.js','js/app.js']){
    const el=window.document.createElement('script');
    el.textContent=fs.readFileSync(path.join(PUBLIC,rel),'utf8');
    window.document.body.appendChild(el);
  }
  await sleep(120);
  return {window,errs};
}

let pass=0,fail=0;
const check=(l,ok,d)=>{console.log((ok?'  ✓ ':'  ✗ ')+l+(ok||!d?'':' — '+d));ok?pass++:fail++;};

(async()=>{
  const {window}=await boot();
  const d=window.document,$=id=>d.getElementById(id);
  const hd=()=>$('main-header');
  const state=()=>({hidden:hd().classList.contains('hidden'), flat:hd().classList.contains('hd-flat')});
  const visibleView=()=>[...d.querySelectorAll('.view')].filter(v=>!v.classList.contains('hidden')).map(v=>v.id)[0];

  console.log('\n--- màn hình đăng nhập ---');
  check('login: header ẩn hẳn', state().hidden, JSON.stringify(state()));

  console.log('\n--- onboarding (tài khoản mới) ---');
  $('login-email').value='a@b.co'; $('login-password').value='secret123';
  window.setAuthMode('register',$('auth-segment').children[1]);
  await window.handleAuthSubmit(); await sleep(150);
  check('đang ở màn onboarding', visibleView()==='view-onboarding', visibleView());
  check('onboarding: header hiện ra', !state().hidden);
  check('onboarding: header PHẲNG (không nuốt tiêu đề)', state().flat,
    'hd-flat=' + state().flat + ' → tiêu đề "Tạo ví đầu tiên" bị kéo 20px vào nền xanh');

  console.log('\n--- sau khi hoàn tất onboarding ---');
  window.obGoStep(2); await sleep(20);
  d.querySelectorAll('.ob-bal-input').forEach(i=>{i.value='1000000';});
  window.obGoStep(3); await sleep(20);
  window.finishOnboarding(); await sleep(60);
  check('vào dashboard', visibleView()==='view-dashboard', visibleView());
  check('dashboard: header KHÔNG phẳng (thẻ số dư đè lên)', !state().flat);

  console.log('\n--- mọi tab điều hướng ---');
  for(const t of ['transactions','reports','settings','add','wallets','budget','debts','recurring','events','categories']){
    window.switchTab(t); await sleep(15);
    check(`${t}: header phẳng`, state().flat && !state().hidden, JSON.stringify(state()));
  }
  window.switchTab('dashboard'); await sleep(15);
  check('quay lại dashboard: bỏ phẳng', !state().flat);

  console.log('\n--- khoá PIN ---');
  window.showLockScreen('set1'); await sleep(20);
  check('lock screen là overlay riêng, không đụng header', !state().hidden);
  window.lockAltAction(); await sleep(20);

  console.log('\n--- đăng xuất rồi đăng nhập lại ---');
  window.switchTab('settings'); await sleep(20);      // rời đi lúc header đang phẳng
  await window.Sync.signOut(); await sleep(60);
  check('đăng xuất: header ẩn', state().hidden);
  $('login-email').value='a@b.co'; $('login-password').value='secret123';
  window.setAuthMode('login',$('auth-segment').children[0]);
  await window.handleAuthSubmit(); await sleep(150);
  check('đăng nhập lại vào dashboard', visibleView()==='view-dashboard', visibleView());
  check('header không giữ trạng thái phẳng cũ', !state().flat);

  console.log('\n--- build thiếu key ---');
  const {window:w2}=await boot({noKeys:true});
  check('màn cấu hình: header ẩn',
    w2.document.getElementById('main-header').classList.contains('hidden'));

  console.log('\n'+(fail?`✗ ${fail} lỗi / ${pass+fail}`:`✓ ${pass}/${pass} đạt`));
  process.exit(fail?1:0);
})().catch(e=>{console.error('crash',e);process.exit(1);});
