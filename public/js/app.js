/* ============================================================
   FINYOURTIN — Personal finance app (cloud edition)

   Storage model: the whole app is one `state` object. Every mutation calls
   saveStorage(), which writes to localStorage first (instant, offline-safe)
   and then debounce-pushes the same snapshot to Supabase. Realtime pulls
   changes made on other devices back in. See js/sync.js.

   Auth is Supabase Auth only — there is no local account store.
   ============================================================ */

/* ---------- CURRENCIES ---------- */
const CURRENCIES = {
  VND:{name:'Việt Nam Đồng', symbol:'đ', decimals:0, suffix:true},
  USD:{name:'US Dollar', symbol:'$', decimals:2, suffix:false},
  EUR:{name:'Euro', symbol:'€', decimals:2, suffix:false},
  JPY:{name:'Japanese Yen', symbol:'¥', decimals:0, suffix:false},
  GBP:{name:'British Pound', symbol:'£', decimals:2, suffix:false},
  AUD:{name:'Australian Dollar', symbol:'A$', decimals:2, suffix:false},
  SGD:{name:'Singapore Dollar', symbol:'S$', decimals:2, suffix:false},
  KRW:{name:'Korean Won', symbol:'₩', decimals:0, suffix:false},
  CNY:{name:'Chinese Yuan', symbol:'CN¥', decimals:2, suffix:false},
  THB:{name:'Thai Baht', symbol:'฿', decimals:2, suffix:false}
};
/* Rates are expressed in VND per 1 unit of the currency (VND is the internal base). */
const DEFAULT_RATES = {VND:1, USD:25400, EUR:27600, JPY:170, GBP:32300, AUD:16800, SGD:18900, KRW:19, CNY:3500, THB:730};

/* ---------- DEFAULT CATEGORY TREE ---------- */
const CATEGORY_COLORS = ['#FB923C','#38BDF8','#FBBF24','#F472B6','#4ADE80','#818CF8','#C084FC','#FB7185','#2DD4BF','#94A3B8','#34D399','#60A5FA','#F87171','#A3E635','#22D3EE','#E879F9'];
const EMOJI_POOL = ['🍔','🍜','☕','🛒','🚗','⛽','🚕','🏠','💡','💧','📶','📱','🛍️','👕','💄','🏥','💊','📚','🎓','🎬','🎮','✈️','🏖️','🎁','👨‍👩‍👧','🐶','🐷','💰','💵','💳','🏦','📈','💹','🏪','🔧','⚙️','💼','👤','💇','🎯','🙏','⭐','🔁','🤝','🧾','🍺','🎂','🏋️','🚌','🛵'];

const DEFAULT_CATEGORIES = {
  expense: [
    {id:'c_food', name:'Ăn uống', icon:'🍔', color:'#FB923C', subs:[{id:'s_breakfast',name:'Ăn sáng'},{id:'s_lunch',name:'Ăn trưa'},{id:'s_dinner',name:'Ăn tối'},{id:'s_coffee',name:'Cà phê/Nước'},{id:'s_restaurant',name:'Nhà hàng'}]},
    {id:'c_transport', name:'Di chuyển', icon:'🚗', color:'#38BDF8', subs:[{id:'s_gas',name:'Xăng xe'},{id:'s_grab',name:'Grab/Taxi'},{id:'s_park',name:'Gửi xe'},{id:'s_repair',name:'Sửa xe'},{id:'s_bus',name:'Vé xe buýt'}]},
    {id:'c_bill', name:'Hóa đơn', icon:'💡', color:'#FBBF24', subs:[{id:'s_electric',name:'Điện'},{id:'s_water',name:'Nước'},{id:'s_internet',name:'Internet'},{id:'s_phone',name:'Điện thoại'},{id:'s_rent',name:'Thuê nhà'}]},
    {id:'c_shopping', name:'Mua sắm', icon:'🛍️', color:'#F472B6', subs:[{id:'s_clothes',name:'Quần áo'},{id:'s_electronics',name:'Đồ điện tử'},{id:'s_cosmetics',name:'Mỹ phẩm'},{id:'s_household',name:'Đồ gia dụng'}]},
    {id:'c_health', name:'Sức khỏe', icon:'🏥', color:'#4ADE80', subs:[{id:'s_doctor',name:'Khám bệnh'},{id:'s_medicine',name:'Thuốc'},{id:'s_insurance',name:'Bảo hiểm'},{id:'s_gym',name:'Gym'}]},
    {id:'c_edu', name:'Giáo dục', icon:'📚', color:'#818CF8', subs:[{id:'s_tuition',name:'Học phí'},{id:'s_books',name:'Sách vở'},{id:'s_course',name:'Khóa học'}]},
    {id:'c_fun', name:'Giải trí', icon:'🎬', color:'#C084FC', subs:[{id:'s_movie',name:'Xem phim'},{id:'s_travel',name:'Du lịch'},{id:'s_game',name:'Game'},{id:'s_hobby',name:'Sở thích'}]},
    {id:'c_family', name:'Gia đình', icon:'👨‍👩‍👧', color:'#FB7185', subs:[{id:'s_kids',name:'Con cái'},{id:'s_parents',name:'Cha mẹ'},{id:'s_events',name:'Hiếu hỉ'}]},
    {id:'c_biz', name:'Kinh doanh', icon:'🏪', color:'#2DD4BF', subs:[{id:'s_stock',name:'Nhập hàng'},{id:'s_staff',name:'Nhân viên'},{id:'s_place',name:'Mặt bằng'},{id:'s_marketing',name:'Marketing'}]},
    {id:'c_debt', name:'Vay & Nợ', icon:'🤝', color:'#F87171', system:true, subs:[{id:'s_lend',name:'Cho vay'},{id:'s_repay',name:'Trả nợ'},{id:'s_interest_pay',name:'Trả lãi'}]},
    {id:'c_other_exp', name:'Khác', icon:'📦', color:'#94A3B8', subs:[{id:'s_other_exp',name:'Chi khác'}]}
  ],
  income: [
    {id:'c_salary', name:'Lương', icon:'💰', color:'#34D399', subs:[{id:'s_mainsalary',name:'Lương chính'},{id:'s_bonus',name:'Thưởng'},{id:'s_allowance',name:'Phụ cấp'}]},
    {id:'c_bizinc', name:'Kinh doanh', icon:'📈', color:'#2DD4BF', subs:[{id:'s_sale',name:'Bán hàng'},{id:'s_service',name:'Dịch vụ'}]},
    {id:'c_invest', name:'Đầu tư', icon:'💹', color:'#60A5FA', subs:[{id:'s_dividend',name:'Cổ tức'},{id:'s_interest',name:'Lãi ngân hàng'},{id:'s_lease',name:'Cho thuê'}]},
    {id:'c_debt_in', name:'Vay & Thu nợ', icon:'🤝', color:'#818CF8', system:true, subs:[{id:'s_borrow',name:'Đi vay'},{id:'s_collect',name:'Thu nợ'}]},
    {id:'c_other_inc', name:'Khác', icon:'🎁', color:'#FBBF24', subs:[{id:'s_gift',name:'Được tặng'},{id:'s_other_inc',name:'Thu khác'}]}
  ]
};

const WALLET_TYPE_META = {
  cash:{label:'Tiền mặt', icon:'👛', color:'#22C55E'},
  bank:{label:'Ngân hàng', icon:'🏦', color:'#3B82F6'},
  credit_card:{label:'Thẻ tín dụng', icon:'💳', color:'#64748B'},
  savings:{label:'Sổ tiết kiệm', icon:'🐷', color:'#F59E0B'}
};
const WALLET_PRESETS = ["Tiền mặt","Ngân hàng","Ví điện tử","Tiết kiệm"];
const FREQ_LABEL = {daily:'ngày', weekly:'tuần', monthly:'tháng', yearly:'năm'};

/* ============================================================
   STATE
   ============================================================ */
let state = {
  version: 4,
  currentUser: null,
  users: [
    {username:"chi.a", password:"123456"},
    {username:"chi.b", password:"123456"},
    {username:"chi.c", password:"123456"}
  ],
  app: {theme:'light', pinEnabled:false, pinHash:null, privacy:false, mainCurrency:'VND', rates:{...DEFAULT_RATES}},
  wallets: [], transactions: [], budgets: [], recurring: [], debts: [], events: [],
  categories: {},          /* username -> {expense:[], income:[]} */
  onboardingStatus: {}
};

/* transient UI state */
let currentTab = 'dashboard';
let currentTxType = 'expense';
let editingTxId = null;
let txSelectedWalletId = null, txSelectedCatId = null, txSelectedSubId = null, txAmount = 0, tfAmount = 0;
let obSelectedWallets = [...WALLET_PRESETS], obBalances = {};
let mwSelectedIcon = '👛', mwSelectedType = 'cash';
let txFilters = {type:'all', walletId:'all', catId:'all', eventId:'all', range:'all'};
let reportPeriodType = 'month', reportOffset = 0, donutMode = 'expense', reportWalletId = 'all';
let upcomingFilter = 'thismonth';
let mrSelectedCatId = null, mrSelectedSubId = null, mrSelectedFreq = 'monthly', mrType = 'expense';
let mbPeriod = 'monthly';
let budgetPeriodView = 'monthly';
let mcpSelectedCardId = null, mcpPayMode = 'full';
let mcType = 'expense', mcIcon = '⭐', mcColor = CATEGORY_COLORS[0], mcSubs = [];
let catManageType = 'expense';
let mdKind = 'borrow', mdpDebtId = null, mdpMode = 'full';
let meIcon = '✈️';
let debtFilter = 'all';
let authMode = 'login';
let pinBuffer = '', pinStage = 'verify', pinFirstEntry = '';

/* ============================================================
   STORAGE
   ============================================================ */
const STORAGE_KEY = 'FINYOURTIN_STATE_V4';        /* pre-cloud key, kept only for adoption */
const LEGACY_KEY  = 'SOTHUCHI_STATE_V3';          /* v3 key, kept only for adoption */
const THEME_KEY   = 'FINYOURTIN_THEME';           /* device-level, readable before sign-in */

/* Each cloud account gets its own localStorage slot so two people sharing a
   browser never overwrite each other's cache. */
let storageNamespace = null;
function setStorageNamespace(uid){ storageNamespace = uid || null; }
function currentStorageKey(){ return storageNamespace ? STORAGE_KEY + '::' + storageNamespace : STORAGE_KEY; }

function emptyState(){
  return {
    version: 4, currentUser: null,
    app: {theme:'light', pinEnabled:false, pinHash:null, privacy:false, mainCurrency:'VND', rates:{...DEFAULT_RATES}},
    wallets: [], transactions: [], budgets: [], recurring: [], debts: [], events: [],
    categories: {}, onboardingStatus: {}, updatedAt: 0
  };
}

function loadStorage(){
  const saved = localStorage.getItem(currentStorageKey());
  if(saved){
    try{ state = JSON.parse(saved); }
    catch(e){ console.error('Corrupt state', e); state = emptyState(); }
  } else {
    state = emptyState();
  }
  migrateState();
}

/* Single write path for the entire app. Local first so the UI never waits on
   the network; the cloud push is debounced inside Sync and is a no-op when
   signed out or offline. */
function saveStorage(){
  state.updatedAt = Date.now();
  /* Signed out there is no account to write against; the theme mirror in
     applyTheme() is the only thing worth keeping from that screen. */
  if(!storageNamespace) return;
  try{ localStorage.setItem(currentStorageKey(), JSON.stringify(state)); }
  catch(e){ toast('Không lưu được dữ liệu (bộ nhớ đầy?)','err'); }
  if(window.Sync) Sync.queuePush(state);
}

/* Adopt a state snapshot that arrived from the cloud. Skips the push-back so a
   pull can never bounce straight into a write loop. */
function adoptRemoteState(remote){
  const uid = state.currentUser;
  state = remote;
  state.currentUser = uid;
  migrateState();
  try{ localStorage.setItem(currentStorageKey(), JSON.stringify(state)); }catch(e){}
  ensureUserCategories(uid);
  applyTheme();
  if(currentTab) switchTab(currentTab);
}

/* Fill in anything a newer version of the app introduced so an old saved state
   never silently loses features. Runs on every load — cheap and idempotent. */
function migrateState(){
  if(!Array.isArray(state.wallets)) state.wallets = [];
  if(!Array.isArray(state.transactions)) state.transactions = [];
  if(!Array.isArray(state.budgets)) state.budgets = [];
  if(!Array.isArray(state.recurring)) state.recurring = [];
  if(!Array.isArray(state.debts)) state.debts = [];
  if(!Array.isArray(state.events)) state.events = [];
  if(!state.categories || Array.isArray(state.categories)) state.categories = {};
  if(!state.onboardingStatus) state.onboardingStatus = {};
  if(typeof state.updatedAt !== 'number') state.updatedAt = 0;
  delete state.users;                       /* local accounts are gone — Supabase Auth owns identity */
  state.app = Object.assign({theme:'light', pinEnabled:false, pinHash:null, privacy:false, mainCurrency:'VND', rates:{...DEFAULT_RATES}}, state.app||{});
  state.app.rates = Object.assign({...DEFAULT_RATES}, state.app.rates||{});
  state.wallets.forEach(w=>{
    if(!w.type) w.type = 'cash';
    if(!w.currency) w.currency = 'VND';
    if(typeof w.startingBalance !== 'number') w.startingBalance = Number(w.startingBalance)||0;
  });
  state.transactions.forEach(t=>{ if(typeof t.amount !== 'number') t.amount = Number(t.amount)||0; });
  state.budgets.forEach(b=>{
    if(!b.period){ b.period = 'monthly'; b.periodKey = b.month || currentPeriodKey('monthly'); }
    if(!b.categoryId) b.categoryId = '__all__';
    if(!b.walletId) b.walletId = 'all';
  });
  state.recurring.forEach(r=>{
    if(!r.type) r.type = 'expense';
    if(!r.interval) r.interval = 1;
  });
  state.version = 4;
}

/* ------------------------------------------------------------------
   Adopting pre-cloud data

   Before Supabase there was one browser-local store keyed by username. On
   first cloud sign-in we look for those leftovers and offer to pull one of
   the old profiles into the signed-in account, remapping every userId.
   ------------------------------------------------------------------ */

/* v3 -> v4 shape, as a plain value (no global mutation). */
function normalizeLegacyArchive(old){
  const out = emptyState();
  out.wallets = (old.wallets||[]).map(w=>({
    id:w.id, userId:w.userId, name:w.name, icon:w.icon||'👛',
    type: w.type==='credit_card' ? 'credit_card' : 'cash',
    currency:'VND', startingBalance:Number(w.startingBalance)||0,
    creditLimit:w.creditLimit, statementDate:w.statementDate, paymentDueDate:w.paymentDueDate
  }));
  out.transactions = (old.transactions||[]).map(t=>({...t, amount:Number(t.amount)||0}));
  out.budgets = (old.budgets||[]).map(b=>({
    id:b.id, userId:b.userId, categoryId:b.categoryId, period:'monthly',
    periodKey:b.month, limit:Number(b.limit)||0, walletId:'all'
  }));
  out.recurring = (old.recurringTransactions||[]).map(r=>({...r, type:'expense', interval:1}));
  out.onboardingStatus = old.onboardingStatus || {};
  /* custom categories were global in v3 — attach them to every profile found */
  const cc = old.customCategories || {expense:[],income:[]};
  const names = new Set((old.users||[]).map(u=>u.username));
  out.wallets.forEach(w=>names.add(w.userId));
  names.forEach(n=>{
    out.categories[n] = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    ['expense','income'].forEach(k=>{
      (cc[k]||[]).forEach(c=>{
        if(!out.categories[n][k].some(x=>x.id===c.id)) out.categories[n][k].push({...c, subs:c.subs||[]});
      });
    });
  });
  return out;
}

const ROW_KEYS = ['wallets','transactions','budgets','recurring','debts','events'];

/* Every old profile still sitting in this browser, with a row count so the
   user can tell which one is theirs. */
function scanLocalArchives(){
  const found = [];
  const consider = (raw, kind)=>{
    if(!raw) return;
    let data; try{ data = JSON.parse(raw); }catch(e){ return; }
    const snap = kind==='v3' ? normalizeLegacyArchive(data) : data;
    const names = new Set();
    ROW_KEYS.forEach(k=>(snap[k]||[]).forEach(r=>{ if(r && r.userId) names.add(r.userId); }));
    names.forEach(n=>{
      const rows = ROW_KEYS.reduce((sum,k)=>sum + (snap[k]||[]).filter(r=>r.userId===n).length, 0);
      if(rows > 0) found.push({kind, username:n, rows, snapshot:snap});
    });
  };
  consider(localStorage.getItem(STORAGE_KEY), 'v4');
  consider(localStorage.getItem(LEGACY_KEY),  'v3');
  return found.sort((a,b)=>b.rows-a.rows);
}

/* Copy one old profile into the signed-in account. Replaces current data. */
function adoptLocalArchive(archive){
  const me = state.currentUser;
  if(!me) return;
  const keepApp = {...state.app};
  const snap = archive.snapshot;
  ROW_KEYS.forEach(k=>{
    state[k] = (snap[k]||[]).filter(r=>r.userId===archive.username).map(r=>({...r, userId:me}));
  });
  const cats = (snap.categories||{})[archive.username];
  state.categories[me] = cats ? JSON.parse(JSON.stringify(cats)) : JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  state.onboardingStatus[me] = true;
  state.app = Object.assign(keepApp, {mainCurrency: (snap.app||{}).mainCurrency || keepApp.mainCurrency});
  ensureUserCategories(me);
  migrateState();
  saveStorage();
  toast(`Đã nhập ${archive.rows} bản ghi từ hồ sơ "${archive.username}"`, 'ok');
  document.getElementById('view-onboarding').classList.add('hidden');
  document.getElementById('main-nav').classList.remove('hidden');
  switchTab('dashboard');
}

/* Offered once, right after a brand-new account signs in on a browser that
   still holds pre-cloud data. */
function offerLocalArchiveImport(){
  const archives = scanLocalArchives();
  if(!archives.length) return false;
  const list = archives.map((a,i)=>
    `<div class="setting-row pointer" onclick="pickLocalArchive(${i})">
       <div class="sr-ic">📦</div>
       <div class="sr-mid"><div class="sr-title">${esc(a.username)}</div>
         <div class="sr-sub">${a.rows} bản ghi · bản ${a.kind}</div></div>
       <span class="muted">›</span>
     </div>`).join('');
  window.__localArchives = archives;
  uiSheet('Tìm thấy dữ liệu cũ trên máy này',
    `<p class="text-sm muted mb12">Chọn hồ sơ bạn muốn đưa vào tài khoản đám mây. Dữ liệu hiện tại của tài khoản sẽ được thay thế.</p>
     ${list}
     <button class="btn btn-ghost mt12" onclick="closeSheet()">Bỏ qua, bắt đầu trống</button>`);
  return true;
}
function pickLocalArchive(i){
  const a = (window.__localArchives||[])[i];
  closeSheet();
  if(a) adoptLocalArchive(a);
}

function ensureUserCategories(username){
  if(!state.categories[username]){
    state.categories[username] = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  } else {
    /* make sure system categories always exist (debt bookkeeping depends on them) */
    ['expense','income'].forEach(k=>{
      if(!Array.isArray(state.categories[username][k])) state.categories[username][k] = [];
      DEFAULT_CATEGORIES[k].filter(c=>c.system).forEach(sys=>{
        if(!state.categories[username][k].some(c=>c.id===sys.id)) state.categories[username][k].push(JSON.parse(JSON.stringify(sys)));
      });
    });
  }
}

/* Loads the bundled sample book into the signed-in account, remapping every
   demo row onto the real user id. Useful for kicking the tyres on a fresh
   account without hand-entering a month of transactions. */
function loadDemoData(){
  uiConfirm('Nạp dữ liệu mẫu','Toàn bộ dữ liệu hiện tại của tài khoản sẽ bị thay bằng bộ dữ liệu mẫu. Tiếp tục?','Nạp dữ liệu mẫu').then(ok=>{
    if(!ok) return;
    const me = state.currentUser, keepApp = {...state.app};
    const live = state;
    seedSampleData();                          /* builds the demo book into `state` */
    const demo = state;
    state = live;                              /* put the real state back before touching it */
    ROW_KEYS.forEach(k=>{
      state[k] = (demo[k]||[]).filter(r=>r.userId===DEMO_PROFILE).map(r=>({...r, userId:me}));
    });
    state.categories[me] = JSON.parse(JSON.stringify(demo.categories[DEMO_PROFILE]));
    state.onboardingStatus[me] = true;
    state.app = keepApp;
    migrateState();
    saveStorage();
    toast('Đã nạp dữ liệu mẫu','ok');
    switchTab('dashboard');
  });
}
function wipeMyData(){
  uiConfirm('Xóa toàn bộ dữ liệu','Mọi ví, giao dịch, ngân sách, sổ nợ của tài khoản này sẽ bị xóa vĩnh viễn, trên cả máy này lẫn trên đám mây. Không thể hoàn tác.').then(ok=>{
    if(!ok) return;
    const u = state.currentUser;
    ROW_KEYS.forEach(k=>{ state[k] = state[k].filter(x=>x.userId!==u); });
    state.categories[u] = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    state.onboardingStatus[u] = false;
    saveStorage();
    toast('Đã xóa dữ liệu','ok');
    obSelectedWallets = [...WALLET_PRESETS]; obBalances = {};
    document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
    document.getElementById('main-nav').classList.add('hidden');
    ['ob-step-2','ob-step-3'].forEach(id=>document.getElementById(id).classList.add('hidden'));
    document.getElementById('ob-step-1').classList.remove('hidden');
    startOnboarding();
  });
}

/* ============================================================
   SEED DATA
   ============================================================ */
/* The sample book is authored against these placeholder profile ids; loadDemoData()
   rewrites them onto the signed-in account. */
const DEMO_PROFILE  = 'chi.a';
const DEMO_PROFILES = ['chi.a','chi.b','chi.c'];

