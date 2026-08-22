# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ngôn ngữ

Toàn bộ UI, thông báo lỗi, comment và tài liệu của dự án viết bằng **tiếng Việt**. Giữ nguyên quy ước đó khi thêm code mới; comment giải thích *tại sao* (nhiều comment hiện có bằng tiếng Anh — bám theo file bạn đang sửa).

## Lệnh

```bash
npm run build          # sinh public/js/env.js từ .env / process.env — đây là toàn bộ build step
npm run build:strict   # như trên nhưng exit 1 nếu thiếu/sai key (Vercel dùng cái này)
npm run dev            # build + serve public/ tại http://localhost:5173

npm run check          # kiểm tra tĩnh wiring HTML ↔ JS (không cần dependency)
npm run smoke          # chạy thật app trong jsdom — cần: npm install jsdom --no-save
npm run sync-test      # hợp đồng đồng bộ: giữ request treo để soi UI giữa chừng
npm run transfer-test  # hợp đồng chuyển ví: phí, khác tiền tệ, ngày tương lai, xoá
npm run chart-test     # canvas giả: chạy thật code vẽ + hit-test tooltip
npm test               # cả năm
```

`scripts/smoke.js` là **một file assertion tuần tự**, không phải test runner — không có cách chạy lẻ một case. Muốn cô lập một luồng thì comment bớt các bước phía sau trong file, đừng thêm framework.

Chạy `npm run check` **trước mỗi commit**. Dự án không có bundler nên đổi tên một hàm hoặc một `id` ở file này mà quên file kia sẽ hỏng âm thầm ở runtime; `check.js` là thứ duy nhất bắt được.

## Kiến trúc

### Không framework, không bundler, không runtime dependency

`public/` là thư mục deploy nguyên trạng. Ba file JS nạp bằng thẻ `<script>` classic (không phải module):

1. `js/env.js` — sinh tự động, **gitignored**, chỉ chứa `window.__ENV__`
2. `js/sync.js` — IIFE, export ra `window.Sync`
3. `js/app.js` — top-level script, mọi hàm là global để inline handler trong HTML gọi được

`@supabase/supabase-js` nạp qua CDN. Vì là classic script, `app.js` gắn hàm vào global scope bằng khai báo `function foo(){}` — **không dùng `const foo = ...` cho hàm mà HTML gọi qua `onclick`** (vẫn được, `check.js` nhận cả hai, nhưng `function` là quy ước hiện tại).

### Một object `state`, một đường ghi

Toàn bộ dữ liệu app nằm trong `let state` (`app.js:67`). **Mọi mutation phải kết thúc bằng `saveStorage()`** (`app.js:139`) — đó là đường ghi duy nhất:

```
saveStorage()
  ├─ state.updatedAt = Date.now()                       ← đồng hồ dùng để giải xung đột
  ├─ localStorage['FINYOURTIN_STATE_V4::<uid>']         ← đồng bộ, tức thì, offline-safe
  └─ Sync.queuePush(state)                              ← debounce 800ms → Supabase
```

Chiều ngược lại đi qua `adoptRemoteState()` (`app.js:151`) — hàm này **không** gọi `saveStorage()`, cố tình, để một lần pull không bật lại thành vòng lặp ghi.

Không có `storageNamespace` (tức chưa đăng nhập) thì `saveStorage()` return sớm — dữ liệu không được lưu. Đây là lý do màn hình login không ghi gì ngoài theme.

### Bridge `state` ↔ `Sync` (cạm bẫy đã từng gây lỗi)

`state` khai báo bằng `let` ở top-level của classic script → nằm trong **global lexical scope**, **không phải** property của `window`. `sync.js` vì thế không bao giờ đọc `window.state`; `boot()` truyền accessor tường minh qua `Sync.bind({getState, adopt, onStatus, notify})` (`app.js:3173`). Đừng "đơn giản hoá" lại thành `window.state`.

### Đồng bộ

Một bảng duy nhất: `public.user_state(user_id pk, data jsonb, device_id, updated_at, created_at)` — xem `supabase/schema.sql`, idempotent, chạy một lần trong SQL Editor.

