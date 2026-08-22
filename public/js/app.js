/* ============================================================
   SoFin — Personal finance app (cloud edition)

   Storage model: the whole app is one `state` object. Every mutation calls
   saveStorage(), which writes to localStorage first (instant, offline-safe)
   and then debounce-pushes the same snapshot to Supabase. Realtime pulls
   changes made on other devices back in. See js/sync.js.

   Auth is Supabase Auth only — there is no local account store.
   ============================================================ */

/* ---------- SYSTEM ICONS ----------
   Lucide-style 24×24 strokes for the app's own chrome: nav, buttons, empty
   states, settings rows. They inherit currentColor and the surrounding font
   size, so a single CSS rule sizes them everywhere.

   Emoji the *user* picked — wallet icons, category icons, event icons — are
   data in `state` and stay exactly as they are. Only the fixed furniture is
   drawn here. */
const ICON_PATHS = {
  home:        '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  list:        '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/>',
  chart:       '<path d="M3 21h18"/><rect x="5" y="11" width="4" height="7" rx="1"/><rect x="11" y="6" width="4" height="12" rx="1"/><rect x="17" y="14" width="4" height="4" rx="1"/>',
  settings:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  plus:        '<path d="M12 5v14M5 12h14"/>',
  wallet:      '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3"/><rect x="3" y="7.5" width="18" height="12" rx="2.5"/><circle cx="16.5" cy="13.5" r="1.6"/>',
  target:      '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  handshake:   '<path d="M11 17.5 9.5 19a2 2 0 0 1-2.8-2.8l1.5-1.5"/><path d="m13 6 3.5-1.5L21 9l-3 3"/><path d="M11 6 7.5 4.5 3 9l3 3"/><path d="m9 12 3 3 3-3 3 3"/>',
  repeat:      '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9a3 3 0 0 1 3-3h14"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v2a3 3 0 0 1-3 3h-14"/>',
  plane:       '<path d="M10.5 19.5 12 22l1.5-2.5V15l7 2v-2.5l-7-4.5V4a1.5 1.5 0 0 0-3 0v6l-7 4.5V17l7-2z"/>',
  tag:         '<path d="M20.5 12.5 12 21 3 12V4h8z"/><circle cx="8" cy="8" r="1.4"/>',
  clock:       '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
  card:        '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 15h3"/>',
  crystal:     '<path d="M12 3a7 7 0 0 1 4.5 12.4V18h-9v-2.6A7 7 0 0 1 12 3z"/><path d="M9 21h6"/>',
  bell:        '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/>',
  moon:        '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  sun:         '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  search:      '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sliders:     '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  lock:        '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  key:         '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-2 2 2 2-2 2-2-2-2 2"/>',
  shield:      '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.9 7.5 9 4.3-1.1 7.5-4.5 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
  upload:      '<path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download:    '<path d="M12 4v12"/><path d="m7.5 11.5 4.5 4.5 4.5-4.5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  file:        '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  refresh:     '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4v5h-5"/>',
  trash:       '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6.5 7 7.5 20a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1L17.5 7"/>',
  logout:      '<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="m15.5 16 4.5-4-4.5-4"/><path d="M20 12H9.5"/>',
  phone:       '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  check:       '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  cloudOff:    '<path d="m3 3 18 18"/><path d="M7.5 8A5 5 0 0 1 17 9.5a4 4 0 0 1 1.9 7.2"/><path d="M15 18H7a4 4 0 0 1-.9-7.9"/>',
  cloud:       '<path d="M17 18H7A4 4 0 0 1 7 10a5 5 0 0 1 9.6-1A3.5 3.5 0 0 1 17 18z"/>',
  box:         '<path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z"/><path d="M3 8.5 12 13l9-4.5M12 13v7"/>',
  inbox:       '<path d="M3.5 12.5h4l1.5 3h6l1.5-3h4"/><path d="M5.5 5h13l2.5 7.5v5a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-5z"/>',
  folder:      '<path d="M3.5 7a2 2 0 0 1 2-2h3.2l2 2.5h7.8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  party:       '<path d="m4 20 4.5-12 7.5 7.5z"/><path d="M15 4.5v.01M19.5 8v.01M18 3l.01.01M21 12.5v.01"/>',
  bulb:        '<path d="M9.5 17h5"/><path d="M10 20.5h4"/><path d="M12 3a6 6 0 0 1 3.5 10.9V17h-7v-3.1A6 6 0 0 1 12 3z"/>',
  bolt:        '<path d="M13.5 2 4 13.5h6.5L10 22l9.5-11.5H13z"/>',
  layers:      '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  plug:        '<path d="M9 3v6M15 3v6"/><path d="M6.5 9h11v2.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 17v4"/>',
  eye:         '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:      '<path d="m3 3 18 18"/><path d="M10.6 6.1A7.9 7.9 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-3.2 3.8"/><path d="M6.2 8.3A15.6 15.6 0 0 0 2.5 12S6 18 12 18a8.6 8.6 0 0 0 3.4-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  arrowDown:   '<path d="M12 4.5v14"/><path d="m6 13 6 6 6-6"/>',
  arrowUp:     '<path d="M12 19.5v-14"/><path d="m6 11 6-6 6 6"/>',
  swap:        '<path d="M7 4.5 3.5 8 7 11.5"/><path d="M3.5 8h13a4 4 0 0 1 0 8H14"/><path d="M17 19.5 20.5 16 17 12.5"/>',
  coins:       '<ellipse cx="9" cy="6.5" rx="6" ry="3"/><path d="M3 6.5v4c0 1.7 2.7 3 6 3s6-1.3 6-3"/><path d="M3 10.5v4c0 1.7 2.7 3 6 3"/><ellipse cx="16" cy="15" rx="5" ry="2.5"/><path d="M11 15v3c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-3"/>'
};