function seedSampleData(skipRows){
  state = emptyState();
  DEMO_PROFILES.forEach(u=>ensureUserCategories(u));
  if(skipRows) return;

  const Y = new Date().getFullYear(), M = new Date().getMonth();
  const d = (mOffset, day)=>{ const x = new Date(Y, M+mOffset, day); return isoOf(x); };

  state.wallets = [
    {id:"w_a1", userId:"chi.a", name:"Garage", icon:"🔧", type:"cash", currency:"VND", startingBalance:25000000},
    {id:"w_a2", userId:"chi.a", name:"Vietcombank", icon:"🏦", type:"bank", currency:"VND", startingBalance:18000000},
    {id:"w_a3", userId:"chi.a", name:"Tạp hóa", icon:"🏪", type:"cash", currency:"VND", startingBalance:10000000},
    {id:"w_a4", userId:"chi.a", name:"Cá nhân", icon:"👤", type:"cash", currency:"VND", startingBalance:8000000},
    {id:"w_a5", userId:"chi.a", name:"Thẻ VPBank", icon:"💳", type:"credit_card", currency:"VND", creditLimit:50000000, statementDate:5, paymentDueDate:25, startingBalance:-5200000},
    {id:"w_a6", userId:"chi.a", name:"Tiết kiệm 12T", icon:"🐷", type:"savings", currency:"VND", startingBalance:100000000, interestRate:5.6, maturityDate:d(6,1)},
    {id:"w_a7", userId:"chi.a", name:"USD Savings", icon:"💵", type:"savings", currency:"USD", startingBalance:1500},
    {id:"w_b1", userId:"chi.b", name:"Tạp hóa", icon:"🏪", type:"cash", currency:"VND", startingBalance:12000000},
    {id:"w_b2", userId:"chi.b", name:"Tiệm tóc", icon:"💇", type:"cash", currency:"VND", startingBalance:15000000},
    {id:"w_b3", userId:"chi.b", name:"Cá nhân", icon:"👤", type:"cash", currency:"VND", startingBalance:5000000}
  ];
  state.events = [
    {id:"e_1", userId:"chi.a", name:"Du lịch Đà Lạt", icon:"✈️", startDate:d(0,10), endDate:d(0,14), budget:12000000}
  ];
  state.transactions = [
    {id:"t1", userId:"chi.a", type:"income", amount:6200000, walletId:"w_a1", categoryId:"c_bizinc", subcategoryId:"s_service", note:"Sửa xe ô tô", date:d(-1,1)},
    {id:"t2", userId:"chi.a", type:"expense", amount:1800000, walletId:"w_a1", categoryId:"c_biz", subcategoryId:"s_stock", note:"Thay dầu nhớt", date:d(-1,2)},
    {id:"t3", userId:"chi.a", type:"income", amount:3900000, walletId:"w_a2", categoryId:"c_bizinc", subcategoryId:"s_sale", note:"Bán lốp xe", date:d(-1,3)},
    {id:"t4", userId:"chi.a", type:"expense", amount:1250000, walletId:"w_a3", categoryId:"c_biz", subcategoryId:"s_stock", note:"Nhập hàng tạp hóa", date:d(-1,4)},
    {id:"t5", userId:"chi.a", type:"expense", amount:420000, walletId:"w_a4", categoryId:"c_food", subcategoryId:"s_dinner", note:"Ăn tối gia đình", date:d(-1,5)},
    {id:"t6_out", userId:"chi.a", type:"transfer_out", amount:3000000, walletId:"w_a4", note:"Chuyển vào Garage", date:d(-1,9), transferId:"tr_1"},
    {id:"t6_in", userId:"chi.a", type:"transfer_in", amount:3000000, walletId:"w_a1", note:"Nhận từ Cá nhân", date:d(-1,9), transferId:"tr_1"},
    {id:"t7", userId:"chi.a", type:"expense", amount:250000, walletId:"w_a4", categoryId:"c_food", subcategoryId:"s_lunch", note:"Ăn trưa", date:d(0,3)},
    {id:"t8", userId:"chi.a", type:"expense", amount:180000, walletId:"w_a4", categoryId:"c_transport", subcategoryId:"s_gas", note:"Đổ xăng", date:d(0,4)},
    {id:"t9", userId:"chi.a", type:"expense", amount:650000, walletId:"w_a5", categoryId:"c_shopping", subcategoryId:"s_clothes", note:"Mua áo (quẹt thẻ)", date:d(0,5)},
    {id:"t10", userId:"chi.a", type:"income", amount:15000000, walletId:"w_a1", categoryId:"c_salary", subcategoryId:"s_mainsalary", note:"Thu garage tháng này", date:d(0,1)},
    {id:"t11", userId:"chi.a", type:"expense", amount:320000, walletId:"w_a4", categoryId:"c_fun", subcategoryId:"s_movie", note:"Xem phim cuối tuần", date:d(0,6)},
    {id:"t12", userId:"chi.a", type:"expense", amount:2400000, walletId:"w_a4", categoryId:"c_fun", subcategoryId:"s_travel", note:"Vé máy bay Đà Lạt", date:d(0,7), eventId:"e_1"},
    {id:"t13", userId:"chi.a", type:"expense", amount:1800000, walletId:"w_a5", categoryId:"c_fun", subcategoryId:"s_travel", note:"Khách sạn Đà Lạt", date:d(0,8), eventId:"e_1"},
    {id:"tb1", userId:"chi.b", type:"income", amount:1500000, walletId:"w_b2", categoryId:"c_bizinc", subcategoryId:"s_service", note:"Làm tóc khách quen", date:d(-1,10)},
    {id:"tb2", userId:"chi.b", type:"expense", amount:300000, walletId:"w_b3", categoryId:"c_fun", subcategoryId:"s_movie", note:"Xem phim", date:d(-1,12)},
    {id:"tb3", userId:"chi.b", type:"expense", amount:250000, walletId:"w_b3", categoryId:"c_food", subcategoryId:"s_coffee", note:"Cà phê bạn bè", date:d(0,4)}
  ];
  state.budgets = [
    {id:"b1", userId:"chi.a", categoryId:"c_food", period:"monthly", periodKey:currentPeriodKey('monthly'), limit:2000000, walletId:'all'},
    {id:"b2", userId:"chi.a", categoryId:"c_shopping", period:"monthly", periodKey:currentPeriodKey('monthly'), limit:1500000, walletId:'all'},
    {id:"b3", userId:"chi.a", categoryId:"c_transport", period:"monthly", periodKey:currentPeriodKey('monthly'), limit:800000, walletId:'all'},
    {id:"b4", userId:"chi.a", categoryId:"__all__", period:"monthly", periodKey:currentPeriodKey('monthly'), limit:20000000, walletId:'all'}
  ];
  state.recurring = [
    {id:"r1", userId:"chi.a", name:"Trả góp ngân hàng", type:"expense", amount:5000000, walletId:"w_a2", categoryId:"c_bill", subcategoryId:"s_rent", frequency:"monthly", interval:1, dueDate:d(0,15), autoProcess:false},
    {id:"r2", userId:"chi.a", name:"Tiền mạng", type:"expense", amount:300000, walletId:"w_a4", categoryId:"c_bill", subcategoryId:"s_internet", frequency:"monthly", interval:1, dueDate:d(0,20), autoProcess:false},
    {id:"r3", userId:"chi.a", name:"Tiền điện Garage", type:"expense", amount:1200000, walletId:"w_a1", categoryId:"c_bill", subcategoryId:"s_electric", frequency:"monthly", interval:1, dueDate:d(1,5), autoProcess:false},
    {id:"r4", userId:"chi.b", name:"Tiền nhà", type:"expense", amount:4000000, walletId:"w_b3", categoryId:"c_bill", subcategoryId:"s_rent", frequency:"monthly", interval:1, dueDate:d(0,18), autoProcess:false}
  ];
  state.debts = [
    {id:"d_1", userId:"chi.a", kind:"borrow", party:"Anh Nam", amount:20000000, walletId:"w_a1", date:d(-2,10), dueDate:d(0,28), note:"Vay mở rộng garage", payments:[{id:'p1', amount:5000000, date:d(-1,10), walletId:"w_a1"}]},
    {id:"d_2", userId:"chi.a", kind:"lend", party:"Chị Hoa", amount:3000000, walletId:"w_a4", date:d(-1,15), dueDate:d(1,15), note:"Cho mượn tiền gấp", payments:[]}
  ];
  state.onboardingStatus = {"chi.a":true, "chi.b":true};
}

/* ============================================================
   HELPERS — dates
   ============================================================ */
function isoOf(dt){
  const t = new Date(dt);
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
}
function todayISO(){ return isoOf(new Date()); }
function parseISO(s){ return new Date(s+'T00:00:00'); }
function monthKey(dateStr){ return (dateStr||'').slice(0,7); }
function yearKey(dateStr){ return (dateStr||'').slice(0,4); }
function quarterKeyOf(dateStr){
  const [y,m] = dateStr.split('-'); return `${y}-Q${Math.floor((Number(m)-1)/3)+1}`;
}
function isoWeekKey(dateStr){
  const d = parseISO(dateStr);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(),0,1));
  const week = Math.ceil((((t - yearStart)/86400000) + 1)/7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}
function periodKeyOf(dateStr, period){
  if(period==='weekly') return isoWeekKey(dateStr);
  if(period==='yearly') return yearKey(dateStr);
  return monthKey(dateStr);
}
function currentPeriodKey(period){ return periodKeyOf(todayISO(), period); }
function periodLabel(key, period){
  if(period==='weekly'){ const [y,w] = key.split('-W'); return `Tuần ${Number(w)}/${y}`; }
  if(period==='yearly') return `Năm ${key}`;
  const [y,m] = key.split('-'); return `Tháng ${Number(m)}/${y}`;
}
function addDaysISO(dateStr, days){ const d = parseISO(dateStr); d.setDate(d.getDate()+days); return isoOf(d); }
function addMonthsISO(dateStr, months){
  const d = parseISO(dateStr); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth()+months);
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoOf(d);
}
function addYearsISO(dateStr, years){ return addMonthsISO(dateStr, years*12); }
function fmtDate(dateStr){ return dateStr ? dateStr.split('-').reverse().join('/') : '-'; }
function daysBetween(a, b){ return Math.round((parseISO(b)-parseISO(a))/86400000); }
function relDueLabel(dueDate){
  const diff = daysBetween(todayISO(), dueDate);
  if(diff < 0) return {text:`Quá hạn ${Math.abs(diff)} ngày`, overdue:true};
  if(diff === 0) return {text:'Đến hạn hôm nay', overdue:true};
  if(diff === 1) return {text:'Đến hạn ngày mai', overdue:false};
  if(diff <= 7) return {text:`Còn ${diff} ngày`, overdue:false};
  return {text:'Đến hạn '+fmtDate(dueDate), overdue:false};
}

/* ============================================================
   HELPERS — money & currency
   ============================================================ */
function mainCurrency(){ return state.app.mainCurrency || 'VND'; }
function rateOf(cur){ return Number(state.app.rates[cur]) || 1; }
function toMain(amount, cur){ return (Number(amount)||0) * rateOf(cur||'VND') / rateOf(mainCurrency()); }
function fromMain(amount, cur){ return (Number(amount)||0) * rateOf(mainCurrency()) / rateOf(cur||'VND'); }

function fmtCur(n, cur){
  cur = cur || mainCurrency();
  const meta = CURRENCIES[cur] || {symbol:cur, decimals:0, suffix:true};
  if(state.app.privacy) return meta.suffix ? '••••• '+meta.symbol : meta.symbol+'•••••';
  const neg = n < 0;
  const v = Math.abs(Number(n)||0);
  const txt = new Intl.NumberFormat('vi-VN',{minimumFractionDigits:meta.decimals, maximumFractionDigits:meta.decimals}).format(v);
  const body = meta.suffix ? txt+' '+meta.symbol : meta.symbol+txt;
  return (neg?'-':'')+body;
}
/* fmt() = format a value already expressed in the main currency */
function fmt(n){ return fmtCur(n, mainCurrency()); }
/* fmtW() = format a raw wallet-currency value with that wallet's symbol */
function fmtW(n, wallet){ return fmtCur(n, wallet ? wallet.currency : mainCurrency()); }
function parseAmount(str){
  if(typeof str === 'number') return str;
  const cleaned = String(str||'').replace(/[^\d.,-]/g,'').replace(/\.(?=\d{3}\b)/g,'').replace(/,/g,'.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? 0 : v;
}
function togglePrivacy(){
  state.app.privacy = !state.app.privacy;
  saveStorage();
  document.getElementById('privacy-btn').textContent = state.app.privacy ? 'Hiện' : 'Ẩn';
  renderAll();
}

/* ============================================================
   HELPERS — data access
   ============================================================ */
function getCats(type){
  ensureUserCategories(state.currentUser);
  return state.categories[state.currentUser][type] || [];
}
function findCategory(type, catId){ return getCats(type).find(c=>c.id===catId); }
function findAnyCategory(catId){ return findCategory('expense',catId) || findCategory('income',catId); }
function findSub(type, catId, subId){
  const c = findCategory(type, catId);
  return c ? (c.subs||[]).find(s=>s.id===subId) : null;
}
function catOf(t){
  const type = t.type==='income' ? 'income' : 'expense';
  return findCategory(type, t.categoryId) || {id:t.categoryId, name:'Khác', icon:'📦', color:'#94A3B8', subs:[]};
}
function getUserWallets(){ return state.wallets.filter(w=>w.userId===state.currentUser); }
function getWallet(id){ return state.wallets.find(w=>w.id===id); }
function getUserTransactions(){ return state.transactions.filter(t=>t.userId===state.currentUser); }
function getUserEvents(){ return state.events.filter(e=>e.userId===state.currentUser); }
function getUserDebts(){ return state.debts.filter(d=>d.userId===state.currentUser); }
function getUserRecurring(){ return state.recurring.filter(r=>r.userId===state.currentUser); }
function getUserBudgets(period){ return state.budgets.filter(b=>b.userId===state.currentUser && (!period || b.period===period)); }

function getWalletBalance(walletId){
  const w = getWallet(walletId);
  if(!w) return 0;
  let bal = w.startingBalance || 0;
  for(const t of state.transactions){
    if(t.walletId !== walletId) continue;
    if(t.type==='income' || t.type==='transfer_in') bal += t.amount;
    else if(t.type==='expense' || t.type==='transfer_out') bal -= t.amount;
  }
  return bal;
}
/* Wallet balance converted into the user's main currency */
function getWalletBalanceMain(walletId){
  const w = getWallet(walletId);
  return w ? toMain(getWalletBalance(walletId), w.currency) : 0;
}
function getUserTotalAssets(){
  return getUserWallets().filter(w=>!w.excludeFromTotal).reduce((s,w)=>s+getWalletBalanceMain(w.id),0);
}
/* Amount of a transaction, expressed in the main currency */
function txMain(t){
  const w = getWallet(t.walletId);
  return toMain(t.amount, w ? w.currency : 'VND');
}

/* --- Credit card helpers ---
   Card debt rides the same ledger as any wallet: startingBalance holds existing debt as a
   NEGATIVE number and each card expense subtracts further, so used/available limits can
   never drift out of sync with the transaction history. */
function isCreditCard(w){ return !!w && w.type==='credit_card'; }
function getCardUsedAmount(w){ return Math.max(0, -getWalletBalance(w.id)); }
function getCardAvailableLimit(w){ return Math.max(0, (w.creditLimit||0) - getCardUsedAmount(w)); }
function getCardUsagePct(w){ const l = w.creditLimit||0; return l ? Math.min(100, Math.round(getCardUsedAmount(w)/l*100)) : 0; }
function getCardNextDueDate(w){
  const day = Math.min(Math.max(Number(w.paymentDueDate)||1,1),28);
  const today = new Date(); today.setHours(0,0,0,0);
  let due = new Date(today.getFullYear(), today.getMonth(), day);
  if(due < today) due.setMonth(due.getMonth()+1);
  return isoOf(due);
}
function walletMeta(w){ return WALLET_TYPE_META[w.type] || WALLET_TYPE_META.cash; }

function uid(prefix){ return prefix+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ============================================================
   UI PRIMITIVES — modal, toast, confirm
   ============================================================ */
function openModal(id){ document.getElementById(id).classList.remove('hidden'); }
function closeModal(id){ document.getElementById(id).classList.add('hidden'); }
function toast(msg, type){
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast ' + (type||'');
  el.innerHTML = (type==='ok'?'<span>✓</span>':type==='err'?'<span>⚠</span>':'') + '<span>'+esc(msg)+'</span>';
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(()=>el.remove(),300); }, 2200);
}
function uiConfirm(title, msg, okText){
  return new Promise(resolve=>{
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    const yes = document.getElementById('confirm-yes'), no = document.getElementById('confirm-no');
    yes.textContent = okText || 'Đồng ý';
    const done = v =>{ closeModal('modal-confirm'); yes.onclick=null; no.onclick=null; resolve(v); };
    yes.onclick = ()=>done(true); no.onclick = ()=>done(false);
    openModal('modal-confirm');
  });
}
/* Generic bottom sheet for one-off content that doesn't warrant its own
   markup block (archive picker, cloud status, ...). */
function uiSheet(title, bodyHtml){
  document.getElementById('sheet-title').textContent = title;
  document.getElementById('sheet-body').innerHTML = bodyHtml;
  openModal('modal-sheet');
}
function closeSheet(){ closeModal('modal-sheet'); }

function buildEmojiPicker(containerId, selected, onPick){
  const el = document.getElementById(containerId);
  el.innerHTML = EMOJI_POOL.map(e=>`<div class="emoji-opt ${e===selected?'active':''}" data-e="${e}">${e}</div>`).join('');
  el.querySelectorAll('.emoji-opt').forEach(o=>{
    o.onclick = ()=>{
      el.querySelectorAll('.emoji-opt').forEach(x=>x.classList.remove('active'));
      o.classList.add('active');
      onPick(o.dataset.e);
    };
  });
}
function buildColorPicker(containerId, selected, onPick){
  const el = document.getElementById(containerId);
  el.innerHTML = CATEGORY_COLORS.map(c=>`<div class="swatch ${c===selected?'active':''}" data-c="${c}" style="background:${c};"></div>`).join('');
  el.querySelectorAll('.swatch').forEach(o=>{
    o.onclick = ()=>{
      el.querySelectorAll('.swatch').forEach(x=>x.classList.remove('active'));
      o.classList.add('active');
      onPick(o.dataset.c);
    };
  });
}

/* ============================================================
   THEME
   ============================================================ */