- **Xung đột**: last-write-wins trên `data.updatedAt` (đồng hồ **client**), so sánh cả khi `pull()` lẫn khi nhận realtime. Không phải CRDT, không merge theo bản ghi.
- **Không có queue thao tác.** `pendingSnapshot` chỉ là bộ đệm debounce trong RAM — **hàng đợi thật chính là snapshot trong localStorage**. Đóng tab lúc offline không mất gì: lần boot sau `pull()` thấy `data.updatedAt` local mới hơn và tự đẩy lên. `scripts/sync-test.js` khoá đúng hành vi này; nếu ai đó định thêm queue thao tác riêng thì phải đọc test đó trước.
- **Echo của chính mình**: mỗi trình duyệt có `deviceId` ổn định trong localStorage; handler realtime bỏ qua row có `device_id` trùng.
- **`updated_at` cột SQL** bị trigger `touch_user_state` ghi đè bằng `now()` phía server — nó *không* dùng để giải xung đột, chỉ để quan sát. Logic xung đột đọc `data.updatedAt` bên trong JSONB.
- **`flushBeacon()`** gọi REST thô bằng `fetch(keepalive)` chứ không `sendBeacon`, vì cần header `Authorization`; token được cache vào `client.auth.__fyt_token`.
- Trước khi `location.reload()` hoặc điều hướng sau một thao tác ghi, **phải `await Sync.flush()`** — nếu không debounce 800ms sẽ nuốt mất lệnh ghi (lỗi này đã xảy ra một lần).

### Cấu hình Supabase — 3 nguồn, hit đầu tiên thắng

`sync.js:readConfig()`: `window.__ENV__` (build) → `<meta name="supabase-url|supabase-anon-key">` → `localStorage['FINYOURTIN_SUPABASE_CFG']` (màn hình cấu hình trong app). Phía Node, `supabase/config.js` là hợp đồng duy nhất: đọc `SUPABASE_URL` / `VITE_` / `NEXT_PUBLIC_` / file `.env`, và **fail build nếu phát hiện `service_role` key**.

Anon key **cố ý** đi vào trình duyệt — RLS (`auth.uid() = user_id` trên cả 4 policy) mới là thứ bảo vệ dữ liệu.

### Bố cục `app.js` (~3.200 dòng)

Chia bằng banner `/* ===== TÊN SECTION ===== */`, theo thứ tự: STATE · STORAGE · SEED DATA · HELPERS (dates / money / data access) · UI PRIMITIVES · THEME · PIN LOCK · AUTH · ONBOARDING · NAVIGATION · DASHBOARD · TRANSACTIONS · WALLETS · BUDGETS · DEBTS · RECURRING · EVENTS · CATEGORY MANAGEMENT · REPORTS · MORE · SETTINGS · IMPORT/EXPORT · BOOTSTRAP. Thêm code vào đúng section, giữ banner.

## Tên thương hiệu vs khoá lưu trữ

App tên **SoFin**, nhưng bốn khoá `localStorage` (`FINYOURTIN_STATE_V4`, `FINYOURTIN_THEME`, `FINYOURTIN_SUPABASE_CFG`, `FINYOURTIN_DEVICE_ID`) và **muối băm PIN** (`'finyourtin::'+pin`) **cố tình giữ tên cũ**. Đổi chúng sẽ: bỏ rơi mọi snapshot đã cache, quên theme và cấu hình Supabase nhập tay, cấp `device_id` mới (máy bắt đầu phản ứng với chính tiếng vọng của mình) — và riêng muối PIN thì **vô hiệu hoá mọi mã PIN đang dùng**, khoá người dùng ra ngoài. Đổi tên hiển thị thì thoải mái; đụng vào bốn khoá này thì phải kèm migration.

## Quy ước bắt buộc