/* `icon('home')` → an inline <svg>. Size and colour come from CSS. */
function icon(name, cls){
  const d = ICON_PATHS[name];
  if(!d) return '';
  return `<svg class="ic-svg${cls?' '+cls:''}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

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
let txFilters = {type:'all', walletId:'all', catId:'all', eventId:'all', range:'all', status:'all'};
let reportRangeKey = 'thismonth', donutMode = 'expense', reportWalletId = 'all';
let reportIncludePending = false;
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
/* These four names are NOT rebranded with the app. They are the keys real
   data already lives under: renaming them would orphan every cached snapshot,
   forget the chosen theme and the manually entered Supabase config, and hand
   the device a new id so it would start reacting to the echo of its own
   writes. The PIN salt below is the same story, but worse — changing it
   invalidates every PIN in existence and locks people out. */
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
  normalizeWalletOrder();
  state.transactions.forEach(t=>{
    if(typeof t.amount !== 'number') t.amount = Number(t.amount)||0;
    /* `status` arrived with future-dated transactions. Everything written
       before it already moved real money, so it stays completed even if its
       date happens to be ahead — silently pulling those amounts back out of
       people's balances on upgrade would be worse than the inconsistency. */
    if(t.status !== 'pending') t.status = 'completed';
  });
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
       <div class="sr-ic">${icon('box')}</div>
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

/* ---------- MONEY INPUT FIELDS ----------
   Every amount box in the app is <input class="money">. One delegated handler
   groups the digits while they are being typed (vi-VN: "." ngăn nghìn, ","
   thập phân) and every read goes back through parseAmount(), so what reaches
   `state` is always a plain number — the separators never leave the DOM.

   These must be type="text": a type="number" input refuses to display grouped
   digits and hands back "" the moment its value stops being a bare number. */
function formatMoneyText(raw){
  const s = String(raw==null?'':raw).replace(/[^\d,]/g,'');
  const comma = s.indexOf(',');
  const int = (comma===-1 ? s : s.slice(0,comma)).replace(/^0+(?=\d)/,'');
  const dec = comma===-1 ? null : s.slice(comma+1).replace(/,/g,'').slice(0,2);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  return dec===null ? grouped : grouped + ',' + dec;
}
function moneyEl(ref){ return typeof ref === 'string' ? document.getElementById(ref) : ref; }
function readMoney(ref){ const el = moneyEl(ref); return el ? parseAmount(el.value) : 0; }
function writeMoney(ref, num){
  const el = moneyEl(ref);
  if(!el) return;
  el.value = (num===''||num==null||isNaN(num)) ? '' : formatMoneyText(String(num).replace('.', ','));
}

/* Reformat on every keystroke, but put the caret back where it was relative to
   the digits — otherwise inserting a separator would fling it to the end. */
function onMoneyInput(el){
  const before = el.value.slice(0, el.selectionStart||0).replace(/\D/g,'').length;
  const next = formatMoneyText(el.value);
  if(next === el.value) return;
  el.value = next;
  if(document.activeElement !== el) return;
  let seen = 0, pos = before ? next.length : 0;
  for(let i=0;i<next.length;i++){
    if(/\d/.test(next[i]) && ++seen === before){ pos = i+1; break; }
  }
  try{ el.setSelectionRange(pos, pos); }catch(e){}
}
document.addEventListener('input', e=>{
  const t = e.target;
  if(t && t.classList && t.classList.contains('money')) onMoneyInput(t);
});

/* "000" — scale by a thousand rather than appending three characters, so it
   also does the right thing on a decimal ("50,5" -> "50.500"). */
function moneyAddThousand(el){
  const v = parseAmount(el.value);
  if(!v){ el.focus(); return; }
  writeMoney(el, Math.round(v * 1000 * 100) / 100);
  el.dispatchEvent(new Event('input', {bubbles:true}));   /* let oninput= recompute */
  el.focus();
}
/* Give every money field its 000 shortcut. Idempotent, so it can be re-run
   after any render that creates new ones (onboarding balances). */
function attachMoneyButtons(root){
  (root||document).querySelectorAll('input.money').forEach(el=>{
    if(el.parentNode && el.parentNode.classList.contains('money-field')) return;
    const wrap = document.createElement('div');
    wrap.className = 'money-field';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-000 ripple-host';
    btn.textContent = '000';
    btn.title = 'Nhân nghìn';
    btn.addEventListener('click', ()=>moneyAddThousand(el));
    wrap.appendChild(btn);
  });
}
function renderPrivacyBtn(){
  const el = document.getElementById('privacy-btn');
  if(el) el.innerHTML = icon(state.app.privacy ? 'eyeOff' : 'eye');
}
function togglePrivacy(){
  state.app.privacy = !state.app.privacy;
  saveStorage();
  renderPrivacyBtn();
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
/* ---------- WALLET DISPLAY ORDER ----------
   `displayOrder` is a dense 1..N sequence per user. Every screen reads wallets
   through getUserWallets(), so sorting here is the whole feature: dashboard
   carousel, every wallet <select>, the report filters and the management list
   all follow automatically, with no sort() repeated at the call sites. */
function walletOrderOf(w){ return typeof w.displayOrder === 'number' ? w.displayOrder : Infinity; }
function compareWallets(a, b){
  const d = walletOrderOf(a) - walletOrderOf(b);
  return d !== 0 ? d : String(a.name||'').localeCompare(String(b.name||''), 'vi');
}
function getUserWallets(){ return state.wallets.filter(w=>w.userId===state.currentUser).sort(compareWallets); }
function nextWalletOrder(){ return getUserWallets().length + 1; }

/* Repairs the sequence per user: fills in wallets saved before the field
   existed, and closes the gaps/duplicates left by a deletion or by two devices
   creating a wallet at the same time. Idempotent — a healthy list exits early,
   which matters because migrateState() runs on every load. */
function normalizeWalletOrder(){
  const byUser = {};
  state.wallets.forEach(w=>{ (byUser[w.userId] = byUser[w.userId] || []).push(w); });
  Object.keys(byUser).forEach(u=>{
    const list = byUser[u];
    const nums = list.map(w=>w.displayOrder);
    const healthy = nums.every(n=>typeof n === 'number') && new Set(nums).size === nums.length
      && Math.min.apply(null, nums) === 1 && Math.max.apply(null, nums) === nums.length;
    if(healthy) return;
    /* keep whatever order they already appear in, then number 1..N */
    list.slice().sort(compareWallets).forEach((w,i)=>{ w.displayOrder = i+1; });
  });
}

/* Move one wallet to `target` and renumber everything else, so bumping a
   wallet to #1 pushes the old #1 down to #2 instead of colliding with it. */
function setWalletOrder(walletId, target){
  const w = getWallet(walletId);
  if(!w) return;
  const others = getUserWallets().filter(x=>x.id!==walletId);
  const pos = Math.min(Math.max(Math.round(Number(target)||1), 1), others.length+1);
  others.splice(pos-1, 0, w);
  others.forEach((x,i)=>{ x.displayOrder = i+1; });
}
function getWallet(id){ return state.wallets.find(w=>w.id===id); }
/* ---------- PENDING (future-dated) TRANSACTIONS ----------
   Invariant: a transaction is pending exactly while its date is still ahead of
   today. Saving derives the status from the date, settling drags the date back
   to today, and autoSettlePending() flips the rest over as the days arrive —
   so "completed" always means "the money has actually moved".

   getUserTransactions() therefore returns only completed rows: anything that
   sums money (balances, budgets, reports, events) is right by default, and the
   few places that genuinely want the whole ledger ask for it explicitly. */
function isPending(t){ return t.status === 'pending'; }
function statusForDate(dateStr){ return dateStr > todayISO() ? 'pending' : 'completed'; }
function getUserTransactions(){ return state.transactions.filter(t=>t.userId===state.currentUser && !isPending(t)); }
function getAllUserTransactions(){ return state.transactions.filter(t=>t.userId===state.currentUser); }
function getPendingTransactions(){ return state.transactions.filter(t=>t.userId===state.currentUser && isPending(t)); }

/* Runs at session start: yesterday's plans are today's spending. */
function autoSettlePending(){
  const today = todayISO();
  let changed = false;
  state.transactions.forEach(t=>{
    if(isPending(t) && t.date <= today){ t.status = 'completed'; changed = true; }
  });
  if(changed) saveStorage();
  return changed;
}
function getUserEvents(){ return state.events.filter(e=>e.userId===state.currentUser); }
function getUserDebts(){ return state.debts.filter(d=>d.userId===state.currentUser); }
function getUserRecurring(){ return state.recurring.filter(r=>r.userId===state.currentUser); }
function getUserBudgets(period){ return state.budgets.filter(b=>b.userId===state.currentUser && (!period || b.period===period)); }

function getWalletBalance(walletId){
  const w = getWallet(walletId);
  if(!w) return 0;
  let bal = w.startingBalance || 0;
  for(const t of state.transactions){
    if(t.walletId !== walletId || isPending(t)) continue;   /* planned money has not moved yet */
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
/* A truncated amount is worse than a small one — "159.800.00…" reads as a
   different number. Long strings step the font down instead of ellipsizing. */
function amtClass(text){
  const n = String(text).length;
  return n > 16 ? ' amt-xs' : n > 13 ? ' amt-sm' : '';
}
function setAmount(el, text){
  el = typeof el === 'string' ? document.getElementById(el) : el;
  if(!el) return;
  el.textContent = text;
  el.classList.remove('amt-sm','amt-xs');
  const c = amtClass(text).trim();
  if(c) el.classList.add(c);
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- RIPPLE + HAPTIC ----------
   Banking apps answer every tap. One delegated listener covers anything marked
   .ripple-host, so new controls only need the class. */
function spawnRipple(host, x, y){
  const r = host.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 1.1;
  const el = document.createElement('span');
  el.className = 'ripple';
  el.style.width = el.style.height = size + 'px';
  el.style.left = (x - r.left - size / 2) + 'px';
  el.style.top  = (y - r.top  - size / 2) + 'px';
  host.appendChild(el);
  el.addEventListener('animationend', ()=>el.remove());
}
document.addEventListener('pointerdown', e=>{
  const host = e.target.closest && e.target.closest('.ripple-host');
  if(!host) return;
  spawnRipple(host, e.clientX, e.clientY);
  /* a 10ms tick is the "typing" feedback; silently absent on iOS Safari */
  if(navigator.vibrate) try{ navigator.vibrate(10); }catch(err){}
});

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
  document.getElementById('meta-theme-color').setAttribute('content', dark?'#08101C':'#00529C');
  const btn = document.getElementById('btn-theme');
  if(btn) btn.innerHTML = icon(dark ? 'sun' : 'moon');
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
  /* salt is frozen on purpose — see the note by STORAGE_KEY */
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
  document.getElementById('lock-sub').textContent   = mode==='verify' ? 'Mở khóa SoFin' : 'Chọn 4 chữ số dễ nhớ';
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
/* ---------- CHANGE PIN / PASSWORD ----------
   Two credentials with the same three-field shape, so they share one modal.

   The PIN is ours: SHA-256 in state.app.pinHash, written by saveStorage() to
   localStorage (and on to Supabase with the rest of the snapshot). The login
   password is not ours at all — it lives in Supabase Auth. Supabase's
   updateUser() does NOT ask for the old password, so the "current password"
   check is a re-authentication: sign in again with it and see if it holds.  */
let credMode = 'pin';
let credBusy = false;

function openCredentialModal(mode){
  /* Nothing to change until a PIN exists — send them through setup instead. */
  if(mode==='pin' && !(state.app.pinEnabled && state.app.pinHash)){
    return toast('Bật khóa PIN trước rồi mới đổi được','err');
  }
  credBusy = false;
  ['cred-current','cred-new','cred-confirm'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('cred-error').textContent = '';
  const hasPin = !!(state.app.pinEnabled && state.app.pinHash);
  document.getElementById('cred-seg-pin').classList.toggle('hidden', !hasPin);
  setCredentialMode(mode);
  openModal('modal-credential');
  setTimeout(()=>{ const el = document.getElementById('cred-current'); if(el) el.focus(); }, 60);
}

function setCredentialMode(mode){
  if(credBusy) return;
  credMode = mode;
  const pin = mode==='pin';
  document.getElementById('cred-seg-pin').classList.toggle('active', pin);
  document.getElementById('cred-seg-password').classList.toggle('active', !pin);
  document.getElementById('cred-title').textContent = pin ? 'Đổi mã PIN' : 'Đổi mật khẩu đăng nhập';
  document.getElementById('cred-hint').textContent = pin
    ? 'Mã PIN gồm 4 chữ số, chỉ dùng để mở khóa app trên thiết bị này.'
    : 'Mật khẩu tài khoản đám mây (' + (sessionEmail || 'tài khoản hiện tại') + '), tối thiểu 6 ký tự.';
  document.getElementById('cred-current-label').textContent = pin ? 'Mã PIN hiện tại' : 'Mật khẩu hiện tại';
  document.getElementById('cred-new-label').textContent     = pin ? 'Mã PIN mới' : 'Mật khẩu mới';
  document.getElementById('cred-confirm-label').textContent = pin ? 'Xác nhận mã PIN mới' : 'Xác nhận mật khẩu mới';
  ['cred-current','cred-new','cred-confirm'].forEach(id=>{
    const el = document.getElementById(id);
    el.value = '';
    el.setAttribute('inputmode', pin ? 'numeric' : 'text');
    el.setAttribute('maxlength', pin ? '4' : '72');
    el.placeholder = pin ? '••••' : '';
  });
  document.getElementById('cred-error').textContent = '';
}

function credError(msg){
  document.getElementById('cred-error').textContent = msg;
  credBusy = false;
  const btn = document.getElementById('cred-submit');
  btn.disabled = false; btn.textContent = 'Cập nhật';
}

async function submitCredentialChange(){
  if(credBusy) return;
  const current = document.getElementById('cred-current').value;
  const next    = document.getElementById('cred-new').value;
  const confirm = document.getElementById('cred-confirm').value;
  const pin = credMode==='pin';

  if(!current || !next || !confirm) return credError('Điền đủ cả ba ô.');
  if(pin && !/^\d{4}$/.test(next))  return credError('Mã PIN mới phải là 4 chữ số.');
  if(!pin && next.length < 6)       return credError('Mật khẩu mới tối thiểu 6 ký tự.');
  if(next !== confirm)              return credError(pin ? 'Hai mã PIN mới không khớp.' : 'Hai mật khẩu mới không khớp.');
  if(next === current)              return credError(pin ? 'Mã PIN mới trùng mã cũ.' : 'Mật khẩu mới trùng mật khẩu cũ.');

  credBusy = true;
  const btn = document.getElementById('cred-submit');
  btn.disabled = true; btn.textContent = 'Đang kiểm tra…';

  if(pin){
    if(await hashPin(current) !== state.app.pinHash) return credError('Mã PIN hiện tại không đúng.');
    state.app.pinHash = await hashPin(next);
    saveStorage();                       /* localStorage + đẩy lên cloud */
    closeModal('modal-credential');
    credBusy = false;
    btn.disabled = false; btn.textContent = 'Cập nhật';
    toast('Đã đổi mã PIN','ok');
    renderSettingsView();
    return;
  }

  if(!sessionEmail) return credError('Không xác định được email của phiên đăng nhập.');
  /* Supabase never verifies the old password, so prove it by signing in. A
     failed sign-in leaves the existing session untouched. */
  let res;
  try{ res = await Sync.signIn(sessionEmail, current); }
  catch(e){ return credError('Không kết nối được máy chủ. Thử lại sau.'); }
  if(res.error) return credError('Mật khẩu hiện tại không đúng.');

  btn.textContent = 'Đang lưu…';
  let error = null;
  try{ ({error} = await Sync.updatePassword(next)); }
  catch(e){ error = e; }
  if(error) return credError(translateAuthError(error));

  closeModal('modal-credential');
  credBusy = false;
  btn.disabled = false; btn.textContent = 'Cập nhật';
  toast('Đã đổi mật khẩu đăng nhập','ok');
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
  /* Must come before the length check — Supabase phrases this as
     "New password should be different from the old password." */
  if(m.includes('should be different') || m.includes('same_password')) return 'Mật khẩu mới phải khác mật khẩu cũ.';
  if(m.includes('session missing') || m.includes('session_not_found') || m.includes('invalid or has expired'))
    return 'Phiên đặt lại đã hết hạn. Bấm "Quên mật khẩu" để nhận liên kết mới.';
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

/* A dead or already-used link comes back as #error=... (implicit flow) or
   ?error=... (PKCE) with no session at all. Read it before supabase-js tidies
   the URL, otherwise the user lands on a silent login screen and gives up. */
function readAuthLinkError(){
  const raw = location.hash.indexOf('error') > -1 ? location.hash : location.search;
  if(raw.indexOf('error') === -1) return '';
  const p = new URLSearchParams(raw.replace(/^[#?]/, ''));
  const code = p.get('error_code') || p.get('error');
  if(!code) return '';
  if(/expired/.test(code)) return 'Liên kết đã hết hạn. Nhập email rồi bấm "Quên mật khẩu" để nhận liên kết mới.';
  return p.get('error_description') || 'Liên kết không hợp lệ hoặc đã được dùng.';
}

/* Supabase drops the user back here with a short-lived recovery session after
   they click the link in the reset email. Without this the flow dead-ends:
   signed in, but still no way to set a new password. */
let pendingPasswordRecovery = false;
let pwBusy = false;

/* One sheet element serves the whole app, so the recovery prompt must not race
   the onboarding archive picker, and must not open behind the PIN lock where
   it cannot be touched. Every caller funnels through here. */
function maybePromptNewPassword(){
  if(!pendingPasswordRecovery) return false;
  if(!document.getElementById('lock-screen').classList.contains('hidden')) return false;
  promptNewPassword();
  return true;
}

function promptNewPassword(){
  pwBusy = false;
  uiSheet('Đặt mật khẩu mới',
    `<p class="text-sm muted mb12">Nhập mật khẩu mới cho tài khoản của bạn (tối thiểu 6 ký tự).</p>
     <div class="form-group">
       <input type="password" id="pw-new" class="input" placeholder="Mật khẩu mới" autocomplete="new-password">
     </div>
     <div id="pw-error" class="text-xs c-expense mb8" style="min-height:14px;"></div>
     <button class="btn btn-primary" id="pw-submit" onclick="submitNewPassword()">Lưu mật khẩu</button>
     <button class="btn btn-ghost mt8" onclick="dismissNewPassword()">Để sau</button>`);
  const el = document.getElementById('pw-new');
  if(el) el.addEventListener('keydown', e=>{ if(e.key==='Enter') submitNewPassword(); });
  setTimeout(()=>{ const i = document.getElementById('pw-new'); if(i) i.focus(); }, 60);
}

async function submitNewPassword(){
  if(pwBusy) return;
  const pw = document.getElementById('pw-new').value;
  const err = document.getElementById('pw-error');
  if(pw.length < 6){ err.textContent = 'Mật khẩu tối thiểu 6 ký tự.'; return; }
  pwBusy = true;
  const btn = document.getElementById('pw-submit');
  if(btn){ btn.disabled = true; btn.textContent = 'Đang lưu…'; }
  let error = null;
  try{ ({error} = await Sync.updatePassword(pw)); }
  catch(e){ error = e; }
  if(error){
    pwBusy = false;
    if(btn){ btn.disabled = false; btn.textContent = 'Lưu mật khẩu'; }
    err.textContent = translateAuthError(error);
    return;
  }
  endPasswordRecovery();
  toast('Đã đổi mật khẩu','ok');
}

function dismissNewPassword(){
  endPasswordRecovery();
  toast('Bạn vẫn đang đăng nhập. Đổi mật khẩu sau ở Cài đặt → Tài khoản.');
}

/* Close the prompt and hand the sheet back to whatever we pre-empted. */
function endPasswordRecovery(){
  pendingPasswordRecovery = false;
  pwBusy = false;
  closeSheet();
  if(state.currentUser && !state.onboardingStatus[state.currentUser]) offerLocalArchiveImport();
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
  resetSessionFilters();          /* never inherit the previous account's filters */
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
  autoSettlePending();          /* yesterday's plans became today's spending */
  autoProcessRecurring();
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('main-header').classList.remove('hidden');
  document.getElementById('user-display-name').textContent = displayName();
  const h = new Date().getHours();
  /* no trailing emoji: the greeting shares one compact line with the name */
  document.getElementById('header-greet').textContent =
    (h<11?'Chào buổi sáng':h<14?'Chào buổi trưa':h<18?'Chào buổi chiều':'Chào buổi tối') + ',';
  renderPrivacyBtn();
  if(!state.onboardingStatus[state.currentUser]){
    /* Brand-new account: if this browser still holds pre-cloud data, offer it
       instead of making the user re-enter everything. */
    document.getElementById('main-nav').classList.add('hidden');
    startOnboarding();
    /* The recovery prompt wants the same sheet; endPasswordRecovery() re-offers. */
    if(!pendingPasswordRecovery) offerLocalArchiveImport();
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
       <input type="text" inputmode="decimal" class="input money ob-bal-input" data-wallet="${esc(w)}" placeholder="0" value="${obBalances[w]?formatMoneyText(String(obBalances[w])):''}"></div>`).join('');
    attachMoneyButtons(document.getElementById('ob-balance-inputs'));
  } else if(step===3){
    document.querySelectorAll('.ob-bal-input').forEach(inp=>{ obBalances[inp.dataset.wallet] = readMoney(inp); });
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
      type: type==='credit_card' ? 'cash' : type, currency:'VND', startingBalance:obBalances[name]||0,
      displayOrder: nextWalletOrder()
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
  /* Screens with no slot of their own are reached from the dashboard's
     "Truy cập nhanh" grid, so that is the nav item that stays lit. */
  const SUB_SCREENS = ['wallets','budget','debts','recurring','events','categories'];
  const navTab = SUB_SCREENS.includes(tab) ? 'dashboard' : tab;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.tab===navTab));
  /* Only the dashboard has a card built to sit on the app bar's lip. */
  const hd = document.getElementById('main-header');
  if(hd) hd.classList.toggle('hd-flat', tab !== 'dashboard');
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
  setAmount('db-total-balance', fmt(getUserTotalAssets()));
  document.getElementById('db-month-income').textContent = fmt(inc);
  document.getElementById('db-month-expense').textContent = fmt(exp);

  renderAlerts();
  document.getElementById('db-income-label').innerHTML = icon('arrowDown') + 'Thu tháng này';
  document.getElementById('db-expense-label').innerHTML = icon('arrowUp') + 'Chi tháng này';
  renderUpcomingCard();

  /* wallets carousel */
  document.getElementById('db-wallet-scroll').innerHTML = getUserWallets().map(w=>{
    /* icon + name on the left, money + type on the right */
    const card = isCreditCard(w);
    const money = card ? getCardUsedAmount(w) : getWalletBalance(w.id);
    const sub   = card ? 'Còn ' + fmtW(getCardAvailableLimit(w), w)
                       : walletMeta(w).label + (w.currency!=='VND' ? ' · '+w.currency : '');
    return `<div class="wallet-card ${card?'cc-mini':''} ripple-host" onclick="jumpToWallet('${w.id}')">
      <div class="w-left">
        <div class="wicon">${w.icon}</div>
        <div class="wname">${esc(w.name)}</div>
      </div>
      <div class="w-right">
        <div class="wbal tabular${amtClass(fmtW(money, w))}">${fmtW(money, w)}</div>
        <div class="wsub">${esc(sub)}</div>
      </div>
    </div>`;
  }).join('') + `<div class="wallet-card add ripple-host" onclick="openWalletModal()">${icon('plus')}<div class="text-xs">Thêm ví</div></div>`;

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
        icon: icon(d.kind==='borrow' ? 'download' : 'upload'),
        text: `${d.kind==='borrow'?'Khoản vay':'Khoản cho vay'} <b>${esc(d.party)}</b> — ${fmt(toMain(debtRemaining(d), (getWallet(d.walletId)||{}).currency))} · ${relDueLabel(d.dueDate).text}`,
        action: `switchTab('debts')`
      });
    }
  });
  /* budgets */
  getUserBudgets().filter(b=>effectivePeriodKey(b)===currentPeriodKey(b.period)).forEach(b=>{
    const spent = getBudgetSpent(b), pct = b.limit ? spent/b.limit*100 : 0;
    if(pct >= 100){
      alerts.push({level:'danger', icon:icon('bell'), text:`Vượt ngân sách <b>${esc(budgetName(b))}</b> — đã chi ${fmt(spent)}/${fmt(b.limit)}`, action:`switchTab('budget')`});
    } else if(pct >= 80){
      alerts.push({level:'warn', icon:icon('bulb'), text:`Ngân sách <b>${esc(budgetName(b))}</b> đã dùng ${Math.round(pct)}%`, action:`switchTab('budget')`});
    }
  });
  /* credit cards nearing due */
  getUserWallets().filter(w=>isCreditCard(w) && getCardUsedAmount(w)>0).forEach(w=>{
    const due = getCardNextDueDate(w), diff = daysBetween(today, due);
    if(diff <= 5) alerts.push({level: diff<=2?'danger':'warn', icon:icon('card'), text:`Thẻ <b>${esc(w.name)}</b> đến hạn thanh toán ${fmtDate(due)} — ${fmtW(getCardUsedAmount(w),w)}`, action:`switchTab('wallets')`});
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
  if(!txs.length) return `<div class="empty-state"><div class="ic">${icon('inbox')}</div><div class="text-sm">Chưa có giao dịch nào</div><div class="es-sub">Bấm nút + để thêm giao dịch đầu tiên</div></div>`;
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
    const pending = isPending(t);
    return `<div class="tx-row ${pending?'tx-pending':''}" onclick="openTxDetail('${t.id}')">
      <div class="tx-ic" style="background:${bg};">${icon}</div>
      <div class="tx-mid">
        <div class="tx-title">${esc(title)}${ev?`<span class="tag">${ev.icon} ${esc(ev.name)}</span>`:''}${pending?'<span class="tag tag-pending">Dự kiến</span>':''}</div>
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
  txFilters = {type:'all', walletId:'all', catId:'all', eventId:'all', range:'all', status:'all'};
  syncTxFilterChips();
  renderTransactionsList(true);
}
/* Filters live in module-level `let`s, never inside `state` — so they are not
   written to localStorage and never ride along in a Supabase snapshot. The
   flip side is that they survive a sign-out: a wallet id from the previous
   account would leave every list on the next account mysteriously empty.
   Wipe them, and put the static chips/segments back in step. */
function resetSessionFilters(){
  txFilters = {type:'all', walletId:'all', catId:'all', eventId:'all', range:'all', status:'all'};
  reportWalletId = 'all'; reportRangeKey = 'thismonth'; donutMode = 'expense';
  reportIncludePending = false;
  upcomingFilter = 'thismonth';
  debtFilter = 'all';
  syncTxFilterChips();
  document.getElementById('tx-advanced-filters').classList.add('hidden');
  document.querySelectorAll('#upcoming-filter .chip').forEach(c=>c.classList.toggle('active', c.dataset.val==='thismonth'));
  document.querySelectorAll('#debt-seg .seg').forEach((s,i)=>s.classList.toggle('active', i===0));
  document.querySelectorAll('#report-range-seg .chip').forEach(c=>
    c.classList.toggle('active', c.dataset.val==='thismonth'));
  document.getElementById('report-custom-range').classList.add('hidden');
  document.getElementById('seg-donut-expense').classList.add('active');
  document.getElementById('seg-donut-income').classList.remove('active');
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
  let txs = getAllUserTransactions();
  if(txFilters.type!=='all'){
    txs = txFilters.type==='transfer' ? txs.filter(t=>t.type.startsWith('transfer')) : txs.filter(t=>t.type===txFilters.type);
  }
  if(txFilters.walletId!=='all') txs = txs.filter(t=>t.walletId===txFilters.walletId);
  if(txFilters.catId!=='all')    txs = txs.filter(t=>t.categoryId===txFilters.catId);
  if(txFilters.eventId!=='all')  txs = txs.filter(t=> txFilters.eventId==='none' ? !t.eventId : t.eventId===txFilters.eventId);
  if(txFilters.status!=='all')   txs = txs.filter(t=> txFilters.status==='pending' ? isPending(t) : !isPending(t));
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
  /* A wallet, category or event can be deleted (here or on another device via
     realtime) while it is the active filter. Left dangling, the list goes
     silently empty against an id nothing can ever match. */
  if(txFilters.walletId!=='all' && !getWallet(txFilters.walletId)) txFilters.walletId = 'all';
  if(txFilters.catId!=='all' && state.currentUser && !findAnyCategory(txFilters.catId)) txFilters.catId = 'all';
  if(txFilters.eventId!=='all' && txFilters.eventId!=='none'
     && !getUserEvents().some(e=>e.id===txFilters.eventId)) txFilters.eventId = 'all';

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
    document.getElementById('tx-filter-status').value = txFilters.status;
  } else {
    txFilters.walletId = document.getElementById('tx-filter-wallet').value || 'all';
    txFilters.catId    = document.getElementById('tx-filter-cat').value || 'all';
    txFilters.eventId  = document.getElementById('tx-filter-event').value || 'all';
    txFilters.status   = document.getElementById('tx-filter-status').value || 'all';
  }

  /* highlight the promoted wallet filter while it is narrowing the list */
  document.getElementById('tx-wallet-bar').classList.toggle('on', txFilters.walletId!=='all');

  const txs = filteredTransactions();
  let inc=0, exp=0;
  txs.forEach(t=>{ if(t.type==='income') inc+=txMain(t); else if(t.type==='expense') exp+=txMain(t); });
  document.getElementById('tx-summary').innerHTML = `
    <div><div class="text-xs muted">Thu</div><div class="text-sm font-bold c-income tabular">${fmt(inc)}</div></div>
    <div><div class="text-xs muted">Chi</div><div class="text-sm font-bold c-expense tabular">${fmt(exp)}</div></div>
    <div><div class="text-xs muted">Còn lại</div><div class="text-sm font-bold tabular ${inc-exp>=0?'c-income':'c-expense'}">${fmt(inc-exp)}</div></div>
    <div><div class="text-xs muted">Số GD</div><div class="text-sm font-bold tabular">${txs.length}</div></div>`;

  const container = document.getElementById('tx-list-container');
  if(!txs.length){ container.innerHTML = `<div class="empty-state"><div class="ic">${icon('search')}</div><div class="text-sm">Không tìm thấy giao dịch</div><div class="es-sub">Thử đổi bộ lọc hoặc từ khóa khác</div></div>`; return; }

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
    /* A transfer with a fee has THREE rows under one transferId: out, in, and
       the fee expense. Match on the transfer type too — matching on the id
       alone only found the right leg because of the order they were pushed. */
    const pair = t.transferId ? state.transactions.find(x=>
      x.transferId===t.transferId && x.id!==t.id && x.type.startsWith('transfer')) : null;
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
      ${t.recurringId?`<p class="text-sm mb8"><b>Nguồn:</b> Giao dịch định kỳ</p>`:''}
      ${t.debtId?`<p class="text-sm mb8"><b>Nguồn:</b> Sổ nợ</p>`:''}
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
  /* A transfer is never deleted alone: both legs go, plus the fee if there was
     one — leaving half a transfer would make the two wallets disagree about
     where the money is, and an orphan fee would point at nothing. Say so,
     rather than removing three rows behind a message that says "giao dịch". */
  const group = t.transferId ? state.transactions.filter(x=>x.transferId===t.transferId) : [t];
  const fee = group.find(x=>!x.type.startsWith('transfer'));
  const msg = group.length > 1
    ? `Cả hai chiều của lần chuyển tiền này sẽ bị xóa${fee ? `, kèm khoản phí ${fmtW(fee.amount, getWallet(fee.walletId))}` : ''}. Số dư hai ví sẽ được tính lại. Tiếp tục?`
    : 'Giao dịch này sẽ bị xóa khỏi sổ và số dư ví sẽ được tính lại.';
  uiConfirm('Xóa giao dịch', msg, 'Xóa').then(ok=>{
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
  writeMoney('tx-amount-raw', txAmount);
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
  writeMoney('tx-amount-raw', t.amount);
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

  /* Derived, never typed: a date ahead of today means the money has not moved. */
  const status = statusForDate(date);
  if(editingTxId){
    const t = state.transactions.find(x=>x.id===editingTxId);
    if(t) Object.assign(t, {type:currentTxType, amount:txAmount, walletId:txSelectedWalletId,
      categoryId:txSelectedCatId, subcategoryId:txSelectedSubId, note, date, eventId, status});
    editingTxId = null;
    toast(status==='pending' ? 'Đã cập nhật — vẫn là khoản dự kiến' : 'Đã cập nhật giao dịch','ok');
  } else {
    state.transactions.push({
      id:uid('t'), userId:state.currentUser, type:currentTxType, amount:txAmount,
      walletId:txSelectedWalletId, categoryId:txSelectedCatId, subcategoryId:txSelectedSubId,
      note, date, eventId, status, createdAt:new Date().toISOString()
    });
    toast(status==='pending'
      ? 'Đã lên lịch — chưa trừ tiền, xem ở "Sắp đến hạn"'
      : 'Đã lưu giao dịch','ok');
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
    writeMoney('tf-to-amount', tfAmount ? Number(converted.toFixed(2)) : '');
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
  const fee = readMoney('tf-fee');
  if(fromId===toId) return toast('Ví nguồn và ví đích phải khác nhau','err');
  if(!tfAmount || tfAmount<=0) return toast('Nhập số tiền hợp lệ','err');
  const fromW = getWallet(fromId), toW = getWallet(toId);
  let received = tfAmount;
  if(fromW.currency !== toW.currency){
    received = readMoney('tf-to-amount') || (toMain(tfAmount, fromW.currency)/rateOf(toW.currency)*rateOf(mainCurrency()));
    if(received <= 0) return toast('Nhập số tiền nhận được ở ví đích','err');
  }
  const transferId = uid('tr');
  const stamp = new Date().toISOString();
  /* Both legs and the fee share one status — a transfer must never be half
     settled, or the two wallets would disagree about where the money is. */
  const status = statusForDate(date);
  state.transactions.push(
    {id:uid('t'), userId:state.currentUser, type:'transfer_out', amount:tfAmount, walletId:fromId, note:note||`Chuyển sang ${toW.name}`, date, transferId, status, createdAt:stamp},
    {id:uid('t'), userId:state.currentUser, type:'transfer_in', amount:received, walletId:toId, note:note||`Nhận từ ${fromW.name}`, date, transferId, status, createdAt:stamp}
  );
  if(fee > 0){
    state.transactions.push({id:uid('t'), userId:state.currentUser, type:'expense', amount:fee, walletId:fromId,
      categoryId:'c_other_exp', subcategoryId:'s_other_exp', note:'Phí chuyển tiền', date, transferId, status, createdAt:stamp});
  }
  saveStorage();
  document.getElementById('tf-note').value=''; document.getElementById('tf-fee').value='';
  tfAmount = 0;
  toast(status==='pending' ? 'Đã lên lịch chuyển tiền — chưa trừ ví' : 'Đã chuyển tiền thành công','ok');
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
  if(!wallets.length){ listEl.innerHTML = `<div class="empty-state"><div class="ic">${icon('wallet')}</div><div class="text-sm">Chưa có ví nào</div><div class="es-sub">Tạo ví để bắt đầu ghi chép</div></div>`; return; }

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
      <div class="font-bold text-sm"><span class="order-badge">#${w.displayOrder||'?'}</span> ${esc(w.name)} ${w.excludeFromTotal?'<span class="tag">Không tính tổng</span>':''}</div>
      <div class="text-xs muted">Đầu kỳ ${fmtW(w.startingBalance,w)}${extra}</div>
      <div class="font-x ${bal>=0?'c-income':'c-expense'} tabular mt4">${fmtW(bal,w)}</div>
      ${w.currency!==mainCurrency()?`<div class="text-xs muted">≈ ${fmt(toMain(bal,w.currency))}</div>`:''}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      <button class="btn btn-secondary btn-xs" onclick="openWalletReport('${w.id}')">Báo cáo</button>
      <button class="btn btn-secondary btn-xs" onclick="openWalletModal('${w.id}')">Sửa</button>
      <button class="btn btn-danger btn-xs" onclick="deleteWallet('${w.id}')">Xóa</button>
    </div>
  </div>`;
}
function renderCreditCard(w){
  const used = getCardUsedAmount(w), avail = getCardAvailableLimit(w), pct = getCardUsagePct(w);
  return `<div class="cc-visual">
    <div class="cc-top">
      <div><div class="cc-name">${w.icon} ${esc(w.name)}</div><div class="cc-tag">#${w.displayOrder||'?'} · Thẻ tín dụng · ${w.currency}</div></div>
      <div class="cc-badge">${icon('card')}</div>
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
      <button class="btn-cc-edit" onclick="openWalletReport('${w.id}')">Báo cáo</button>
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
/* The order box is capped at the number of slots that actually exist, so the
   hint can say what "3" will mean before the user commits to it. */
function setWalletOrderField(value, max){
  const el = document.getElementById('mw-order');
  el.value = value || 1;
  el.max = Math.max(1, max);
  document.getElementById('mw-order-help').textContent =
    max > 1 ? `1 = đứng đầu, ${max} = cuối cùng. Đặt trùng số thì các ví sau tự lùi xuống.`
            : 'Ví số 1 đứng đầu ở Tổng quan và mọi danh sách chọn ví.';
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
    setWalletOrderField(w.displayOrder, getUserWallets().length);
    mwSelectedIcon = w.icon;
    selectWalletType(w.type || 'cash');
    if(isCreditCard(w)){
      writeMoney('mw-credit-limit', w.creditLimit||0);
      writeMoney('mw-used-amount', getCardUsedAmount(w));
      document.getElementById('mw-statement-date').value = w.statementDate||'';
      document.getElementById('mw-payment-due').value = w.paymentDueDate||'';
    } else {
      writeMoney('mw-starting-balance', w.startingBalance);
      document.getElementById('mw-interest').value = w.interestRate||'';
      document.getElementById('mw-maturity').value = w.maturityDate||'';
    }
  } else {
    document.getElementById('modal-wallet-title').textContent = 'Tạo ví mới';
    ['mw-wallet-id','mw-name','mw-starting-balance','mw-credit-limit','mw-used-amount','mw-statement-date','mw-payment-due','mw-interest','mw-maturity']
      .forEach(id=>document.getElementById(id).value='');
    document.getElementById('mw-exclude').checked = false;
    setWalletOrderField(nextWalletOrder(), nextWalletOrder());
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
  const wantedOrder = Number(document.getElementById('mw-order').value) || 0;
  if(!name) return toast('Nhập tên ví','err');
  let savedId = id;

  if(mwSelectedType==='credit_card'){
    const creditLimit = readMoney('mw-credit-limit');
    const usedAmount  = readMoney('mw-used-amount');
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
      savedId = uid('w');
      state.wallets.push({id:savedId, userId:state.currentUser, name, icon:mwSelectedIcon, type:'credit_card',
        currency, excludeFromTotal, creditLimit, statementDate, paymentDueDate, startingBalance:-usedAmount,
        displayOrder: nextWalletOrder()});
    }
  } else {
    const bal = readMoney('mw-starting-balance');
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
      const w = {id:uid('w'), userId:state.currentUser, name, icon:mwSelectedIcon, type:mwSelectedType, currency, excludeFromTotal, startingBalance:bal, displayOrder: nextWalletOrder()};
      if(mwSelectedType==='savings'){ w.interestRate = interestRate; w.maturityDate = maturityDate; }
      state.wallets.push(w);
      savedId = w.id;
    }
  }
  /* Placement runs after the wallet exists, so a brand-new one can be slotted
     straight into the middle; setWalletOrder() renumbers the rest to match. */
  if(wantedOrder && savedId) setWalletOrder(savedId, wantedOrder);
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
    normalizeWalletOrder();          /* close the gap the deletion left */
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
  writeMoney(amt, debt); amt.disabled = true;
  openModal('modal-card-payment');
}
function setMcpMode(mode, el){
  mcpPayMode = mode;
  el.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  const w = getWallet(mcpSelectedCardId);
  const input = document.getElementById('mcp-amount');
  if(mode==='full'){ writeMoney(input, w ? getCardUsedAmount(w) : 0); input.disabled = true; }
  else { input.disabled = false; input.value=''; input.focus(); }
}
function settleCardPayment(){
  const w = getWallet(mcpSelectedCardId);
  if(!w) return;
  const amount = readMoney('mcp-amount');
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
  if(b.categoryId==='__all__') return {icon:'🎯', color:'#00529C'};
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
    : `<div class="empty-state"><div class="ic">${icon('target')}</div><div class="text-sm">Chưa đặt hạn mức</div><div class="es-sub">Đặt hạn mức để nhận cảnh báo khi chi tiêu đạt 80% và 100%</div></div>`;
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
    writeMoney('mb-limit', b.limit);
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
  const limit = readMoney('mb-limit');
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
    el.innerHTML = `<div class="empty-state"><div class="ic">${icon('handshake')}</div><div class="text-sm">Không có khoản nợ nào</div><div class="es-sub">Ghi lại các khoản đi vay và cho vay để không quên hạn trả</div></div>`;
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
        <div class="w-avatar" style="background:${isBorrow?'var(--expense-bg)':'var(--income-bg)'};">${icon(isBorrow?'download':'upload')}</div>
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
    writeMoney('md-amount', d.amount);
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
  const amount = readMoney('md-amount');
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
  /* Without a wallet the payment would be written against walletId:'' and the
     money would vanish from every balance. */
  if(!getUserWallets().some(w=>!isCreditCard(w))) return toast('Cần ít nhất 1 ví thường để ghi nhận','err');
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
  if(mode==='full'){ writeMoney(input, d ? debtRemaining(d) : 0); input.disabled = true; }
  else { input.disabled = false; input.value=''; input.focus(); }
}
function saveDebtPayment(){
  const d = state.debts.find(x=>x.id===mdpDebtId);
  if(!d) return;
  const amount = readMoney('mdp-amount');
  const walletId = document.getElementById('mdp-wallet').value;
  const date = document.getElementById('mdp-date').value || todayISO();
  if(amount<=0) return toast('Nhập số tiền hợp lệ','err');
  if(!getWallet(walletId)) return toast('Chọn ví hợp lệ','err');
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
  /* Reachable from the dashboard's "Dự kiến phải chi" as well as the debts
     view — repaint whatever tab is actually on screen. */
  renderAll();
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
function createRecurringTx(r, dateStr, walletId){
  state.transactions.push({
    id:uid('t'), userId:r.userId, type:r.type||'expense', amount:r.amount,
    walletId: walletId || r.walletId,
    categoryId:r.categoryId, subcategoryId:r.subcategoryId, note:r.name, date:dateStr,
    recurringId:r.id, createdAt:new Date().toISOString()
  });
}
function autoProcessRecurring(){
  const today = todayISO();
  let changed = false, orphaned = 0;
  state.recurring.forEach(r=>{
    if(!r.autoProcess || r.dueDate > today) return;
    /* A deleted wallet would swallow the money: the transaction lands on a
       walletId no balance ever reads. Leave the occurrence due instead and let
       the ✓ prompt redirect it to a real wallet. */
    if(!getWallet(r.walletId)){ orphaned++; return; }
    let guard = 0;
    while(r.dueDate <= today && guard < 60){
      if(r.endDate && r.dueDate > r.endDate) break;
      createRecurringTx(r, r.dueDate);
      r.dueDate = nextDueDate(r.dueDate, r.frequency, r.interval);
      changed = true; guard++;
    }
  });
  if(changed) saveStorage();
  if(orphaned) toast(orphaned+' khoản định kỳ trỏ vào ví đã xóa — bấm ✓ để chọn ví khác','err');
}
/* A schedule is finished once its next occurrence would fall past the end date. */
function recurEnded(r){ return !!r.endDate && r.dueDate > r.endDate; }
/* Tapping ✓ must always end in a real transaction on a real wallet. The wallet
   a schedule points at can have been deleted, so show which wallet will be
   charged and let it be redirected, instead of dead-ending on an error toast. */
function payRecurring(id){
  const r = state.recurring.find(x=>x.id===id);
  if(!r) return;
  if(recurEnded(r)) return toast('Khoản này đã kết thúc vào '+fmtDate(r.endDate),'err');
  const wallets = getUserWallets();
  if(!wallets.length) return toast('Bạn cần tạo ít nhất 1 ví trước','err');
  const target = getWallet(r.walletId) || wallets[0];
  const income = r.type==='income';
  uiSheet('Xác nhận giao dịch',
    `<div class="text-sm mb4">${esc(r.name)}</div>
     <div class="text-lg font-bold ${income?'c-income':'c-expense'} tabular">${income?'+':'-'}${fmtW(r.amount, target)}</div>
     <div class="text-xs muted mb12">Đến hạn ${fmtDate(r.dueDate)}</div>
     ${getWallet(r.walletId) ? '' : '<div class="text-xs c-expense mb8">⚠ Ví cũ của khoản này đã bị xóa. Chọn ví khác để ghi nhận.</div>'}
     <div class="form-group field-row">
       <div><label>Ngày ghi nhận</label>
         <input type="date" id="pr-date" class="input" value="${r.dueDate}"></div>
       <div><label>Ghi vào ví</label>
         <select id="pr-wallet" class="input">${wallets.map(w=>
           `<option value="${w.id}" ${w.id===target.id?'selected':''}>${w.icon} ${esc(w.name)}</option>`).join('')}</select></div>
     </div>
     <button class="btn btn-primary" onclick="confirmPayRecurring('${r.id}')">Ghi nhận</button>
     <button class="btn btn-ghost mt8" onclick="closeSheet()">Hủy</button>`);
}
function confirmPayRecurring(id){
  const r = state.recurring.find(x=>x.id===id);
  if(!r) return closeSheet();
  const sel = document.getElementById('pr-wallet');
  const dateEl = document.getElementById('pr-date');
  const walletId = sel ? sel.value : r.walletId;
  const date = (dateEl && dateEl.value) || r.dueDate;
  const w = getWallet(walletId);
  if(!w) return toast('Chọn ví hợp lệ','err');
  if(!date) return toast('Chọn ngày ghi nhận','err');
  createRecurringTx(r, date, walletId);
  /* Redirecting the payment repairs the schedule too — otherwise the next
     occurrence lands on the same dead wallet. */
  r.walletId = walletId;
  /* The cadence stays anchored to the due date, not to when it was actually
     paid: trả muộn 4 ngày không được đẩy cả lịch đi 4 ngày. */
  r.dueDate = nextDueDate(r.dueDate, r.frequency, r.interval);
  saveStorage();
  closeSheet();
  toast('Đã ghi nhận '+fmtDate(date)+' vào ví '+w.name,'ok');
  renderAll();
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
    el.innerHTML = `<div class="empty-state"><div class="ic">${icon('repeat')}</div><div class="text-sm">Chưa có khoản định kỳ nào</div><div class="es-sub">Thêm tiền nhà, tiền mạng, lương... để tự động ghi sổ</div></div>`;
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
          ${ended?'':`<button class="btn-pay" title="${broken?'Ghi nhận và chọn ví khác':'Ghi nhận ngay'}" onclick="payRecurring('${r.id}')">✓</button>`}
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
    writeMoney('mr-amount', r.amount);
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
  const amount = readMoney('mr-amount');
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

/* Confirm a scheduled transaction early. The date moves to today because that
   is when the money actually leaves — which also keeps the invariant that a
   completed transaction is never dated in the future. */
function settlePendingTx(txId){
  const t = state.transactions.find(x=>x.id===txId);
  if(!t || !isPending(t)) return;
  const w = getWallet(t.walletId);
  if(!w) return toast('Ví của giao dịch này không còn tồn tại — hãy sửa lại','err');
  const planned = t.date, today = todayISO();
  const when = planned === today ? '' : ` (dự kiến ${fmtDate(planned)})`;
  uiConfirm('Xác nhận đã chi',
    `Ghi nhận "${t.note || catOf(t).name}" — ${fmtW(t.amount, w)} vào ví ${w.name} hôm nay${when}?`,
    'Đã chi').then(ok=>{
    if(!ok) return;
    /* the whole transfer pair settles together or the two wallets disagree */
    const group = t.transferId
      ? state.transactions.filter(x=>x.transferId===t.transferId && isPending(x))
      : [t];
    group.forEach(x=>{ x.status = 'completed'; if(x.date > today) x.date = today; });
    saveStorage();
    toast('Đã ghi nhận giao dịch','ok');
    renderAll();
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
    /* No wallet means no known currency — read the amount as already being in
       the main currency rather than letting rateOf() fall back to 1. */
    .map(r=>({kind:'recurring', id:r.id, name:r.name, dueDate:r.dueDate, walletId:r.walletId,
              amount:toMain(r.amount, (getWallet(r.walletId)||{}).currency || mainCurrency())}));
  const cardItems = getUserWallets()
    .filter(w=> isCreditCard(w) && getCardUsedAmount(w) > 0)
    .map(w=>({kind:'card', id:w.id, name:w.name+' (Thẻ tín dụng)', amount:toMain(getCardUsedAmount(w), w.currency), dueDate:getCardNextDueDate(w), walletId:w.id}))
    .filter(it=> it.dueDate <= rangeEnd);
  const debtItems = getUserDebts()
    .filter(d=> d.kind==='borrow' && debtRemaining(d)>0 && d.dueDate && d.dueDate <= rangeEnd)
    .map(d=>({kind:'debt', id:d.id, name:'Trả nợ '+d.party, amount:toMain(debtRemaining(d), debtCurrency(d)), dueDate:d.dueDate, walletId:d.walletId}));
  /* Future-dated expenses the user has already entered. Only expenses: the
     card totals "dự kiến phải chi", and scheduled income/transfers would
     quietly cancel it out. They stay visible in the Giao dịch list. */
  const pendingItems = getPendingTransactions()
    .filter(t=> t.type==='expense' && t.date <= rangeEnd)
    .map(t=>({kind:'tx', id:t.id, name:t.note || catOf(t).name, amount:txMain(t), dueDate:t.date, walletId:t.walletId}));
  return [...recurItems, ...cardItems, ...debtItems, ...pendingItems].sort((a,b)=> a.dueDate<b.dueDate?-1:1);
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
    const icons = {card:'card', debt:'handshake', recurring:'clock', tx:'crystal'};
    const actions = {card:`openCardPaymentModal('${it.id}')`, debt:`openDebtPayModal('${it.id}')`,
                     recurring:`payRecurring('${it.id}')`, tx:`settlePendingTx('${it.id}')`};
    const sub = it.kind==='tx' || it.kind==='recurring'
      ? (wallet?esc(wallet.name):'⚠ Ví đã xóa')+' · ' : '';
    return `<div class="upcoming-row">
      <div class="up-ic ${it.kind==='card'?'up-ic-card':''}">${icon(icons[it.kind])}</div>
      <div class="up-mid">
        <div class="up-title">${esc(it.name)}</div>
        <div class="up-sub ${overdue?'up-overdue':''}">${sub}${relDueLabel(it.dueDate).text}</div>
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
    el.innerHTML = `<div class="empty-state"><div class="ic">${icon('plane')}</div><div class="text-sm">Chưa có sự kiện nào</div><div class="es-sub">Gom nhóm chi tiêu cho chuyến du lịch, đám cưới, sinh nhật...</div></div>`;
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
  writeMoney('me-budget', ev && ev.budget ? ev.budget : '');
  buildEmojiPicker('me-icon-picker', meIcon, e=>{ meIcon = e; });
  openModal('modal-event');
}
function saveEventModal(){
  const id = document.getElementById('me-event-id').value;
  const name = document.getElementById('me-name').value.trim();
  const startDate = document.getElementById('me-start').value;
  const endDate = document.getElementById('me-end').value;
  const budget = readMoney('me-budget');
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
  const count = getAllUserTransactions().filter(t=>t.eventId===id).length;
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
  getAllUserTransactions().forEach(t=>{ usage[t.categoryId] = (usage[t.categoryId]||0)+1; });
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
  const used = getAllUserTransactions().filter(t=>t.categoryId===catId);
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

function setDonutMode(mode){
  donutMode = mode;
  renderReportsView();      /* repaints the switcher too */
}
/* Range for the report period, shifted by `extra` periods relative to the current view */
/* Preset windows instead of a period type plus an offset: people reach for
   "tháng trước" far more often than they reach for "hai kỳ về trước", and the
   trend chart below always walks months regardless of what is picked here. */
function reportRange(){
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  let start, end, label;
  switch(reportRangeKey){
    case 'lastmonth':
      start = new Date(y, m-1, 1); end = new Date(y, m, 0);
      label = `Tháng ${start.getMonth()+1}/${start.getFullYear()}`; break;
    case '3months':
      start = new Date(y, m-2, 1); end = new Date(y, m+1, 0);
      label = `${start.getMonth()+1}/${String(start.getFullYear()).slice(2)} – ${m+1}/${String(y).slice(2)}`; break;
    case 'thisyear':
      start = new Date(y, 0, 1); end = new Date(y, 12, 0);
      label = `Năm ${y}`; break;
    case 'custom': {
      const f = (document.getElementById('rep-from')||{}).value;
      const t = (document.getElementById('rep-to')||{}).value;
      const from = f || isoOf(new Date(y, m, 1));
      const to   = t || todayISO();
      /* tolerate the two dates being entered the wrong way round */
      const lo = from <= to ? from : to, hi = from <= to ? to : from;
      return {start: lo, end: hi, label: `${fmtDate(lo)} – ${fmtDate(hi)}`};
    }
    default:
      start = new Date(y, m, 1); end = new Date(y, m+1, 0);
      label = `Tháng ${m+1}/${y}`;
  }
  return {start:isoOf(start), end:isoOf(end), label};
}
/* One calendar month, `back` months ago — the unit of the trend chart. */
function monthWindow(back){
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth()-back, 1);
  const end   = new Date(start.getFullYear(), start.getMonth()+1, 0);
  return {start:isoOf(start), end:isoOf(end),
          shortLabel:`${start.getMonth()+1}/${String(start.getFullYear()).slice(2)}`};
}
function setReportRange(key, el){
  reportRangeKey = key;
  if(el){ el.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.remove('active')); el.classList.add('active'); }
  const custom = document.getElementById('report-custom-range');
  custom.classList.toggle('hidden', key!=='custom');
  if(key==='custom'){
    const f = document.getElementById('rep-from'), t = document.getElementById('rep-to');
    if(!f.value) f.value = isoOf(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    if(!t.value) t.value = todayISO();
  }
  renderReportsView();
}
/* Wallets currently in scope for the report — one wallet, or every wallet that counts
   toward net worth. Returned as a Set of ids for cheap lookups in the chart loops. */
function reportWalletScope(){
  if(reportWalletId!=='all' && getWallet(reportWalletId)) return new Set([reportWalletId]);
  return new Set(getUserWallets().filter(w=>!w.excludeFromTotal).map(w=>w.id));
}
function inReportScope(t){ return reportWalletId==='all' || t.walletId===reportWalletId; }
/* Reports read completed rows only unless the user asks to preview what the
   period will look like once the scheduled ones land. */
function reportSource(){ return reportIncludePending ? getAllUserTransactions() : getUserTransactions(); }
function toggleReportPending(){
  reportIncludePending = !reportIncludePending;
  renderReportsView();
}
function txInRange(r){ return reportSource().filter(t=>t.date>=r.start && t.date<=r.end && inReportScope(t)); }
function setReportWallet(id){
  reportWalletId = id;
  renderReportsView();
}
/* Dashboard wallet card → report scoped to that wallet */
function openWalletReport(walletId){
  reportWalletId = walletId;
  reportRangeKey = 'thismonth';
  switchTab('reports');
  document.querySelectorAll('#report-range-seg .chip').forEach(c=>
    c.classList.toggle('active', c.dataset.val==='thismonth'));
  document.getElementById('report-custom-range').classList.add('hidden');
}

function renderReportsView(){
  if(reportWalletId!=='all' && !getWallet(reportWalletId)) reportWalletId = 'all';
  document.getElementById('report-pending-chip').classList.toggle('active', reportIncludePending);
  /* one owner for the switcher's lit state, so it can never drift from donutMode */
  document.getElementById('seg-donut-expense').classList.toggle('active', donutMode==='expense');
  document.getElementById('seg-donut-income').classList.toggle('active', donutMode==='income');
  document.getElementById('report-wallet-filter').innerHTML =
    `<div class="chip ${reportWalletId==='all'?'active':''}" onclick="setReportWallet('all')">${icon('layers')}Tất cả ví</div>` +
    getUserWallets().map(w=>
      `<div class="chip ${reportWalletId===w.id?'active':''}" onclick="setReportWallet('${w.id}')">${w.icon} ${esc(w.name)}</div>`).join('');

  const r = reportRange();
  document.getElementById('report-period-label').textContent = r.label;
  const txs = txInRange(r);
  let inc=0, exp=0;
  const catTotals = {expense:{}, income:{}};
  txs.forEach(t=>{
    const v = txMain(t);
    if(t.type==='income'){ inc+=v; catTotals.income[t.categoryId] = (catTotals.income[t.categoryId]||0)+v; }
    else if(t.type==='expense'){ exp+=v; catTotals.expense[t.categoryId] = (catTotals.expense[t.categoryId]||0)+v; }
  });
  setAmount('rep-income', fmt(inc));
  setAmount('rep-expense', fmt(exp));
  const net = inc-exp;
  setAmount('rep-net', (net>=0?'+':'') + fmt(net));
  document.getElementById('rep-net-card').className = 'sum-card net ' + (net>=0?'pos':'neg');
  /* how much of what came in survived the period */
  document.getElementById('rep-net-sub').textContent = inc > 0
    ? `Giữ lại ${Math.round(net/inc*100)}% thu nhập · ${txs.length} giao dịch`
    : `${txs.length} giao dịch trong kỳ`;

  /* donut */
  const mode = donutMode, total = mode==='expense' ? exp : inc;
  const entries = Object.entries(catTotals[mode]).sort((a,b)=>b[1]-a[1]);
  const data = entries.map(([cid,val])=>{
    const c = findCategory(mode, cid) || {name:'Khác', color:'#94A3B8', icon:'📦'};
    return {label:c.name, value:val, color:c.color, icon:c.icon};
  });
  safeDraw('cơ cấu danh mục', ()=>{
    drawDonut('chart-donut', data, total, mode==='expense'?'Tổng chi':'Tổng thu');
    bindDonutTip('chart-donut', 'tip-donut');
  });
  document.getElementById('donut-legend').innerHTML = data.slice(0,8).map(d=>
    `<div class="legend-item"><span class="legend-dot" style="background:${d.color};"></span>${esc(d.label)} ${total?Math.round(d.value/total*100):0}%</div>`).join('');

  /* category detail list */
  /* ranked list — bars are relative to the biggest category, not to the total,
     so the ordering stays legible when one category dwarfs the rest */
  const catListEl = document.getElementById('rep-cat-list');
  const top = entries.length ? entries[0][1] : 0;
  catListEl.innerHTML = entries.length ? entries.map(([cid,val],i)=>{
    const c = findCategory(mode,cid) || {name:'Khác',icon:'📦',color:'#94A3B8'};
    const pct = total ? Math.round(val/total*100) : 0;
    const bar = top ? Math.max(3, Math.round(val/top*100)) : 0;
    const count = txs.filter(t=>t.categoryId===cid && t.type===mode).length;
    return `<div class="rank-row ripple-host" onclick="jumpToCategory('${cid}')" style="cursor:pointer;">
      <span class="rank-no">${i+1}</span>
      <div class="cat-circle" style="width:34px;height:34px;font-size:1rem;background:${c.color}22;">${c.icon}</div>
      <div class="rank-mid">
        <div class="rank-head">
          <span class="rank-name">${esc(c.name)}<span class="rank-pct">${pct}%</span></span>
          <span class="rank-amt tabular">${fmt(val)}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${bar}%;background:${c.color};"></div></div>
        <div class="text-xs muted mt4">${count} giao dịch</div>
      </div>
    </div>`;
  }).join('') : `<p class="text-sm muted text-center">Không có dữ liệu trong kỳ này</p>`;

  /* 6-period bar + line */
  const series = [];
  for(let i=5;i>=0;i--){
    const rr = monthWindow(i);
    let ri=0, re=0;
    reportSource().forEach(t=>{
      if(t.date<rr.start || t.date>rr.end || !inReportScope(t)) return;
      if(t.type==='income') ri += txMain(t);
      else if(t.type==='expense') re += txMain(t);
    });
    series.push({label:rr.shortLabel, inc:ri, exp:re, end:rr.end});
  }
  safeDraw('dòng tiền', ()=>{
    drawBars('chart-bar', series);
    bindBarTip('chart-bar', 'tip-bar');
  });

  /* cumulative balance at the end of each period — whole portfolio, or the picked wallet */
  const scope = reportWalletScope();
  const openingBalance = getUserWallets().filter(w=>scope.has(w.id))
    .reduce((s,w)=>s+toMain(w.startingBalance||0, w.currency),0);
  const linePoints = series.map(s=>{
    let cum = openingBalance;
    reportSource().forEach(t=>{
      if(t.date > s.end || !scope.has(t.walletId)) return;
      const v = txMain(t);
      if(t.type==='income'||t.type==='transfer_in') cum += v;
      else if(t.type==='expense'||t.type==='transfer_out') cum -= v;
    });
    return {label:s.label, value:cum};
  });
  safeDraw('xu hướng số dư', ()=>drawLine('chart-line', linePoints));

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
/* Land on the Giao dịch tab with exactly one filter applied. Everything else —
   chips, search box, the other selects — is reset, so the list can never
   disagree with what the filter UI says it is showing. switchTab() renders in
   rebuild mode, which repaints the selects *from* txFilters; calling
   renderTransactionsList() without rebuild here would read the stale selects
   back over the filter we just set. */
function jumpToTransactions(patch){
  txFilters = Object.assign({type:'all', walletId:'all', catId:'all', eventId:'all', range:'all', status:'all'}, patch||{});
  syncTxFilterChips();
  switchTab('transactions');
}
function syncTxFilterChips(){
  const s = document.getElementById('tx-search');
  if(s) s.value = '';
  document.querySelectorAll('#tx-filter-type .chip').forEach(c=>c.classList.toggle('active', c.dataset.val===txFilters.type));
  document.querySelectorAll('#tx-filter-range .chip').forEach(c=>c.classList.toggle('active', c.dataset.val===txFilters.range));
  document.getElementById('tx-custom-range').classList.add('hidden');
}
function jumpToWallet(walletId){ jumpToTransactions({walletId}); }
function jumpToCategory(catId){
  jumpToTransactions({catId});
  /* the category select still lives in the collapsed panel — open it so the
     active filter is visible */
  document.getElementById('tx-advanced-filters').classList.remove('hidden');
}

/* ---------- CANVAS CHART HELPERS ---------- */
function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
/* renderReportsView() paints the charts before it builds the ranked list, so
   anything thrown inside a draw used to take the numbers down with it and
   leave the card empty. A chart is decoration; the figures are the point. */
function safeDraw(label, fn){
  try{ fn(); }
  catch(err){ console.warn('Không vẽ được biểu đồ ' + label, err); }
}
function setupCanvas(id){
  const canvas = document.getElementById(id);
  if(!canvas || !canvas.getContext) return null;

  /* Let CSS decide the width FIRST, then measure what it settled on.
     Reading canvas.clientWidth instead would measure the pixel width we
     pinned on the previous pass — the first size would stick forever, so
     rotating the phone left the bitmap wide while `max-width:100%` squeezed
     the element: blurry, overflowing, and every tooltip hit-test off by the
     difference. A percentage width cannot go stale, and it accounts for the
     card's padding without us having to know about it. */
  /* `data-fill` means the wrapper decides both dimensions (the square donut
     box); otherwise the height comes from the element's own attribute. */
  const fill = canvas.hasAttribute('data-fill');
  const attrH = Number(canvas.getAttribute('height')) || 200;
  canvas.style.width = '100%';
  canvas.style.height = fill ? '100%' : attrH + 'px';
  const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : {width:0, height:0};
  /* A hidden or not-yet-laid-out canvas measures 0. Falling through to a
     sane default keeps the draw from dividing by zero and leaving a blank
     card that never repairs itself. */
  const cssW = Math.max(1, Math.round(r.width) || canvas.clientWidth || 300);
  const cssH = fill ? Math.max(1, Math.round(r.height) || canvas.clientHeight || 300)
                    : attrH;

  /* Above 3x the extra pixels are invisible and the bitmap gets 16x heavier —
     a 512px-wide donut at dpr 4 is an 8MB buffer redrawn on every filter tap. */
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  if(!ctx) return null;
  /* setTransform, not scale: assigning width/height already reset the matrix,
     and scale() would compound if that ever stopped being true. */
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return {ctx, w:cssW, h:cssH};
}
/* Geometry the tooltips hit-test against. Filled while drawing so a pointer
   move never has to recompute — or redraw — anything. */
let chartHit = {donut:null, bars:null};

function drawDonut(id, data, total, centerLabel){
  const c = setupCanvas(id); if(!c) return;
  const {ctx,w,h} = c;
  const cx = w/2, cy = h/2, rOuter = Math.min(w,h)/2 - 8, rInner = rOuter*0.62;
  const cardBg = cssVar('--card') || '#fff';
  if(!total || !data.length){
    /* Drop the previous chart's geometry. Leaving it meant switching to a mode
       with no data kept the old slices live under an empty ring: touching it
       popped a tooltip naming categories that were not on screen, and painted
       a percentage over the "no data" label. */
    chartHit.donut = null;
    ctx.beginPath(); ctx.arc(cx,cy,rOuter,0,2*Math.PI); ctx.fillStyle = cssVar('--card-2'); ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,rInner,0,2*Math.PI); ctx.fillStyle = cardBg; ctx.fill();
    ctx.fillStyle = cssVar('--muted'); ctx.font='13px sans-serif'; ctx.textAlign='center';
    ctx.fillText('Không có dữ liệu', cx, cy+5);
    return;
  }
  let start = -Math.PI/2;
  const slices = [];
  data.forEach(d=>{
    const angle = (d.value/total)*2*Math.PI;
    /* a soft gradient per slice reads less flat than one solid fill */
    const g = ctx.createLinearGradient(cx-rOuter, cy-rOuter, cx+rOuter, cy+rOuter);
    g.addColorStop(0, d.color);
    g.addColorStop(1, mixHex(d.color, '#FFFFFF', 0.34));
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,rOuter,start,start+angle); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = cardBg; ctx.lineWidth = 2; ctx.stroke();
    slices.push({from:start, to:start+angle, label:d.label, value:d.value,
                 pct: Math.round(d.value/total*100), color:d.color, icon:d.icon});
    start += angle;
  });
  ctx.beginPath(); ctx.arc(cx,cy,rInner,0,2*Math.PI); ctx.fillStyle = cardBg; ctx.fill();

  chartHit.donut = {cx, cy, rOuter, rInner, slices, total, centerLabel};
  paintDonutCentre(ctx, chartHit.donut, null);
}