function applyTheme(){
  const t = state.app.theme || 'light';
  /* Mirrored outside the per-account state so the sign-in screen can paint in
     the right theme before we know who is signing in. */
  try{ localStorage.setItem(THEME_KEY, t); }catch(e){}
  const dark = t==='dark' || (t==='auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark?'dark':'light');
  document.getElementById('meta-theme-color').setAttribute('content', dark?'#0B1120':'#0D9488');
  const btn = document.getElementById('btn-theme');
  if(btn) btn.textContent = dark ? '☀️' : '🌙';
  document.querySelectorAll('#theme-seg .seg').forEach((s,i)=>s.classList.toggle('active', ['light','dark','auto'][i]===t));
}
function setTheme(t, el){
  state.app.theme = t; saveStorage(); applyTheme();
  if(el){ el.parentNode.querySelectorAll('.seg').forEach(s=>s.classList.remove('active')); el.classList.add('active'); }
  if(currentTab==='reports') renderReportsView();
}
function toggleTheme(){
  const dark = document.documentElement.getAttribute('data-theme')==='dark';
  setTheme(dark?'light':'dark');
}
/* Older Safari exposes addListener instead of addEventListener — guard so a missing API
   can never abort the rest of the script. */
(function watchColorScheme(){
  try{
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if(!mq) return;
    const onChange = ()=>{ if(state.app.theme==='auto') applyTheme(); };
    if(mq.addEventListener) mq.addEventListener('change', onChange);
    else if(mq.addListener) mq.addListener(onChange);
  }catch(e){ /* colour-scheme watching is optional */ }
})();

/* ============================================================
   PIN LOCK
   ============================================================ */
async function hashPin(pin){
  const data = new TextEncoder().encode('finyourtin::'+pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function renderPinDots(){
  document.getElementById('pin-dots').innerHTML =
    [0,1,2,3].map(i=>`<div class="pin-dot ${i<pinBuffer.length?'filled':''}"></div>`).join('');
}
function buildKeypad(){
  const keys = ['1','2','3','4','5','6','7','8','9','C','0','⌫'];
  document.getElementById('keypad').innerHTML = keys.map(k=>
    `<button class="key ${(k==='C'||k==='⌫')?'fn':''}" onclick="pinPress('${k}')">${k}</button>`).join('');
}
function pinPress(k){
  if(k==='C'){ pinBuffer=''; }
  else if(k==='⌫'){ pinBuffer = pinBuffer.slice(0,-1); }
  else if(pinBuffer.length < 4){ pinBuffer += k; }
  renderPinDots();
  if(pinBuffer.length===4) setTimeout(submitPin, 120);
}
async function submitPin(){
  const errEl = document.getElementById('pin-error');
  const hash = await hashPin(pinBuffer);
  if(pinStage==='verify'){
    if(hash === state.app.pinHash){
      pinBuffer=''; document.getElementById('lock-screen').classList.add('hidden'); bootAfterUnlock();
    } else { failPin('Mã PIN không đúng'); }
  } else if(pinStage==='set1'){
    pinFirstEntry = pinBuffer; pinBuffer=''; pinStage='set2';
    document.getElementById('lock-title').textContent = 'Nhập lại mã PIN';
    document.getElementById('lock-sub').textContent = 'Xác nhận mã vừa tạo';
    errEl.textContent=''; renderPinDots();
  } else if(pinStage==='set2'){
    if(pinBuffer === pinFirstEntry){
      state.app.pinHash = hash; state.app.pinEnabled = true; saveStorage();
      pinBuffer=''; document.getElementById('lock-screen').classList.add('hidden');
      toast('Đã bật khóa PIN','ok');
      if(currentTab==='settings') renderSettingsView();
      if(!state.currentUser) showLogin();
    } else { pinStage='set1'; pinFirstEntry=''; failPin('Hai mã PIN không khớp, thử lại'); document.getElementById('lock-title').textContent='Tạo mã PIN mới'; }
  }
}
function failPin(msg){
  const errEl = document.getElementById('pin-error');
  errEl.textContent = msg;
  const dots = document.getElementById('pin-dots');
  dots.classList.add('shake');
  setTimeout(()=>dots.classList.remove('shake'), 360);
  pinBuffer=''; renderPinDots();
}
function showLockScreen(mode){
  pinStage = mode; pinBuffer=''; pinFirstEntry='';
  document.getElementById('lock-title').textContent = mode==='verify' ? 'Nhập mã PIN' : 'Tạo mã PIN mới';
  document.getElementById('lock-sub').textContent   = mode==='verify' ? 'Mở khóa Finyourtin' : 'Chọn 4 chữ số dễ nhớ';
  document.getElementById('pin-error').textContent = '';
  document.getElementById('lock-alt-btn').textContent = mode==='verify' ? 'Quên mã PIN?' : 'Hủy';
  buildKeypad(); renderPinDots();
  document.getElementById('lock-screen').classList.remove('hidden');
}
function lockAltAction(){
  if(pinStage === 'verify'){ forgotPin(); return; }
  /* cancelling a PIN setup — leave everything as it was */
  document.getElementById('lock-screen').classList.add('hidden');
  pinBuffer=''; pinFirstEntry='';
  if(!state.currentUser && !state.app.pinEnabled) bootAfterUnlock();
  if(currentTab==='settings') renderSettingsView();
}
function startPinSetup(){ showLockScreen('set1'); }
function onPinToggle(checked){
  if(checked){ startPinSetup(); }
  else{
    state.app.pinEnabled = false; state.app.pinHash = null; saveStorage();
    toast('Đã tắt khóa PIN'); renderSettingsView();
  }
}
function forgotPin(){
  uiConfirm('Quên mã PIN?','Cách khôi phục duy nhất là tắt khóa PIN. Dữ liệu tài chính của bạn vẫn được giữ nguyên. Tiếp tục?','Tắt khóa PIN').then(ok=>{
    if(!ok) return;
    state.app.pinEnabled=false; state.app.pinHash=null; saveStorage();
    document.getElementById('lock-screen').classList.add('hidden');
    bootAfterUnlock();
    toast('Đã tắt khóa PIN');
  });
}

/* ============================================================
   AUTH
   ============================================================ */
let sessionEmail = null;              /* display name for the header */
let authBusy = false;

function setAuthMode(mode, el){
  authMode = mode;
  el.parentNode.querySelectorAll('.seg').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('auth-submit').textContent = mode==='login' ? 'Đăng nhập' : 'Tạo tài khoản';
  document.getElementById('auth-forgot').classList.toggle('hidden', mode!=='login');
  document.getElementById('auth-note').textContent = mode==='login'
    ? 'Dữ liệu được đồng bộ qua Supabase và lưu bản sao trên máy này để dùng offline.'
    : 'Mật khẩu tối thiểu 6 ký tự. Tuỳ cấu hình dự án, Supabase có thể gửi email xác nhận trước khi đăng nhập được.';
  document.getElementById('auth-error').textContent = '';
}

function setAuthBusy(busy, label){
  authBusy = busy;
  const btn = document.getElementById('auth-submit');
  btn.disabled = busy;
  btn.textContent = busy ? (label || 'Đang xử lý…') : (authMode==='login' ? 'Đăng nhập' : 'Tạo tài khoản');
}
function authError(msg){
  document.getElementById('auth-error').textContent = msg;
}

async function handleAuthSubmit(){
  if(authBusy) return;
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  authError('');
  if(!email || !pass) return authError('Nhập đủ email và mật khẩu.');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authError('Email không hợp lệ.');
  if(authMode==='register' && pass.length < 6) return authError('Mật khẩu tối thiểu 6 ký tự.');

  setAuthBusy(true, authMode==='login' ? 'Đang đăng nhập…' : 'Đang tạo tài khoản…');
  try{
    const res = authMode==='login'
      ? await Sync.signIn(email, pass)
      : await Sync.signUp(email, pass);
    if(res.error){ authError(translateAuthError(res.error)); return; }
    if(authMode==='register' && !res.session){
      authError('');
      uiSheet('Kiểm tra hộp thư',
        `<p class="text-sm muted">Supabase đã gửi email xác nhận tới <b>${esc(email)}</b>. Bấm liên kết trong email rồi quay lại đăng nhập.</p>
         <button class="btn btn-primary mt12" onclick="closeSheet()">Đã hiểu</button>`);
      return;
    }
    /* onAuthStateChange drives the actual session entry — nothing else to do here. */
  }catch(e){
    authError('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
    console.error(e);
  }finally{
    setAuthBusy(false);
  }
}

function translateAuthError(err){
  const m = String(err.message || err).toLowerCase();
  if(m.includes('invalid login credentials')) return 'Email hoặc mật khẩu không đúng.';
  if(m.includes('email not confirmed'))       return 'Email chưa được xác nhận. Kiểm tra hộp thư của bạn.';
  if(m.includes('already registered') || m.includes('already been registered')) return 'Email này đã có tài khoản. Chuyển sang tab Đăng nhập.';
  if(m.includes('password should be'))        return 'Mật khẩu quá ngắn (tối thiểu 6 ký tự).';
  if(m.includes('rate limit') || m.includes('too many')) return 'Thử lại quá nhiều lần. Đợi một lát rồi thử lại.';
  if(m.includes('failed to fetch'))           return 'Không kết nối được Supabase. Kiểm tra mạng hoặc cấu hình URL.';
  return err.message || 'Đăng nhập thất bại.';
}

async function requestPasswordReset(){
  const email = document.getElementById('login-email').value.trim();
  if(!email) return authError('Nhập email trước rồi bấm "Quên mật khẩu".');
  const {error} = await Sync.resetPassword(email);
  if(error) return authError(translateAuthError(error));
  toast('Đã gửi email đặt lại mật khẩu','ok');
}

function logout(){
  uiConfirm('Đăng xuất','Bản sao dữ liệu trên máy này vẫn được giữ để lần sau vào nhanh hơn. Đăng xuất?','Đăng xuất').then(async ok=>{
    if(!ok) return;
    await Sync.flush();               /* don't drop a pending write on the way out */
    await Sync.signOut();
    location.reload();
  });
}
function showLogin(){
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('main-header').classList.add('hidden');
  document.getElementById('main-nav').classList.add('hidden');
  document.getElementById('lock-screen').classList.add('hidden');
  setAuthBusy(false);
}

/* Called once a Supabase session exists. Paints from the local cache first so
   the app is usable immediately, then lets Sync reconcile with the cloud. */
function enterSession(user){
  sessionEmail = user.email || '';
  setStorageNamespace(user.id);
  loadStorage();
  state.currentUser = user.id;
  ensureUserCategories(user.id);

  if(state.app.pinEnabled && state.app.pinHash){
    document.getElementById('view-login').classList.add('hidden');
    showLockScreen('verify');
  } else {
    initUserSession();
  }
  Sync.start(user.id);
}

function displayName(){
  return sessionEmail ? sessionEmail.split('@')[0] : 'Bạn';
}

function initUserSession(){
  ensureUserCategories(state.currentUser);
  autoProcessRecurring();
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('main-header').classList.remove('hidden');
  document.getElementById('user-display-name').textContent = displayName();
  const h = new Date().getHours();
  document.getElementById('header-greet').textContent = h<11?'Chào buổi sáng ☀️':h<14?'Chào buổi trưa 🍚':h<18?'Chào buổi chiều 🌤':'Chào buổi tối 🌙';
  document.getElementById('privacy-btn').textContent = state.app.privacy ? 'Hiện' : 'Ẩn';
  if(!state.onboardingStatus[state.currentUser]){
    /* Brand-new account: if this browser still holds pre-cloud data, offer it
       instead of making the user re-enter everything. */
    document.getElementById('main-nav').classList.add('hidden');
    startOnboarding();
    offerLocalArchiveImport();
  }
  else { document.getElementById('main-nav').classList.remove('hidden'); switchTab('dashboard'); }
}

/* ============================================================
   ONBOARDING
   ============================================================ */
function startOnboarding(){
  document.getElementById('view-onboarding').classList.remove('hidden');
  renderObStep1();
}
function renderObStep1(){
  document.getElementById('ob-wallet-options').innerHTML = WALLET_PRESETS.map(w=>
    `<div class="chip ${obSelectedWallets.includes(w)?'active':''}" onclick="toggleObWallet('${esc(w)}')">${esc(w)}</div>`).join('');
}
function toggleObWallet(w){
  obSelectedWallets = obSelectedWallets.includes(w) ? obSelectedWallets.filter(x=>x!==w) : [...obSelectedWallets, w];
  renderObStep1();
}
function addObCustomWallet(){
  const input = document.getElementById('ob-custom-wallet');
  const val = input.value.trim();
  if(val && !obSelectedWallets.includes(val)){ obSelectedWallets.push(val); input.value=''; renderObStep1(); }
}
function obGoStep(step){
  if(step===2 && obSelectedWallets.length===0) return toast('Chọn ít nhất 1 ví','err');
  ['ob-step-1','ob-step-2','ob-step-3'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  document.getElementById('ob-step-'+step).classList.remove('hidden');
  if(step===2){
    document.getElementById('ob-balance-inputs').innerHTML = obSelectedWallets.map(w=>
      `<div class="form-group"><label>${esc(w)}</label>
       <input type="number" class="input ob-bal-input" data-wallet="${esc(w)}" placeholder="0" value="${obBalances[w]||''}"></div>`).join('');
  } else if(step===3){
    document.querySelectorAll('.ob-bal-input').forEach(inp=>{ obBalances[inp.dataset.wallet] = Number(inp.value)||0; });
    document.getElementById('ob-summary-balance').textContent = fmt(Object.values(obBalances).reduce((a,b)=>a+b,0));
  }
}
function finishOnboarding(){
  const guessType = n =>{
    const s = n.toLowerCase();
    if(s.includes('ngân hàng')||s.includes('bank')) return 'bank';
    if(s.includes('tiết kiệm')||s.includes('saving')) return 'savings';
    if(s.includes('thẻ')||s.includes('credit')) return 'credit_card';
    return 'cash';
  };
  obSelectedWallets.forEach(name=>{
    const type = guessType(name);
    state.wallets.push({
      id:uid('w'), userId:state.currentUser, name, icon:WALLET_TYPE_META[type].icon,
      type: type==='credit_card' ? 'cash' : type, currency:'VND', startingBalance:obBalances[name]||0
    });
  });
  state.onboardingStatus[state.currentUser] = true;
  saveStorage();
  document.getElementById('view-onboarding').classList.add('hidden');
  document.getElementById('main-nav').classList.remove('hidden');
  switchTab('dashboard');
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const VIEW_RENDERERS = {
  dashboard: renderDashboard,
  transactions: ()=>renderTransactionsList(true),
  add: renderAddForm,
  reports: renderReportsView,
  more: renderMoreView,
  wallets: renderWalletsView,
  budget: renderBudgetView,
  debts: renderDebtsView,
  recurring: renderRecurringView,
  events: renderEventsView,
  categories: renderCategoriesView,
  settings: renderSettingsView
};
function switchTab(tab){
  if(tab==='add' && getUserWallets().length===0){ toast('Bạn cần tạo ít nhất 1 ví trước','err'); tab='wallets'; }
  currentTab = tab;
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  const el = document.getElementById('view-'+tab);
  if(el) el.classList.remove('hidden');
  const SUB_OF_MORE = ['wallets','budget','debts','recurring','events','categories','settings'];
  const navTab = SUB_OF_MORE.includes(tab) ? 'more' : tab;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.tab===navTab));
  const fn = VIEW_RENDERERS[tab];
  if(fn) fn();
  window.scrollTo({top:0});
}
function renderAll(){
  const fn = VIEW_RENDERERS[currentTab];
  if(fn) fn();
}
/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard(){
  const curMonth = monthKey(todayISO());
  const txs = getUserTransactions();
  let inc=0, exp=0;
  txs.forEach(t=>{
    if(monthKey(t.date)!==curMonth) return;
    if(t.type==='income') inc += txMain(t);
    else if(t.type==='expense') exp += txMain(t);
  });
  document.getElementById('db-total-balance').textContent = fmt(getUserTotalAssets());
  document.getElementById('db-month-income').textContent = fmt(inc);
  document.getElementById('db-month-expense').textContent = fmt(exp);

  renderAlerts();
  renderUpcomingCard();

  /* wallets carousel */
  document.getElementById('db-wallet-scroll').innerHTML = getUserWallets().map(w=>{
    if(isCreditCard(w)){
      return `<div class="wallet-card cc-mini" onclick="openWalletReport('${w.id}')">
        <div class="wicon" style="background:rgba(255,255,255,.15);">${w.icon}</div>
        <div class="wname">${esc(w.name)}</div>
        <div class="wbal tabular">${fmtW(getCardUsedAmount(w), w)}</div>
        <div class="wsub">Còn: ${fmtW(getCardAvailableLimit(w), w)}</div>
      </div>`;
    }
    return `<div class="wallet-card" onclick="openWalletReport('${w.id}')">
      <div class="wicon">${w.icon}</div>
      <div class="wname">${esc(w.name)}</div>
      <div class="wbal tabular">${fmtW(getWalletBalance(w.id), w)}</div>
      <div class="wsub">${walletMeta(w).label}${w.currency!=='VND'?' · '+w.currency:''}</div>
    </div>`;
  }).join('') + `<div class="wallet-card add" onclick="openWalletModal()"><div style="font-size:1.4rem;">+</div><div class="text-xs">Thêm ví</div></div>`;

  /* budget mini */
  const bEl = document.getElementById('db-budget-mini');
  const monthBudgets = getUserBudgets('monthly').filter(b=>effectivePeriodKey(b)===currentPeriodKey('monthly'));
  if(monthBudgets.length===0){
    bEl.innerHTML = `<div class="between"><span class="text-sm muted">Chưa đặt ngân sách nào</span><span class="link" onclick="switchTab('budget')">Đặt ngay</span></div>`;
  } else {
    bEl.innerHTML = monthBudgets.slice(0,3).map(b=>renderBudgetBar(b, true)).join('');
  }

  /* category mini (this month expense) */
  const catTotals = {};
  txs.filter(t=>t.type==='expense' && monthKey(t.date)===curMonth)
     .forEach(t=>{ catTotals[t.categoryId] = (catTotals[t.categoryId]||0) + txMain(t); });
  const sorted = Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const miniEl = document.getElementById('db-cat-mini');
  miniEl.innerHTML = sorted.length===0
    ? `<p class="text-sm muted text-center">Chưa có chi tiêu tháng này</p>`
    : sorted.map(([catId,val])=>{
        const cat = findCategory('expense',catId) || {name:'Khác',icon:'📦',color:'#94A3B8'};
        const pct = exp ? Math.round(val/exp*100) : 0;
        return `<div class="row-c gap10 mb12">
          <div class="cat-circle" style="width:32px;height:32px;font-size:.9rem;background:${cat.color}22;">${cat.icon}</div>
          <div class="flex1">
            <div class="between"><span class="text-sm font-sb">${esc(cat.name)}</span><span class="text-sm font-bold tabular">${fmt(val)}</span></div>
            <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${cat.color};"></div></div>
          </div>
          <span class="text-xs muted" style="width:32px;text-align:right;">${pct}%</span>
        </div>`;
      }).join('');

  renderFeatureTiles('db-quick-access');
}
function sortTxDesc(a,b){
  if(a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt||'') > (a.createdAt||'') ? 1 : -1;
}

function collectAlerts(){
  const alerts = [];
  const today = todayISO();
  /* debts */
  getUserDebts().filter(d=>debtRemaining(d) > 0 && d.dueDate).forEach(d=>{
    const diff = daysBetween(today, d.dueDate);
    if(diff <= 7){
      alerts.push({
        level: diff < 0 ? 'danger' : 'warn',
        icon: d.kind==='borrow' ? '🔻' : '🔺',
        text: `${d.kind==='borrow'?'Khoản vay':'Khoản cho vay'} <b>${esc(d.party)}</b> — ${fmt(toMain(debtRemaining(d), (getWallet(d.walletId)||{}).currency))} · ${relDueLabel(d.dueDate).text}`,
        action: `switchTab('debts')`
      });
    }
  });
  /* budgets */
  getUserBudgets().filter(b=>effectivePeriodKey(b)===currentPeriodKey(b.period)).forEach(b=>{
    const spent = getBudgetSpent(b), pct = b.limit ? spent/b.limit*100 : 0;
    if(pct >= 100){
      alerts.push({level:'danger', icon:'🚨', text:`Vượt ngân sách <b>${esc(budgetName(b))}</b> — đã chi ${fmt(spent)}/${fmt(b.limit)}`, action:`switchTab('budget')`});
    } else if(pct >= 80){
      alerts.push({level:'warn', icon:'⚠️', text:`Ngân sách <b>${esc(budgetName(b))}</b> đã dùng ${Math.round(pct)}%`, action:`switchTab('budget')`});
    }
  });
  /* credit cards nearing due */
  getUserWallets().filter(w=>isCreditCard(w) && getCardUsedAmount(w)>0).forEach(w=>{
    const due = getCardNextDueDate(w), diff = daysBetween(today, due);
    if(diff <= 5) alerts.push({level: diff<=2?'danger':'warn', icon:'💳', text:`Thẻ <b>${esc(w.name)}</b> đến hạn thanh toán ${fmtDate(due)} — ${fmtW(getCardUsedAmount(w),w)}`, action:`switchTab('wallets')`});
  });
  return alerts;
}
function renderAlerts(){
  const alerts = collectAlerts();
  document.getElementById('alert-dot').classList.toggle('hidden', alerts.length===0);
  document.getElementById('db-alerts').innerHTML = alerts.slice(0,4).map(a=>
    `<div class="alert alert-${a.level}" onclick="${a.action}" style="cursor:pointer;"><span>${a.icon}</span><span>${a.text}</span></div>`).join('');
}

/* ============================================================
   TRANSACTION ROWS
   ============================================================ */
function renderTxRows(txs){
  if(!txs.length) return `<div class="empty-state"><div class="ic">🗂️</div><div class="text-sm">Chưa có giao dịch nào</div><div class="es-sub">Bấm nút + để thêm giao dịch đầu tiên</div></div>`;
  return txs.map(t=>{
    const wallet = getWallet(t.walletId);
    let icon='⇄', bg='var(--transfer-bg)', amtClass='c-transfer', prefix = t.type==='transfer_in'?'+':'-';
    let title = t.note || 'Chuyển tiền';
    let sub = wallet ? esc(wallet.name) : '';
    if(t.type==='income' || t.type==='expense'){
      const cat = catOf(t);
      const s2 = findSub(t.type==='income'?'income':'expense', t.categoryId, t.subcategoryId);
      icon = cat.icon; bg = cat.color+'22';
      amtClass = t.type==='income' ? 'c-income' : 'c-expense';
      prefix = t.type==='income' ? '+' : '-';
      title = t.note || cat.name;
      sub = (wallet ? esc(wallet.name)+' · ' : '') + esc(s2 ? s2.name : cat.name);
    }
    const ev = t.eventId ? getUserEvents().find(e=>e.id===t.eventId) : null;
    return `<div class="tx-row" onclick="openTxDetail('${t.id}')">
      <div class="tx-ic" style="background:${bg};">${icon}</div>
      <div class="tx-mid">
        <div class="tx-title">${esc(title)}${ev?`<span class="tag">${ev.icon} ${esc(ev.name)}</span>`:''}</div>
        <div class="tx-sub">${sub} · ${fmtDate(t.date)}</div>
      </div>
      <div class="tx-amt ${amtClass} tabular">${prefix}${fmtW(t.amount, wallet)}</div>
    </div>`;
  }).join('');
}

/* ============================================================
   TRANSACTIONS VIEW
   ============================================================ */
function toggleTxFilters(){ document.getElementById('tx-advanced-filters').classList.toggle('hidden'); }
function setTxFilter(key, val, el){
  txFilters[key] = val;
  if(el){ el.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.remove('active')); el.classList.add('active'); }
  document.getElementById('tx-custom-range').classList.toggle('hidden', txFilters.range!=='custom');
  renderTransactionsList();
}
function resetTxFilters(){
  txFilters = {type:'all', walletId:'all', catId:'all', eventId:'all', range:'all'};
  document.getElementById('tx-search').value = '';
  document.querySelectorAll('#tx-filter-type .chip').forEach(c=>c.classList.toggle('active', c.dataset.val==='all'));
  document.querySelectorAll('#tx-filter-range .chip').forEach(c=>c.classList.toggle('active', c.dataset.val==='all'));
  document.getElementById('tx-custom-range').classList.add('hidden');
  renderTransactionsList(true);
}
function rangeBounds(){
  const today = todayISO();
  switch(txFilters.range){
    case 'thismonth': { const k = monthKey(today); return [k+'-01', isoOf(new Date(parseISO(today).getFullYear(), parseISO(today).getMonth()+1, 0))]; }
    case 'lastmonth': { const d = parseISO(today); const s = new Date(d.getFullYear(), d.getMonth()-1, 1); const e = new Date(d.getFullYear(), d.getMonth(), 0); return [isoOf(s), isoOf(e)]; }
    case '7d':  return [addDaysISO(today,-6), today];
    case '30d': return [addDaysISO(today,-29), today];
    case 'thisyear': return [yearKey(today)+'-01-01', yearKey(today)+'-12-31'];
    case 'custom': return [document.getElementById('tx-from').value || '0000-01-01', document.getElementById('tx-to').value || '9999-12-31'];
    default: return null;
  }
}
function filteredTransactions(){
  const search = (document.getElementById('tx-search').value||'').toLowerCase().trim();
  let txs = getUserTransactions();
  if(txFilters.type!=='all'){
    txs = txFilters.type==='transfer' ? txs.filter(t=>t.type.startsWith('transfer')) : txs.filter(t=>t.type===txFilters.type);
  }
  if(txFilters.walletId!=='all') txs = txs.filter(t=>t.walletId===txFilters.walletId);
  if(txFilters.catId!=='all')    txs = txs.filter(t=>t.categoryId===txFilters.catId);
  if(txFilters.eventId!=='all')  txs = txs.filter(t=> txFilters.eventId==='none' ? !t.eventId : t.eventId===txFilters.eventId);
  const bounds = rangeBounds();
  if(bounds) txs = txs.filter(t=>t.date>=bounds[0] && t.date<=bounds[1]);
  if(search){
    txs = txs.filter(t=>{
      const cat = catOf(t);
      const s2 = findSub(t.type==='income'?'income':'expense', t.categoryId, t.subcategoryId);
      const w = getWallet(t.walletId);
      const hay = [t.note, cat.name, s2&&s2.name, w&&w.name, String(t.amount)].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(search);
    });
  }
  return txs.sort(sortTxDesc);
}
function renderTransactionsList(rebuild){
  if(rebuild){
    const wSel = document.getElementById('tx-filter-wallet');
    wSel.innerHTML = `<option value="all">Tất cả ví</option>` + getUserWallets().map(w=>`<option value="${w.id}">${w.icon} ${esc(w.name)}</option>`).join('');
    wSel.value = txFilters.walletId;
    const cSel = document.getElementById('tx-filter-cat');
    cSel.innerHTML = `<option value="all">Tất cả danh mục</option>`
      + `<optgroup label="Khoản chi">` + getCats('expense').map(c=>`<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join('') + `</optgroup>`
      + `<optgroup label="Khoản thu">` + getCats('income').map(c=>`<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join('') + `</optgroup>`;
    cSel.value = txFilters.catId;
    const eSel = document.getElementById('tx-filter-event');
    eSel.innerHTML = `<option value="all">Tất cả</option><option value="none">Không thuộc sự kiện</option>`
      + getUserEvents().map(e=>`<option value="${e.id}">${e.icon} ${esc(e.name)}</option>`).join('');
    eSel.value = txFilters.eventId;
  } else {
    txFilters.walletId = document.getElementById('tx-filter-wallet').value || 'all';
    txFilters.catId    = document.getElementById('tx-filter-cat').value || 'all';
    txFilters.eventId  = document.getElementById('tx-filter-event').value || 'all';
  }

  const txs = filteredTransactions();
  let inc=0, exp=0;
  txs.forEach(t=>{ if(t.type==='income') inc+=txMain(t); else if(t.type==='expense') exp+=txMain(t); });
  document.getElementById('tx-summary').innerHTML = `
    <div><div class="text-xs muted">Thu</div><div class="text-sm font-bold c-income tabular">${fmt(inc)}</div></div>
    <div><div class="text-xs muted">Chi</div><div class="text-sm font-bold c-expense tabular">${fmt(exp)}</div></div>
    <div><div class="text-xs muted">Còn lại</div><div class="text-sm font-bold tabular ${inc-exp>=0?'c-income':'c-expense'}">${fmt(inc-exp)}</div></div>
    <div><div class="text-xs muted">Số GD</div><div class="text-sm font-bold tabular">${txs.length}</div></div>`;

  const container = document.getElementById('tx-list-container');
  if(!txs.length){ container.innerHTML = `<div class="empty-state"><div class="ic">🔍</div><div class="text-sm">Không tìm thấy giao dịch</div><div class="es-sub">Thử đổi bộ lọc hoặc từ khóa khác</div></div>`; return; }

  const groups = {};
  txs.forEach(t=>{ (groups[t.date] = groups[t.date]||[]).push(t); });
  container.innerHTML = Object.keys(groups).map(date=>{
    let net = 0;
    groups[date].forEach(t=>{ if(t.type==='income') net += txMain(t); else if(t.type==='expense') net -= txMain(t); });
    const label = parseISO(date).toLocaleDateString('vi-VN',{weekday:'short', day:'2-digit', month:'2-digit', year:'numeric'});
    return `<div class="day-header"><span class="dtitle">${label}</span><span class="dtotal ${net>=0?'c-income':'c-expense'}">${net>=0?'+':''}${fmt(net)}</span></div>` + renderTxRows(groups[date]);
  }).join('');
}

/* ============================================================
   TRANSACTION DETAIL
   ============================================================ */
function openTxDetail(txId){
  const t = state.transactions.find(x=>x.id===txId);
  if(!t) return;
  const wallet = getWallet(t.walletId);
  const ev = t.eventId ? getUserEvents().find(e=>e.id===t.eventId) : null;
  const isTransfer = t.type.startsWith('transfer');
  let head, meta = '';
  if(isTransfer){
    const pair = t.transferId ? state.transactions.find(x=>x.transferId===t.transferId && x.id!==t.id) : null;
    const other = pair ? getWallet(pair.walletId) : null;
    head = `<div class="cat-circle" style="width:56px;height:56px;font-size:1.6rem;background:var(--transfer-bg);margin:0 auto 8px;">⇄</div>
      <div class="text-lg font-bold c-transfer">${fmtW(t.amount, wallet)}</div>
      <div class="text-sm muted">Chuyển tiền nội bộ</div>`;
    meta = other ? `<p class="text-sm mb8"><b>${t.type==='transfer_out'?'Đến ví':'Từ ví'}:</b> ${other.icon} ${esc(other.name)}</p>` : '';
  } else {
    const cat = catOf(t);
    const sub = findSub(t.type==='income'?'income':'expense', t.categoryId, t.subcategoryId);
    head = `<div class="cat-circle" style="width:56px;height:56px;font-size:1.6rem;background:${cat.color}22;margin:0 auto 8px;">${cat.icon}</div>
      <div class="text-lg font-bold ${t.type==='income'?'c-income':'c-expense'}">${t.type==='income'?'+':'-'}${fmtW(t.amount, wallet)}</div>
      <div class="text-sm muted">${esc(cat.name)}${sub?' · '+esc(sub.name):''}</div>`;
  }
  const converted = wallet && wallet.currency !== mainCurrency()
    ? `<p class="text-sm mb8"><b>Quy đổi:</b> ${fmt(txMain(t))}</p>` : '';
  document.getElementById('tx-detail-content').innerHTML = `
    <div class="text-center mb12">${head}</div>
    <div class="card flat">
      <p class="text-sm mb8"><b>Ví:</b> ${wallet?wallet.icon+' '+esc(wallet.name):'-'}</p>
      ${meta}${converted}
      <p class="text-sm mb8"><b>Ngày:</b> ${fmtDate(t.date)}</p>
      ${ev?`<p class="text-sm mb8"><b>Sự kiện:</b> ${ev.icon} ${esc(ev.name)}</p>`:''}
      ${t.recurringId?`<p class="text-sm mb8"><b>Nguồn:</b> Giao dịch định kỳ 🔁</p>`:''}
      ${t.debtId?`<p class="text-sm mb8"><b>Nguồn:</b> Sổ nợ 🤝</p>`:''}
      <p class="text-sm"><b>Ghi chú:</b> ${esc(t.note)||'(không có)'}</p>
    </div>`;
  const editBtn = document.getElementById('tx-detail-edit-btn');
  editBtn.classList.toggle('hidden', isTransfer);
  editBtn.onclick = ()=>{ closeModal('modal-tx-detail'); startEditTx(txId); };
  document.getElementById('tx-detail-delete-btn').onclick = ()=>deleteTx(txId);
  openModal('modal-tx-detail');
}
function deleteTx(txId){
  const t = state.transactions.find(x=>x.id===txId);
  if(!t) return;
  uiConfirm('Xóa giao dịch','Giao dịch này sẽ bị xóa khỏi sổ và số dư ví sẽ được tính lại.','Xóa').then(ok=>{
    if(!ok) return;
    if(t.transferId) state.transactions = state.transactions.filter(x=>x.transferId!==t.transferId);
    else state.transactions = state.transactions.filter(x=>x.id!==txId);
    if(t.debtId){
      const debt = state.debts.find(d=>d.id===t.debtId);
      if(debt) debt.payments = (debt.payments||[]).filter(p=>p.txId!==txId);
    }
    saveStorage();
    closeModal('modal-tx-detail');
    toast('Đã xóa giao dịch','ok');
    renderAll();
  });
}

/* ============================================================
   ADD / EDIT TRANSACTION
   ============================================================ */
function setTxType(type){
  currentTxType = type;
  document.querySelectorAll('#view-add .segment .seg').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-'+type).classList.add('active');
  if(type==='transfer'){
    document.getElementById('form-normal').classList.add('hidden');
    document.getElementById('form-transfer').classList.remove('hidden');
    renderTransferForm();
  } else {
    document.getElementById('form-transfer').classList.add('hidden');
    document.getElementById('form-normal').classList.remove('hidden');
    txSelectedCatId = null; txSelectedSubId = null;
    renderAddForm();
  }
}
function cancelAddTx(){
  editingTxId = null; clearAmount();
  document.getElementById('tx-note').value = '';
  switchTab('dashboard');
}
function renderAddForm(){
  const wallets = getUserWallets();
  if(!wallets.length){ toast('Bạn cần tạo ít nhất 1 ví trước','err'); switchTab('wallets'); return; }
  document.getElementById('add-title').textContent = editingTxId ? 'Sửa giao dịch' : 'Thêm giao dịch';
  document.getElementById('tx-save-btn').textContent = editingTxId ? 'Cập nhật giao dịch' : 'Lưu giao dịch';
  if(currentTxType==='transfer'){ renderTransferForm(); return; }

  if(!txSelectedWalletId || !wallets.find(w=>w.id===txSelectedWalletId)) txSelectedWalletId = wallets[0].id;
  document.getElementById('tx-wallet-chips').innerHTML = wallets.map(w=>
    `<div class="chip ${w.id===txSelectedWalletId?'active':''}" onclick="selectTxWallet('${w.id}')">${w.icon} ${esc(w.name)}</div>`).join('');

  const type = currentTxType==='income' ? 'income' : 'expense';
  const cats = getCats(type);
  if(!txSelectedCatId || !cats.find(c=>c.id===txSelectedCatId)) txSelectedCatId = cats.length ? cats[0].id : null;
  document.getElementById('tx-cat-grid').innerHTML = cats.map(c=>
    `<div class="cat-tile ${c.id===txSelectedCatId?'active':''}" onclick="selectTxCategory('${c.id}')">
      <div class="cat-circle" style="background:${c.color}22;">${c.icon}</div>
      <div class="cat-name">${esc(c.name)}</div>
    </div>`).join('') +
    `<div class="cat-tile" onclick="openCategoryModal(null,'${type}')">
      <div class="cat-circle" style="background:var(--card-2);color:var(--muted);">+</div>
      <div class="cat-name">Thêm mới</div>
    </div>`;

  const cat = findCategory(type, txSelectedCatId);
  const subGroup = document.getElementById('tx-sub-group');
  if(cat && cat.subs && cat.subs.length){
    subGroup.classList.remove('hidden');
    if(!txSelectedSubId || !cat.subs.find(s=>s.id===txSelectedSubId)) txSelectedSubId = cat.subs[0].id;
    document.getElementById('tx-sub-chips').innerHTML = cat.subs.map(s=>
      `<div class="chip ${s.id===txSelectedSubId?'active':''}" onclick="selectTxSub('${s.id}')">${esc(s.name)}</div>`).join('');
  } else { subGroup.classList.add('hidden'); txSelectedSubId = null; }

  const evSel = document.getElementById('tx-event');
  const prevEv = evSel.value;
  evSel.innerHTML = `<option value="">Không</option>` + getUserEvents().map(e=>`<option value="${e.id}">${e.icon} ${esc(e.name)}</option>`).join('');
  if(prevEv) evSel.value = prevEv;

  if(!document.getElementById('tx-date').value) document.getElementById('tx-date').value = todayISO();
  const w = getWallet(txSelectedWalletId);
  document.getElementById('tx-amount-unit').textContent = w ? (CURRENCIES[w.currency]||{}).name || w.currency : 'VND';
  document.getElementById('tx-amount-display').textContent = fmtW(txAmount, w);
}
function selectTxWallet(id){ txSelectedWalletId = id; renderAddForm(); }
function selectTxCategory(id){ txSelectedCatId = id; txSelectedSubId = null; renderAddForm(); }
function selectTxSub(id){ txSelectedSubId = id; renderAddForm(); }
function addQuickAmount(v){
  txAmount += v;
  document.getElementById('tx-amount-raw').value = txAmount;
  document.getElementById('tx-amount-display').textContent = fmtW(txAmount, getWallet(txSelectedWalletId));
}
function clearAmount(){
  txAmount = 0;
  const el = document.getElementById('tx-amount-raw'); if(el) el.value = '';
  const d = document.getElementById('tx-amount-display'); if(d) d.textContent = fmtW(0, getWallet(txSelectedWalletId));
}
function onAmountTyped(val){
  txAmount = parseAmount(val);
  document.getElementById('tx-amount-display').textContent = fmtW(txAmount, getWallet(txSelectedWalletId));
}
function startEditTx(txId){
  const t = state.transactions.find(x=>x.id===txId);
  if(!t || t.type.startsWith('transfer')) return;
  editingTxId = txId;
  currentTxType = t.type;
  txSelectedWalletId = t.walletId; txSelectedCatId = t.categoryId; txSelectedSubId = t.subcategoryId;
  txAmount = t.amount;
  switchTab('add');
  document.querySelectorAll('#view-add .segment .seg').forEach(s=>s.classList.remove('active'));
  document.getElementById('tab-'+t.type).classList.add('active');
  document.getElementById('form-transfer').classList.add('hidden');
  document.getElementById('form-normal').classList.remove('hidden');
  document.getElementById('tx-note').value = t.note || '';
  document.getElementById('tx-date').value = t.date;
  document.getElementById('tx-amount-raw').value = t.amount;
  renderAddForm();
  document.getElementById('tx-event').value = t.eventId || '';
}
function saveTransaction(){
  const note = document.getElementById('tx-note').value.trim();
  const date = document.getElementById('tx-date').value;
  const eventId = document.getElementById('tx-event').value || null;
  if(!txAmount || txAmount<=0) return toast('Nhập số tiền hợp lệ','err');
  if(!txSelectedWalletId) return toast('Chọn ví','err');
  if(!txSelectedCatId) return toast('Chọn danh mục','err');
  if(!date) return toast('Chọn ngày giao dịch','err');

  if(editingTxId){
    const t = state.transactions.find(x=>x.id===editingTxId);
    if(t) Object.assign(t, {type:currentTxType, amount:txAmount, walletId:txSelectedWalletId,
      categoryId:txSelectedCatId, subcategoryId:txSelectedSubId, note, date, eventId});
    editingTxId = null;
    toast('Đã cập nhật giao dịch','ok');
  } else {
    state.transactions.push({
      id:uid('t'), userId:state.currentUser, type:currentTxType, amount:txAmount,
      walletId:txSelectedWalletId, categoryId:txSelectedCatId, subcategoryId:txSelectedSubId,
      note, date, eventId, createdAt:new Date().toISOString()
    });
    toast('Đã lưu giao dịch','ok');
  }
  saveStorage();
  clearAmount();
  document.getElementById('tx-note').value = '';
  document.getElementById('tx-date').value = todayISO();
  checkBudgetWarning(txSelectedCatId);
  switchTab('dashboard');
}
function checkBudgetWarning(catId){
  const bs = getUserBudgets().filter(b=>effectivePeriodKey(b)===currentPeriodKey(b.period) && (b.categoryId===catId || b.categoryId==='__all__'));
  bs.forEach(b=>{
    const spent = getBudgetSpent(b), pct = b.limit ? spent/b.limit*100 : 0;
    if(pct >= 100) toast(`⚠ Vượt ngân sách "${budgetName(b)}" (${Math.round(pct)}%)`, 'err');
    else if(pct >= 80) toast(`⚠ Ngân sách "${budgetName(b)}" đã dùng ${Math.round(pct)}%`);
  });
}

/* ---------- TRANSFER ---------- */
function renderTransferForm(){
  const wallets = getUserWallets();
  if(wallets.length < 2){ toast('Cần ít nhất 2 ví để chuyển tiền','err'); switchTab('wallets'); return; }
  const opts = wallets.map(w=>`<option value="${w.id}">${w.icon} ${esc(w.name)} (${w.currency})</option>`).join('');
  const from = document.getElementById('tf-from-wallet'), to = document.getElementById('tf-to-wallet');
  const prevFrom = from.value, prevTo = to.value;
  from.innerHTML = opts; to.innerHTML = opts;
  from.value = prevFrom && wallets.some(w=>w.id===prevFrom) ? prevFrom : wallets[0].id;
  to.value   = prevTo && wallets.some(w=>w.id===prevTo) && prevTo!==from.value ? prevTo : (wallets.find(w=>w.id!==from.value)||wallets[0]).id;
  document.getElementById('tf-date').value = todayISO();
  tfAmount = 0;
  document.getElementById('tf-amount-raw').value = '';
  onTransferWalletChange();
}
function onTransferWalletChange(){
  const fw = getWallet(document.getElementById('tf-from-wallet').value);
  const tw = getWallet(document.getElementById('tf-to-wallet').value);
  document.getElementById('tf-amount-unit').textContent = fw ? fw.currency : 'VND';
  document.getElementById('tf-amount-display').textContent = fmtW(tfAmount, fw);
  const differs = fw && tw && fw.currency !== tw.currency;
  document.getElementById('tf-fx-group').classList.toggle('hidden', !differs);
  if(differs){
    const converted = toMain(tfAmount, fw.currency) / rateOf(tw.currency) * rateOf(mainCurrency());
    document.getElementById('tf-to-amount').value = tfAmount ? Number(converted.toFixed(2)) : '';
    document.getElementById('tf-fx-help').textContent = `Tỷ giá hiện tại: 1 ${fw.currency} ≈ ${(rateOf(fw.currency)/rateOf(tw.currency)).toFixed(4)} ${tw.currency}. Bạn có thể sửa số thực nhận.`;
  }
}
function onTfAmountTyped(val){
  tfAmount = parseAmount(val);
  onTransferWalletChange();
}
function saveTransfer(){
  const fromId = document.getElementById('tf-from-wallet').value;
  const toId = document.getElementById('tf-to-wallet').value;
  const date = document.getElementById('tf-date').value || todayISO();
  const note = document.getElementById('tf-note').value.trim();
  const fee = Number(document.getElementById('tf-fee').value)||0;
  if(fromId===toId) return toast('Ví nguồn và ví đích phải khác nhau','err');
  if(!tfAmount || tfAmount<=0) return toast('Nhập số tiền hợp lệ','err');
  const fromW = getWallet(fromId), toW = getWallet(toId);
  let received = tfAmount;
  if(fromW.currency !== toW.currency){
    received = Number(document.getElementById('tf-to-amount').value) || (toMain(tfAmount, fromW.currency)/rateOf(toW.currency)*rateOf(mainCurrency()));
    if(received <= 0) return toast('Nhập số tiền nhận được ở ví đích','err');
  }
  const transferId = uid('tr');
  const stamp = new Date().toISOString();
  state.transactions.push(
    {id:uid('t'), userId:state.currentUser, type:'transfer_out', amount:tfAmount, walletId:fromId, note:note||`Chuyển sang ${toW.name}`, date, transferId, createdAt:stamp},
    {id:uid('t'), userId:state.currentUser, type:'transfer_in', amount:received, walletId:toId, note:note||`Nhận từ ${fromW.name}`, date, transferId, createdAt:stamp}
  );
  if(fee > 0){
    state.transactions.push({id:uid('t'), userId:state.currentUser, type:'expense', amount:fee, walletId:fromId,
      categoryId:'c_other_exp', subcategoryId:'s_other_exp', note:'Phí chuyển tiền', date, createdAt:stamp});
  }
  saveStorage();
  document.getElementById('tf-note').value=''; document.getElementById('tf-fee').value='';
  tfAmount = 0;
  toast('Đã chuyển tiền thành công','ok');
  switchTab('dashboard');
}

/* ============================================================
   WALLETS
   ============================================================ */
function renderWalletsView(){
  const wallets = getUserWallets();
  const assets = wallets.filter(w=>!isCreditCard(w) && !w.excludeFromTotal).reduce((s,w)=>s+getWalletBalanceMain(w.id),0);
  const debt = wallets.filter(w=>isCreditCard(w)).reduce((s,w)=>s+toMain(getCardUsedAmount(w), w.currency),0);
  document.getElementById('wallets-total').innerHTML = `
    <div style="display:flex;justify-content:space-around;text-align:center;">
      <div><div class="text-xs muted">Tài sản</div><div class="font-bold c-income tabular">${fmt(assets)}</div></div>
      <div><div class="text-xs muted">Nợ thẻ</div><div class="font-bold c-expense tabular">${fmt(debt)}</div></div>
      <div><div class="text-xs muted">Ròng</div><div class="font-bold tabular">${fmt(getUserTotalAssets())}</div></div>
    </div>`;

  const listEl = document.getElementById('wallets-list');
  if(!wallets.length){ listEl.innerHTML = `<div class="empty-state"><div class="ic">👛</div><div class="text-sm">Chưa có ví nào</div><div class="es-sub">Tạo ví để bắt đầu ghi chép</div></div>`; return; }

  let html = '';
  ['cash','bank','credit_card','savings'].forEach(type=>{
    const group = wallets.filter(w=>w.type===type);
    if(!group.length) return;
    html += `<div class="section-title"><h4>${WALLET_TYPE_META[type].icon} ${WALLET_TYPE_META[type].label}</h4><span class="text-xs muted">${group.length} ví</span></div>`;
    html += group.map(w=> isCreditCard(w) ? renderCreditCard(w) : renderWalletItem(w)).join('');
  });
  listEl.innerHTML = html;
}
function renderWalletItem(w){
  const bal = getWalletBalance(w.id);
  const extra = w.type==='savings' && w.interestRate ? ` · ${w.interestRate}%/năm${w.maturityDate?' · đáo hạn '+fmtDate(w.maturityDate):''}` : '';
  return `<div class="wallet-item">
    <div class="w-avatar" style="background:${walletMeta(w).color}22;">${w.icon}</div>
    <div class="flex1">
      <div class="font-bold text-sm">${esc(w.name)} ${w.excludeFromTotal?'<span class="tag">Không tính tổng</span>':''}</div>
      <div class="text-xs muted">Đầu kỳ ${fmtW(w.startingBalance,w)}${extra}</div>
      <div class="font-x ${bal>=0?'c-income':'c-expense'} tabular mt4">${fmtW(bal,w)}</div>
      ${w.currency!==mainCurrency()?`<div class="text-xs muted">≈ ${fmt(toMain(bal,w.currency))}</div>`:''}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      <button class="btn btn-secondary btn-xs" onclick="openWalletModal('${w.id}')">Sửa</button>
      <button class="btn btn-danger btn-xs" onclick="deleteWallet('${w.id}')">Xóa</button>
    </div>
  </div>`;
}
function renderCreditCard(w){
  const used = getCardUsedAmount(w), avail = getCardAvailableLimit(w), pct = getCardUsagePct(w);
  return `<div class="cc-visual">
    <div class="cc-top">
      <div><div class="cc-name">${w.icon} ${esc(w.name)}</div><div class="cc-tag">Thẻ tín dụng · ${w.currency}</div></div>
      <div class="cc-badge">💳</div>
    </div>
    <div class="cc-stats">
      <div><div class="cc-stat-lbl">Hạn mức</div><div class="cc-stat-val tabular">${fmtW(w.creditLimit||0,w)}</div></div>
      <div><div class="cc-stat-lbl">Đã dùng</div><div class="cc-stat-val tabular" style="color:#FCA5A5;">${fmtW(used,w)}</div></div>
      <div><div class="cc-stat-lbl">Còn lại</div><div class="cc-stat-val tabular" style="color:#86EFAC;">${fmtW(avail,w)}</div></div>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${pct>=90?'#F43F5E':pct>=70?'#FBBF24':'#34D399'};"></div></div>
    <div class="cc-due">📅 Chốt sao kê ngày ${w.statementDate||'-'} · Hạn thanh toán ngày ${w.paymentDueDate||'-'} hàng tháng</div>
    <div class="cc-actions">
      <button class="btn-cc-pay" onclick="openCardPaymentModal('${w.id}')">Thanh toán thẻ</button>
      <button class="btn-cc-edit" onclick="openWalletModal('${w.id}')">Sửa</button>
      <button class="btn-cc-edit" onclick="deleteWallet('${w.id}')">Xóa</button>
    </div>
  </div>`;
}
function selectWalletType(type){
  mwSelectedType = type;
  ['cash','bank','credit_card','savings'].forEach(t=>
    document.getElementById('mw-type-'+t).classList.toggle('active', t===type));
  document.getElementById('mw-cash-fields').classList.toggle('hidden', type==='credit_card');
  document.getElementById('mw-card-fields').classList.toggle('hidden', type!=='credit_card');
  document.getElementById('mw-savings-fields').classList.toggle('hidden', type!=='savings');
}
function openWalletModal(walletId){
  const curSel = document.getElementById('mw-currency');
  curSel.innerHTML = Object.keys(CURRENCIES).map(c=>`<option value="${c}">${c} — ${CURRENCIES[c].name}</option>`).join('');
  if(walletId){
    const w = getWallet(walletId);
    document.getElementById('modal-wallet-title').textContent = 'Sửa ví';
    document.getElementById('mw-wallet-id').value = w.id;
    document.getElementById('mw-name').value = w.name;
    curSel.value = w.currency || 'VND';
    document.getElementById('mw-exclude').checked = !!w.excludeFromTotal;
    mwSelectedIcon = w.icon;
    selectWalletType(w.type || 'cash');
    if(isCreditCard(w)){
      document.getElementById('mw-credit-limit').value = w.creditLimit||0;
      document.getElementById('mw-used-amount').value = getCardUsedAmount(w);
      document.getElementById('mw-statement-date').value = w.statementDate||'';
      document.getElementById('mw-payment-due').value = w.paymentDueDate||'';
    } else {
      document.getElementById('mw-starting-balance').value = w.startingBalance;
      document.getElementById('mw-interest').value = w.interestRate||'';
      document.getElementById('mw-maturity').value = w.maturityDate||'';
    }
  } else {
    document.getElementById('modal-wallet-title').textContent = 'Tạo ví mới';
    ['mw-wallet-id','mw-name','mw-starting-balance','mw-credit-limit','mw-used-amount','mw-statement-date','mw-payment-due','mw-interest','mw-maturity']
      .forEach(id=>document.getElementById(id).value='');
    document.getElementById('mw-exclude').checked = false;
    curSel.value = mainCurrency();
    mwSelectedIcon = '👛';
    selectWalletType('cash');
  }
  buildEmojiPicker('mw-icon-picker', mwSelectedIcon, e=>{ mwSelectedIcon = e; });
  openModal('modal-wallet');
}
function saveWalletModal(){
  const id = document.getElementById('mw-wallet-id').value;
  const name = document.getElementById('mw-name').value.trim();
  const currency = document.getElementById('mw-currency').value;
  const excludeFromTotal = document.getElementById('mw-exclude').checked;
  if(!name) return toast('Nhập tên ví','err');

  if(mwSelectedType==='credit_card'){
    const creditLimit = Number(document.getElementById('mw-credit-limit').value)||0;
    const usedAmount  = Number(document.getElementById('mw-used-amount').value)||0;
    const statementDate = clampDay(document.getElementById('mw-statement-date').value);
    const paymentDueDate = clampDay(document.getElementById('mw-payment-due').value);
    if(creditLimit<=0) return toast('Nhập hạn mức thẻ hợp lệ','err');
    if(id){
      const w = getWallet(id);
      if(w){
        /* keep already-recorded transactions intact: recompute startingBalance so the
           resulting used amount equals what the user just typed */
        const txSum = getWalletBalance(w.id) - w.startingBalance;
        Object.assign(w, {name, icon:mwSelectedIcon, type:'credit_card', currency, excludeFromTotal,
          creditLimit, statementDate, paymentDueDate, startingBalance: -usedAmount - txSum});
      }
    } else {
      state.wallets.push({id:uid('w'), userId:state.currentUser, name, icon:mwSelectedIcon, type:'credit_card',
        currency, excludeFromTotal, creditLimit, statementDate, paymentDueDate, startingBalance:-usedAmount});
    }
  } else {
    const bal = Number(document.getElementById('mw-starting-balance').value)||0;
    const interestRate = Number(document.getElementById('mw-interest').value)||0;
    const maturityDate = document.getElementById('mw-maturity').value || '';
    if(id){
      const w = getWallet(id);
      if(w){
        Object.assign(w, {name, icon:mwSelectedIcon, type:mwSelectedType, currency, excludeFromTotal, startingBalance:bal});
        delete w.creditLimit; delete w.statementDate; delete w.paymentDueDate;
        if(mwSelectedType==='savings'){ w.interestRate = interestRate; w.maturityDate = maturityDate; }
        else { delete w.interestRate; delete w.maturityDate; }
      }
    } else {
      const w = {id:uid('w'), userId:state.currentUser, name, icon:mwSelectedIcon, type:mwSelectedType, currency, excludeFromTotal, startingBalance:bal};
      if(mwSelectedType==='savings'){ w.interestRate = interestRate; w.maturityDate = maturityDate; }
      state.wallets.push(w);
    }
  }
  saveStorage();
  closeModal('modal-wallet');
  toast('Đã lưu ví','ok');
  renderWalletsView();
}
function clampDay(v){ const n = Number(v)||0; return n ? Math.min(Math.max(n,1),31) : null; }
function deleteWallet(id){
  if(state.transactions.some(t=>t.walletId===id)) return toast('Không thể xóa ví đã có giao dịch','err');
  uiConfirm('Xóa ví','Ví này sẽ bị xóa khỏi danh sách. Tiếp tục?','Xóa').then(ok=>{
    if(!ok) return;
    state.wallets = state.wallets.filter(w=>w.id!==id);
    saveStorage(); toast('Đã xóa ví','ok'); renderWalletsView();
  });
}

/* ---------- CREDIT CARD PAYMENT ---------- */
function openCardPaymentModal(walletId){
  const w = getWallet(walletId);
  if(!w) return;
  const sources = getUserWallets().filter(x=>!isCreditCard(x));
  if(!sources.length) return toast('Cần ít nhất 1 ví thường để thanh toán thẻ','err');
  mcpSelectedCardId = walletId;
  const debt = getCardUsedAmount(w);
  document.getElementById('mcp-card-name').textContent = w.name;
  document.getElementById('mcp-debt-amount').textContent = fmtW(debt, w);
  document.getElementById('mcp-source-wallet').innerHTML = sources.map(x=>`<option value="${x.id}">${x.icon} ${esc(x.name)} — ${fmtW(getWalletBalance(x.id),x)}</option>`).join('');
  document.getElementById('mcp-date').value = todayISO();
  document.querySelectorAll('#mcp-mode-chips .chip').forEach(c=>c.classList.toggle('active', c.dataset.val==='full'));
  mcpPayMode = 'full';
  const amt = document.getElementById('mcp-amount');
  amt.value = debt; amt.disabled = true;
  openModal('modal-card-payment');
}
function setMcpMode(mode, el){
  mcpPayMode = mode;
  el.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  const w = getWallet(mcpSelectedCardId);
  const input = document.getElementById('mcp-amount');
  if(mode==='full'){ input.value = w ? getCardUsedAmount(w) : 0; input.disabled = true; }
  else { input.disabled = false; input.value=''; input.focus(); }
}
function settleCardPayment(){
  const w = getWallet(mcpSelectedCardId);
  if(!w) return;
  const amount = Number(document.getElementById('mcp-amount').value)||0;
  const sourceId = document.getElementById('mcp-source-wallet').value;
  const date = document.getElementById('mcp-date').value || todayISO();
  const debt = getCardUsedAmount(w);
  if(!amount || amount<=0) return toast('Nhập số tiền thanh toán hợp lệ','err');
  if(!sourceId) return toast('Chọn ví nguồn thanh toán','err');
  const proceed = amount > debt + 0.01
    ? uiConfirm('Vượt dư nợ','Số tiền thanh toán lớn hơn dư nợ hiện tại. Bạn vẫn muốn tiếp tục?','Tiếp tục')
    : Promise.resolve(true);
  proceed.then(ok=>{
    if(!ok) return;
    const sourceW = getWallet(sourceId);
    /* pay in the source wallet's currency, credit the card in the card's currency */
    const cardAmount = sourceW.currency === w.currency ? amount
      : toMain(amount, sourceW.currency) / rateOf(w.currency) * rateOf(mainCurrency());
    const transferId = uid('tr'), stamp = new Date().toISOString();
    state.transactions.push(
      {id:uid('t'), userId:state.currentUser, type:'transfer_out', amount, walletId:sourceId, note:`Thanh toán thẻ ${w.name}`, date, transferId, createdAt:stamp},
      {id:uid('t'), userId:state.currentUser, type:'transfer_in', amount:cardAmount, walletId:w.id, note:`Trả nợ thẻ từ ${sourceW.name}`, date, transferId, createdAt:stamp}
    );
    saveStorage();
    closeModal('modal-card-payment');
    toast('Đã thanh toán thẻ tín dụng','ok');
    renderAll();
  });
}
/* ============================================================
   BUDGETS
   ============================================================ */
function effectivePeriodKey(b){ return b.repeat===false ? b.periodKey : currentPeriodKey(b.period); }
function budgetName(b){
  if(b.categoryId==='__all__') return 'Tổng chi tiêu';
  const c = findCategory('expense', b.categoryId);
  return c ? c.name : 'Danh mục đã xóa';
}
function budgetIcon(b){
  if(b.categoryId==='__all__') return {icon:'🎯', color:'#0D9488'};
  const c = findCategory('expense', b.categoryId);
  return c ? {icon:c.icon, color:c.color} : {icon:'📦', color:'#94A3B8'};
}
function getBudgetSpent(b){
  const key = effectivePeriodKey(b);
  return getUserTransactions().filter(t=>
    t.type==='expense' &&
    periodKeyOf(t.date, b.period)===key &&
    (b.categoryId==='__all__' || t.categoryId===b.categoryId) &&
    (!b.walletId || b.walletId==='all' || t.walletId===b.walletId)
  ).reduce((s,t)=>s+txMain(t),0);
}
function budgetColor(pct){ return pct>=100 ? 'var(--expense)' : pct>=80 ? 'var(--warn)' : 'var(--primary)'; }
function renderBudgetBar(b, compact){
  const spent = getBudgetSpent(b);
  const pct = b.limit ? Math.round(spent/b.limit*100) : 0;
  const meta = budgetIcon(b);
  const remain = b.limit - spent;
  const wallet = b.walletId && b.walletId!=='all' ? getWallet(b.walletId) : null;
  return `<div class="${compact?'':'card'}" ${compact?'style="margin-bottom:12px;"':`onclick="openBudgetModal('${b.id}')" style="cursor:pointer;"`}>
    <div class="row-c gap10 mb4">
      <div class="cat-circle" style="width:34px;height:34px;font-size:1rem;background:${meta.color}22;">${meta.icon}</div>
      <div class="flex1">
        <div class="between">
          <span class="font-sb text-sm">${esc(budgetName(b))}</span>
          <span class="text-xs font-bold" style="color:${budgetColor(pct)};">${pct}%</span>
        </div>
        <div class="text-xs muted">${fmt(spent)} / ${fmt(b.limit)}${wallet?' · '+esc(wallet.name):''}</div>
      </div>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,pct)}%;background:${budgetColor(pct)};"></div></div>
    <div class="between mt4">
      <span class="text-xs muted">${periodLabel(effectivePeriodKey(b), b.period)}</span>
      <span class="text-xs font-sb ${remain>=0?'muted':'c-expense'}">${remain>=0?'Còn '+fmt(remain):'Vượt '+fmt(-remain)}</span>
    </div>
  </div>`;
}
function setBudgetPeriod(p, el){
  budgetPeriodView = p;
  el.parentNode.querySelectorAll('.seg').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  renderBudgetView();
}
function renderBudgetView(){
  const budgets = getUserBudgets(budgetPeriodView);
  const totalLimit = budgets.reduce((s,b)=>s+b.limit,0);
  const totalSpent = budgets.filter(b=>b.categoryId!=='__all__').reduce((s,b)=>s+getBudgetSpent(b),0);
  const overall = budgets.find(b=>b.categoryId==='__all__');
  const shownSpent = overall ? getBudgetSpent(overall) : totalSpent;
  const shownLimit = overall ? overall.limit : totalLimit;
  const pct = shownLimit ? Math.round(shownSpent/shownLimit*100) : 0;
  const periodName = {weekly:'tuần này', monthly:'tháng này', yearly:'năm nay'}[budgetPeriodView];

  document.getElementById('budget-summary').innerHTML = budgets.length ? `
    <div class="text-sm muted">Tổng chi tiêu ${periodName} · ${periodLabel(currentPeriodKey(budgetPeriodView), budgetPeriodView)}</div>
    <div class="text-xl font-x tabular" style="margin:4px 0;">${fmt(shownSpent)} <span class="text-sm muted">/ ${fmt(shownLimit)}</span></div>
    <div class="progress-track" style="height:10px;"><div class="progress-fill" style="width:${Math.min(100,pct)}%;background:${budgetColor(pct)};"></div></div>
    <div class="between mt8">
      <span class="text-xs muted">${budgets.length} hạn mức đang theo dõi</span>
      <span class="text-xs font-bold" style="color:${budgetColor(pct)};">${pct}% ${pct>=100?'· Đã vượt!':pct>=80?'· Sắp chạm hạn':''}</span>
    </div>` : `<p class="text-sm muted text-center">Chưa có ngân sách nào cho chu kỳ này</p>`;

  const listEl = document.getElementById('budget-list');
  listEl.innerHTML = budgets.length
    ? budgets.sort((a,b)=>getBudgetSpent(b)/(b.limit||1) - getBudgetSpent(a)/(a.limit||1)).map(b=>renderBudgetBar(b)).join('')
    : `<div class="empty-state"><div class="ic">🎯</div><div class="text-sm">Chưa đặt hạn mức</div><div class="es-sub">Đặt hạn mức để nhận cảnh báo khi chi tiêu đạt 80% và 100%</div></div>`;
}
function setMbPeriod(p, el){
  mbPeriod = p;
  el.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
}
function openBudgetModal(budgetId){
  const catSel = document.getElementById('mb-cat');
  catSel.innerHTML = `<option value="__all__">🎯 Tổng chi tiêu (mọi danh mục)</option>` +
    getCats('expense').map(c=>`<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join('');
  const wSel = document.getElementById('mb-wallet');
  wSel.innerHTML = `<option value="all">Tất cả ví</option>` + getUserWallets().map(w=>`<option value="${w.id}">${w.icon} ${esc(w.name)}</option>`).join('');

  const b = budgetId ? state.budgets.find(x=>x.id===budgetId) : null;
  document.getElementById('mb-budget-id').value = b ? b.id : '';
  document.getElementById('modal-budget-title').textContent = b ? 'Sửa ngân sách' : 'Đặt ngân sách';
  document.getElementById('mb-delete').classList.toggle('hidden', !b);
  if(b){
    catSel.value = b.categoryId; wSel.value = b.walletId || 'all';
    document.getElementById('mb-limit').value = b.limit;
    mbPeriod = b.period;
  } else {
    document.getElementById('mb-limit').value = '';
    mbPeriod = budgetPeriodView;
  }
  document.querySelectorAll('#mb-period-chips .chip').forEach(c=>c.classList.toggle('active', c.dataset.val===mbPeriod));
  openModal('modal-budget');
}
function saveBudgetModal(){
  const id = document.getElementById('mb-budget-id').value;
  const categoryId = document.getElementById('mb-cat').value;
  const walletId = document.getElementById('mb-wallet').value;
  const limit = Number(document.getElementById('mb-limit').value)||0;
  if(limit<=0) return toast('Nhập hạn mức hợp lệ','err');
  const dup = state.budgets.find(b=>b.userId===state.currentUser && b.categoryId===categoryId && b.period===mbPeriod && b.walletId===walletId && b.id!==id);
  if(dup) return toast('Đã có ngân sách cho danh mục & chu kỳ này','err');
  if(id){
    const b = state.budgets.find(x=>x.id===id);
    if(b) Object.assign(b, {categoryId, walletId, limit, period:mbPeriod, periodKey:currentPeriodKey(mbPeriod)});
  } else {
    state.budgets.push({id:uid('bg'), userId:state.currentUser, categoryId, walletId, period:mbPeriod,
      periodKey:currentPeriodKey(mbPeriod), limit, repeat:true});
  }
  saveStorage();
  closeModal('modal-budget');
  budgetPeriodView = mbPeriod;
  document.querySelectorAll('#budget-period-seg .seg').forEach((s,i)=>s.classList.toggle('active', ['weekly','monthly','yearly'][i]===mbPeriod));
  toast('Đã lưu ngân sách','ok');
  renderBudgetView();
}
function deleteBudget(){
  const id = document.getElementById('mb-budget-id').value;
  uiConfirm('Xóa ngân sách','Hạn mức này sẽ bị gỡ bỏ. Giao dịch không bị ảnh hưởng.','Xóa').then(ok=>{
    if(!ok) return;
    state.budgets = state.budgets.filter(b=>b.id!==id);
    saveStorage(); closeModal('modal-budget'); toast('Đã xóa ngân sách','ok'); renderBudgetView();
  });
}

/* ============================================================
   DEBTS & LOANS
   ============================================================ */
function debtPaid(d){ return (d.payments||[]).reduce((s,p)=>s+p.amount,0); }
function debtRemaining(d){ return Math.max(0, d.amount - debtPaid(d)); }
function debtCurrency(d){ const w = getWallet(d.walletId); return w ? w.currency : mainCurrency(); }
function setDebtFilter(f, el){
  debtFilter = f;
  el.parentNode.querySelectorAll('.seg').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  renderDebtsView();
}
function renderDebtsView(){
  const debts = getUserDebts();
  const borrowTotal = debts.filter(d=>d.kind==='borrow').reduce((s,d)=>s+toMain(debtRemaining(d), debtCurrency(d)),0);
  const lendTotal   = debts.filter(d=>d.kind==='lend').reduce((s,d)=>s+toMain(debtRemaining(d), debtCurrency(d)),0);
  document.getElementById('debt-borrow-total').textContent = fmt(borrowTotal);
  document.getElementById('debt-lend-total').textContent = fmt(lendTotal);

  let list = debts;
  if(debtFilter==='borrow') list = debts.filter(d=>d.kind==='borrow' && debtRemaining(d)>0);
  else if(debtFilter==='lend') list = debts.filter(d=>d.kind==='lend' && debtRemaining(d)>0);
  else if(debtFilter==='settled') list = debts.filter(d=>debtRemaining(d)<=0);
  else list = debts.filter(d=>debtRemaining(d)>0);

  list.sort((a,b)=>(a.dueDate||'9999')<(b.dueDate||'9999')?-1:1);
  const el = document.getElementById('debts-list');
  if(!list.length){
    el.innerHTML = `<div class="empty-state"><div class="ic">🤝</div><div class="text-sm">Không có khoản nợ nào</div><div class="es-sub">Ghi lại các khoản đi vay và cho vay để không quên hạn trả</div></div>`;
    return;
  }
  el.innerHTML = list.map(d=>{
    const w = getWallet(d.walletId);
    const remain = debtRemaining(d), paid = debtPaid(d);
    const pct = d.amount ? Math.round(paid/d.amount*100) : 0;
    const settled = remain <= 0;
    const due = d.dueDate ? relDueLabel(d.dueDate) : null;
    const isBorrow = d.kind==='borrow';
    return `<div class="card">
      <div class="row-c gap10 mb8">
        <div class="w-avatar" style="background:${isBorrow?'var(--expense-bg)':'var(--income-bg)'};">${isBorrow?'🔻':'🔺'}</div>
        <div class="flex1">
          <div class="between">
            <span class="font-bold text-sm">${esc(d.party)}</span>
            <span class="pill ${settled?'pill-done':(due&&due.overdue?'pill-over':'pill-open')}">${settled?'Đã tất toán':(due&&due.overdue?'Quá hạn':'Đang mở')}</span>
          </div>
          <div class="text-xs muted">${isBorrow?'Tôi đi vay':'Tôi cho vay'}${w?' · '+esc(w.name):''} · từ ${fmtDate(d.date)}</div>
        </div>
      </div>
      <div class="between mb4">
        <span class="text-xs muted">Đã ${isBorrow?'trả':'thu'} ${fmtCur(paid, debtCurrency(d))}</span>
        <span class="text-sm font-x ${isBorrow?'c-expense':'c-income'} tabular">${fmtCur(remain, debtCurrency(d))}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${settled?'var(--income)':'var(--primary)'};"></div></div>
      <div class="between mt8">
        <span class="text-xs ${due&&due.overdue&&!settled?'c-expense font-bold':'muted'}">${d.dueDate?(settled?'Hạn '+fmtDate(d.dueDate):due.text):'Không có hạn'}</span>
        <div class="row gap6">
          ${settled?'':`<button class="btn btn-success btn-xs" onclick="openDebtPayModal('${d.id}')">${isBorrow?'Trả nợ':'Thu nợ'}</button>`}
          <button class="btn btn-secondary btn-xs" onclick="openDebtModal('${d.id}')">Sửa</button>
          <button class="btn btn-danger btn-xs" onclick="deleteDebt('${d.id}')">Xóa</button>
        </div>
      </div>
      ${(d.payments||[]).length?`<div class="divider"></div><div class="text-xs muted mb4">Lịch sử thanh toán</div>` +
        d.payments.map(p=>`<div class="between text-xs" style="padding:3px 0;"><span class="muted">${fmtDate(p.date)}</span><span class="font-sb tabular">${fmtCur(p.amount, debtCurrency(d))}</span></div>`).join('') : ''}
      ${d.note?`<div class="text-xs muted mt8">📝 ${esc(d.note)}</div>`:''}
    </div>`;
  }).join('');
}
function setDebtKind(kind){
  mdKind = kind;
  document.getElementById('md-kind-borrow').classList.toggle('active', kind==='borrow');
  document.getElementById('md-kind-lend').classList.toggle('active', kind==='lend');
  document.getElementById('md-party-label').textContent = kind==='borrow' ? 'Vay của ai?' : 'Cho ai vay?';
  document.getElementById('md-wallet-label').textContent = kind==='borrow' ? 'Nhận tiền vào ví' : 'Chi tiền từ ví';
  document.getElementById('md-affect-sub').textContent = kind==='borrow' ? 'Cộng tiền vào ví ngay khi lưu' : 'Trừ tiền khỏi ví ngay khi lưu';
}
function openDebtModal(debtId){
  const wallets = getUserWallets().filter(w=>!isCreditCard(w));
  if(!wallets.length) return toast('Bạn cần tạo ít nhất 1 ví trước','err');
  document.getElementById('md-wallet').innerHTML = wallets.map(w=>`<option value="${w.id}">${w.icon} ${esc(w.name)}</option>`).join('');
  const d = debtId ? state.debts.find(x=>x.id===debtId) : null;
  document.getElementById('md-debt-id').value = d ? d.id : '';
  document.getElementById('modal-debt-title').textContent = d ? 'Sửa khoản nợ' : 'Thêm khoản nợ';
  if(d){
    setDebtKind(d.kind);
    document.getElementById('md-party').value = d.party;
    document.getElementById('md-amount').value = d.amount;
    document.getElementById('md-wallet').value = d.walletId;
    document.getElementById('md-date').value = d.date;
    document.getElementById('md-duedate').value = d.dueDate||'';
    document.getElementById('md-note').value = d.note||'';
    document.getElementById('md-affect').checked = false;
    document.getElementById('md-affect').parentNode.parentNode.classList.add('hidden');
  } else {
    setDebtKind('borrow');
    ['md-party','md-amount','md-note','md-duedate'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('md-date').value = todayISO();
    document.getElementById('md-affect').checked = true;
    document.getElementById('md-affect').parentNode.parentNode.classList.remove('hidden');
  }
  openModal('modal-debt');
}
function saveDebtModal(){
  const id = document.getElementById('md-debt-id').value;
  const party = document.getElementById('md-party').value.trim();
  const amount = Number(document.getElementById('md-amount').value)||0;
  const walletId = document.getElementById('md-wallet').value;
  const date = document.getElementById('md-date').value || todayISO();
  const dueDate = document.getElementById('md-duedate').value || '';
  const note = document.getElementById('md-note').value.trim();
  const affect = document.getElementById('md-affect').checked;
  if(!party) return toast('Nhập tên người/tổ chức','err');
  if(amount<=0) return toast('Nhập số tiền hợp lệ','err');

  if(id){
    const d = state.debts.find(x=>x.id===id);
    if(d) Object.assign(d, {party, amount, walletId, date, dueDate, note});
    toast('Đã cập nhật khoản nợ','ok');
  } else {
    const debtId = uid('d');
    state.debts.push({id:debtId, userId:state.currentUser, kind:mdKind, party, amount, walletId, date, dueDate, note, payments:[]});
    if(affect){
      state.transactions.push({
        id:uid('t'), userId:state.currentUser,
        type: mdKind==='borrow' ? 'income' : 'expense',
        amount, walletId,
        categoryId: mdKind==='borrow' ? 'c_debt_in' : 'c_debt',
        subcategoryId: mdKind==='borrow' ? 's_borrow' : 's_lend',
        note: (mdKind==='borrow'?'Vay của ':'Cho vay ')+party, date, debtId, createdAt:new Date().toISOString()
      });
    }
    toast('Đã thêm khoản nợ','ok');
  }
  saveStorage();
  closeModal('modal-debt');
  renderDebtsView();
}
function deleteDebt(id){
  uiConfirm('Xóa khoản nợ','Xóa khoản nợ này? Các giao dịch đã ghi nhận trong ví sẽ được giữ nguyên.','Xóa').then(ok=>{
    if(!ok) return;
    state.debts = state.debts.filter(d=>d.id!==id);
    saveStorage(); toast('Đã xóa','ok'); renderDebtsView();
  });
}
function openDebtPayModal(debtId){
  const d = state.debts.find(x=>x.id===debtId);
  if(!d) return;
  mdpDebtId = debtId; mdpMode = 'full';
  const remain = debtRemaining(d);
  document.getElementById('mdp-title').textContent = d.kind==='borrow' ? 'Trả nợ' : 'Thu hồi nợ';
  document.getElementById('mdp-sub').textContent = (d.kind==='borrow'?'Trả cho ':'Thu từ ') + d.party;
  document.getElementById('mdp-remaining').textContent = fmtCur(remain, debtCurrency(d));
  document.getElementById('mdp-wallet').innerHTML = getUserWallets().filter(w=>!isCreditCard(w))
    .map(w=>`<option value="${w.id}" ${w.id===d.walletId?'selected':''}>${w.icon} ${esc(w.name)}</option>`).join('');
  document.getElementById('mdp-date').value = todayISO();
  setMdpMode('full');
  openModal('modal-debt-pay');
}
function setMdpMode(mode){
  mdpMode = mode;
  document.getElementById('mdp-mode-full').classList.toggle('active', mode==='full');
  document.getElementById('mdp-mode-part').classList.toggle('active', mode==='part');
  const d = state.debts.find(x=>x.id===mdpDebtId);
  const input = document.getElementById('mdp-amount');
  if(mode==='full'){ input.value = d ? debtRemaining(d) : 0; input.disabled = true; }
  else { input.disabled = false; input.value=''; input.focus(); }
}
function saveDebtPayment(){
  const d = state.debts.find(x=>x.id===mdpDebtId);
  if(!d) return;
  const amount = Number(document.getElementById('mdp-amount').value)||0;
  const walletId = document.getElementById('mdp-wallet').value;
  const date = document.getElementById('mdp-date').value || todayISO();
  if(amount<=0) return toast('Nhập số tiền hợp lệ','err');
  if(amount > debtRemaining(d) + 0.01) return toast('Số tiền lớn hơn phần còn lại','err');
  const txId = uid('t');
  state.transactions.push({
    id:txId, userId:state.currentUser,
    type: d.kind==='borrow' ? 'expense' : 'income',
    amount, walletId,
    categoryId: d.kind==='borrow' ? 'c_debt' : 'c_debt_in',
    subcategoryId: d.kind==='borrow' ? 's_repay' : 's_collect',
    note: (d.kind==='borrow'?'Trả nợ ':'Thu nợ ')+d.party, date, debtId:d.id, createdAt:new Date().toISOString()
  });
  d.payments = d.payments || [];
  d.payments.push({id:uid('p'), amount, date, walletId, txId});
  saveStorage();
  closeModal('modal-debt-pay');
  toast(debtRemaining(d)<=0 ? 'Đã tất toán khoản nợ 🎉' : 'Đã ghi nhận thanh toán','ok');
  renderDebtsView();
}

/* ============================================================
   RECURRING TRANSACTIONS
   ============================================================ */
function nextDueDate(dateStr, freq, interval){
  const n = Math.max(1, Number(interval)||1);
  if(freq==='daily')  return addDaysISO(dateStr, n);
  if(freq==='weekly') return addDaysISO(dateStr, 7*n);
  if(freq==='yearly') return addYearsISO(dateStr, n);
  return addMonthsISO(dateStr, n);
}
function createRecurringTx(r, dateStr){
  state.transactions.push({
    id:uid('t'), userId:r.userId, type:r.type||'expense', amount:r.amount, walletId:r.walletId,
    categoryId:r.categoryId, subcategoryId:r.subcategoryId, note:r.name, date:dateStr,
    recurringId:r.id, createdAt:new Date().toISOString()
  });
}
function autoProcessRecurring(){
  const today = todayISO();
  let changed = false;
  state.recurring.forEach(r=>{
    let guard = 0;
    while(r.autoProcess && r.dueDate <= today && guard < 60){
      if(r.endDate && r.dueDate > r.endDate) break;
      createRecurringTx(r, r.dueDate);
      r.dueDate = nextDueDate(r.dueDate, r.frequency, r.interval);
      changed = true; guard++;
    }
  });
  if(changed) saveStorage();
}
/* A schedule is finished once its next occurrence would fall past the end date. */
function recurEnded(r){ return !!r.endDate && r.dueDate > r.endDate; }
function payRecurring(id){
  const r = state.recurring.find(x=>x.id===id);
  if(!r) return;
  if(recurEnded(r)) return toast('Khoản này đã kết thúc vào '+fmtDate(r.endDate),'err');
  if(!getWallet(r.walletId)) return toast('Ví của khoản này không còn tồn tại — hãy sửa lại','err');
  uiConfirm('Xác nhận giao dịch', `Ghi nhận "${r.name}" — ${fmtW(r.amount, getWallet(r.walletId))} vào ngày ${fmtDate(r.dueDate)}?`, 'Ghi nhận').then(ok=>{
    if(!ok) return;
    createRecurringTx(r, r.dueDate);
    r.dueDate = nextDueDate(r.dueDate, r.frequency, r.interval);
    saveStorage();
    toast('Đã ghi nhận giao dịch','ok');
    renderAll();
  });
}
function toggleRecurAuto(id, checked){
  const r = state.recurring.find(x=>x.id===id);
  if(!r) return;
  r.autoProcess = checked;
  saveStorage();
  if(checked) autoProcessRecurring();
  renderRecurringView();
}
function renderRecurringView(){
  const items = getUserRecurring().sort((a,b)=>a.dueDate<b.dueDate?-1:1);
  const el = document.getElementById('recurring-list');
  if(!items.length){
    el.innerHTML = `<div class="empty-state"><div class="ic">🔁</div><div class="text-sm">Chưa có khoản định kỳ nào</div><div class="es-sub">Thêm tiền nhà, tiền mạng, lương... để tự động ghi sổ</div></div>`;
    return;
  }
  el.innerHTML = items.map(r=>{
    const w = getWallet(r.walletId);
    const cat = findCategory(r.type==='income'?'income':'expense', r.categoryId) || {name:'Khác', icon:'📦', color:'#94A3B8'};
    const sub = findSub(r.type==='income'?'income':'expense', r.categoryId, r.subcategoryId);
    const due = relDueLabel(r.dueDate);
    const every = (r.interval>1?`${r.interval} `:'') + FREQ_LABEL[r.frequency];
    const ended = recurEnded(r);
    const broken = !w;
    return `<div class="list-row" ${ended?'style="opacity:.6;"':''}>
      <div class="lr-ic" style="background:${cat.color}22;">${cat.icon}</div>
      <div class="lr-mid">
        <div class="lr-title">${esc(r.name)} <span class="${r.type==='income'?'c-income':'c-expense'}">${r.type==='income'?'+':'-'}${fmtW(r.amount,w)}</span>
          ${ended?'<span class="pill pill-done">Đã kết thúc</span>':''}</div>
        <div class="lr-sub">Mỗi ${every} · ${w?esc(w.name):'<span class="c-expense font-bold">⚠ Ví không tồn tại</span>'}${sub?' · '+esc(sub.name):''}</div>
        <div class="lr-sub ${(due.overdue && !ended)?'up-overdue':''}">${ended?'Kết thúc '+fmtDate(r.endDate):due.text+' ('+fmtDate(r.dueDate)+')'+(r.endDate?' · đến '+fmtDate(r.endDate):'')}</div>
      </div>
      <div class="lr-actions" style="flex-direction:column;">
        <label class="switch" title="Tự động"><input type="checkbox" ${r.autoProcess?'checked':''} ${ended||broken?'disabled':''} onchange="toggleRecurAuto('${r.id}',this.checked)"><span class="slider"></span></label>
        <div class="row gap6">
          ${ended||broken?'':`<button class="btn-pay" title="Ghi nhận ngay" onclick="payRecurring('${r.id}')">✓</button>`}
          <button class="icon-btn" style="width:30px;height:30px;font-size:.8rem;" onclick="openRecurringModal('${r.id}')">✎</button>
          <button class="icon-btn" style="width:30px;height:30px;font-size:.8rem;" onclick="deleteRecurring('${r.id}')">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function setRecurType(type){
  mrType = type;
  document.getElementById('mr-type-expense').classList.toggle('active', type==='expense');
  document.getElementById('mr-type-income').classList.toggle('active', type==='income');
  mrSelectedCatId = null; mrSelectedSubId = null;
  renderRecurCatChips();
}
function openRecurringModal(recurId){
  const wallets = getUserWallets();
  if(!wallets.length) return toast('Bạn cần tạo ít nhất 1 ví trước','err');
  document.getElementById('mr-wallet').innerHTML = wallets.map(w=>`<option value="${w.id}">${w.icon} ${esc(w.name)}</option>`).join('');
  const r = recurId ? state.recurring.find(x=>x.id===recurId) : null;
  document.getElementById('mr-recur-id').value = r ? r.id : '';
  document.getElementById('modal-recurring-title').textContent = r ? 'Sửa khoản định kỳ' : 'Thêm giao dịch định kỳ';
  if(r){
    mrType = r.type || 'expense';
    document.getElementById('mr-name').value = r.name;
    document.getElementById('mr-amount').value = r.amount;
    /* the referenced wallet may have been deleted — fall back so we never save an empty id */
    if(getWallet(r.walletId)) document.getElementById('mr-wallet').value = r.walletId;
    else { document.getElementById('mr-wallet').value = wallets[0].id; toast('Ví cũ không còn, đã chọn ví khác','err'); }
    document.getElementById('mr-duedate').value = r.dueDate;
    document.getElementById('mr-enddate').value = r.endDate||'';
    document.getElementById('mr-interval').value = r.interval||1;
    document.getElementById('mr-auto').checked = !!r.autoProcess;
    mrSelectedCatId = r.categoryId; mrSelectedSubId = r.subcategoryId; mrSelectedFreq = r.frequency;
  } else {
    mrType = 'expense';
    ['mr-name','mr-amount','mr-enddate'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('mr-wallet').value = wallets[0].id;
    document.getElementById('mr-duedate').value = todayISO();
    document.getElementById('mr-interval').value = 1;
    document.getElementById('mr-auto').checked = false;
    mrSelectedCatId = null; mrSelectedSubId = null; mrSelectedFreq = 'monthly';
  }
  document.getElementById('mr-type-expense').classList.toggle('active', mrType==='expense');
  document.getElementById('mr-type-income').classList.toggle('active', mrType==='income');
  document.querySelectorAll('#mr-freq-chips .chip').forEach(c=>c.classList.toggle('active', c.dataset.val===mrSelectedFreq));
  updateIntervalUnit();
  renderRecurCatChips();
  openModal('modal-recurring');
}
function renderRecurCatChips(){
  const cats = getCats(mrType==='income'?'income':'expense');
  if(!mrSelectedCatId || !cats.find(c=>c.id===mrSelectedCatId)) mrSelectedCatId = cats.length ? cats[0].id : null;
  document.getElementById('mr-cat-chips').innerHTML = cats.map(c=>
    `<div class="chip ${c.id===mrSelectedCatId?'active':''}" onclick="selectRecurCat('${c.id}')">${c.icon} ${esc(c.name)}</div>`).join('');
  const cat = cats.find(c=>c.id===mrSelectedCatId);
  const subGroup = document.getElementById('mr-sub-group');
  if(cat && cat.subs && cat.subs.length){
    subGroup.classList.remove('hidden');
    if(!mrSelectedSubId || !cat.subs.find(s=>s.id===mrSelectedSubId)) mrSelectedSubId = cat.subs[0].id;
    document.getElementById('mr-sub-chips').innerHTML = cat.subs.map(s=>
      `<div class="chip ${s.id===mrSelectedSubId?'active':''}" onclick="selectRecurSub('${s.id}')">${esc(s.name)}</div>`).join('');
  } else { subGroup.classList.add('hidden'); mrSelectedSubId = null; }
}
function selectRecurCat(id){ mrSelectedCatId = id; mrSelectedSubId = null; renderRecurCatChips(); }
function selectRecurSub(id){ mrSelectedSubId = id; renderRecurCatChips(); }
function selectRecurFreq(val, el){
  mrSelectedFreq = val;
  el.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  updateIntervalUnit();
}
/* "Lặp mỗi [2] tuần" — keeps the interval box unambiguous */
function updateIntervalUnit(){
  const el = document.getElementById('mr-interval-unit');
  if(el) el.textContent = FREQ_LABEL[mrSelectedFreq] || 'tháng';
}
function saveRecurringModal(){
  const id = document.getElementById('mr-recur-id').value;
  const name = document.getElementById('mr-name').value.trim();
  const amount = Number(document.getElementById('mr-amount').value)||0;
  const walletId = document.getElementById('mr-wallet').value;
  const dueDate = document.getElementById('mr-duedate').value;
  const endDate = document.getElementById('mr-enddate').value || '';
  const interval = Math.max(1, Number(document.getElementById('mr-interval').value)||1);
  const autoProcess = document.getElementById('mr-auto').checked;
  if(!name) return toast('Nhập tên khoản','err');
  if(amount<=0) return toast('Nhập số tiền hợp lệ','err');
  if(!walletId || !getWallet(walletId)) return toast('Chọn ví hợp lệ','err');
  if(!mrSelectedCatId) return toast('Chọn danh mục','err');
  if(!dueDate) return toast('Chọn ngày đến hạn','err');
  if(endDate && endDate < dueDate) return toast('Ngày kết thúc phải sau ngày đến hạn kế tiếp','err');

  const payload = {name, type:mrType, amount, walletId, categoryId:mrSelectedCatId, subcategoryId:mrSelectedSubId,
    frequency:mrSelectedFreq, interval, dueDate, endDate, autoProcess};
  if(id){
    const r = state.recurring.find(x=>x.id===id);
    if(r) Object.assign(r, payload);
  } else {
    state.recurring.push({id:uid('r'), userId:state.currentUser, ...payload});
  }
  saveStorage();
  if(autoProcess) autoProcessRecurring();
  closeModal('modal-recurring');
  toast('Đã lưu khoản định kỳ','ok');
  renderRecurringView();
}
function deleteRecurring(id){
  uiConfirm('Xóa khoản định kỳ','Các giao dịch đã ghi nhận trước đó vẫn được giữ nguyên. Tiếp tục?','Xóa').then(ok=>{
    if(!ok) return;
    state.recurring = state.recurring.filter(x=>x.id!==id);
    saveStorage(); toast('Đã xóa','ok'); renderRecurringView();
  });
}

/* ---------- UPCOMING (dashboard) ---------- */
function setUpcomingFilter(val, el){
  upcomingFilter = val;
  el.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  renderUpcomingCard();
}
function getUpcomingRange(){
  const today = todayISO(), d = parseISO(today);
  if(upcomingFilter==='nextweek') return addDaysISO(today,7);
  if(upcomingFilter==='nextmonth') return isoOf(new Date(d.getFullYear(), d.getMonth()+2, 0));
  return isoOf(new Date(d.getFullYear(), d.getMonth()+1, 0));
}
function getUpcomingItems(rangeEnd){
  const recurItems = getUserRecurring()
    .filter(r=> r.type!=='income' && r.dueDate <= rangeEnd && (!r.endDate || r.dueDate <= r.endDate))
    .map(r=>({kind:'recurring', id:r.id, name:r.name, amount:toMain(r.amount,(getWallet(r.walletId)||{}).currency), dueDate:r.dueDate, walletId:r.walletId}));
  const cardItems = getUserWallets()
    .filter(w=> isCreditCard(w) && getCardUsedAmount(w) > 0)
    .map(w=>({kind:'card', id:w.id, name:w.name+' (Thẻ tín dụng)', amount:toMain(getCardUsedAmount(w), w.currency), dueDate:getCardNextDueDate(w), walletId:w.id}))
    .filter(it=> it.dueDate <= rangeEnd);
  const debtItems = getUserDebts()
    .filter(d=> d.kind==='borrow' && debtRemaining(d)>0 && d.dueDate && d.dueDate <= rangeEnd)
    .map(d=>({kind:'debt', id:d.id, name:'Trả nợ '+d.party, amount:toMain(debtRemaining(d), debtCurrency(d)), dueDate:d.dueDate, walletId:d.walletId}));
  return [...recurItems, ...cardItems, ...debtItems].sort((a,b)=> a.dueDate<b.dueDate?-1:1);
}
function renderUpcomingCard(){
  const items = getUpcomingItems(getUpcomingRange());
  document.getElementById('upcoming-total').textContent = fmt(items.reduce((s,it)=>s+it.amount,0));
  const listEl = document.getElementById('upcoming-list');
  if(!items.length){
    listEl.innerHTML = `<p class="text-xs muted text-center" style="padding:10px 0;">Không có khoản nào sắp đến hạn 🎉</p>`;
    return;
  }
  const today = todayISO();
  listEl.innerHTML = items.map(it=>{
    const wallet = getWallet(it.walletId);
    const overdue = it.dueDate < today;
    const icons = {card:'💳', debt:'🤝', recurring:'⏰'};
    const actions = {card:`openCardPaymentModal('${it.id}')`, debt:`openDebtPayModal('${it.id}')`, recurring:`payRecurring('${it.id}')`};
    return `<div class="upcoming-row">
      <div class="up-ic ${it.kind==='card'?'up-ic-card':''}">${icons[it.kind]}</div>
      <div class="up-mid">
        <div class="up-title">${esc(it.name)}</div>
        <div class="up-sub ${overdue?'up-overdue':''}">${(it.kind==='recurring'&&wallet)?esc(wallet.name)+' · ':''}${relDueLabel(it.dueDate).text}</div>
      </div>
      <div class="up-amt tabular">${fmt(it.amount)}</div>
      <button class="btn-pay" title="Đã thanh toán" onclick="${actions[it.kind]}">✓</button>
    </div>`;
  }).join('');
}

/* ============================================================
   EVENTS / TRIPS
   ============================================================ */
function eventTotals(ev){
  const txs = getUserTransactions().filter(t=>t.eventId===ev.id);
  let spent=0, income=0;
  txs.forEach(t=>{ if(t.type==='expense') spent+=txMain(t); else if(t.type==='income') income+=txMain(t); });
  return {spent, income, count:txs.length, txs};
}
function renderEventsView(){
  const events = getUserEvents();
  const el = document.getElementById('events-list');
  if(!events.length){
    el.innerHTML = `<div class="empty-state"><div class="ic">✈️</div><div class="text-sm">Chưa có sự kiện nào</div><div class="es-sub">Gom nhóm chi tiêu cho chuyến du lịch, đám cưới, sinh nhật...</div></div>`;
    return;
  }
  const today = todayISO();
  el.innerHTML = events.sort((a,b)=>(b.startDate||'')>(a.startDate||'')?1:-1).map(ev=>{
    const t = eventTotals(ev);
    const pct = ev.budget ? Math.round(t.spent/ev.budget*100) : 0;
    const active = (!ev.startDate || ev.startDate<=today) && (!ev.endDate || ev.endDate>=today);
    return `<div class="card" onclick="openEventDetail('${ev.id}')" style="cursor:pointer;">
      <div class="row-c gap10 mb8">
        <div class="w-avatar" style="background:var(--primary-light);">${ev.icon}</div>
        <div class="flex1">
          <div class="between">
            <span class="font-bold text-sm">${esc(ev.name)}</span>
            ${active?'<span class="pill pill-open">Đang diễn ra</span>':''}
          </div>
          <div class="text-xs muted">${ev.startDate?fmtDate(ev.startDate):'?'} → ${ev.endDate?fmtDate(ev.endDate):'?'} · ${t.count} giao dịch</div>
        </div>
      </div>
      <div class="between">
        <span class="text-xs muted">Đã chi</span>
        <span class="font-x c-expense tabular">${fmt(t.spent)}</span>
      </div>
      ${ev.budget?`<div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,pct)}%;background:${budgetColor(pct)};"></div></div>
        <div class="between mt4"><span class="text-xs muted">Ngân sách ${fmt(ev.budget)}</span><span class="text-xs font-bold" style="color:${budgetColor(pct)};">${pct}%</span></div>`:''}
      <div class="row gap6 mt8" onclick="event.stopPropagation();">
        <button class="btn btn-secondary btn-xs" onclick="openEventModal('${ev.id}')">Sửa</button>
        <button class="btn btn-danger btn-xs" onclick="deleteEvent('${ev.id}')">Xóa</button>
      </div>
    </div>`;
  }).join('');
}
function openEventDetail(id){
  const ev = getUserEvents().find(e=>e.id===id);
  if(!ev) return;
  const t = eventTotals(ev);
  const byCat = {};
  t.txs.filter(x=>x.type==='expense').forEach(x=>{ byCat[x.categoryId] = (byCat[x.categoryId]||0)+txMain(x); });
  const catRows = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([cid,val])=>{
    const c = findCategory('expense',cid) || {name:'Khác',icon:'📦',color:'#94A3B8'};
    const pct = t.spent ? Math.round(val/t.spent*100) : 0;
    return `<div class="row-c gap10 mb8">
      <div class="cat-circle" style="width:30px;height:30px;font-size:.85rem;background:${c.color}22;">${c.icon}</div>
      <div class="flex1"><div class="between"><span class="text-xs font-sb">${esc(c.name)}</span><span class="text-xs font-bold tabular">${fmt(val)} · ${pct}%</span></div>
      <div class="progress-track" style="height:6px;"><div class="progress-fill" style="width:${pct}%;background:${c.color};"></div></div></div>
    </div>`;
  }).join('') || '<p class="text-xs muted">Chưa có chi tiêu nào</p>';

  document.getElementById('event-detail-content').innerHTML = `
    <div class="text-center mb12">
      <div class="cat-circle" style="width:56px;height:56px;font-size:1.6rem;background:var(--primary-light);margin:0 auto 8px;">${ev.icon}</div>
      <h3>${esc(ev.name)}</h3>
      <p class="text-xs muted mt4">${ev.startDate?fmtDate(ev.startDate):'?'} → ${ev.endDate?fmtDate(ev.endDate):'?'}</p>
    </div>
    <div class="stat-grid mb12">
      <div class="stat-box"><div class="sb-lbl">Tổng chi</div><div class="sb-val c-expense tabular">${fmt(t.spent)}</div></div>
      <div class="stat-box"><div class="sb-lbl">Tổng thu</div><div class="sb-val c-income tabular">${fmt(t.income)}</div></div>
    </div>
    ${ev.budget?`<div class="card flat"><div class="between mb4"><span class="text-xs muted">Ngân sách</span><span class="text-xs font-bold">${fmt(ev.budget)}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,ev.budget?Math.round(t.spent/ev.budget*100):0)}%;background:${budgetColor(ev.budget?t.spent/ev.budget*100:0)};"></div></div>
      <div class="text-xs muted mt4">${t.spent<=ev.budget?'Còn lại '+fmt(ev.budget-t.spent):'Vượt '+fmt(t.spent-ev.budget)}</div></div>`:''}
    <div class="section-title"><h4>Theo danh mục</h4></div>
    <div class="card flat">${catRows}</div>
    <div class="section-title"><h4>Giao dịch (${t.count})</h4></div>
    ${renderTxRows(t.txs.sort(sortTxDesc))}`;
  openModal('modal-event-detail');
}
function openEventModal(id){
  const ev = id ? getUserEvents().find(e=>e.id===id) : null;
  document.getElementById('me-event-id').value = ev ? ev.id : '';
  document.getElementById('modal-event-title').textContent = ev ? 'Sửa sự kiện' : 'Tạo sự kiện';
  meIcon = ev ? ev.icon : '✈️';
  document.getElementById('me-name').value = ev ? ev.name : '';
  document.getElementById('me-start').value = ev ? (ev.startDate||'') : todayISO();
  document.getElementById('me-end').value = ev ? (ev.endDate||'') : '';
  document.getElementById('me-budget').value = ev && ev.budget ? ev.budget : '';
  buildEmojiPicker('me-icon-picker', meIcon, e=>{ meIcon = e; });
  openModal('modal-event');
}
function saveEventModal(){
  const id = document.getElementById('me-event-id').value;
  const name = document.getElementById('me-name').value.trim();
  const startDate = document.getElementById('me-start').value;
  const endDate = document.getElementById('me-end').value;
  const budget = Number(document.getElementById('me-budget').value)||0;
  if(!name) return toast('Nhập tên sự kiện','err');
  if(startDate && endDate && endDate < startDate) return toast('Ngày kết thúc phải sau ngày bắt đầu','err');
  if(id){
    const ev = state.events.find(e=>e.id===id);
    if(ev) Object.assign(ev, {name, icon:meIcon, startDate, endDate, budget});
  } else {
    state.events.push({id:uid('e'), userId:state.currentUser, name, icon:meIcon, startDate, endDate, budget});
  }
  saveStorage();
  closeModal('modal-event');
  toast('Đã lưu sự kiện','ok');
  renderEventsView();
}
function deleteEvent(id){
  const count = getUserTransactions().filter(t=>t.eventId===id).length;
  uiConfirm('Xóa sự kiện', count?`${count} giao dịch sẽ được gỡ khỏi sự kiện này (giao dịch vẫn được giữ). Tiếp tục?`:'Xóa sự kiện này?','Xóa').then(ok=>{
    if(!ok) return;
    state.events = state.events.filter(e=>e.id!==id);
    state.transactions.forEach(t=>{ if(t.eventId===id) delete t.eventId; });
    saveStorage(); toast('Đã xóa sự kiện','ok'); renderEventsView();
  });
}

/* ============================================================
   CATEGORY MANAGEMENT
   ============================================================ */
function setCatManageType(type, el){
  catManageType = type;
  el.parentNode.querySelectorAll('.seg').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  renderCategoriesView();
}
function renderCategoriesView(){
  const cats = getCats(catManageType);
  const usage = {};
  getUserTransactions().forEach(t=>{ usage[t.categoryId] = (usage[t.categoryId]||0)+1; });
  document.getElementById('categories-list').innerHTML = cats.map(c=>`
    <div class="list-row">
      <div class="lr-ic" style="background:${c.color}22;">${c.icon}</div>
      <div class="lr-mid">
        <div class="lr-title">${esc(c.name)} ${c.system?'<span class="tag">Hệ thống</span>':''}</div>
        <div class="lr-sub">${(c.subs||[]).length} danh mục con · ${usage[c.id]||0} giao dịch</div>
        ${(c.subs||[]).length?`<div class="lr-sub truncate">${c.subs.map(s=>esc(s.name)).join(' · ')}</div>`:''}
      </div>
      <div class="lr-actions">
        <button class="icon-btn" style="width:32px;height:32px;font-size:.8rem;" onclick="openCategoryModal('${c.id}')">✎</button>
        <button class="icon-btn" style="width:32px;height:32px;font-size:.8rem;" onclick="deleteCategory('${c.id}')">🗑</button>
      </div>
    </div>`).join('');
}
function setMcType(type, el){
  mcType = type;
  if(el){ el.parentNode.querySelectorAll('.seg').forEach(s=>s.classList.remove('active')); el.classList.add('active'); }
}
function openCategoryModal(catId, presetType){
  const type = catId ? (findCategory('expense',catId) ? 'expense' : 'income') : (presetType || catManageType);
  mcType = type;
  document.querySelectorAll('#mc-type-seg .seg').forEach((s,i)=>s.classList.toggle('active', ['expense','income'][i]===type));
  const c = catId ? findCategory(type, catId) : null;
  document.getElementById('mc-cat-id').value = c ? c.id : '';
  document.getElementById('modal-category-title').textContent = c ? 'Sửa danh mục' : 'Thêm danh mục';
  document.getElementById('mc-name').value = c ? c.name : '';
  mcIcon = c ? c.icon : '⭐';
  mcColor = c ? c.color : CATEGORY_COLORS[Math.floor(Math.random()*CATEGORY_COLORS.length)];
  mcSubs = c ? JSON.parse(JSON.stringify(c.subs||[])) : [];
  document.querySelectorAll('#mc-type-seg .seg').forEach(s=>s.style.pointerEvents = c ? 'none' : 'auto');
  buildEmojiPicker('mc-icon-picker', mcIcon, e=>{ mcIcon = e; });
  buildColorPicker('mc-color-picker', mcColor, col=>{ mcColor = col; });
  renderMcSubs();
  openModal('modal-category');
}
function renderMcSubs(){
  document.getElementById('mc-subs-list').innerHTML = mcSubs.length
    ? mcSubs.map((s,i)=>`<span class="subcat-chip">${esc(s.name)}<span class="x" onclick="removeMcSub(${i})">✕</span></span>`).join('')
    : '<span class="text-xs muted">Chưa có danh mục con</span>';
}
function addMcSub(){
  const input = document.getElementById('mc-sub-name');
  const name = input.value.trim();
  if(!name) return;
  if(mcSubs.some(s=>s.name.toLowerCase()===name.toLowerCase())) return toast('Danh mục con đã tồn tại','err');
  mcSubs.push({id:uid('s'), name});
  input.value=''; renderMcSubs();
}
function removeMcSub(i){ mcSubs.splice(i,1); renderMcSubs(); }
function saveCategoryModal(){
  const id = document.getElementById('mc-cat-id').value;
  const name = document.getElementById('mc-name').value.trim();
  if(!name) return toast('Nhập tên danh mục','err');
  ensureUserCategories(state.currentUser);
  const list = state.categories[state.currentUser][mcType];
  if(id){
    const c = list.find(x=>x.id===id);
    if(c) Object.assign(c, {name, icon:mcIcon, color:mcColor, subs:mcSubs});
  } else {
    if(list.some(c=>c.name.toLowerCase()===name.toLowerCase())) return toast('Danh mục đã tồn tại','err');
    const newCat = {id:uid('cat'), name, icon:mcIcon, color:mcColor, subs:mcSubs};
    list.push(newCat);
    if(currentTab==='add'){ txSelectedCatId = newCat.id; txSelectedSubId = null; }
  }
  saveStorage();
  closeModal('modal-category');
  toast('Đã lưu danh mục','ok');
  renderAll();
}
function deleteCategory(catId){
  const c = findCategory(catManageType, catId);
  if(!c) return;
  if(c.system) return toast('Không thể xóa danh mục hệ thống','err');
  const used = getUserTransactions().filter(t=>t.categoryId===catId);
  const fallbackId = catManageType==='expense' ? 'c_other_exp' : 'c_other_inc';
  const msg = used.length
    ? `${used.length} giao dịch đang dùng danh mục này sẽ được chuyển sang "Khác". Tiếp tục?`
    : 'Xóa danh mục này?';
  uiConfirm('Xóa danh mục', msg, 'Xóa').then(ok=>{
    if(!ok) return;
    used.forEach(t=>{ t.categoryId = fallbackId; t.subcategoryId = null; });
    state.budgets = state.budgets.filter(b=>b.categoryId!==catId);
    state.recurring.forEach(r=>{ if(r.categoryId===catId){ r.categoryId = fallbackId; r.subcategoryId = null; } });
    state.categories[state.currentUser][catManageType] =
      state.categories[state.currentUser][catManageType].filter(x=>x.id!==catId);
    saveStorage(); toast('Đã xóa danh mục','ok'); renderCategoriesView();
  });
}
/* ============================================================
   REPORTS
   ============================================================ */
function setReportPeriod(p, el){
  reportPeriodType = p; reportOffset = 0;
  el.parentNode.querySelectorAll('.seg').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  renderReportsView();
}
function shiftReportPeriod(delta){ reportOffset += delta; renderReportsView(); }
function setDonutMode(mode, el){
  donutMode = mode;
  el.parentNode.querySelectorAll('.seg').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  renderReportsView();
}
/* Range for the report period, shifted by `extra` periods relative to the current view */
function reportRange(extra){
  const off = reportOffset + (extra||0);
  const now = new Date();
  let start, end, label;
  if(reportPeriodType==='month'){
    start = new Date(now.getFullYear(), now.getMonth()+off, 1);
    end   = new Date(start.getFullYear(), start.getMonth()+1, 0);
    label = `Tháng ${start.getMonth()+1}/${start.getFullYear()}`;
  } else if(reportPeriodType==='quarter'){
    const qStartMonth = Math.floor(now.getMonth()/3)*3 + off*3;
    start = new Date(now.getFullYear(), qStartMonth, 1);
    end   = new Date(start.getFullYear(), start.getMonth()+3, 0);
    label = `Quý ${Math.floor(start.getMonth()/3)+1}/${start.getFullYear()}`;
  } else {
    start = new Date(now.getFullYear()+off, 0, 1);
    end   = new Date(start.getFullYear(), 12, 0);
    label = `Năm ${start.getFullYear()}`;
  }
  return {start:isoOf(start), end:isoOf(end), label, shortLabel: reportPeriodType==='month'
    ? `${start.getMonth()+1}/${String(start.getFullYear()).slice(2)}`
    : reportPeriodType==='quarter' ? `Q${Math.floor(start.getMonth()/3)+1}/${String(start.getFullYear()).slice(2)}`
    : String(start.getFullYear())};
}
/* Wallets currently in scope for the report — one wallet, or every wallet that counts
   toward net worth. Returned as a Set of ids for cheap lookups in the chart loops. */
function reportWalletScope(){
  if(reportWalletId!=='all' && getWallet(reportWalletId)) return new Set([reportWalletId]);
  return new Set(getUserWallets().filter(w=>!w.excludeFromTotal).map(w=>w.id));
}
function inReportScope(t){ return reportWalletId==='all' || t.walletId===reportWalletId; }
function txInRange(r){ return getUserTransactions().filter(t=>t.date>=r.start && t.date<=r.end && inReportScope(t)); }
function setReportWallet(id){
  reportWalletId = id;
  renderReportsView();
}
/* Dashboard wallet card → report scoped to that wallet */
function openWalletReport(walletId){
  reportWalletId = walletId;
  reportPeriodType = 'month'; reportOffset = 0;
  switchTab('reports');
  document.querySelectorAll('#report-period-seg .seg').forEach((s,i)=>s.classList.toggle('active', i===0));
}

function renderReportsView(){
  if(reportWalletId!=='all' && !getWallet(reportWalletId)) reportWalletId = 'all';
  document.getElementById('report-wallet-filter').innerHTML =
    `<div class="chip ${reportWalletId==='all'?'active':''}" onclick="setReportWallet('all')">📚 Tất cả ví</div>` +
    getUserWallets().map(w=>
      `<div class="chip ${reportWalletId===w.id?'active':''}" onclick="setReportWallet('${w.id}')">${w.icon} ${esc(w.name)}</div>`).join('');

  const r = reportRange(0);
  document.getElementById('report-period-label').textContent = r.label;
  const txs = txInRange(r);
  let inc=0, exp=0;
  const catTotals = {expense:{}, income:{}};
  txs.forEach(t=>{
    const v = txMain(t);
    if(t.type==='income'){ inc+=v; catTotals.income[t.categoryId] = (catTotals.income[t.categoryId]||0)+v; }
    else if(t.type==='expense'){ exp+=v; catTotals.expense[t.categoryId] = (catTotals.expense[t.categoryId]||0)+v; }
  });
  document.getElementById('rep-income').textContent = fmt(inc);
  document.getElementById('rep-expense').textContent = fmt(exp);
  const net = inc-exp, netEl = document.getElementById('rep-net');
  netEl.textContent = (net>=0?'+':'') + fmt(net);
  netEl.className = 'font-bold tabular ' + (net>=0?'c-income':'c-expense');

  /* donut */
  const mode = donutMode, total = mode==='expense' ? exp : inc;
  const entries = Object.entries(catTotals[mode]).sort((a,b)=>b[1]-a[1]);
  const data = entries.map(([cid,val])=>{
    const c = findCategory(mode, cid) || {name:'Khác', color:'#94A3B8', icon:'📦'};
    return {label:c.name, value:val, color:c.color, icon:c.icon};
  });
  drawDonut('chart-donut', data, total, mode==='expense'?'Tổng chi':'Tổng thu');
  document.getElementById('donut-legend').innerHTML = data.slice(0,8).map(d=>
    `<div class="legend-item"><span class="legend-dot" style="background:${d.color};"></span>${esc(d.label)} ${total?Math.round(d.value/total*100):0}%</div>`).join('');

  /* category detail list */
  const catListEl = document.getElementById('rep-cat-list');
  catListEl.innerHTML = entries.length ? entries.map(([cid,val])=>{
    const c = findCategory(mode,cid) || {name:'Khác',icon:'📦',color:'#94A3B8'};
    const pct = total ? Math.round(val/total*100) : 0;
    const count = txs.filter(t=>t.categoryId===cid && t.type===mode).length;
    return `<div class="row-c gap10 mb12" onclick="jumpToCategory('${cid}')" style="cursor:pointer;">
      <div class="cat-circle" style="width:34px;height:34px;font-size:1rem;background:${c.color}22;">${c.icon}</div>
      <div class="flex1">
        <div class="between"><span class="text-sm font-sb">${esc(c.name)}</span><span class="text-sm font-bold tabular">${fmt(val)}</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${c.color};"></div></div>
        <div class="between mt4"><span class="text-xs muted">${count} giao dịch</span><span class="text-xs muted">${pct}%</span></div>
      </div>
    </div>`;
  }).join('') : `<p class="text-sm muted text-center">Không có dữ liệu trong kỳ này</p>`;

  /* 6-period bar + line */
  const series = [];
  for(let i=5;i>=0;i--){
    const rr = reportRange(-i);
    let ri=0, re=0;
    getUserTransactions().forEach(t=>{
      if(t.date<rr.start || t.date>rr.end || !inReportScope(t)) return;
      if(t.type==='income') ri += txMain(t);
      else if(t.type==='expense') re += txMain(t);
    });
    series.push({label:rr.shortLabel, inc:ri, exp:re, end:rr.end});
  }
  drawBars('chart-bar', series);

  /* cumulative balance at the end of each period — whole portfolio, or the picked wallet */
  const scope = reportWalletScope();
  const openingBalance = getUserWallets().filter(w=>scope.has(w.id))
    .reduce((s,w)=>s+toMain(w.startingBalance||0, w.currency),0);
  const linePoints = series.map(s=>{
    let cum = openingBalance;
    getUserTransactions().forEach(t=>{
      if(t.date > s.end || !scope.has(t.walletId)) return;
      const v = txMain(t);
      if(t.type==='income'||t.type==='transfer_in') cum += v;
      else if(t.type==='expense'||t.type==='transfer_out') cum -= v;
    });
    return {label:s.label, value:cum};
  });
  drawLine('chart-line', linePoints);

  /* per-wallet spending */
  const walletTotals = {};
  txs.filter(t=>t.type==='expense').forEach(t=>{ walletTotals[t.walletId] = (walletTotals[t.walletId]||0)+txMain(t); });
  const wEntries = Object.entries(walletTotals).sort((a,b)=>b[1]-a[1]);
  document.getElementById('rep-wallet-list').innerHTML = wEntries.length ? wEntries.map(([wid,val])=>{
    const w = getWallet(wid) || {name:'Ví đã xóa', icon:'❓'};
    const pct = exp ? Math.round(val/exp*100) : 0;
    return `<div class="row-c gap10 mb12">
      <div class="cat-circle" style="width:34px;height:34px;font-size:1rem;background:var(--primary-light);">${w.icon}</div>
      <div class="flex1">
        <div class="between"><span class="text-sm font-sb">${esc(w.name)}</span><span class="text-sm font-bold tabular">${fmt(val)}</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:var(--primary);"></div></div>
      </div>
      <span class="text-xs muted" style="width:32px;text-align:right;">${pct}%</span>
    </div>`;
  }).join('') : `<p class="text-sm muted text-center">Không có chi tiêu trong kỳ này</p>`;
}
function jumpToCategory(catId){
  txFilters = {type:'all', walletId:'all', catId, eventId:'all', range:'all'};
  switchTab('transactions');
  document.getElementById('tx-advanced-filters').classList.remove('hidden');
  document.getElementById('tx-filter-cat').value = catId;
  renderTransactionsList();
}

/* ---------- CANVAS CHART HELPERS ---------- */
function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function setupCanvas(id){
  const canvas = document.getElementById(id);
  if(!canvas || !canvas.getContext) return null;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.parentNode.clientWidth || 300;
  const cssH = Number(canvas.getAttribute('height')) || 200;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  canvas.style.width = cssW+'px'; canvas.style.height = cssH+'px';
  const ctx = canvas.getContext('2d');
  if(!ctx) return null;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);
  return {ctx, w:cssW, h:cssH};
}
function drawDonut(id, data, total, centerLabel){
  const c = setupCanvas(id); if(!c) return;
  const {ctx,w,h} = c;
  const cx = w/2, cy = h/2, rOuter = Math.min(w,h)/2 - 8, rInner = rOuter*0.62;
  const cardBg = cssVar('--card') || '#fff';
  if(!total || !data.length){
    ctx.beginPath(); ctx.arc(cx,cy,rOuter,0,2*Math.PI); ctx.fillStyle = cssVar('--card-2'); ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,rInner,0,2*Math.PI); ctx.fillStyle = cardBg; ctx.fill();
    ctx.fillStyle = cssVar('--muted'); ctx.font='13px sans-serif'; ctx.textAlign='center';
    ctx.fillText('Không có dữ liệu', cx, cy+5);
    return;
  }
  let start = -Math.PI/2;
  data.forEach(d=>{
    const angle = (d.value/total)*2*Math.PI;
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,rOuter,start,start+angle); ctx.closePath();
    ctx.fillStyle = d.color; ctx.fill();
    ctx.strokeStyle = cardBg; ctx.lineWidth = 2; ctx.stroke();
    start += angle;
  });
  ctx.beginPath(); ctx.arc(cx,cy,rInner,0,2*Math.PI); ctx.fillStyle = cardBg; ctx.fill();
  ctx.fillStyle = cssVar('--text'); ctx.font='bold 15px sans-serif'; ctx.textAlign='center';
  ctx.fillText(fmt(total), cx, cy+4);
  ctx.fillStyle = cssVar('--muted'); ctx.font='11px sans-serif';
  ctx.fillText(centerLabel||'Tổng', cx, cy+21);
}
function roundRect(ctx,x,y,w,h,r){
  if(h<=0) h = 0.01;
  r = Math.min(r, w/2, Math.max(h/2,0.01));
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function shortMoney(v){
  const a = Math.abs(v);
  if(a >= 1e9) return (v/1e9).toFixed(1).replace('.0','')+'B';
  if(a >= 1e6) return (v/1e6).toFixed(1).replace('.0','')+'M';
  if(a >= 1e3) return (v/1e3).toFixed(0)+'K';
  return String(Math.round(v));
}
function drawBars(id, series){
  const c = setupCanvas(id); if(!c) return;
  const {ctx,w,h} = c;
  const padL = 40, padR = 8, padB = 22, padT = 10;
  const chartW = w - padL - padR, chartH = h - padB - padT;
  const maxVal = Math.max(1, ...series.map(s=>Math.max(s.inc, s.exp)));
  ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
  ctx.fillStyle = cssVar('--muted'); ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
  for(let i=0;i<=3;i++){
    const y = padT + chartH - (chartH*i/3);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w-padR, y); ctx.stroke();
    ctx.fillText(shortMoney(maxVal*i/3), padL-5, y+3);
  }
  const groupW = chartW/series.length;
  series.forEach((s,i)=>{
    const gx = padL + i*groupW, barW = Math.min(16, groupW*0.28);
    const incH = (s.inc/maxVal)*chartH, expH = (s.exp/maxVal)*chartH;
    ctx.fillStyle = '#16A34A'; roundRect(ctx, gx+groupW/2-barW-3, padT+chartH-incH, barW, incH, 3); ctx.fill();
    ctx.fillStyle = '#E11D48'; roundRect(ctx, gx+groupW/2+3, padT+chartH-expH, barW, expH, 3); ctx.fill();
    ctx.fillStyle = cssVar('--muted'); ctx.font='9px sans-serif'; ctx.textAlign='center';
    ctx.fillText(s.label, gx+groupW/2, h-7);
  });
}
function drawLine(id, points){
  const c = setupCanvas(id); if(!c) return;
  const {ctx,w,h} = c;
  const padL = 44, padR = 10, padB = 22, padT = 12;
  const chartW = w - padL - padR, chartH = h - padB - padT;
  const vals = points.map(p=>p.value);
  const maxV = Math.max(...vals, 0), minV = Math.min(...vals, 0);
  const span = (maxV - minV) || 1;
  const x = i => padL + (points.length>1 ? chartW*i/(points.length-1) : chartW/2);
  const y = v => padT + chartH - ((v-minV)/span)*chartH;

  ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
  ctx.fillStyle = cssVar('--muted'); ctx.font='9px sans-serif'; ctx.textAlign='right';
  for(let i=0;i<=3;i++){
    const yy = padT + chartH - chartH*i/3;
    ctx.beginPath(); ctx.moveTo(padL,yy); ctx.lineTo(w-padR,yy); ctx.stroke();
    ctx.fillText(shortMoney(minV + span*i/3), padL-5, yy+3);
  }
  const primary = cssVar('--primary') || '#0D9488';
  const grad = ctx.createLinearGradient(0,padT,0,padT+chartH);
  grad.addColorStop(0, primary+'55'); grad.addColorStop(1, primary+'00');
  ctx.beginPath();
  points.forEach((p,i)=> i===0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value)));
  ctx.lineTo(x(points.length-1), padT+chartH); ctx.lineTo(x(0), padT+chartH); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  points.forEach((p,i)=> i===0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value)));
  ctx.strokeStyle = primary; ctx.lineWidth = 2.5; ctx.lineJoin='round'; ctx.stroke();

  points.forEach((p,i)=>{
    ctx.beginPath(); ctx.arc(x(i), y(p.value), 3.5, 0, 2*Math.PI);
    ctx.fillStyle = cssVar('--card'); ctx.fill();
    ctx.strokeStyle = primary; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = cssVar('--muted'); ctx.font='9px sans-serif'; ctx.textAlign='center';
    ctx.fillText(p.label, x(i), h-7);
  });
}