- **Ngày tháng**: dùng `todayISO()` / `isoOf()` (`app.js:430`), **không bao giờ** `new Date().toISOString()` — sẽ sai ngày với mọi giao dịch tạo trước 07:00 ở UTC+7.
- **Render HTML**: mọi dữ liệu người dùng phải qua `esc()` trước khi nhét vào `innerHTML`.
- **Đối thoại**: dùng `toast()`, `uiConfirm()`, `uiSheet()` (`app.js:591`–`617`), không dùng `alert()` / `confirm()`.
- **Tiền tệ**: `fmt()` cho giá trị đã quy về tiền tệ chính, `fmtW(n, wallet)` cho giá trị thô theo tiền tệ của ví. VND là base nội bộ của bảng tỷ giá.
- **Truy vấn dữ liệu**: luôn qua `getUserWallets()` / `getUserTransactions()` / … — chúng lọc theo `state.currentUser`; đọc thẳng `state.transactions` sẽ lẫn dữ liệu của tài khoản khác trên cùng máy.
- **`getUserTransactions()` chỉ trả về giao dịch `completed`** — cố ý: mọi chỗ cộng tiền (số dư, ngân sách, báo cáo, sự kiện) mặc định đúng, quên sót thì lỗi nghiêng về phía an toàn (tiền dự kiến không lọt vào số dư). Cần cả sổ (danh sách, đếm, xoá danh mục, xuất file) thì gọi `getAllUserTransactions()`. Bất biến: **`completed` ⟺ `date <= hôm nay`** — `status` suy ra từ ngày ở `statusForDate()`, xác nhận sớm thì kéo `date` về hôm nay, `autoSettlePending()` lật phần còn lại lúc vào phiên. Đừng thêm đường nào đặt `status` thủ công mà không đụng `date`.
- **Chuyển ví** tạo **một cặp** `transfer_out` + `transfer_in` chung `transferId` — và **khoản phí (nếu có) cũng mang `transferId` đó**, nên một `transferId` có thể ứng với 3 bản ghi. Tìm chân đối diện phải lọc thêm `type.startsWith('transfer')`, không thì vớ phải bản ghi phí. Xoá thì xoá cả cụm: để lại nửa lần chuyển sẽ khiến hai ví bất đồng về chỗ tiền đang nằm. `scripts/transfer-test.js` khoá toàn bộ hành vi này.
- **Không có trường `balance` trên ví.** `getWalletBalance()` phát lại sổ cái mỗi lần gọi, nên chuyển ví làm đổi số dư ngay khi hai bản ghi tồn tại — không có bước "cập nhật số dư" nào để quên. Đừng thêm trường `balance`; nó sẽ là nguồn sự thật thứ hai để lệch.
- **Test không được phụ thuộc ngày chạy.** Dùng mốc cố định (ngày 15 tháng sau) thay vì `+40 ngày` — kiểu sau chạy cuối tháng là rơi sang tháng kế nữa và đỏ ngẫu nhiên.
- **Số dư không lưu trữ** — `getWalletBalance()` cộng lại từ lịch sử mỗi lần gọi. Đừng cache nó vào state.
- **Vẽ lại sau khi ghi**: dùng `renderAll()` (vẽ tab đang mở), **không** gọi cứng `renderDebtsView()` / `renderRecurringView()` — nhiều thao tác gọi được từ cả màn hình gốc lẫn thẻ "Dự kiến phải chi" trên Dashboard, gọi cứng sẽ vẽ vào view đang ẩn và màn hình thật đứng yên.
- **Ô nhập tiền**: mọi ô số tiền là `<input type="text" class="money">` — **không** dùng `type="number"` (nó từ chối hiển thị dấu phân cách và trả về `""` ngay khi value không còn là số trần). Đọc bằng `readMoney(id)`, ghi bằng `writeMoney(id, num)`; đừng chạm `.value` trực tiếp. Nút `000` được `attachMoneyButtons()` tự gắn ở boot — ô nào render động thì gọi lại hàm đó với container. Ô số **không phải tiền** (ngày chốt, lãi suất, số kỳ) giữ `type="number"` và không có class `money`.
- **Bộ lọc là UI state, không phải dữ liệu**: `txFilters`, `reportWalletId`, `debtFilter`… là `let` ở top-level, không nằm trong `state` nên không bao giờ đi vào localStorage hay snapshot Supabase. Đổi lại chúng sống qua lần đăng xuất — thêm biến lọc mới thì nhớ khai báo trong `resetSessionFilters()`. Điều hướng chéo tab thì dùng `jumpToTransactions({...})`, đừng gán thẳng `txFilters`: `renderTransactionsList()` **không** tham số sẽ đọc ngược giá trị từ các `<select>` đè lên bộ lọc vừa đặt (chỉ `renderTransactionsList(true)` mới vẽ select *từ* `txFilters`).
- **`walletId` phải luôn trỏ vào ví có thật** trước khi push giao dịch. Ví bị xóa nhưng `recurring`/`debts` vẫn giữ id cũ; ghi vào đó thì giao dịch tồn tại mà không số dư nào đọc — tiền biến mất không dấu vết. Mọi đường tạo giao dịch đều phải `getWallet(id)` trước.
- `migrateState()` chạy mỗi lần load, phải **idempotent**: thêm field mới thì thêm default ở đây, không viết migration một chiều.

