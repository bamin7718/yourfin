/* ============================================================
   SoFin — Supabase client, auth and state sync

   The whole app is one `state` object (see app.js). Rather than shredding it
   into a dozen tables, we store it as a single JSONB snapshot per user and let
   Postgres Realtime tell other devices when it changed:

       public.user_state(user_id uuid pk, data jsonb, updated_at, device_id)

   Write path : saveStorage() -> localStorage (sync) -> Sync.queuePush (debounced)
   Read  path : Sync.pull() on start/focus + realtime UPDATE from other devices

   Conflicts are resolved last-write-wins on `data.updatedAt`, a client clock
   stamped by saveStorage(). Good enough for a single person on a handful of
   devices; it is not a CRDT and does not try to be.
   ============================================================ */
(function(global){
  'use strict';

  const TABLE          = 'user_state';
  const PUSH_DEBOUNCE  = 800;      /* ms of quiet before a write leaves the device */
  const STALE_AFTER    = 30000;    /* re-pull on tab focus if older than this */
  const CFG_KEY        = 'FINYOURTIN_SUPABASE_CFG';
  const DEVICE_KEY     = 'FINYOURTIN_DEVICE_ID';

  let client   = null;
  let userId   = null;
  let channel  = null;
  let pushTimer = null;
  let pendingSnapshot = null;
  let inFlight = false;
  let lastPullAt = 0;
  let cfg = null;

  let phase = 'offline';           /* offline | pending | synced | error */
  let message = '';
  let lastSyncAt = 0;

  /* app.js declares its state with `let`, which in a classic script lives in
     the global *lexical* scope and is therefore NOT reachable as window.state.
     So the app hands us explicit accessors instead of us reaching for globals. */
  let bridge = {
    getState:  ()=>null,
    adopt:     ()=>{},
    onStatus:  ()=>{},
    notify:    ()=>{}
  };
  function bind(hooks){ bridge = Object.assign(bridge, hooks); }

  /* A stable per-browser id so a device never reacts to the echo of its own write. */
  const deviceId = (function(){
    let d = null;
    try{ d = localStorage.getItem(DEVICE_KEY); }catch(e){}
    if(!d){
      d = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try{ localStorage.setItem(DEVICE_KEY, d); }catch(e){}
    }
    return d;
  })();

  /* ---------- configuration ----------
     Three sources, first hit wins:
       1. window.__ENV__      — written by scripts/generate-env.js at build time
       2. <meta name="supabase-url" | "supabase-anon-key">
       3. localStorage        — typed into the in-app config screen
     Anon keys are designed to ship to the browser; row-level security, not
     secrecy, is what protects the data. */
  function readConfig(){
    const env = global.__ENV__ || {};
    if(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && !/^__/.test(env.SUPABASE_URL)){
      return {url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY, source: 'build'};
    }
    const m = n => { const el = document.querySelector('meta[name="'+n+'"]'); return el && el.content; };
    if(m('supabase-url') && m('supabase-anon-key')){
      return {url: m('supabase-url'), key: m('supabase-anon-key'), source: 'meta'};
    }
    try{
      const raw = localStorage.getItem(CFG_KEY);
      if(raw){
        const o = JSON.parse(raw);
        if(o.url && o.key) return {url:o.url, key:o.key, source:'local'};
      }
    }catch(e){}
    return null;
  }

  function saveLocalConfig(url, key){
    try{ localStorage.setItem(CFG_KEY, JSON.stringify({url, key})); }catch(e){}
  }

  function init(){
    if(!global.supabase || !global.supabase.createClient){
      return {ok:false, reason:'Không tải được thư viện @supabase/supabase-js. Kiểm tra kết nối mạng hoặc trình chặn quảng cáo.'};
    }
    cfg = readConfig();
    if(!cfg){
      return {ok:false, reason:'Chưa có SUPABASE_URL / SUPABASE_ANON_KEY.'};
    }
    try{
      client = global.supabase.createClient(cfg.url, cfg.key, {
        auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
      });
    }catch(e){
      return {ok:false, reason:'Cấu hình Supabase không hợp lệ: ' + e.message};
    }
    return {ok:true};
  }

  /* ---------- auth ---------- */
  async function signIn(email, password){
    const {data, error} = await client.auth.signInWithPassword({email, password});
    return {session: data && data.session, error};
  }
  async function signUp(email, password){
    const {data, error} = await client.auth.signUp({email, password});
    return {session: data && data.session, error};
  }
  async function signOut(){
    stop();
    return client.auth.signOut();
  }
  async function resetPassword(email){
    /* In the app `location.origin` is https://localhost, which Supabase will
       reject and which no mail client can open anyway. Send those users to the
       real site — it is the same app, and it can finish the reset. */
    const native = !!(global.Capacitor && (global.Capacitor.isNativePlatform
      ? global.Capacitor.isNativePlatform() : true));
    const web = (global.__ENV__ && global.__ENV__.SITE_URL) || '';
    const redirectTo = (native && web) ? web : location.origin + location.pathname;
    return client.auth.resetPasswordForEmail(email, {redirectTo});
  }
  /* Used after a PASSWORD_RECOVERY event, when the link from the email has
     already put a short-lived recovery session in place. */
  async function updatePassword(password){
    return client.auth.updateUser({password});
  }
  async function getSession(){
    const {data} = await client.auth.getSession();
    return data && data.session;
  }
  function onAuthChange(fn){
    client.auth.onAuthStateChange((event, session)=>fn(event, session));
  }

  /* ---------- status ---------- */
  function setPhase(p, msg){
    phase = p; message = msg || '';
    if(p === 'synced') lastSyncAt = Date.now();
    const el = document.getElementById('sync-pill');
    if(el){
      /* a CSS dot rather than a coloured-circle emoji: it inherits the theme
         palette and renders identically on every platform */
      el.className = 'dot dot-' + (['synced','pending','offline','error'].indexOf(p) >= 0 ? p : 'offline');
      el.title = msg || p;
    }
    bridge.onStatus(phase, message);
  }
  function status(){ return {phase, message, lastSyncAt, deviceId, source: cfg && cfg.source}; }

  /* ---------- pull ---------- */
  async function pull(force){
    if(!client || !userId) return;
    try{
      const {data, error} = await client
        .from(TABLE).select('data, updated_at, device_id')
        .eq('user_id', userId).maybeSingle();
      lastPullAt = Date.now();
      if(error){ setPhase('error', error.message); return; }

      const local = bridge.getState();
      if(!data){
        /* First sign-in on this account — seed the row from whatever is local. */
        await push(local, true);
        return;
      }
      const remote = data.data || {};
      const localAt  = Number(local && local.updatedAt) || 0;
      const remoteAt = Number(remote.updatedAt) || 0;

      if(remoteAt > localAt){
        bridge.adopt(remote);
        setPhase('synced');
      } else if(localAt > remoteAt || force){
        await push(local, true);
      } else {
        setPhase('synced');
      }
    }catch(e){
      setPhase('error', e.message);
    }
  }
  function pullIfStale(){
    if(userId && Date.now() - lastPullAt > STALE_AFTER) pull(false);
  }

  /* ---------- push ---------- */
  function queuePush(snapshot){
    if(!client || !userId) return;
    pendingSnapshot = snapshot;
    setPhase('pending');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(()=>{ push(pendingSnapshot, false); }, PUSH_DEBOUNCE);
  }

  async function push(snapshot, immediate){
    if(!client || !userId || !snapshot) return;
    if(inFlight && !immediate){ queuePush(snapshot); return; }
    clearTimeout(pushTimer);
    inFlight = true;
    /* currentUser is a local session detail — the row is already keyed by user_id. */
    const payload = Object.assign({}, snapshot, {currentUser: null});
    try{
      const {error} = await client.from(TABLE).upsert({
        user_id: userId,
        data: payload,
        device_id: deviceId,
        updated_at: new Date().toISOString()
      }, {onConflict: 'user_id'});
      if(error) setPhase('error', error.message);
      else { pendingSnapshot = null; setPhase('synced'); }
    }catch(e){
      setPhase(navigator.onLine ? 'error' : 'offline', e.message);
    }finally{
      inFlight = false;
    }
  }

  async function flush(){
    clearTimeout(pushTimer);
    if(pendingSnapshot) await push(pendingSnapshot, true);
  }

  /* Fire-and-forget write for pagehide, where a normal await never resolves.
     fetch(keepalive) is used over sendBeacon because we need auth headers. */
  function flushBeacon(){
    if(!client || !userId || !pendingSnapshot || !cfg) return;
    const token = (client.auth.__fyt_token) || null;
    if(!token) return;
    const body = JSON.stringify({
      user_id: userId,
      data: Object.assign({}, pendingSnapshot, {currentUser:null}),
      device_id: deviceId,
      updated_at: new Date().toISOString()
    });
    try{
      fetch(cfg.url + '/rest/v1/' + TABLE + '?on_conflict=user_id', {
        method: 'POST', keepalive: true, body,
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.key,
          'Authorization': 'Bearer ' + token,
          'Prefer': 'resolution=merge-duplicates'
        }
      });
      pendingSnapshot = null;
    }catch(e){ /* the tab is going away; nothing useful to do */ }
  }

  /* ---------- realtime ---------- */
  function subscribe(){
    if(!client || !userId) return;
    unsubscribe();
    channel = client
      .channel('user_state:' + userId)
      .on('postgres_changes',
        {event: '*', schema: 'public', table: TABLE, filter: 'user_id=eq.' + userId},
        payload=>{
          const row = payload.new;
          if(!row || row.device_id === deviceId) return;      /* our own echo */
          const remote = row.data || {};
          const local = bridge.getState();
          const localAt = Number(local && local.updatedAt) || 0;
          if((Number(remote.updatedAt) || 0) > localAt){
            bridge.adopt(remote);
            setPhase('synced');
            bridge.notify('Đã cập nhật từ thiết bị khác');
          }
        })
      .subscribe(st=>{
        if(st === 'SUBSCRIBED') setPhase('synced');
        else if(st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setPhase('error', 'Realtime: ' + st);
      });
  }
  function unsubscribe(){
    if(channel){ try{ client.removeChannel(channel); }catch(e){} channel = null; }
  }

  /* ---------- lifecycle ---------- */
  async function start(uid){
    userId = uid;
    /* Cache the access token so flushBeacon can build a raw REST call. */
    const s = await getSession();
    if(s) client.auth.__fyt_token = s.access_token;
    client.auth.onAuthStateChange((_e, sess)=>{ if(sess) client.auth.__fyt_token = sess.access_token; });
    await pull(false);
    subscribe();
  }
  function stop(){
    clearTimeout(pushTimer);
    unsubscribe();
    userId = null; pendingSnapshot = null;
    setPhase('offline');
  }

  global.addEventListener('online',  ()=>{ if(userId){ setPhase('pending'); flush().then(()=>pull(false)); } });
  global.addEventListener('offline', ()=>setPhase('offline'));

  global.Sync = {
    bind, init, saveLocalConfig,
    signIn, signUp, signOut, resetPassword, updatePassword, getSession, onAuthChange,
    start, stop, pull, pullIfStale, queuePush, flush, flushBeacon, status,
    get client(){ return client; },
    get deviceId(){ return deviceId; }
  };
})(window);