/* ============================================================
   FEATURE TILES — shared by Dashboard "Truy cập nhanh" and the More menu
   ============================================================ */
const FEATURE_TILES = [
  {tab:'transactions', icon:'📋', name:'Giao dịch'},
  {tab:'wallets',      icon:'👛', name:'Ví & Tài khoản'},
  {tab:'budget',       icon:'🎯', name:'Ngân sách',  badge:()=>getUserBudgets().filter(b=>effectivePeriodKey(b)===currentPeriodKey(b.period) && b.limit && getBudgetSpent(b)/b.limit>=0.8).length},
  {tab:'debts',        icon:'🤝', name:'Sổ nợ',      badge:()=>getUserDebts().filter(d=>debtRemaining(d)>0).length},
  {tab:'recurring',    icon:'🔁', name:'Định kỳ',    badge:()=>getUserRecurring().filter(r=>daysBetween(todayISO(), r.dueDate)<=7).length},
  {tab:'events',       icon:'✈️', name:'Sự kiện'},
  {tab:'categories',   icon:'🏷️', name:'Danh mục'},
  {tab:'reports',      icon:'📊', name:'Báo cáo'},
  {tab:'settings',     icon:'⚙️', name:'Cài đặt'}
];
function renderFeatureTiles(containerId, extraHtml){
  const el = document.getElementById(containerId);
  if(!el) return;
  el.innerHTML = FEATURE_TILES.map(f=>{
    let n = 0;
    try{ n = f.badge ? f.badge() : 0; }catch(e){ n = 0; }
    return `<div class="menu-tile" onclick="switchTab('${f.tab}')">
      ${n>0?`<span class="mt-badge">${n}</span>`:''}
      <span class="mt-ic">${f.icon}</span><span class="mt-name">${f.name}</span>
    </div>`;
  }).join('') + (extraHtml||'');
}