## Cạm bẫy của `scripts/check.js`

Nó cũng thực thi một danh sách **tên bị cấm** (`state.users`, `login-username`, `resetDemoData`, `migrateFromLegacy`) — tàn dư từ bản offline. Nếu bạn cố tình cần một trong các tên đó, sửa danh sách ở `check.js:70` kèm lý do, đừng lách.

Tập id hợp lệ gồm cả `id="..."` xuất hiện trong JS (do `uiSheet` và các panel render động), không chỉ trong `index.html`.

## Icon và màu

Icon *hệ thống* dùng `icon('name')` (bảng `ICON_PATHS` ở đầu `app.js`) — SVG 24×24 stroke, thừa kế `currentColor` và cỡ chữ; cần cỡ khác thì thêm rule cho `.ic-svg` trong ngữ cảnh đó, đừng gán `width` inline. **Emoji do người dùng chọn** (`wallet.icon`, `category.icon`, `event.icon`, `EMOJI_POOL`) là **dữ liệu trong `state`** — không đụng vào, đổi sẽ hỏng bộ chọn emoji và dữ liệu cũ. Trong `<option>` cũng phải giữ emoji vì SVG không nhúng được vào đó.

Ngôn ngữ thiết kế bám theo **VietinBank iPay**: xanh `#00529C` / `#003B70`, đỏ nhấn `#ED1C24` (`--brand-red`), nền `#F4F7FA`. Ba gradient riêng biệt, đừng dùng lẫn: `--gradient` (app bar), `--gradient-card` (thẻ ví/tài sản), `--gradient-fab` (nút +). `header` là app bar full-bleed giữ một vành 26px phía dưới để **riêng thẻ số dư của Dashboard** đè lên (`margin-top:-20px`). Mọi màn khác mở đầu bằng `.view-title` / `.sub-view-head` — không có nền riêng — nên sẽ bị màu xanh nuốt mất chữ. Vì vậy `switchTab()` gắn cờ `.hd-flat` lên header khi **không** ở Dashboard: vành thu lại còn 12px và view được `padding-top:20px`. **Đừng áp `margin-top` âm cho `.view` nói chung** — đó chính là lỗi đã từng che mất tiêu đề "Cài đặt". Cũng **giữ nguyên `:not(.hidden)`**: bỏ đi thì màn đăng nhập/onboarding (vốn ẩn header) sẽ bị cắt mất đỉnh.

Lưới Tiện ích cố định **4×2 = 8 ô**. Thêm tính năng mới thì cho vào `MORE_FEATURES` (sheet "Tất cả tiện ích"), đừng nhồi thêm ô — 9 ô sẽ vỡ lưới và bỏ rơi một màn hình.

Màu brand nằm trong `--primary*` / `--gradient*` / `--primary-glow` ở `styles.css`. Đổi màu thì phải đổi cả 4 chỗ khác ngoài CSS: `applyTheme()` (meta theme-color), `manifest.json`, `scripts/generate-icons.js` rồi chạy `npm run icons`, và fallback màu trong `drawDonut`/`budgetIcon`. Chữ trên nền primary dùng `--on-primary`, đừng hard-code `#fff`.