/* The hole doubles as the readout: the total by default, the touched slice's
   share while a finger is on the chart. Only this patch is repainted. */
function paintDonutCentre(ctx, geo, slice){
  const cardBg = cssVar('--card') || '#fff';
  ctx.beginPath(); ctx.arc(geo.cx, geo.cy, geo.rInner-1, 0, 2*Math.PI);
  ctx.fillStyle = cardBg; ctx.fill();
  ctx.textAlign = 'center';
  if(slice){
    ctx.fillStyle = slice.color; ctx.font = 'bold 22px sans-serif';
    ctx.fillText(slice.pct + '%', geo.cx, geo.cy - 2);
    ctx.fillStyle = cssVar('--muted'); ctx.font = '11px sans-serif';
    ctx.fillText(trimLabel(slice.label, 16), geo.cx, geo.cy + 16);
  } else {
    ctx.fillStyle = cssVar('--text'); ctx.font = 'bold 15px sans-serif';
    ctx.fillText(fmt(geo.total), geo.cx, geo.cy + 4);
    ctx.fillStyle = cssVar('--muted'); ctx.font = '11px sans-serif';
    ctx.fillText(geo.centerLabel || 'Tổng', geo.cx, geo.cy + 21);
  }
}
function trimLabel(t, n){ return t.length > n ? t.slice(0, n-1) + '…' : t; }
/* Blend two #rrggbb colours — used for the slice gradients. */
function mixHex(a, b, t){
  const pick = (h,i)=>parseInt(h.slice(1+i*2, 3+i*2), 16);
  if(!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  const out = [0,1,2].map(i=>Math.round(pick(a,i) + (pick(b,i)-pick(a,i))*t));
  return '#' + out.map(v=>v.toString(16).padStart(2,'0')).join('');
}
/* ---------- CHART TOOLTIPS ----------
   Pointer events on the canvas, a plain DOM node for the bubble. Nothing is
   redrawn while the finger moves except the donut's centre patch, so dragging
   across a chart stays smooth on a phone. */
function bindChartTip(canvasId, tipId, resolve){
  const cv = document.getElementById(canvasId), tip = document.getElementById(tipId);
  if(!cv || !tip) return;
  if(cv.__tipBound) return;          /* renderReportsView runs on every filter change */
  cv.__tipBound = true;

  const hide = ()=>{ tip.classList.add('hidden'); resolve(null, tip); };
  const move = e=>{
    const r = cv.getBoundingClientRect();
    const hit = resolve({x: e.clientX - r.left, y: e.clientY - r.top}, tip);
    if(!hit){ tip.classList.add('hidden'); return; }
    tip.innerHTML = hit.html;
    tip.classList.remove('hidden');
    /* keep the bubble inside the canvas */
    const half = tip.offsetWidth/2 + 4;
    tip.style.left = Math.min(Math.max(hit.x, half), r.width - half) + 'px';
    tip.style.top  = Math.max(hit.y, tip.offsetHeight + 6) + 'px';
  };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerdown', move);
  cv.addEventListener('pointerleave', hide);
  cv.addEventListener('pointercancel', hide);
}

function bindDonutTip(canvasId, tipId){
  bindChartTip(canvasId, tipId, (pt, tip)=>{
    const geo = chartHit.donut;
    if(!geo) return null;
    const cv = document.getElementById(canvasId);
    const ctx = cv.getContext('2d');
    if(!pt){ if(ctx && geo) paintDonutCentre(ctx, geo, null); return null; }
    const dx = pt.x - geo.cx, dy = pt.y - geo.cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if(dist < geo.rInner || dist > geo.rOuter){
      if(ctx) paintDonutCentre(ctx, geo, null);
      return null;
    }
    /* atan2 measured from the same -90° the arcs start at */
    let a = Math.atan2(dy, dx);
    if(a < -Math.PI/2) a += 2*Math.PI;
    const slice = geo.slices.find(sl=> a >= sl.from && a < sl.to);
    if(!slice){ if(ctx) paintDonutCentre(ctx, geo, null); return null; }
    if(ctx) paintDonutCentre(ctx, geo, slice);
    return {
      x: geo.cx + Math.cos((slice.from+slice.to)/2) * (geo.rOuter*0.78),
      y: geo.cy + Math.sin((slice.from+slice.to)/2) * (geo.rOuter*0.78),
      html: `<div>${esc(slice.label)}</div>
             <div class="tip-val">${fmt(slice.value)}</div>
             <div class="tip-sub">${slice.pct}% tổng kỳ</div>`
    };
  });
}

function bindBarTip(canvasId, tipId){
  bindChartTip(canvasId, tipId, pt=>{
    const geo = chartHit.bars;
    if(!geo || !pt) return null;
    if(pt.x < geo.padL || pt.x > geo.padL + geo.chartW) return null;
    const i = Math.floor((pt.x - geo.padL) / geo.groupW);
    const s = geo.series[i];
    if(!s) return null;
    const net = s.inc - s.exp;
    return {
      x: geo.padL + i*geo.groupW + geo.groupW/2,
      y: geo.padT + 4,
      html: `<div>Tháng ${esc(s.label)}</div>
             <div class="tip-val" style="color:var(--primary);">Thu ${fmt(s.inc)}</div>
             <div class="tip-val" style="color:var(--brand-red);">Chi ${fmt(s.exp)}</div>
             <div class="tip-sub">Ròng ${net>=0?'+':''}${fmt(net)}</div>`
    };
  });
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
  /* the eye toggle has to reach the axis too, or the numbers a person hid are
     still legible to whoever is looking over their shoulder */
  if(state.app && state.app.privacy) return '•••';
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
  /* brand blue for money in, brand red for money out */
  const cIn = cssVar('--primary') || '#00529C', cOut = cssVar('--brand-red') || '#ED1C24';
  const groupW = chartW/series.length;
  series.forEach((s,i)=>{
    const gx = padL + i*groupW, barW = Math.min(16, groupW*0.28);
    const incH = (s.inc/maxVal)*chartH, expH = (s.exp/maxVal)*chartH;
    ctx.fillStyle = cIn;  roundRect(ctx, gx+groupW/2-barW-3, padT+chartH-incH, barW, incH, 3); ctx.fill();
    ctx.fillStyle = cOut; roundRect(ctx, gx+groupW/2+3, padT+chartH-expH, barW, expH, 3); ctx.fill();
    ctx.fillStyle = cssVar('--muted'); ctx.font='9px sans-serif'; ctx.textAlign='center';
    ctx.fillText(s.label, gx+groupW/2, h-7);
  });
  chartHit.bars = series.length ? {padL, padT, chartW, chartH, groupW, series} : null;
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
  const primary = cssVar('--primary') || '#00529C';
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
/* The service grid, iPay style: exactly 4x2. `tone` colours the three money
   verbs; everything else stays brand blue. Giao dịch and Báo cáo are left out
   on purpose — both already own a slot in the bottom nav. */
const FEATURE_TILES = [
  /* Ghi chi tiêu / Ghi thu nhập / Chuyển ví are deliberately absent: the FAB
     in the middle of the nav already opens that screen, and a second door to
     the same room only costs space. */
  {tab:'wallets',    icon:'wallet',    name:'Ví & TK'},
  {tab:'budget',     icon:'target',    name:'Ngân sách',
    badge:()=>getUserBudgets().filter(b=>effectivePeriodKey(b)===currentPeriodKey(b.period) && b.limit && getBudgetSpent(b)/b.limit>=0.8).length},
  {tab:'debts',      icon:'handshake', name:'Sổ nợ',
    badge:()=>getUserDebts().filter(d=>debtRemaining(d)>0).length},
  {tab:'recurring',  icon:'repeat',    name:'Định kỳ',
    badge:()=>getUserRecurring().filter(r=>daysBetween(todayISO(), r.dueDate)<=7).length},
  /* iPay's "tất cả dịch vụ" tile: the grid stays 4x2 and nothing becomes
     unreachable now that the More tab is gone. */
  {action:'openAllFeatures()', icon:'layers', name:'Tất cả'}
];
/* Everything that did not fit the eight slots. */
const MORE_FEATURES = [
  {action:"openAddTransaction('transfer')", icon:'swap', name:'Chuyển tiền giữa ví',
   sub:'Rút quỹ, nạp ví, trả thẻ'},
  {tab:'events',       icon:'plane', name:'Sự kiện / Chuyến đi', sub:'Gom chi tiêu theo chuyến đi'},
  {tab:'categories',   icon:'tag',   name:'Danh mục',            sub:'Sửa danh mục và danh mục con'},
  {tab:'transactions', icon:'list',  name:'Sổ giao dịch',        sub:'Tìm và lọc toàn bộ giao dịch'},
  {tab:'reports',      icon:'chart', name:'Báo cáo',             sub:'Biểu đồ thu chi theo kỳ'}
];
function openAllFeatures(){
  uiSheet('Tất cả tiện ích', MORE_FEATURES.map(f=>
    `<div class="setting-row pointer" onclick="closeSheet();${f.action || `switchTab('${f.tab}')`}">
       <div class="sr-ic">${icon(f.icon)}</div>
       <div class="sr-mid"><div class="sr-title">${f.name}</div><div class="sr-sub">${f.sub}</div></div>
       <span class="muted">›</span>
     </div>`).join('') +
    `<button class="btn btn-ghost mt12" onclick="closeSheet()">Đóng</button>`);
}
/* Jump into the add screen already on the right type. */
function openAddTransaction(type){
  switchTab('add');
  setTxType(type);
}
function renderFeatureTiles(containerId, extraHtml){
  const el = document.getElementById(containerId);
  if(!el) return;
  el.innerHTML = FEATURE_TILES.map(f=>{
    let n = 0;
    try{ n = f.badge ? f.badge() : 0; }catch(e){ n = 0; }
    const go = f.action || `switchTab('${f.tab}')`;
    return `<div class="menu-tile ripple-host" onclick="${go}">
      ${n>0?`<span class="mt-badge">${n}</span>`:''}
      <span class="mt-ic${f.tone?' tone-'+f.tone:''}">${icon(f.icon)}</span>
      <span class="mt-name">${f.name}</span>
    </div>`;
  }).join('') + (extraHtml||'');
}

/* ============================================================
   ACCOUNT SUMMARY — lives in Settings since the More tab was removed
   ============================================================ */
function renderAccountSummary(){
  const el = document.getElementById('account-summary');
  if(!el) return;
  const txs = getAllUserTransactions();
  const debts = getUserDebts().filter(d=>debtRemaining(d)>0);
  el.innerHTML = `
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
  renderAccountSummary();
  renderAppInfo();
}

/* ============================================================
   PWA — service worker + install prompt
   ============================================================ */
let deferredInstall = null;      /* the beforeinstallprompt event, if offered */
let swUpdateReady = false;

function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;     /* iOS Safari */
}
/* iOS never fires beforeinstallprompt — the only route is Share → Add to Home
   Screen, so we detect it and show the steps instead of a dead button. */
function isIOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
      && !/crios|fxios|edgios/i.test(navigator.userAgent);
}

function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  /* Version the worker URL from the build stamp: a new deploy is a new script
     to the browser, which is what triggers install + old-cache cleanup. */
  const build = (window.__ENV__ && window.__ENV__.BUILD) || 'dev';
  navigator.serviceWorker.register('/sw.js?v=' + encodeURIComponent(build))
    .then(reg=>{
      reg.addEventListener('updatefound', ()=>{
        const sw = reg.installing;
        if(!sw) return;
        sw.addEventListener('statechange', ()=>{
          /* an existing controller means this is an upgrade, not a first install */
          if(sw.state === 'installed' && navigator.serviceWorker.controller){
            swUpdateReady = true;
            if(currentTab === 'settings') renderAppInfo();
            toast('Có bản cập nhật mới — mở Cài đặt để tải lại');
          }
        });
      });
    })
    .catch(err=>console.warn('Service worker không đăng ký được', err));
}

function applyAppUpdate(){
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistration().then(reg=>{
    if(reg && reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
    /* flush before the reload, or the 800ms debounce eats the last write */
    Sync.flush().finally(()=>location.reload());
  });
}

async function promptInstall(){
  if(!deferredInstall) return;
  deferredInstall.prompt();
  const {outcome} = await deferredInstall.userChoice;
  deferredInstall = null;                 /* a prompt event is single-use */
  renderAppInfo();
  if(outcome === 'accepted') toast('Đang cài đặt ứng dụng…','ok');
}

function showIOSInstallHelp(){
  uiSheet('Cài lên màn hình chính',
    `<p class="text-sm muted mb12">Safari trên iOS không có nút cài tự động. Làm 3 bước:</p>
     <ol class="cfg-steps">
       <li>Bấm nút <b>Chia sẻ</b> ⬆️ ở thanh dưới Safari</li>
       <li>Chọn <b>Thêm vào MH chính</b> (Add to Home Screen)</li>
       <li>Bấm <b>Thêm</b> — SoFin sẽ chạy toàn màn hình như app</li>
     </ol>
     <button class="btn btn-primary mt12" onclick="closeSheet()">Đã hiểu</button>`);
}

function renderAppInfo(){
  const el = document.getElementById('app-info');
  if(!el) return;
  const installed = isStandalone();
  let installRow;
  if(installed){
    installRow = `<div class="setting-row">
      <div class="sr-ic" style="color:var(--income);">${icon('check')}</div>
      <div class="sr-mid"><div class="sr-title">Đã cài trên thiết bị này</div>
        <div class="sr-sub">Đang chạy ở chế độ toàn màn hình</div></div>
    </div>`;
  } else if(deferredInstall){
    installRow = `<div class="setting-row pointer" onclick="promptInstall()">
      <div class="sr-ic" style="color:var(--primary);">${icon('download')}</div>
      <div class="sr-mid"><div class="sr-title">Tải / Cài đặt ứng dụng lên thiết bị</div>
        <div class="sr-sub">Chạy toàn màn hình, mở được cả khi mất mạng</div></div>
      <span class="muted">›</span>
    </div>`;
  } else if(isIOS()){
    installRow = `<div class="setting-row pointer" onclick="showIOSInstallHelp()">
      <div class="sr-ic">${icon('phone')}</div>
      <div class="sr-mid"><div class="sr-title">Thêm vào màn hình chính</div>
        <div class="sr-sub">Safari: Chia sẻ → Thêm vào MH chính</div></div>
      <span class="muted">›</span>
    </div>`;
  } else {
    installRow = `<div class="setting-row">
      <div class="sr-ic">${icon('cloud')}</div>
      <div class="sr-mid"><div class="sr-title">Đang chạy trong trình duyệt</div>
        <div class="sr-sub">Trình duyệt này chưa mời cài đặt — thử Chrome hoặc Edge</div></div>
    </div>`;
  }

  const offline = ('serviceWorker' in navigator) && navigator.serviceWorker.controller;
  el.innerHTML = installRow + `
    <div class="setting-row">
      <div class="sr-ic">${icon(offline ? 'cloudOff' : 'cloud')}</div>
      <div class="sr-mid"><div class="sr-title">Dùng khi mất mạng</div>
        <div class="sr-sub">${offline ? 'Đã lưu sẵn — mở được offline' : 'Chưa sẵn sàng, tải lại trang một lần'}</div></div>
    </div>` + (swUpdateReady ? `
    <div class="setting-row pointer" onclick="applyAppUpdate()">
      <div class="sr-ic" style="color:var(--primary);">${icon('refresh')}</div>
      <div class="sr-mid"><div class="sr-title c-primary">Có bản cập nhật mới</div>
        <div class="sr-sub">Bấm để tải lại và dùng phiên bản mới nhất</div></div>
      <span class="muted">›</span>
    </div>` : '');
}

window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault();                     /* keep it for our own button */
  deferredInstall = e;
  if(currentTab === 'settings') renderAppInfo();
});
window.addEventListener('appinstalled', ()=>{
  deferredInstall = null;
  toast('Đã cài SoFin lên thiết bị','ok');
  if(currentTab === 'settings') renderAppInfo();
});

/* ---- Cloud / sync panel in Settings ---- */
function renderCloudSection(){
  const el = document.getElementById('cloud-status');
  if(!el) return;
  const s = Sync.status();
  const dotClass = 'dot dot-' + (['synced','pending','offline','error'].indexOf(s.phase) >= 0 ? s.phase : 'offline');
  const label = {
    synced:  s.lastSyncAt ? 'Đã đồng bộ lúc ' + new Date(s.lastSyncAt).toLocaleTimeString('vi-VN') : 'Đã đồng bộ',
    pending: 'Đang gửi thay đổi…',
    offline: 'Ngoại tuyến — sẽ gửi khi có mạng',
    error:   s.message || 'Đồng bộ lỗi'
  }[s.phase] || '—';
  el.innerHTML = `
    <div class="setting-row">
      <div class="sr-ic"><span class="${dotClass}"></span></div>
      <div class="sr-mid"><div class="sr-title">${esc(sessionEmail || 'Tài khoản đám mây')}</div>
        <div class="sr-sub">${esc(label)}</div></div>
      <span class="link" onclick="forceSync()">Đồng bộ</span>
    </div>
    <div class="setting-row pointer" onclick="showArchivePicker()">
      <div class="sr-ic">${icon('box')}</div>
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
    app:'sofin', version:4, exportedAt:new Date().toISOString(), user:u,
    settings: state.app,
    categories: state.categories[u],
    wallets: state.wallets.filter(x=>x.userId===u),
    transactions: state.transactions.filter(x=>x.userId===u),
    budgets: state.budgets.filter(x=>x.userId===u),
    recurring: state.recurring.filter(x=>x.userId===u),
    debts: state.debts.filter(x=>x.userId===u),
    events: state.events.filter(x=>x.userId===u)
  };
  downloadFile(`sofin-backup-${displayName()}-${todayISO()}.json`, JSON.stringify(payload,null,2), 'application/json');
  toast('Đã xuất file JSON','ok');
}
function csvEscape(v){
  const s = String(v==null?'':v);
  return /[",\n;]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function exportCSV(){
  const header = ['Ngay','Loai','SoTien','TienTe','Vi','DanhMuc','DanhMucCon','GhiChu','SuKien'];
  const typeLabel = {expense:'Chi', income:'Thu', transfer_out:'Chuyen di', transfer_in:'Chuyen den'};
  const rows = getAllUserTransactions().sort((a,b)=>a.date<b.date?-1:1).map(t=>{
    const w = getWallet(t.walletId);
    const type = t.type==='income' ? 'income' : 'expense';
    const c = t.type.startsWith('transfer') ? null : (findCategory(type, t.categoryId)||{name:''});
    const s = t.type.startsWith('transfer') ? null : findSub(type, t.categoryId, t.subcategoryId);
    const ev = t.eventId ? getUserEvents().find(e=>e.id===t.eventId) : null;
    return [t.date, typeLabel[t.type]||t.type, t.amount, w?w.currency:'VND', w?w.name:'', c?c.name:'', s?s.name:'', t.note||'', ev?ev.name:''];
  });
  const csv = '﻿' + [header, ...rows].map(r=>r.map(csvEscape).join(',')).join('\r\n');
  downloadFile(`sofin-transactions-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8');
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
    if(!data || (!data.transactions && !data.wallets)) return toast('File không đúng định dạng SoFin','err');
    uiConfirm('Nhập dữ liệu',
      `Toàn bộ dữ liệu hiện tại của "${state.currentUser}" sẽ được thay bằng nội dung file (${(data.wallets||[]).length} ví, ${(data.transactions||[]).length} giao dịch). Tiếp tục?`,
      'Nhập & thay thế').then(ok=>{
      if(!ok) return;
      const u = state.currentUser;
      const reown = arr => (arr||[]).map(x=>({...x, userId:u}));
      state.wallets = state.wallets.filter(x=>x.userId!==u).concat(reown(data.wallets));
      /* backups taken before `status` existed carry none — treat them as real
         money already spent, same rule migrateState() applies */
      state.transactions = state.transactions.filter(x=>x.userId!==u)
        .concat(reown(data.transactions).map(t=>({...t, status: t.status==='pending' ? 'pending' : 'completed'})));
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
    w = {id:uid('w'), userId:state.currentUser, name, icon:'👛', type:'cash', currency:currency||'VND', startingBalance:0, displayOrder: nextWalletOrder()};
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
          date, eventId, status:statusForDate(date), createdAt:new Date().toISOString()
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
  maybePromptNewPassword();          /* deferred while the PIN screen was up */
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

  /* Read before Sync.init(): supabase-js rewrites the URL as it boots. */
  const linkError = readAuthLinkError();

  const ready = Sync.init();
  if(!ready.ok){ showConfigScreen(ready.reason); return; }

  Sync.onAuthChange((event, session)=>{
    if(event === 'SIGNED_OUT'){
      pendingPasswordRecovery = false;
      Sync.stop(); setStorageNamespace(null); state = emptyState();
      resetSessionFilters(); showLogin(); return;
    }
    /* Flag first: enterSession() below checks it before claiming the sheet. */
    if(event === 'PASSWORD_RECOVERY') pendingPasswordRecovery = true;
    if(session && session.user && session.user.id !== state.currentUser) enterSession(session.user);
    maybePromptNewPassword();
  });

  let session = null;
  try{ session = await Sync.getSession(); }
  catch(e){ console.error('Session lookup failed', e); }

  if(session && session.user) enterSession(session.user);
  else { showLogin(); if(linkError) authError(linkError); }
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
['cred-current','cred-new','cred-confirm'].forEach(id=>
  document.getElementById(id).addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); submitCredentialChange(); } }));

/* Wrap every static input.money with its 000 shortcut. Dynamically rendered
   fields call attachMoneyButtons(container) themselves. */
attachMoneyButtons();
registerServiceWorker();

/* Crawlers need an absolute og:image, and the app is served from production,
   preview and localhost — so resolve it against wherever we actually are. */
['og-image','twitter-image'].forEach(id=>{
  const el = document.getElementById(id);
  if(el) el.setAttribute('content', location.origin + '/icons/icon-512.png');
});

/* Last chance to land a pending write before the tab goes away. */
window.addEventListener('pagehide', ()=>{ if(window.Sync) Sync.flushBeacon(); });
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden' && window.Sync) Sync.flush();
  if(document.visibilityState === 'visible' && window.Sync) Sync.pullIfStale();
});

boot();