/* ============================================================
   MORE VIEW
   ============================================================ */
function renderMoreView(){
  renderFeatureTiles('more-tiles', `<div class="menu-tile" onclick="logout()"><span class="mt-ic">⎋</span><span class="mt-name">Đăng xuất</span></div>`);
  const txs = getUserTransactions();
  const debts = getUserDebts().filter(d=>debtRemaining(d)>0);
  document.getElementById('more-summary').innerHTML = `
    <div class="text-sm font-bold mb8">Tổng quan tài khoản</div>
    <div class="between text-sm" style="padding:5px 0;"><span class="muted">Ví đang quản lý</span><span class="font-sb">${getUserWallets().length}</span></div>
    <div class="between text-sm" style="padding:5px 0;"><span class="muted">Tổng giao dịch</span><span class="font-sb">${txs.length}</span></div>
    <div class="between text-sm" style="padding:5px 0;"><span class="muted">Ngân sách đang theo dõi</span><span class="font-sb">${getUserBudgets().length}</span></div>
    <div class="between text-sm" style="padding:5px 0;"><span class="muted">Khoản nợ chưa tất toán</span><span class="font-sb">${debts.length}</span></div>
    <div class="between text-sm" style="padding:5px 0;"><span class="muted">Giao dịch định kỳ</span><span class="font-sb">${getUserRecurring().length}</span></div>
    <div class="between text-sm" style="padding:5px 0;"><span class="muted">Sự kiện</span><span class="font-sb">${getUserEvents().length}</span></div>
    <div class="divider"></div>
    <div class="between text-sm"><span class="muted">Tổng tài sản ròng</span><span class="font-x c-primary">${fmt(getUserTotalAssets())}</span></div>`;
}