## Biểu đồ

Vẽ bằng **Canvas thuần**, không thư viện — thêm Chart.js/Recharts sẽ kéo theo một CDN thứ hai và phá vỡ ràng buộc không-bundler cùng câu chuyện offline-first.

Tooltip hoạt động theo cặp: hàm `draw*` ghi hình học vào `chartHit.donut` / `chartHit.bars`, còn `bindDonutTip()` / `bindBarTip()` hit-test trên đó. **Không vẽ lại canvas khi con trỏ di chuyển** — chỉ đổi text/vị trí của node DOM `.chart-tip`, riêng donut vá lại đúng vòng tâm bằng `paintDonutCentre()`. Giữ nguyên tính chất này, không thì cuộn trên điện thoại sẽ giật.

`bindChartTip()` gắn cờ `__tipBound` lên canvas vì `renderReportsView()` chạy lại mỗi lần đổi bộ lọc — thiếu cờ đó thì listener chồng chất.

Hàm `draw*` **phải đặt lại `chartHit.*` kể cả khi không có dữ liệu** — nhánh rỗng của `drawDonut()` từng `return` sớm và để nguyên hình học của lần vẽ trước, nên đổi sang tab không có dữ liệu là chạm vào vành rỗng lại bung tooltip của danh mục cũ. `chart-test.js` khoá ca này.

`setupCanvas()` **đặt `style.width='100%'` rồi mới đo** bằng `getBoundingClientRect()`. Đừng đo `canvas.clientWidth`: đó là bề rộng chính ta ghim ở lần vẽ trước, nên kích thước đầu tiên sẽ dính vĩnh viễn — xoay máy là bitmap vẫn rộng trong khi `max-width:100%` bóp phần tử lại, cho ra nét mờ, tràn khung, và tooltip lệch đúng bằng phần chênh. `devicePixelRatio` chặn trần 3x.

`shortMoney()` (nhãn trục) tôn trọng `state.app.privacy` — bật con mắt thì trục cũng phải che, không thì số vẫn đọc được qua vai.

## PWA

`public/manifest.json` + `public/sw.js`, đăng ký ở `registerServiceWorker()`. Ba luật của service worker, đừng nới:

1. **Không đụng vào Supabase** (`isSupabase(url)` → `return`) và bỏ qua mọi request không phải `GET`. Cache lại auth/REST là đường thẳng tới việc phục vụ session của người khác.
2. **`js/env.js` đi network-first** — nó chứa URL và anon key; ghim một key đã bị xoay vòng sẽ khoá người dùng ra ngoài.
3. Phần còn lại cache-first + revalidate ngầm.

Tên cache lấy từ `?v=` trên chính URL của `sw.js`, do `generate-env.js` đóng dấu (`__ENV__.BUILD`). Mỗi lần deploy là một script mới → cài lại → `activate` xoá cache cũ. **Đừng bỏ query đó**, không thì người dùng kẹt ở bundle cũ vĩnh viễn.

Icon là PNG thật, sinh bằng `npm run icons` (`scripts/generate-icons.js` tự encode PNG bằng `zlib`, không có thư viện ảnh). Đổi màu thương hiệu thì chạy lại. `npm run check` sẽ fail nếu manifest trỏ vào icon không tồn tại hoặc thiếu icon 512.

## Deploy

Vercel, static: `outputDirectory: public`, `buildCommand: node scripts/generate-env.js --strict`, không framework. `SUPABASE_URL` và `SUPABASE_ANON_KEY` đặt trong Environment Variables của project. `js/env.js` được set `Cache-Control: no-store`; `css/` và `js/` còn lại cache 1 giờ.

## `legacy/`

`legacy/index.offline-v4.html` là bản single-file v4 cũ, vẫn chạy độc lập, **không** được đồng bộ với code mới. Không sửa nó khi thay đổi bản cloud; nó chỉ tồn tại cho người dùng cần bản offline và làm nguồn cho luồng "nhập dữ liệu cũ trên máy này" (`normalizeLegacyArchive`).