/* ============================================================
   SETTINGS
   ============================================================ */
function renderSettingsView(){
  applyTheme();
  const sel = document.getElementById('set-main-currency');
  sel.innerHTML = Object.keys(CURRENCIES).map(c=>`<option value="${c}">${c} — ${CURRENCIES[c].name}</option>`).join('');
  sel.value = mainCurrency();
  renderRatesView();
  document.getElementById('pin-toggle').checked = !!state.app.pinEnabled;
  document.getElementById('pin-status').textContent = state.app.pinEnabled ? 'Đang bật — yêu cầu PIN khi mở app' : 'Chưa thiết lập';
  document.getElementById('pin-change-row').classList.toggle('hidden', !state.app.pinEnabled);
  renderCloudSection();
}

/* ---- Cloud / sync panel in Settings ---- */
function renderCloudSection(){
  const el = document.getElementById('cloud-status');
  if(!el) return;
  const s = Sync.status();
  const dot = {synced:'🟢', pending:'🟡', offline:'⚪️', error:'🔴'}[s.phase] || '⚪️';
  const label = {
    synced:  s.lastSyncAt ? 'Đã đồng bộ lúc ' + new Date(s.lastSyncAt).toLocaleTimeString('vi-VN') : 'Đã đồng bộ',
    pending: 'Đang gửi thay đổi…',
    offline: 'Ngoại tuyến — sẽ gửi khi có mạng',
    error:   s.message || 'Đồng bộ lỗi'
  }[s.phase] || '—';
  el.innerHTML = `
    <div class="setting-row">
      <div class="sr-ic">${dot}</div>
      <div class="sr-mid"><div class="sr-title">${esc(sessionEmail || 'Tài khoản đám mây')}</div>
        <div class="sr-sub">${esc(label)}</div></div>
      <span class="link" onclick="forceSync()">Đồng bộ</span>
    </div>
    <div class="setting-row pointer" onclick="showArchivePicker()">
      <div class="sr-ic">📦</div>
      <div class="sr-mid"><div class="sr-title">Nhập dữ liệu cũ trên máy này</div>
        <div class="sr-sub">Từ bản offline trước khi dùng đám mây</div></div>
      <span class="muted">›</span>
    </div>`;
}
async function forceSync(){
  await Sync.flush();
  await Sync.pull(true);
  renderCloudSection();
  toast('Đã đồng bộ','ok');
}
function showArchivePicker(){
  if(!offerLocalArchiveImport()) toast('Không tìm thấy dữ liệu cũ nào trên máy này');
}
function renderRatesView(){
  const main = mainCurrency();
  document.getElementById('rates-view').innerHTML = Object.keys(CURRENCIES)
    .filter(c=>c!==main)
    .map(c=>`1 ${c} = ${new Intl.NumberFormat('vi-VN',{maximumFractionDigits:4}).format(rateOf(c)/rateOf(main))} ${main}`)
    .join('<br>');
}
function toggleRatesEditor(){
  const ed = document.getElementById('rates-editor'), view = document.getElementById('rates-view');
  const opening = ed.classList.contains('hidden');
  if(opening){
    ed.innerHTML = Object.keys(CURRENCIES).map(c=>`
      <div class="form-group" style="margin-bottom:8px;">
        <label>1 ${c} = ? VND</label>
        <input type="number" class="input rate-input" data-cur="${c}" value="${rateOf(c)}" step="0.0001" ${c==='VND'?'disabled':''}>
      </div>`).join('') +
      `<button class="btn btn-primary btn-sm" style="width:100%;" onclick="saveRates()">Lưu tỷ giá</button>`;
  }
  ed.classList.toggle('hidden');
  view.classList.toggle('hidden', opening);
}
function saveRates(){
  document.querySelectorAll('.rate-input').forEach(inp=>{
    const v = Number(inp.value);
    if(v > 0) state.app.rates[inp.dataset.cur] = v;
  });
  state.app.rates.VND = 1;
  saveStorage();
  toggleRatesEditor();
  renderRatesView();
  toast('Đã cập nhật tỷ giá','ok');
}
function changeMainCurrency(cur){
  state.app.mainCurrency = cur;
  saveStorage();
  renderRatesView();
  toast('Tiền tệ chính: '+cur,'ok');
}

/* ============================================================
   IMPORT / EXPORT
   ============================================================ */
function downloadFile(filename, content, mime){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function exportJSON(){
  const u = state.currentUser;
  const payload = {
    app:'finyourtin', version:4, exportedAt:new Date().toISOString(), user:u,
    settings: state.app,
    categories: state.categories[u],
    wallets: state.wallets.filter(x=>x.userId===u),
    transactions: state.transactions.filter(x=>x.userId===u),
    budgets: state.budgets.filter(x=>x.userId===u),
    recurring: state.recurring.filter(x=>x.userId===u),
    debts: state.debts.filter(x=>x.userId===u),
    events: state.events.filter(x=>x.userId===u)
  };
  downloadFile(`finyourtin-backup-${displayName()}-${todayISO()}.json`, JSON.stringify(payload,null,2), 'application/json');
  toast('Đã xuất file JSON','ok');
}
function csvEscape(v){
  const s = String(v==null?'':v);
  return /[",\n;]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function exportCSV(){
  const header = ['Ngay','Loai','SoTien','TienTe','Vi','DanhMuc','DanhMucCon','GhiChu','SuKien'];
  const typeLabel = {expense:'Chi', income:'Thu', transfer_out:'Chuyen di', transfer_in:'Chuyen den'};
  const rows = getUserTransactions().sort((a,b)=>a.date<b.date?-1:1).map(t=>{
    const w = getWallet(t.walletId);
    const type = t.type==='income' ? 'income' : 'expense';
    const c = t.type.startsWith('transfer') ? null : (findCategory(type, t.categoryId)||{name:''});
    const s = t.type.startsWith('transfer') ? null : findSub(type, t.categoryId, t.subcategoryId);
    const ev = t.eventId ? getUserEvents().find(e=>e.id===t.eventId) : null;
    return [t.date, typeLabel[t.type]||t.type, t.amount, w?w.currency:'VND', w?w.name:'', c?c.name:'', s?s.name:'', t.note||'', ev?ev.name:''];
  });
  const csv = '﻿' + [header, ...rows].map(r=>r.map(csvEscape).join(',')).join('\r\n');
  downloadFile(`finyourtin-transactions-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8');
  toast('Đã xuất file CSV','ok');
}
function importJSON(ev){
  const file = ev.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e=>{
    let data;
    try{ data = JSON.parse(e.target.result); }
    catch(err){ return toast('File JSON không hợp lệ','err'); }
    if(!data || (!data.transactions && !data.wallets)) return toast('File không đúng định dạng Finyourtin','err');
    uiConfirm('Nhập dữ liệu',
      `Toàn bộ dữ liệu hiện tại của "${state.currentUser}" sẽ được thay bằng nội dung file (${(data.wallets||[]).length} ví, ${(data.transactions||[]).length} giao dịch). Tiếp tục?`,
      'Nhập & thay thế').then(ok=>{
      if(!ok) return;
      const u = state.currentUser;
      const reown = arr => (arr||[]).map(x=>({...x, userId:u}));
      state.wallets = state.wallets.filter(x=>x.userId!==u).concat(reown(data.wallets));
      state.transactions = state.transactions.filter(x=>x.userId!==u).concat(reown(data.transactions));
      state.budgets = state.budgets.filter(x=>x.userId!==u).concat(reown(data.budgets));
      state.recurring = state.recurring.filter(x=>x.userId!==u).concat(reown(data.recurring));
      state.debts = state.debts.filter(x=>x.userId!==u).concat(reown(data.debts));
      state.events = state.events.filter(x=>x.userId!==u).concat(reown(data.events));
      if(data.categories && data.categories.expense) state.categories[u] = data.categories;
      if(data.settings){
        state.app.mainCurrency = data.settings.mainCurrency || state.app.mainCurrency;
        state.app.rates = Object.assign({...DEFAULT_RATES}, data.settings.rates||{});
      }
      migrateState();
      saveStorage();
      toast('Đã nhập dữ liệu thành công','ok');
      switchTab('dashboard');
    });
  };
  reader.readAsText(file);
  ev.target.value = '';
}
/* Minimal RFC-4180 CSV parser (handles quotes, embedded commas and newlines) */
function parseCSV(text){
  const rows = []; let row = [], field = '', inQuotes = false;
  text = text.replace(/^﻿/,'');
  for(let i=0;i<text.length;i++){
    const ch = text[i];
    if(inQuotes){
      if(ch === '"'){ if(text[i+1] === '"'){ field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if(ch === '"'){ inQuotes = true; }
    else if(ch === ',' || ch === ';'){ row.push(field); field = ''; }
    else if(ch === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
    else if(ch !== '\r'){ field += ch; }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r=>r.some(c=>c.trim()!==''));
}
function findOrCreateWallet(name, currency){
  if(!name) return getUserWallets()[0];
  let w = getUserWallets().find(x=>x.name.toLowerCase()===name.toLowerCase());
  if(!w){
    w = {id:uid('w'), userId:state.currentUser, name, icon:'👛', type:'cash', currency:currency||'VND', startingBalance:0};
    state.wallets.push(w);
  }
  return w;
}
function findOrCreateCategory(type, name){
  ensureUserCategories(state.currentUser);
  const list = state.categories[state.currentUser][type];
  if(!name) return list[list.length-1];
  let c = list.find(x=>x.name.toLowerCase()===name.toLowerCase());
  if(!c){
    c = {id:uid('cat'), name, icon:type==='income'?'💰':'📦', color:CATEGORY_COLORS[list.length % CATEGORY_COLORS.length], subs:[]};
    list.push(c);
  }
  return c;
}
function importCSV(ev){
  const file = ev.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e=>{
    const rows = parseCSV(e.target.result);
    if(rows.length < 2) return toast('File CSV rỗng hoặc sai định dạng','err');
    const deaccent = s => s.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]','g'),'').replace(/đ/g,'d');
    const head = rows[0].map(h=>deaccent(h.trim().toLowerCase()));
    const idx = names => head.findIndex(h=>names.some(n=>h.includes(n)));
    const iDate = idx(['ngay','date']), iType = idx(['loai','type']), iAmt = idx(['sotien','amount','so tien']),
          iCur = idx(['tiente','currency']), iWallet = idx(['vi','wallet']), iCat = idx(['danhmuc','category','danh muc']),
          iSub = idx(['danhmuccon','subcategory']), iNote = idx(['ghichu','note','mo ta']), iEvent = idx(['sukien','event']);
    if(iDate < 0 || iAmt < 0) return toast('CSV cần tối thiểu cột Ngày và Số tiền','err');

    uiConfirm('Nhập CSV', `Tìm thấy ${rows.length-1} dòng. Các giao dịch sẽ được THÊM vào sổ hiện tại (ví/danh mục chưa có sẽ được tạo tự động). Tiếp tục?`, 'Nhập').then(ok=>{
      if(!ok) return;
      let added = 0, skipped = 0;
      rows.slice(1).forEach(r=>{
        const rawDate = (r[iDate]||'').trim();
        let date = rawDate;
        if(/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) date = rawDate.split('/').reverse().join('-');
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ skipped++; return; }
        const amount = Math.abs(parseAmount(r[iAmt]));
        if(!amount){ skipped++; return; }
        const rawType = (iType>=0 ? r[iType] : '').toLowerCase();
        const type = /thu|income|\+/.test(rawType) && !/chuyen/.test(rawType) ? 'income' : 'expense';
        const wallet = findOrCreateWallet((iWallet>=0?r[iWallet]:'').trim(), (iCur>=0?r[iCur]:'VND').trim()||'VND');
        const cat = findOrCreateCategory(type, (iCat>=0?r[iCat]:'').trim());
        let subId = null;
        const subName = (iSub>=0?r[iSub]:'').trim();
        if(subName){
          let sub = (cat.subs||[]).find(s=>s.name.toLowerCase()===subName.toLowerCase());
          if(!sub){ sub = {id:uid('s'), name:subName}; cat.subs = cat.subs||[]; cat.subs.push(sub); }
          subId = sub.id;
        }
        let eventId = null;
        const evName = (iEvent>=0?r[iEvent]:'').trim();
        if(evName){
          let evObj = getUserEvents().find(x=>x.name.toLowerCase()===evName.toLowerCase());
          if(!evObj){ evObj = {id:uid('e'), userId:state.currentUser, name:evName, icon:'✈️', startDate:date, endDate:'', budget:0}; state.events.push(evObj); }
          eventId = evObj.id;
        }
        state.transactions.push({
          id:uid('t'), userId:state.currentUser, type, amount, walletId:wallet.id,
          categoryId:cat.id, subcategoryId:subId, note:(iNote>=0?r[iNote]:'').trim(),
          date, eventId, createdAt:new Date().toISOString()
        });
        added++;
      });
      saveStorage();
      toast(`Đã nhập ${added} giao dịch${skipped?`, bỏ qua ${skipped} dòng lỗi`:''}`,'ok');
      switchTab('transactions');
    });
  };
  reader.readAsText(file);
  ev.target.value = '';
}

/* ============================================================
   BOOTSTRAP
   ============================================================ */
function bootAfterUnlock(){
  if(state.currentUser) initUserSession();
  else showLogin();
}

/* Shown instead of the sign-in form when the build has no Supabase keys. */
function showConfigScreen(reason){
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  document.getElementById('main-header').classList.add('hidden');
  document.getElementById('main-nav').classList.add('hidden');
  document.getElementById('view-config').classList.remove('hidden');
  document.getElementById('config-reason').textContent = reason || '';
}

/* Save keys typed into the config screen. Handy for local dev and for opening
   the file straight off disk, where no build step ran to inject env.js. */
function saveManualConfig(){
  const url = document.getElementById('cfg-url').value.trim().replace(/\/+$/,'');
  const key = document.getElementById('cfg-key').value.trim();
  if(!/^https:\/\/.+\.supabase\.co$/.test(url)) return toast('URL phải có dạng https://xxxx.supabase.co','err');
  if(key.length < 40) return toast('Anon key trông không hợp lệ','err');
  Sync.saveLocalConfig(url, key);
  location.reload();
}

async function boot(){
  /* Paint in the remembered theme before we know who is signing in. */
  state = emptyState();
  state.app.theme = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme();

  /* `state` is a top-level `let`, so it lives in the global lexical scope and
     is not reachable as window.state. Hand Sync explicit accessors instead. */
  Sync.bind({
    getState: ()=>state,
    adopt:    adoptRemoteState,
    onStatus: ()=>{ if(currentTab === 'settings') renderCloudSection(); },
    notify:   msg=>toast(msg)
  });

  const ready = Sync.init();
  if(!ready.ok){ showConfigScreen(ready.reason); return; }

  Sync.onAuthChange((event, session)=>{
    if(event === 'SIGNED_OUT'){ Sync.stop(); setStorageNamespace(null); state = emptyState(); showLogin(); return; }
    if(session && session.user && session.user.id !== state.currentUser) enterSession(session.user);
  });

  let session = null;
  try{ session = await Sync.getSession(); }
  catch(e){ console.error('Session lookup failed', e); }

  if(session && session.user) enterSession(session.user);
  else showLogin();
}
let resizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(()=>{ if(currentTab==='reports') renderReportsView(); }, 200);
});
document.addEventListener('keydown', e=>{
  if(e.key === 'Escape'){
    const open = [...document.querySelectorAll('.modal:not(.hidden)')].pop();
    if(open) open.classList.add('hidden');
  }
});
/* close bottom-sheet when tapping the dimmed backdrop */
document.querySelectorAll('.modal').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target === m) m.classList.add('hidden'); });
});
document.getElementById('login-password').addEventListener('keydown', e=>{ if(e.key==='Enter') handleAuthSubmit(); });
document.getElementById('login-email').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('login-password').focus(); });
document.getElementById('mc-sub-name').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); addMcSub(); } });

/* Last chance to land a pending write before the tab goes away. */
window.addEventListener('pagehide', ()=>{ if(window.Sync) Sync.flushBeacon(); });
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden' && window.Sync) Sync.flush();
  if(document.visibilityState === 'visible' && window.Sync) Sync.pullIfStale();
});

boot();
