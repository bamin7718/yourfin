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
npm run header-test    # vỏ app: app bar ẩn/phẳng và nav bar có mặt trên mọi màn hình
npm test               # cả sáu
```

`scripts/smoke.js` là **một file assertion tuần tự**, không phải test runner — không có cách chạy lẻ một case. Muốn cô lập một luồng thì comment bớt các bước phía sau trong file, đừng thêm framework.

Chạy `npm run check` **trước mỗi commit**. Dự án không có bundler nên đổi tên một hàm hoặc một `id` ở file này mà quên file kia sẽ hỏng âm thầm ở runtime; `check.js` là thứ duy nhất bắt được.

## Kiến trúc

### Không framework, không bundler, không runtime dependency

`public/` là thư mục deploy nguyên trạng. Ba file JS nạp bằng thẻ `<script>` classic (không phải module):

1. `js/env.js` — sinh tự động, **gitignored**, chỉ chứa `window.__ENV__`
2. `js/sync.js` — IIFE, export ra `window.Sync`
3. `js/app.js` — top-level script, mọi hàm là global để inline handler trong HTML gọi được

`@supabase/supabase-js` **vendor sẵn** ở `public/js/vendor/supabase.js`, không nạp CDN — bản APK không có jsDelivr để dựa vào, và PWA khởi động nguội cũng vậy. Cập nhật bằng `npm run vendor:supabase` rồi chạy `npm test` (smoke boot app thật với đúng bundle đó). Vì là classic script, `app.js` gắn hàm vào global scope bằng khai báo `function foo(){}` — **không dùng `const foo = ...` cho hàm mà HTML gọi qua `onclick`** (vẫn được, `check.js` nhận cả hai, nhưng `function` là quy ước hiện tại).

### Một object `state`, một đường ghi

Toàn bộ dữ liệu app nằm trong `let state` (`app.js:67`). **Mọi mutation phải kết thúc bằng `saveStorage()`** (`app.js:139`) — đó là đường ghi duy nhất:

```
saveStorage()
  ├─ state.updatedAt = Date.now()                       ← đồng hồ dùng để giải xung đột
  ├─ localStorage['FINYOURTIN_STATE_V4::<uid>']         ← đồng bộ, tức thì, offline-safe
  └─ Sync.queuePush(state)                              ← debounce 800ms → Supabase
```

Chiều ngược lại đi qua `adoptRemoteState()` (`app.js:151`) — hàm này **không** gọi `saveStorage()`, cố tình, để một lần pull không bật lại thành vòng lặp ghi. Nó cũng **không vẽ đè lên onboarding**: lần đăng nhập đầu trên một máy mới bắt đầu từ cache rỗng nên vào onboarding, rồi vài giây sau `pull()` mới trả lời. Trước đây nó cứ `switchTab(currentTab)` (mặc định `'dashboard'`), thế là màn onboarding bị giật đi và **nav bar thì vẫn đang ẩn** — người dùng nhìn thấy Tổng quan mà không có đường nào đi tiếp. Giờ: cloud có dữ liệu thì đóng onboarding rồi vào dashboard tử tế, cloud cũng trắng thì để yên. `header-test.js` khoá cả hai nhánh.

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

### Bố cục `app.js` (~5.500 dòng)

Chia bằng banner `/* ===== TÊN SECTION ===== */`, theo thứ tự: STATE · STORAGE · SEED DATA · HELPERS (dates / money / data access) · UI PRIMITIVES · THEME · PIN LOCK · AUTH · ONBOARDING · NAVIGATION · LỊCH SỬ ĐIỀU HƯỚNG · DASHBOARD · TRANSACTIONS · WALLETS · BUDGETS · DEBTS · RECURRING · EVENTS · CATEGORY MANAGEMENT · REPORTS · MORE · TRỢ LÝ CHAT & QUÉT BILL · SETTINGS · IMPORT/EXPORT · BOOTSTRAP. Thêm code vào đúng section, giữ banner.

## Tên thương hiệu vs khoá lưu trữ

App tên **SoFin**, nhưng bốn khoá `localStorage` (`FINYOURTIN_STATE_V4`, `FINYOURTIN_THEME`, `FINYOURTIN_SUPABASE_CFG`, `FINYOURTIN_DEVICE_ID`) và **muối băm PIN** (`'finyourtin::'+pin`) **cố tình giữ tên cũ**. Đổi chúng sẽ: bỏ rơi mọi snapshot đã cache, quên theme và cấu hình Supabase nhập tay, cấp `device_id` mới (máy bắt đầu phản ứng với chính tiếng vọng của mình) — và riêng muối PIN thì **vô hiệu hoá mọi mã PIN đang dùng**, khoá người dùng ra ngoài. Đổi tên hiển thị thì thoải mái; đụng vào bốn khoá này thì phải kèm migration.

## Quy ước bắt buộc

- **Ngày tháng**: dùng `todayISO()` / `isoOf()` (`app.js:430`), **không bao giờ** `new Date().toISOString()` — sẽ sai ngày với mọi giao dịch tạo trước 07:00 ở UTC+7.
- **Render HTML**: mọi dữ liệu người dùng phải qua `esc()` trước khi nhét vào `innerHTML`.
- **Đối thoại**: dùng `toast()`, `uiConfirm()`, `uiSheet()` (`app.js:591`–`617`), không dùng `alert()` / `confirm()`.
- **Tiền tệ**: `fmt()` cho giá trị đã quy về tiền tệ chính, `fmtW(n, wallet)` cho giá trị thô theo tiền tệ của ví. VND là base nội bộ của bảng tỷ giá. Khối "Tiền tệ" trong Cài đặt **đã gỡ** — không còn đường nào sửa `state.app.mainCurrency` hay `state.app.rates` trong app, nhưng **lớp quy đổi thì giữ nguyên** (ví vẫn chọn được tiền tệ riêng, `transfer-test.js` khoá ca VND↔USD). Đừng dọn tiếp `CURRENCIES` / `DEFAULT_RATES` / `toMain()` chỉ vì Cài đặt không dùng nữa.
- **Truy vấn dữ liệu**: luôn qua `getUserWallets()` / `getUserTransactions()` / … — chúng lọc theo `state.currentUser`; đọc thẳng `state.transactions` sẽ lẫn dữ liệu của tài khoản khác trên cùng máy.
- **`getUserTransactions()` chỉ trả về giao dịch `completed`** — cố ý: mọi chỗ cộng tiền (số dư, ngân sách, báo cáo, sự kiện) mặc định đúng, quên sót thì lỗi nghiêng về phía an toàn (tiền dự kiến không lọt vào số dư). Cần cả sổ (danh sách, đếm, xoá danh mục, xuất file) thì gọi `getAllUserTransactions()`. Bất biến: **`completed` ⟺ `date <= hôm nay`** — `status` suy ra từ ngày ở `statusForDate()`, xác nhận sớm thì kéo `date` về hôm nay, `autoSettlePending()` lật phần còn lại lúc vào phiên. Đừng thêm đường nào đặt `status` thủ công mà không đụng `date`.
- **Mọi `state.transactions.push()` phải gắn `status: statusForDate(date)`.** Thiếu nó thì bản ghi ra đời với `status: undefined`, `isPending()` trả `false`, và số dư bị trừ trước khi tiền thật sự đi — `migrateState()` chỉ vá được ở lần load SAU. Bốn đường từng thiếu và đã sửa: `createRecurringTx()`, thanh toán thẻ tín dụng, tạo khoản nợ, trả/thu nợ. Nguy hiểm nhất là định kỳ: nút ✓ mặc định đề nghị **hạn kế tiếp**, tức một ngày ở tương lai.
- **Mục dự kiến "ảo" (`isVirtual`) không bao giờ được vào `state.transactions`.** Thẻ "Sắp đến hạn" gom bốn nguồn nhưng chỉ giao dịch ngày tương lai nằm trong sổ; lịch định kỳ / thẻ tín dụng / khoản nợ chỉ là *lịch*. `getVirtualPendingItems()` dựng chúng thành pseudo-transaction để lọc "Dự kiến" ở tab Giao dịch hiện đủ danh sách, và chúng **chỉ sống trong mảng trả về của `filteredTransactions()`**. Push một cái vào `state` là tạo ra khoản chi ma mà không thao tác nào của người dùng sinh ra nó, rồi nó sẽ nhân lên mỗi lần vẽ lại. Thấy cờ `isVirtual` thì dừng lại. Chỉ trộn khi `txFilters.status === 'pending'` — trộn ở mọi lúc thì "Tất cả" cộng lịch định kỳ vào tổng Chi như tiền đã tiêu. Nút ✓ trên dòng ảo mở đúng luồng đã có (`payRecurring` / `openCardPaymentModal` / `openDebtPayModal`), và id ảo dựng từ (nguồn + ngày) nên xác nhận một kỳ không làm tổng đổi: kỳ đó thành giao dịch thật, `dueDate` nhảy sang kỳ sau.
- **Chuyển ví** tạo **một cặp** `transfer_out` + `transfer_in` chung `transferId` — và **khoản phí (nếu có) cũng mang `transferId` đó**, nên một `transferId` có thể ứng với 3 bản ghi. Tìm chân đối diện phải lọc thêm `type.startsWith('transfer')`, không thì vớ phải bản ghi phí. Xoá thì xoá cả cụm: để lại nửa lần chuyển sẽ khiến hai ví bất đồng về chỗ tiền đang nằm. `scripts/transfer-test.js` khoá toàn bộ hành vi này.
- **Không có trường `balance` trên ví.** `getWalletBalance()` phát lại sổ cái mỗi lần gọi, nên chuyển ví làm đổi số dư ngay khi hai bản ghi tồn tại — không có bước "cập nhật số dư" nào để quên. Đừng thêm trường `balance`; nó sẽ là nguồn sự thật thứ hai để lệch.
- **Test không được phụ thuộc ngày chạy.** Dùng mốc cố định (ngày 15 tháng sau) thay vì `+40 ngày` — kiểu sau chạy cuối tháng là rơi sang tháng kế nữa và đỏ ngẫu nhiên.
- **Số dư không lưu trữ** — `getWalletBalance()` cộng lại từ lịch sử mỗi lần gọi. Đừng cache nó vào state.
- **`openModal()` / `closeModal()` là cửa duy nhất ẩn/hiện một `.modal`** — chúng cũng ghi lịch sử điều hướng. Gọi `classList.add('hidden')` thẳng lên một modal sẽ để lại entry mồ côi và cú Back ngay sau đó trông như không làm gì cả. Xem mục *Lịch sử điều hướng*.
- **`switchTab()` là nơi duy nhất bật nav bar.** Mọi màn hình đi qua nó đều là màn hình trong phiên, nên nó tự `remove('hidden')` cho `#main-nav`. Login/onboarding tự ẩn thanh này và tự trả lại khi xong. Đừng bắt từng caller nhớ — đã có một caller quên và người dùng kẹt cứng ở Tổng quan không có nav.
- **Loại ví đọc từ `WALLET_TYPE_META`**, không chép tay `['cash','bank',…]` ở chỗ khác: màn hình Ví gom nhóm theo `Object.keys()` của bảng đó, thiếu một loại trong vòng lặp là ví thuộc loại ấy **biến mất khỏi chính màn quản lý nó**. Nhãn lấy qua `walletMeta(w)`, loại lấy qua `walletTypeOf(w)` (loại lạ/thiếu quy về `cash` để không có thẻ nào trống nhãn).
- **Vẽ lại sau khi ghi**: dùng `renderAll()` (vẽ tab đang mở), **không** gọi cứng `renderDebtsView()` / `renderRecurringView()` — nhiều thao tác gọi được từ cả màn hình gốc lẫn thẻ "Dự kiến phải chi" trên Dashboard, gọi cứng sẽ vẽ vào view đang ẩn và màn hình thật đứng yên.
- **Ô nhập tiền**: mọi ô số tiền là `<input type="text" class="money">` — **không** dùng `type="number"` (nó từ chối hiển thị dấu phân cách và trả về `""` ngay khi value không còn là số trần). Đọc bằng `readMoney(id)`, ghi bằng `writeMoney(id, num)`; đừng chạm `.value` trực tiếp. Riêng `#tx-amount-raw` / `#tf-amount-raw` bị **ẩn** (khung `.amount-raw`) vì giao diện nhập của hai ô đó giờ là bàn phím riêng — nhưng chúng vẫn là **chỗ giữ giá trị**, `saveTransaction()` / `saveTransfer()` vẫn đọc qua đường cũ. Đừng gỡ chúng ra khỏi DOM, và đừng bỏ lớp `.amount-raw` (hiện cả hai lên là có hai cách gõ cùng một con số, và cái nhỏ hơn luôn thắng khi người dùng lỡ chạm). Nút `000` được `attachMoneyButtons()` tự gắn ở boot — ô nào render động thì gọi lại hàm đó với container. Ô số **không phải tiền** (ngày chốt, lãi suất, số kỳ) giữ `type="number"` và không có class `money`. `check.js` (mục 9) canh hai chiều: ô có class `money` bắt buộc `type="text"` + `inputmode="decimal"`; ô có id nghe như tiền (`*amount*`, `*balance*`, `*limit*`, `*budget*`, `*fee*`…) mà thiếu class `money` thì fail — thật sự không phải tiền thì khai vào `NOT_MONEY` trong `check.js`, đừng đổi tên id để lách.
- **Bộ lọc là UI state, không phải dữ liệu**: `txFilters`, `reportWalletId`, `debtFilter`… là `let` ở top-level, không nằm trong `state` nên không bao giờ đi vào localStorage hay snapshot Supabase. Đổi lại chúng sống qua lần đăng xuất — thêm biến lọc mới thì nhớ khai báo trong `resetSessionFilters()`. Điều hướng chéo tab thì dùng `jumpToTransactions({...})`, đừng gán thẳng `txFilters`: `renderTransactionsList()` **không** tham số sẽ đọc ngược giá trị từ các `<select>` đè lên bộ lọc vừa đặt (chỉ `renderTransactionsList(true)` mới vẽ select *từ* `txFilters`). Cú nhảy phải mang theo **cả phạm vi của khối vừa bấm**, không chỉ mỗi id: `jumpToCategoryThisMonth()` đặt thêm `type/range/status` để tổng Chi bên Giao dịch bằng đúng con số trên thẻ danh mục ở Tổng quan — lọc mỗi `catId` thì ra một tổng khác và trông như tính sai. Và **chỉ gắn onclick khi id còn tồn tại**: `renderTransactionsList()` hạ bộ lọc treo về `'all'`, nên một hàng trỏ vào danh mục/ví đã xoá sẽ trả về *toàn bộ* giao dịch — ngược hẳn điều nó hứa.
- **`walletId` phải luôn trỏ vào ví có thật** trước khi push giao dịch. Ví bị xóa nhưng `recurring`/`debts` vẫn giữ id cũ; ghi vào đó thì giao dịch tồn tại mà không số dư nào đọc — tiền biến mất không dấu vết. Mọi đường tạo giao dịch đều phải `getWallet(id)` trước.
- `migrateState()` chạy mỗi lần load, phải **idempotent**: thêm field mới thì thêm default ở đây, không viết migration một chiều. Nếu buộc phải sửa dữ liệu cũ (ví dụ gán lại `type` cho ví tạo ra trước khi loại đó tồn tại) thì **kẹp sau một cờ trong `state.app`** như `walletTypeFixV1` — chạy đúng một lần rồi thôi. Không có cờ thì mỗi lần load lại đè lên lựa chọn người dùng vừa sửa tay.

## Lịch sử điều hướng (nút Back cứng / vuốt lùi)

Section `LỊCH SỬ ĐIỀU HƯỚNG TOÀN CỤC` trong `app.js`. Mỗi bước điều hướng là một entry `history` mang `stateSchema` = `{activeTab, activeModal, filterState, subView}`. Trước đây app không đẩy entry nào, nên một cú Back ở bất kỳ đâu là **thoát thẳng app**, kể cả khi đang mở modal.

- **Luôn có state gốc.** `initNavigationHistory()` chạy lúc app load (trong khối BOOTSTRAP), trước cả khi biết ai đăng nhập, nên `event.state` không bao giờ là `null`; `navInit()` sau đó chỉ điền tab thật vào chính entry ấy. `navReset()` cũng dựng lại mốc này thay vì trả về null.
- **Không đụng vào URL.** `pushState(state, '')` / `replaceState(state, '')` — bỏ trống tham số url để giữ nguyên cả path LẪN hash. Đừng truyền `location.pathname` như phản xạ thông thường: nó **xoá hash**, mà hash là nơi Supabase Auth trả `access_token` / `error=...` về. Và app **không có một dòng nào ghi `location.hash`** — điều hướng ở đây thuần state object, nên không có chuyện `popstate` bị kích hoạt hai lần. Hash là của Supabase Auth (`#access_token=…`, `#error=…`, `readAuthLinkError()` đọc nó lúc boot); đổi path thì reload rơi vào fallback của service worker và link chia sẻ trỏ tới một đường không có thật.
- **`activeTab` dùng đúng tên tab của app** (`switchTab` nhận chính chuỗi đó). Đừng thêm một bộ tên song song (`home`/`report`/…) rồi dịch qua lại — đó là một chỗ nữa để lệch.
- **Ba cửa duy nhất**: `navPush()` (bước mới), `navReplace()` (ghi đè bước đang đứng), `navDropOverlay(id)` (đóng overlay). Tất cả đều **no-op khi `navBusy > 0`** — đang khôi phục từ popstate mà lại ghi tiếp thì mỗi cú Back đẻ ra một entry và người dùng không bao giờ thoát được app.
- **`switchTab()` là nơi duy nhất ghi entry cho màn hình**, đúng như nó cũng là nơi duy nhất bật nav bar. Lần gọi đầu của phiên dựng **mốc gốc** bằng `replaceState` (`navInit`) chứ không push: push thì Back ở Tổng quan chỉ quay về chính Tổng quan.
- **`switchTab(tab, true)` = "bước cũ đã xong"** — dùng sau khi lưu giao dịch / chuyển ví / huỷ form, và cho các lần chuyển hướng bắt buộc (chưa có ví → màn Ví). Không có cờ này thì Back sau khi lưu sẽ mở lại đúng cái form vừa gửi, giờ đã trống.
- **Đóng overlay bằng `replaceState`, KHÔNG bằng `history.back()`.** `back()` là bất đồng bộ: đóng overlay rồi điều hướng tiếp trong cùng một lượt (`chatCustomize()` làm đúng thế) thì popstate nổ **sau** và kéo người dùng ngược lại màn hình cũ. Cái giá phải trả: mở-đóng một modal để lại một entry trùng với entry đang đứng, nên `popstate` **gộp entry trùng** — thấy `activeTab` và `activeModal` y hệt thì `history.back()` thêm một nhịp nữa. Không có bước gộp đó thì bấm Back ba lần mà màn hình đứng im.
- **`openModal()` / `closeModal()` là cửa duy nhất để ẩn/hiện `.modal`.** Ẩn thẳng bằng `classList.add('hidden')` sẽ để lại một entry mồ côi và cú Back kế tiếp trông như không làm gì cả. Handler Esc và cú chạm nền đã được nối lại qua `closeModal(id)` vì đúng lý do này.
- **`uiConfirm()` trả lời bằng Promise**, nên nó đăng ký `navConfirmDismiss` — Back/Esc/chạm nền đóng hộp thì promise resolve `false`. Thiếu móc này, luồng gọi (xoá ví, nhập CSV) đứng chờ mãi mãi mà không ai thấy.
- **Forward không mở lại overlay** (`navApply` đặt `activeModal = null`). Từ một cái id không dựng lại được nội dung bên trong — bản ghi đang sửa, handler của `uiConfirm` — mà một modal rỗng còn tệ hơn không có modal.
- **`filterState` được chốt vào entry đang đứng ngay trước khi rời nó** (`navPush` gọi `replaceState` một nhịp trước khi `pushState`). Đổi bộ lọc **không** phải một bước Back: mười lần đổi mốc báo cáo mà thành mười bước thì Back mất hết ý nghĩa. Khôi phục phải đi kèm `navSyncFilterChips()` — chip và segment là HTML tĩnh, không tự vẽ lại theo biến. Vì thế mọi segment lọc (`#debt-seg`, `#budget-period-seg`, `#cat-type-seg`) đều mang `data-val`; **giữ thuộc tính đó**, không thì chỗ này phải đọc chuỗi `onclick` mà đoán.
- **Panel lọc gập ở tab Giao dịch cũng là một bước** (`NAV_SHEETS['tx-advanced-filters']`). Nó nằm trong `.view` chứ không nổi lên trên, nhưng dưới mắt người dùng thì mở panel là một bước và Back phải gấp nó lại. App này **không có màn hình "mục tiêu" (goal)**, và "tạo giao dịch" là một tab thật (`add`) chứ không phải modal — nên hai giá trị đó không xuất hiện trong `activeModal`.
- **Ngoài phiên thì không ghi gì** (`navArmed`): màn đăng nhập, onboarding và màn cấu hình để trình duyệt tự xử — ở đó không có bước nào để lùi. `showLogin()` gọi `navReset()`.
- **Bản Android: nút Back cứng đi qua `navBindNativeBack()`.** Nút cứng và cú vuốt predictive back của Android 13+ đi qua tầng native TRƯỚC, và mặc định của Capacitor là chuyện của Capacitor — không có gì bảo đảm nó tra history của WebView thay vì đóng luôn activity. Đăng ký listener `backButton` của `@capacitor/app` là cách duy nhất để chắc: có listener thì Capacitor giao hẳn quyết định cho JS. **Đổi lại, có listener là TẮT mặc định**, nên handler phải tự lo cả việc thoát app — `App.exitApp()` là thứ duy nhất làm được, và đó là lý do plugin này nằm trong `devDependencies` (đừng gỡ). Thứ tự trong handler: còn entry ⇒ `history.back()` (đi cùng một đường với cú vuốt trên trình duyệt); hết entry mà còn overlay mở ⇒ đóng overlay, **tuyệt đối không thoát** (thoát trong lúc người dùng đang gõ dở là mất dữ liệu không sửa lại được); hết cả hai ⇒ `exitApp()`. Không dùng `import` — dự án không có bundler, plugin được bridge bơm vào `Capacitor.Plugins.App` lúc chạy, và thiếu plugin thì hàm lặng lẽ trả `false`.
- **iOS**: Safari/PWA vuốt mép chạy qua history nên có sẵn. WKWebView trong bản đóng gói cần `allowsBackForwardNavigationGestures`, mà `ios/` thì không commit — nếu sau này build iOS thì đặt trong `capacitor.config.json`.

## Màn nhập số tiền (bàn phím riêng)

`#amount-sheet` là overlay toàn màn hình phục vụ **cả** form thường lẫn form chuyển ví — `openAmountSheet('tx'|'tf')`. Lý do tồn tại: bàn phím hệ điều hành chiếm nửa màn hình và che mất ví nguồn cùng số dư khả dụng, đúng hai thứ người dùng cần thấy khi quyết định gõ bao nhiêu.

- **Buffer rời.** `amtBuf` là chuỗi đang gõ, chỉ chốt vào `txAmount` / `tfAmount` khi bấm "Tiếp tục" (`amtCommit()`). Bấm `‹` thoát giữa chừng thì số cũ còn nguyên. Đừng ghi thẳng vào `txAmount` từ `amtKey()`.
- **Một đường ghi**: `applyTxAmount()` / `applyTfAmount()` là chỗ duy nhất đặt số tiền từ bên ngoài ô input — chúng vừa gán state, vừa `writeMoney()`, vừa vẽ lại con số to. `onAmountTyped()` thì **không** được gọi chúng: `writeMoney()` gán lại `.value` sẽ ném con trỏ về cuối ngay giữa lúc người dùng đang gõ.
- **Dấu thập phân là `,`, không phải `.`** — `formatMoneyText()` đọc `,` là thập phân và `.` là ngăn nghìn (vi-VN), nên một phím dấu chấm sẽ biến "50.5" thành năm mươi nghìn năm trăm.
- Overlay không phải một `.view`, nên **`switchTab()` và `showLogin()` phải tự đóng nó**. Đã có hai đường vào quên và nó nằm đè lên màn hình tiếp theo.
- Con số đang gõ **không đi qua `fmt()`/`fmtW()`**: chế độ riêng tư che *số dư* là đúng, che chính thứ người dùng vừa bấm thì không. Số dư ví trong cùng thẻ đó thì vẫn qua `fmtW()` và vẫn bị che.
- Bàn phím có `keydown` trên `document` (số, `,`, Backspace, Enter, Esc) vì màn này không còn ô input nào để gõ trên desktop. Listener được gỡ trong `closeAmountSheet()` — đừng để nó sống sót.
- Hai phím cao (`⌫`, `Tiếp tục`) đặt hàng **tường minh** (`grid-row: 1 / span 2` và `3 / span 2`). Chỉ `span 2` thì vị trí của chúng phụ thuộc thứ tự thẻ trong HTML, và một lần đổi thứ tự phím là cả lưới trượt.
- Bảng màu bàn phím nằm trong token riêng `--tcb-*` (xanh `#007AFF`), **cố ý đứng ngoài `--primary`**: đây là một bề mặt riêng theo ngôn ngữ Techcombank, không phải app bar hay thẻ. Có bộ override dark mode — bàn phím trắng trên nền tối là một tấm đèn pha. Đổi màu thương hiệu thì không phải đụng vào đây.

## Ghi nhanh giao dịch (Direct-to-Keypad)

Nút **[+]** giữa nav bar mở thẳng `#amount-sheet` ở chế độ `amtKind === 'quick'` (`openQuickEntry()`), không mở form. Con số là thứ người ta biết trước khi biết mình sẽ xếp nó vào đâu, nên bắt chọn danh mục trước là bắt trả lời câu hỏi thứ hai trước câu hỏi thứ nhất.

- **Chế độ thứ ba của cùng một overlay, không phải overlay mới.** `'tx'` chốt số về form thường, `'tf'` chốt về form chuyển ví, `'quick'` **lưu tại chỗ**. Dựng bàn phím thứ hai là hai lưới 4×4 phải sửa song song mãi mãi — smoke khoá `document.querySelectorAll('.tcb-keypad-wrapper').length === 1`.
- **Dùng đúng bộ biến của form thêm giao dịch** (`currentTxType`, `txSelectedWalletId`, `txSelectedCatId`, `txSelectedSubId`). Nhờ vậy `quickToFullForm()` ("Thêm chi tiết ›") chỉ là mở form ra — mọi thứ đã nằm đúng chỗ — và không có state song song để lệch.
- **Phím thứ tư đổi nhãn theo chế độ**: "Tiếp tục" ở `'tx'`/`'tf'`, **"Lưu"** ở `'quick'`. `amtCommit()` rẽ nhánh ngay dòng đầu.
- **Gõ ghi chú là ví và danh mục tự nhảy** (`onQuickNote()` → `matchWalletAndCategory()`). Nhưng **tay người dùng luôn thắng**: `qeWalletPicked` / `qeCatPicked` chặn mọi phỏng đoán sau khi người dùng đã bấm chip. Hai cờ đó reset ở mỗi lần `openQuickEntry()`.
- **Ghi nhanh luôn là HÔM NAY.** Muốn ngày khác, sự kiện, danh mục con thì đã có "Thêm chi tiết ›". Nhồi một ô ngày vào đây là phá đúng cái lý do màn này tồn tại.
- **`quickToFullForm()` đóng bàn phím IM LẶNG** rồi `switchTab('add', true)`. Gọi `closeAmountSheet()` thường thì `navDropOverlay()` sẽ để lại một bước lịch sử trỏ vào một bàn phím đã đóng.
- Căn giữa nhóm số-tiền bằng `margin:auto`, **không** bằng `justify-content:center`: `.amt-body` có `overflow-y:auto`, mà `justify-content` trên hộp cuộn được sẽ cắt mất phần đầu khi nội dung cao hơn khung và không cuộn lên tới được. Có media query `max-height:700px` hạ phím xuống 46px để bàn phím không trôi khỏi màn hình trên máy thấp.

## Trợ lý chat & quét bill

`#chat-fab` (nút nổi) + `#chat-drawer` (ngăn chat), section `TRỢ LÝ CHAT & QUÉT BILL` trong `app.js`. Gõ "cà phê 35k" hoặc gửi ảnh hoá đơn → bot dựng một **draft** rồi chờ bấm **[Tự động lưu]** / **[Tùy chỉnh thêm]**.

- **Draft không bao giờ vào `state`.** `chatDrafts` là `Map` trong RAM. Giao dịch chỉ ra đời khi người dùng bấm, và khi đó đi đúng đường ghi cũ: `state.transactions.push({... status: statusForDate(date)})` + `saveStorage()`. Cùng lý do với mục dự kiến "ảo" (`isVirtual`) — một bot tự ghi vào sổ là một khoản chi ma không thao tác nào của người dùng sinh ra.
- **Toàn bộ trạng thái trợ lý là UI state** (`chatDrafts`, `chatKwIndex`, `chatBusy`, cờ OCR): `let` ở top-level, không nằm trong `state`, nên không vào localStorage và không ride theo snapshot Supabase. `resetSessionFilters()` gọi `resetChatAssistant()` — hội thoại của người vừa đăng xuất không được nằm lại chờ người sau đọc.
- **Ma trận từ khoá tự học.** `buildHistoryMappingIndex()` quét `getAllUserTransactions()`, tách unigram + bigram từ `note` rồi cộng điểm về `(type, categoryId, subcategoryId)` **và** đếm tần suất `walletId` (`walletStats`). Trọng số: lịch sử 3 > tên danh mục con 2 > tên danh mục 1; bigram nhân đôi. Tên danh mục có mặt trong ma trận **cố ý** — tài khoản mới chưa có lịch sử nào mà "ăn uống" thì vẫn phải ra Ăn uống. Cache đọc theo `state.updatedAt` + `currentUser`; đổi cách vô hiệu cache thì nhớ cả hai. **Một hàm, hai bản đồ** — đừng tách thành hai index trên cùng nguồn dữ liệu: lệch nhau nghĩa là bot đề nghị danh mục của khoản này và ví của khoản khác.
- **Gợi ý ví thông minh.** `matchWalletAndCategory()` (tên cũ `matchCategoryFromInput` đã bỏ) trả thêm `walletId` + `walletMatched`: ví mà lịch sử nói người dùng hay trả khoản NÀY bằng — "xăng" ra ví tiền mặt, "Netflix" ra thẻ. `walletStats` **chỉ** được nuôi bằng lịch sử, không bằng tên danh mục (tên danh mục không nói gì về việc tiền ra từ ví nào), và ví đã bị xoá thì không bao giờ được đề nghị. Không đủ dữ liệu thì `walletId: null` và chỗ gọi tự lấy `chatDefaultWallet()` — **đừng bịa ra một ví "trông có lý"**.
- **Từ khoá học từ chi tiêu không được trả về cho khoản thu** (và ngược lại) — `matchCategoryFromInput()` lọc theo `type`. Không có ràng buộc đó thì "lương" sẽ ra Ăn uống chỉ vì hai chữ từng nằm chung một câu.
- **Không khớp từ nào ⇒ "Khác", và phải NÓI RA.** `matched:false` là thứ bật dòng "Chưa nhận diện được, bấm để đổi" trên thẻ. Im lặng nhận bừa thì người dùng không bao giờ sửa, và ma trận học luôn cái sai đó.
- **Ghi chú giữ nguyên câu người dùng gõ, cả dấu.** Đừng "dọn" số tiền ra khỏi nó: chính chuỗi đó là dữ liệu học cho lần sau, và nó cũng là thứ hiện trong sổ giao dịch.
- **Ngày bị bóc ra TRƯỚC số tiền** (`chatExtractDate()` trả cả `rest`). Để nguyên "12/03/2026" thì 2026 là con số lớn nhất trong câu và nó thắng "35k". Ngày dựng bằng `isoOf()`, ngày trong tháng bị kẹp theo độ dài tháng — `new Date(2026,1,31)` âm thầm nhảy sang tháng 3.
- **Dấu `.` và `,` trong số tiền**: nhóm cuối đúng 3 chữ số ⇒ ngăn nghìn (`50.000`), còn lại ⇒ thập phân (`1.2tr`). Đoán sai là lệch một nghìn lần. Đơn vị phải đứng cuối token (`(?![a-z0-9])`), không thì "35 khách" thành 35k.
- **OCR là ngoại lệ duy nhất của luật "không CDN"** — và chỉ là ngoại lệ vì nằm **ngoài đường boot**: `chatOcrImage()` xin phép rồi mới nạp `tesseract.js` từ jsDelivr, thất bại thì bot nói thẳng và người dùng gõ tay số tiền. Đừng chuyển nó lên `<script>` trong `index.html` và đừng vendor nó: ~2MB JS + wasm + gói tiếng Việt vài MB sẽ nhân đôi APK và phá câu chuyện offline-first. `sw.js` bỏ qua mọi origin khác nên gói đó không rơi vào cache của shell. Phần bóc tách văn bản (`parseBillText()`) tách riêng khỏi OCR để test chạy được mà không cần engine.
- **Ngăn chat là overlay ngoài `.view`**, đúng cạm bẫy của `#amount-sheet`: `switchTab()` và `showLogin()` phải tự đóng nó. `switchTab()` cũng là nơi duy nhất bật `#chat-fab`, cùng luật với nav bar; login / onboarding / màn cấu hình tự ẩn.
- **Căn giữa ngăn chat bằng `left:0;right:0;margin:0 auto`, KHÔNG bằng `left:50% + translateX(-50%)`** — keyframe `slideUp` animate `transform`, nó ghi đè luôn phần `translateX` và ngăn chat bay vào từ lệch nửa màn hình rồi mới nhảy về chỗ. Đã thấy tận mắt.
- **`z-index: 99`** cho cả nút nổi lẫn ngăn chat. Thang lớp đầy đủ: `.view` 2 · `.nav-bar` 30 · trợ lý 99 · `#amount-sheet` **120** · `.modal` **130** · `.lock-screen` 200 · `#toast-wrap` 300. Nâng trợ lý lên 1000 là nuốt mất đúng cái toast "Đã lưu giao dịch" mà chính nó vừa bắn ra.
- **`.modal` (130) phải nằm TRÊN `#amount-sheet` (120).** Một modal luôn được mở *từ* một bề mặt nào đó, nên nó phải ở trên bề mặt đó. Bàn phím nhập tiền từng cao hơn (`.modal` ở 100), và hậu quả là: bấm chip Danh mục hay chip Ví trong màn ghi nhanh thì sheet mở **ra sau** bàn phím — người dùng không thấy gì và tưởng app đơ. Đây là loại lỗi jsdom không thấy (không layout), nên smoke **so trực tiếp hai con số z-index trong CSS**.
- **Ba nhóm ý định** (`parseChatIntent()`): `TRANSFER` · `RECURRING` · `SINGLE_TRANSACTION`. Chuyển ví và định kỳ ghi vào sổ theo hai đường hoàn toàn khác — biến chúng thành một khoản thu/chi thường là ghi sai bản chất.
  - **Thiếu dữ liệu thì HỎI, không đoán** (`renderBotInteractiveCard()`, kịch bản A): thiếu ví đích → chip danh sách ví; thiếu chu kỳ → ba nút Hàng tuần/Hàng tháng/Hàng năm. Đoán hộ ví đích của một lần chuyển tiền là đoán hộ chỗ tiền sẽ nằm.
  - **Hướng tiền đọc theo chữ dẫn, không theo thứ tự**: "từ|ở|trong" ⇒ nguồn, "sang|đến|tới|vào|qua" ⇒ đích (`walletDirection()` soi 12 ký tự ngay trước tên ví). Một ví trong câu thì "rút" ⇒ ví đó là nguồn, "nạp" ⇒ ví đó là đích.
  - **`commitTransfer()` là chỗ DUY NHẤT dựng một lần chuyển ví** — `saveTransfer()` (form) và trợ lý đều gọi nó. Hai đường ghi song song thì sớm muộn một đường quên khoản phí, hoặc quên rằng cả ba bản ghi phải dùng **chung một `status`**, và khi đó hai ví bất đồng về chỗ tiền đang nằm. Tương tự, `recurringRecord()` là hình dạng dùng chung của một bản ghi định kỳ.
  - **Bot tạo lịch với `autoProcess: false`.** Nó tạo *lịch nhắc*, không tự mở một đường ghi tiền định kỳ mà người dùng chưa bật bao giờ. Hạn kế tiếp luôn ở tương lai (`recurringDueDate()`) — một lịch sinh ra với hạn quá khứ sẽ bị `autoProcessRecurring()` bù ngay lập tức.
  - **"ngày 5" là ngày, không phải tiền**: `chatRecurringDraft()` bóc `\b(ngay|mung)\s*\d{1,2}\b` ra **trước** khi tìm số tiền, không thì với câu "định kỳ ngày 5" con số 5 thắng luôn.
- **Biên lai ngân hàng / ví điện tử** (`parseBankReceiptOCR()`): nhận nhà phát hành qua `BANK_SIGNS` (Techcombank, MoMo, ZaloPay, VCB, VietinBank, BIDV, MB, ACB, VPBank), bóc số tiền theo **nhóm nghìn có dấu phân cách** (`2,000,000` / `100.000` — không thể là số tài khoản), rồi nội dung chuyển khoản, rồi map sang ví trong sổ.
  - **Mọi regex chạy trên chuỗi ĐÃ BỎ DẤU.** Đây là điểm quan trọng nhất: OCR đọc dấu rất tệ ("Nội dung" ra "Noi dung", "Nôi dung"), nên khớp tiếng Việt có dấu là đánh cược vào đúng thứ máy đọc sai nhiều nhất. `deaccent()` giữ nguyên dấu câu **và độ dài chuỗi** với tiếng Việt tổ hợp sẵn, nên mốc cắt ghi chú tìm trên bản không dấu rồi áp **chỉ số** sang bản có dấu — có kiểm tra `t.length === flat.length` trước, gặp chuỗi đã tách dấu thì thà lấy bản không dấu còn hơn cắt lệch.
  - **Nhà phát hành = tên xuất hiện SỚM NHẤT trong văn bản**, không phải tên đầu tiên khớp trong `BANK_SIGNS`. Biên lai in logo/tên app ở đầu trang, còn tên ngân hàng của người *nhận* nằm giữa trang — ảnh mẫu Techcombank có cả "TECHCOMBANK" (nguồn) lẫn "VIETCOMBANK" (đích), và duyệt theo thứ tự bảng thì kết quả phụ thuộc thứ tự ta gõ cái bảng đó.
  - **Bóc chữ nghiệp vụ trước khi khớp danh mục** (`RECEIPT_FILLER_RE`). Lý do tìm ra từ biên lai thật: "chuyển khoản" chứa "chuyển", mà danh mục "Di chuyển" cũng chứa "chuyển" — nên **mọi** biên lai chuyển tiền đều bị gán vào Di chuyển. Memo chỉ có chữ nghiệp vụ thì không mang thông tin danh mục nào, và trả về "Khác" kèm nhắc "bấm để đổi" mới là câu trả lời đúng.
  - **Danh mục: ba nguồn, tin cậy giảm dần** — dòng "Danh mục" do chính app in ra (MoMo có) → nội dung chuyển khoản → toàn bộ văn bản. Dòng của app là phân loại của chính giao dịch đó, đáng tin hơn mọi phép đoán từ tên cửa hàng.
  - **Ảnh biên lai KHÔNG được đoán lại bằng `detectChatType()` / `matchWalletAndCategory()` trên toàn văn OCR.** `processChatMessage()` lấy `type` và `categoryId` thẳng từ `parseBankReceiptOCR()`. Đoán lại là ghi đè bằng chứng bằng phỏng đoán, và phỏng đoán đó đọc cả tên quận huyện: "Thủ Đức" chứa "thu" nên một khoản cà phê thành khoản THU; "Mã đơn hàng" chứa "hàng" nên danh mục con thành "Nhà hàng". Cả hai đã xảy ra thật trên ảnh của người dùng.
  - **`receiptDirection()` — ba tầng, tầng nào cũng chỉ đọc bằng chứng NÓI VỀ HƯỚNG**: dấu ngay cạnh con số (kể cả `–`, `—`, `~` do OCR đọc chệch) → từ khoá hướng ("nhận từ"/"tiền vào"/"ghi có" ⇔ vào, "thanh toán"/"chuyển tiền"/"ghi nợ" ⇔ ra) → mặc định **chi**. Mặc định chi vì tờ biên lai người ta chụp trong app thanh toán gần như luôn là tiền đi ra, và đoán sai theo hướng đó thì số dư chỉ thiếu chứ không phình — cùng nguyên tắc với `getUserTransactions()`.
  - **Dấu của con số quyết định chiều tiền**, không phải từ khoá: một trang biên lai đầy chữ nghiệp vụ thì "Thủ Đức" chứa "thu" và "Ngoại thương" chứa "thương". Dấu có thể đứng trước số hoặc trước đơn vị (`-VND 262,000`).
  - **Dãy số trần ≥ 10 chữ số không bao giờ là tiền** (`chatAmountCandidates`): trên biên lai, số tiền luôn có dấu ngăn nghìn, còn 14 chữ số liền nhau là số tài khoản. Không có luật này thì "So tai khoan 19027323500017" ra mười chín nghìn tỷ. Trần trên là `AMT_MAX_INT_DIGITS` — cùng trần mà bàn phím số dùng.
  - **Mốc dừng khi cắt một đoạn** (`RECEIPT_STOP_RE`) lấy từ nhãn của hai app thật: thiếu "ma don hang" thì "Nội dung" của MoMo ăn luôn mã đơn hàng 40 ký tự phía sau. `receiptSlice()` cũng không bao giờ cắt giữa một từ.
  - Ảnh mẫu (`techcom.jpg`, `momo.jpg`) **không commit** — chúng là ảnh chụp thật, có tên người và số tài khoản, mà repo này public; `.gitignore` chặn `/*.jpg|jpeg|png` ở gốc. Văn bản của chúng đã ẩn danh và nằm trong `scripts/smoke.js` làm fixture, nên test chạy được mà không cần ảnh.
  - **`findWalletByNameOrType()` khớp TÊN trước, rồi mới tới LOẠI ví** (`walletTypeOf()`, không so chuỗi tay). Không tìm được thì trả `null` và chỗ gọi dùng ví mặc định — đoán bừa một ví là ghi tiền vào sai chỗ. Ví từ biên lai **thắng** ví suy từ lịch sử: tờ giấy nói rõ tiền đi từ nhà nào.
  - Không thấy cấu trúc biên lai nào thì tự về `parseBillText()` (dòng "tổng cộng" → con số lớn nhất) — cùng một hàm mà hoá đơn quán ăn đang dùng.
- **Hỏi dữ liệu, không chỉ ghi dữ liệu.** `parseQueryIntent()` nhận bốn loại câu hỏi (`HIGHEST_EXPENSE` · `LOWEST_EXPENSE` · `CATEGORY_TOTAL` · `BALANCE_CHECK`) cùng mốc thời gian / ví / danh mục, `executeQuery()` tính bằng **chính** `getUserTransactions()` + `txMain()` mà báo cáo dùng (hai chỗ không được ra hai con số), và `chatNavigate({view, period, categoryId, walletId, highlightTxId})` là cửa duy nhất cho mọi hyperlink trong chat.
  - **Có số tiền rõ ràng trong câu ⇒ đây là giao dịch, không phải câu hỏi** (`chatHasExplicitAmount()`): "trà sữa tổng cộng 45k" chứa chữ "tổng cộng" nhưng vẫn là một khoản chi. Ngược lại, con số phỏng đoán không tính — "chi nhiều nhất tháng 9" thì 9 là tháng.
  - **Bóc từ ngữ của câu hỏi ra trước khi khớp danh mục** (`queryCleanText()`). Để nguyên thì "tháng trước chi bao nhiêu" có "bao" trở thành từ khoá và khớp bừa vào một danh mục — câu hỏi về tổng chi cả kỳ bỗng thành câu hỏi về một danh mục. `QUERY_FILLER_RE` **bắt buộc có `\b` hai đầu**: thiếu ranh giới từ thì "con" ăn vào giữa "cong" của "tổng cộng".
  - **`view` chọn nơi trả lời được câu hỏi**: tab Báo cáo lọc theo ví + mốc, nhưng **chỉ tab Giao dịch có bộ lọc danh mục** — nên câu hỏi theo danh mục dẫn sang Giao dịch, câu hỏi tổng cả kỳ dẫn sang Báo cáo, `BALANCE_CHECK` dẫn sang Ví. Mốc `last_7_days` không có preset ở Báo cáo nên phải đi qua "Tùy chỉnh", và hai ô ngày phải được ghi **trước** `setReportRange()` vì `reportRange()` đọc chính chúng.
  - Hợp đồng điều hướng giữ trong `chatQueryNavs` (RAM), **không** nhúng JSON vào `onclick`: một tên ví có dấu nháy là đủ phá cả thuộc tính đó.
- **Lịch sử hội thoại: 100 bản ghi gần nhất**, localStorage `sofin_chat_history::<uid>` — **có namespace theo tài khoản**, hai người dùng cùng một máy không đọc hội thoại của nhau (cùng lý do `FINYOURTIN_STATE_V4::<uid>`). Không nằm trong `state`: hội thoại không phải dữ liệu tài chính, đẩy lên Supabase là làm snapshot to thêm mỗi lần nhắn.
  - **Lưu CHỮ, không lưu HTML.** HTML còn ôm theo id của draft trong RAM, nạp lại là một cái thẻ có nút bấm không làm gì cả. Chỉ lưu thứ đã xảy ra: câu người dùng nhắn, câu bot trả lời, và bản ghi đã vào sổ (`role:'tx'` + snapshot) — thẻ xác nhận đang chờ thì không.
  - `chatAppend()` là chỗ **duy nhất** mọi bong bóng đi qua, nên log nằm ở đó. Cờ `chatSkipLog` tắt log khi đang khôi phục (không thì mỗi lần mở lại nhân đôi) và khi chào (lời chào là giao diện, không phải tin nhắn — để nó vào lịch sử thì người dùng cuộn lại sẽ thấy nó chen giữa những khoản chi của mình).
  - **Lưu xong thì thẻ xác nhận biến thành đúng cái thẻ mà lịch sử sẽ vẽ ra** — đầy đủ thông tin giao dịch và có nút "Tạo lại" ngay tại chỗ. Trước đây chỗ này chỉ in một dòng "✓ Đã lưu", nên muốn xem lại thông tin hay tạo lại thì phải **đóng app mở lại** cho `restoreChatHistory()` vẽ thẻ — đúng lỗi người dùng báo. Một chỗ vẽ, hai đường tới (vừa lưu / vừa nạp lại) thì không thể lệch nhau.
  - **Nút "Tạo lại" khoá theo `lid` (id ổn định của bản ghi lịch sử), KHÔNG theo chỉ số mảng.** `saveChatHistory()` cắt còn 100 bằng `slice(-100)`, nên mỗi lần cắt là mọi chỉ số trượt đi và một nút đã vẽ ra sẽ dựng lại **nhầm giao dịch khác**.
  - Nút **🔄 Tạo lại** trên thẻ "Giao dịch cũ" dựng một draft mới rồi hiện thẻ xác nhận — không ghi thẳng vào sổ. Ngày lấy **hôm nay** (tạo lại nghĩa là lần này), còn ví/danh mục được **kiểm lại lúc bấm**: cái đã bị xoá thì rơi về mặc định thay vì tạo ra một giao dịch không số dư nào đọc được.
  - Nút ✕ chỉ **đóng** (lịch sử bền rồi); xoá là hành động riêng có hỏi lại (🗑).
- **Thiếu số tiền thì HỎI LẠI, không dựng thẻ** (`validateChatPayload()` + `generateMissingInfoPrompt()`). Một thẻ với "chưa rõ — bấm để nhập" vẫn có nút "Tự động lưu", mà nút đó chỉ toast một câu rồi đứng im — người dùng bấm hai lần rồi bỏ đi.
  - `pendingChatContext` giữ ý định dở dang, **hạn 10 phút**: một context của nửa tiếng trước lặng lẽ dính vào câu "50k" bây giờ là một khoản chi không ai nhớ mình đã khai. Nhắn sang chuyện khác thì context bị bỏ.
  - Chỉ gộp khi tin nhắn sau **thực sự chỉ có con số** (`chatIsAmountOnly()`: bỏ số tiền ra thì không còn từ khoá nào). "cà phê 30k" cũng có số tiền nhưng nó là một giao dịch MỚI, không phải câu trả lời.
  - Câu hỏi được rút ngẫu nhiên trong ba biến thể, nên phần "mình đã ghi nhận …" phải là **một dòng riêng** — mọi cách chèn vào thân câu đều chỉ đúng với một biến thể.
- **Ví mặc định lấy theo TẦN SUẤT của đúng loại giao dịch** (`chatDefaultWallet(type)`), không phải "ví vừa dùng gần nhất": lương hay vào ví ngân hàng, chi lẻ hay ra ví tiền mặt, và một lần ghi lẻ ở ví khác không được kéo mặc định đi theo.
- Con số vừa bóc tách **không** đi qua `fmt()` (`chatAmountText()` tự format): chế độ riêng tư che *số dư*, che chính con số người dùng vừa gõ thì vô nghĩa. Số dư ví trong bộ chọn ví thì vẫn qua `fmtW()` và vẫn bị che.

## Trung tâm thông báo

Cảnh báo không còn là banner trên Trang chủ. Banner ở đó vừa chiếm chỗ của Giao dịch gần đây và Ví trên màn hình đầu, vừa **không có trạng thái "đã đọc"** — nên nó hiện lại y nguyên mỗi lần mở app cho tới khi người dùng xử lý xong, và người ta học cách nhìn xuyên qua nó. Giờ tất cả vào quả chuông trên app bar (`#notification-bell`), chấm đỏ khi còn tin chưa đọc.

- **`state.notifications` nằm TRONG state** nên nó đi theo snapshot Supabase — cố ý: đánh dấu đã đọc trên điện thoại thì máy tính cũng thôi nhắc. Đổi lại snapshot to dần, nên có trần `NOTIF_MAX` và khi cắt thì **cắt tin đã đọc trước**.
- **`createdAt` là chuỗi ISO, không phải object `Date`.** State đi qua `JSON.stringify` vào localStorage và lên Supabase, nên một `Date` sẽ thành string sau lần nạp đầu tiên — kiểu dữ liệu khác nhau trước và sau reload là một lớp lỗi không đáng có.
- **Dedup bằng chính `id`**, nên id **không được chứa `Date.now()`**: hai lần quét trong cùng một tháng phải ra cùng một id, không thì mỗi lần mở app lại đẻ thêm một bản trùng. Mốc 80% và 100% là **hai tin khác nhau** (id mang theo mốc): vượt hạn mức rồi thì phải được nhắc lại dù đã đọc tin 80%.
- **`checkBudgetAndPushNotifications()` gọi từ `initUserSession()` và `checkBudgetWarning()`** — không gọi từ hàm render: render mà ghi state là một vòng vẽ-ghi-vẽ. Nó quét cả ba nguồn cảnh báo (ngân sách, nợ đến hạn, thẻ tới ngày trả); toast là cảnh báo tức thì cho danh mục vừa ghi, thông báo là bản ghi lâu dài — hai thứ khác nhau.
- **Bấm một tin thì đi tới chỗ xử lý được nó**, qua `chatNavigate()` — cùng một cửa điều hướng với hyperlink trong chat. Ngân sách theo danh mục dẫn sang **Giao dịch** (chỗ duy nhất có bộ lọc danh mục), ngân sách tổng dẫn sang **Báo cáo**.

## Vuốt ngang đổi tab

`SWIPE_TABS = ['dashboard','transactions','reports','settings']` — đúng thứ tự trên nav bar, nên chiều vuốt trùng chiều mắt đọc. Dùng **tên tab thật** của app, không phải một bộ tên song song.

- **Gọi `switchTab(tab)` KHÔNG có tham số thứ hai.** Tham số đó ở app này là `replaceStep` ("bước cũ đã xong, ghi đè entry") — truyền `true` vào sẽ làm mỗi cú vuốt ăn mất một bước lịch sử và nút Back nhảy cách tab. Đẩy entry mới là hành vi mặc định, và đó đúng là thứ cần ở đây.
- **Bốn vùng chừa ra**, mỗi vùng một lý do:
  1. Overlay đang mở (modal / bàn phím số / ngăn chat / màn khoá) — kiểm cả khi ngón tay đặt **ngoài** overlay: đổi tab sau lưng một modal thì người dùng đóng nó ra và thấy mình ở màn hình khác.
  2. Vùng cuộn ngang (`.wallet-strip`, `.chip-scroll`, `.scroll-x`) — không chừa thì thanh ví không cuộn được nữa, nó đổi tab.
  3. `canvas` — biểu đồ có tooltip theo ngón tay.
  4. **24px sát mép trái** (`SWIPE_EDGE_GUARD`) — vùng cử chỉ Back của iOS/Android. Không chừa thì một động tác cho ra hai bước: lùi lịch sử **và** đổi tab.
- Ngang phải nhiều hơn dọc, và tối thiểu 60px: thiếu hai điều kiện đó thì một cú cuộn trang hơi chéo tay cũng nhảy tab. Hai ngón (pinch) bị bỏ qua.
- **Màn hình con không có tab kế bên** (`indexOf` trả `-1` → không làm gì): Ví, Ngân sách, Sổ nợ… vào từ lưới Tiện ích chứ không từ nav bar.
- **Không có animation trượt.** Mỗi `.view` là một khối riêng; muốn trượt thì phải dựng cả băng bốn màn hình cạnh nhau và giữ nó đồng bộ với `switchTab()` — trả bằng một nguồn sự thật thứ hai về "đang ở tab nào". `touch-action` trong CSS là thứ cần khoá: `pan-y` cho `.app`, `pan-x` cho các vùng cuộn ngang.

## Bố cục Trang chủ

Thứ tự cố định, từ trên xuống: **Tổng tài sản ròng → Giao dịch gần đây → Tiện ích → Ví (thanh cuộn ngang) → cụm cảnh báo (Sắp đến hạn + Ngân sách) → Chi tiêu theo danh mục.** Smoke khoá đúng thứ tự này bằng vị trí trong `innerHTML`, vì nó là thứ vỡ âm thầm khi ai đó thêm một khối mới vào giữa.

- **Biến động dòng tiền đọc được ngay**, không phải cuộn xuống cuối trang: Giao dịch gần đây ở vị trí 2, Tiện ích ở vị trí 3.
- **Ví là thanh cuộn ngang** (`.wallet-strip`), và đây là **một lần đảo ngược quyết định cũ** — trước đây là lưới 2 cột với lý do "6 ví = 3 hàng, không phải vuốt". Lý do đảo: sau khi hai khối trên lên đầu, chiều dọc của màn hình đầu tiên đắt hơn chiều ngang. Cái giá của thanh cuộn là ví thứ ba trở đi nằm ngoài khung, nên **`flex: 0 0 46%` là con số có chủ đích**: hai thẻ vừa khung và luôn hở một phần thẻ kế tiếp. Mảnh hở đó là tín hiệu duy nhất nói rằng cuộn được — bỏ nó đi là quay lại đúng cái lỗi mà lưới 2 cột từng dựng lên để sửa.
- **Cụm cảnh báo tự ẩn khi không có gì để nhắc** (`syncAlertZone()`, gọi từ `renderDashboard()`): không có khoản sắp đến hạn **và** không có ngân sách nào đang theo dõi thì ẩn cả `#db-alert-zone`. Hai thẻ rỗng ("Không có khoản nào sắp đến hạn 🎉" + "Chưa đặt ngân sách nào") chiếm đúng chỗ mà Giao dịch gần đây và Ví đang cần. **Ẩn, không xoá khỏi DOM** — id và handler bên trong phải còn nguyên để lần vẽ sau hiện lại được, và `check.js` cũng cần các id đó tồn tại.
- Padding `.card` là **14px** (không phải 16): năm khối trong một màn hình thì 2px mỗi thẻ nhân lên gần một dòng chữ.

## Báo cáo — biến động số dư

Một thẻ `.report-balance-card` đọc một mạch: **đầu kỳ → thu/chi → ròng → cuối kỳ**. Bốn con số này chỉ có nghĩa khi đứng cạnh nhau, nên đừng tách lại thành các thẻ rời.

- `balanceAsOf(walletIds, beforeISO, includePending)` **phát lại sổ** tới trước ngày đầu kỳ. Đừng thay bằng "số dư hiện tại trừ ngược biến động": cách đó sai với chuyển ví và với ví ngoài phạm vi đang lọc. Cùng lý do với `getWalletBalance()` — không có trường `balance` nào để đọc.
- `calculateReportMetrics()` trả `closing = opening + thu − chi + transfer`, và đó **bằng đúng** số dư phát lại tới cuối kỳ. Bỏ số hạng `transfer` là lọc theo một ví sẽ ra `đầu kỳ + ròng ≠ cuối kỳ` — chuyển ví không phải thu cũng không phải chi, nhưng nó có làm số dư ví đổi. Dòng "Chuyển ví ròng" trên UI chỉ hiện khi khác 0, và nó là chỗ duy nhất nói ra phần chênh đó.
- `reportBalanceScope()` phải khớp **chính xác** với `inReportScope()`. Lệch một ví là phép cộng trên thẻ vỡ. Chú ý `reportWalletScope()` (dùng cho biểu đồ) thì *có* loại ví `excludeFromTotal` — hai hàm khác nhau, đừng dùng lẫn.
- `reportIncludePending` chi phối **cả hai đầu**: bật "Gồm dự kiến" mà chỉ cộng khoản dự kiến vào biến động trong kỳ thì thẻ tự mâu thuẫn với chính nó.
- Smoke khoá phép cộng này chứ không khoá con số cụ thể — dữ liệu mẫu đổi thì test vẫn đúng.

## Điều hướng "Xem tất cả ›" từ khối Sắp đến hạn

`viewAllUpcoming()` đặt `status:'pending'` + `range:'custom'` với **chỉ cận trên** (`tx-to = getUpcomingRange()`, `tx-from` để trống).

Không preset nào của trang Giao dịch dùng được: `7d` / `30d` đếm **lùi** về quá khứ, còn cửa sổ ở đây là tới hết hạn. Và cận dưới thì **phải để trống**: kẹp từ hôm nay chẳng lọc thêm được gì (khoản dự kiến nào cũng từ hôm nay trở đi) nhưng lại cắt sạch mọi giao dịch đã ghi nhận (vốn luôn ≤ hôm nay), nên đổi ô Trạng thái sang "Đã ghi nhận" hay "Tất cả" vẫn ra đúng danh sách cũ — trông y như bộ lọc chết. Đúng lỗi này đã được báo một lần.

Khối **"Giao dịch gần đây"** dưới lưới Tiện ích ở Tổng quan đọc `getUserTransactions()` — **chỉ khoản đã ghi nhận**. Dùng `getAllUserTransactions()` thì `sortTxDesc` xếp ngày lớn trước và một khoản dự kiến ngày mai sẽ chiếm đầu danh sách "gần đây": người dùng đọc ra một khoản chi chưa hề xảy ra. Phần dự kiến đã có khối "Sắp đến hạn" riêng ở trên. Link "Xem tất cả ›" của nó (`viewAllRecent()`) đi qua `jumpToTransactions({})` — **hạ mọi bộ lọc về "all"**, vì lời hứa của nó là toàn bộ sổ. Dòng thì dùng lại `renderTxRows()` chứ không dựng markup riêng: một hàng giao dịch phải trông y như nhau ở mọi màn hình, và nhãn "Dự kiến" cùng cú chạm mở chi tiết theo luôn.

`#tx-filter-status` nằm **ngoài** panel lọc gập (cạnh bộ lọc Ví, trong `.quick-filter-row`), giống `#tx-filter-wallet` và vì cùng lý do: cả hai đều lọc *mất* giao dịch khỏi danh sách, mà một bộ lọc giấu trong panel ẩn thì người dùng chỉ thấy danh sách ngắn đi chứ không thấy lý do. Smoke khoá điều này (`!$('tx-filter-status').closest('#tx-advanced-filters')`).

## Cạm bẫy của `scripts/check.js`

Nó cũng thực thi một danh sách **tên bị cấm** (`state.users`, `login-username`, `resetDemoData`, `migrateFromLegacy`) — tàn dư từ bản offline. Nếu bạn cố tình cần một trong các tên đó, sửa danh sách ở `check.js:70` kèm lý do, đừng lách.

Tập id hợp lệ gồm cả `id="..."` xuất hiện trong JS (do `uiSheet` và các panel render động), không chỉ trong `index.html`.

## Icon và màu

Icon *hệ thống* dùng `icon('name')` (bảng `ICON_PATHS` ở đầu `app.js`) — SVG 24×24 stroke, thừa kế `currentColor` và cỡ chữ; cần cỡ khác thì thêm rule cho `.ic-svg` trong ngữ cảnh đó, đừng gán `width` inline. **Emoji do người dùng chọn** (`wallet.icon`, `category.icon`, `event.icon`, `EMOJI_POOL`) là **dữ liệu trong `state`** — không đụng vào, đổi sẽ hỏng bộ chọn emoji và dữ liệu cũ. Trong `<option>` cũng phải giữ emoji vì SVG không nhúng được vào đó.

Ngôn ngữ thiết kế bám theo **VietinBank iPay**: xanh `#00529C` / `#003B70`, đỏ nhấn `#ED1C24` (`--brand-red`), nền `#F4F7FA`. Ba gradient riêng biệt, đừng dùng lẫn: `--gradient` (app bar), `--gradient-card` (thẻ ví/tài sản), `--gradient-fab` (nút +). **Thứ tự xếp lớp**: `header` để `z-index:1`, `.view` để `z-index:2`. Đừng nâng header lên — nó từng để `25` (di sản thời còn `position:sticky`) và nuốt mất nửa dòng "Tổng tài sản ròng" vì thẻ số dư cố tình kéo lên đè vào vành header. `.view` có `z-index` nên tạo stacking context riêng: đặt `z-index` cho `.hero` bên trong là vô ích, phải chỉnh ở tầng `.view`.

**App bar dùng `position:fixed`, KHÔNG dùng `sticky`.** Sticky neo vào scrollport gần nhất, mà bất kỳ tổ tiên nào có `overflow` khác `visible` cũng trở thành scrollport — `.app` có `overflow-x` để chặn trôi ngang, nên nó nhận vai đó rồi không bao giờ cuộn, và bar trôi theo trang. Đổi sang `clip` **không cứu được**; đã thử và vẫn hỏng. `.nav-bar` fixed từ đầu và chưa bao giờ dính lỗi này, header giờ dùng đúng công thức đó: `fixed; left:50%; transform:translateX(-50%); max-width:520px`.

Bar ra khỏi luồng nên không gì bên dưới biết nó cao bao nhiêu: `syncHeaderHeight()` đo rồi công bố `--hd-h` (chiều cao phụ thuộc safe-area, chỉ biết lúc chạy), `.view` chừa `calc(var(--hd-h) + 12px)`. Gọi lại sau mỗi `switchTab`, khi hiện header, và khi resize.

Trên desktop (`shell.css`) `.app > .view` mới là vùng cuộn và bar nằm ngoài nó, nên media query trả header về `position:static` — fixed sẽ ghim nó vào viewport và văng khỏi khung.

**Chỉ có MỘT kiểu app bar: phẳng.** `switchTab()` luôn `add('hd-flat')`, HTML cũng đặt sẵn cờ đó cho màn hình nào hiện header mà không đi qua `switchTab` (onboarding). Trước đây Dashboard giữ một vành 26px để thẻ số dư kéo lên đè vào — cơ chế đó cần cờ `hd-flat` phải đúng trên **mọi** đường vào **mọi** màn hình, và nó sai hai lần: nuốt tiêu đề "Cài đặt", rồi nuốt tiêu đề onboarding. Đã bỏ hẳn: không còn `margin-top` âm, `.hero` nằm dưới header như tiêu đề mọi trang khác.

**Giữ nguyên `:not(.hidden)`** trong selector `#main-header:not(.hidden) ~ .view`: bỏ đi thì màn đăng nhập/onboarding (vốn ẩn header) sẽ ăn phải `padding-top` thừa.

Lưới Tiện ích ở đáy Dashboard cố định **5 ô một hàng** (`.menu-grid-compact`), ô cuối là "Tất cả". Thêm tính năng mới thì cho vào `MORE_FEATURES` — sheet đó mở từ ô cuối — đừng nhồi thêm ô: ô thứ 6 sẽ vỡ hàng, và bỏ ô "Tất cả" đi là có màn hình không còn đường vào (Sự kiện đã từng bị bỏ rơi đúng kiểu này).

Màu brand nằm trong `--primary*` / `--gradient*` / `--primary-glow` ở `styles.css`. Đổi màu thì phải đổi cả 4 chỗ khác ngoài CSS: `applyTheme()` (meta theme-color), `manifest.json`, `scripts/generate-icons.js` rồi chạy `npm run icons`, và fallback màu trong `drawDonut`/`budgetIcon`. Chữ trên nền primary dùng `--on-primary`, đừng hard-code `#fff`.

## Biểu đồ

Vẽ bằng **Canvas thuần**, không thư viện — thêm Chart.js/Recharts sẽ kéo theo một CDN thứ hai và phá vỡ ràng buộc không-bundler cùng câu chuyện offline-first.

Tooltip hoạt động theo cặp: hàm `draw*` ghi hình học vào `chartHit.donut` / `chartHit.bars`, còn `bindDonutTip()` / `bindBarTip()` hit-test trên đó. **Không vẽ lại canvas khi con trỏ di chuyển** — chỉ đổi text/vị trí của node DOM `.chart-tip`, riêng donut vá lại đúng vòng tâm bằng `paintDonutCentre()`. Giữ nguyên tính chất này, không thì cuộn trên điện thoại sẽ giật.

`bindChartTip()` gắn cờ `__tipBound` lên canvas vì `renderReportsView()` chạy lại mỗi lần đổi bộ lọc — thiếu cờ đó thì listener chồng chất.

Hàm `draw*` **phải đặt lại `chartHit.*` kể cả khi không có dữ liệu** — nhánh rỗng của `drawDonut()` từng `return` sớm và để nguyên hình học của lần vẽ trước, nên đổi sang tab không có dữ liệu là chạm vào vành rỗng lại bung tooltip của danh mục cũ. `chart-test.js` khoá ca này.

**Chiều cao canvas lấy từ `data-h`, tuyệt đối không từ thuộc tính `height`.** Gán `canvas.height = X` sẽ **ghi ngược vào thuộc tính `height`**, nên lần vẽ sau đọc lại chính bitmap cũ rồi nhân dpr thêm lần nữa: 200 → 600 → 1800 → 5400 → 16200… mỗi lần đổi bộ lọc là một lần nhân. Điện thoại cuối cùng từ chối cấp bitmap và biểu đồ chết. `data-h` là của riêng ta, không ai ghi đè. Có thêm trần `MAX_PX = 4096` chặn mọi phép tính sai trong tương lai.

`setupCanvas()` **đặt `style.width='100%'` rồi mới đo** bằng `getBoundingClientRect()`. Đừng đo `canvas.clientWidth`: đó là bề rộng chính ta ghim ở lần vẽ trước, nên kích thước đầu tiên sẽ dính vĩnh viễn — xoay máy là bitmap vẫn rộng trong khi `max-width:100%` bóp phần tử lại, cho ra nét mờ, tràn khung, và tooltip lệch đúng bằng phần chênh. `devicePixelRatio` chặn trần 3x.

`shortMoney()` (nhãn trục) tôn trọng `state.app.privacy` — bật con mắt thì trục cũng phải che, không thì số vẫn đọc được qua vai.

## Bản Android (Capacitor)

`public/` là nguồn duy nhất — bản mobile chỉ là chính nó đóng gói lại, `webDir: "public"`.

**Thư mục `android/` và `ios/` không commit.** CI chạy `npx cap add android` mỗi lần build, nên không có dự án native nào để lệch khỏi `public/`. Đổi lại: mọi tuỳ biến native phải nằm trong `capacitor.config.json`, sửa tay trong `android/` sẽ bay mất.

Ba chỗ bản native khác web, đã xử lý — đừng gỡ:
- `isNativeApp()` → **không đăng ký service worker** (asset đã nằm sẵn trên máy, worker chỉ cache bản sao của bản sao).
- `resetPassword()` dùng `__ENV__.SITE_URL` khi chạy native: origin của app là `https://localhost`, Supabase từ chối redirect đó và không mail client nào mở được.
- Nút tải APK trong Cài đặt tự ẩn khi đang chạy trong chính APK.

Nút tải trỏ vào `/releases/**latest**/download/**sofin.apk**` — bí danh GitHub cho bản phát hành mới nhất, nên link không đổi theo phiên bản; nhưng *tên file* vẫn phải khớp `build-apk.yml`, lệch là nút 404 mà không có gì báo, nên có assertion khoá cặp đó. CI phải dùng **JDK 21**: Capacitor 8 đặt `sourceCompatibility = 21`, JDK 17 fail ở bước Gradle.

### Phát hành và kiểm tra cập nhật

Push lên `main` chỉ ra **artifact**; chỉ **tag `v*`** mới tạo release. Đó là vì `checkAppUpdate()` đọc `tag_name` của release mới nhất rồi so với `APP_VERSION` — một tag cố định `latest` thì không có gì để so với `5.0.0`. Tag **phải bằng** `package.json.version`; CI chặn ngay từ đầu job nếu lệch, nếu không app vừa cập nhật xong đã tự thấy mình lỗi thời.

```bash
npm version patch --no-git-tag-version   # sửa package.json
git commit -am "..." && git tag v5.0.1 && git push origin main v5.0.1
```

Hai cái bẫy trong workflow đã cắn thật, đừng nới:

- **`concurrency.group` phải kèm `${{ github.ref }}`.** Lệnh push trên đẩy nhánh và tag cùng lúc → hai run song song; một nhóm chung thì cái sau giết cái trước, và đã có lần cái bị giết là run của tag: tag lên remote nhưng **không có release nào**, không một dòng báo lỗi.
- **`ANDROID_DEBUG_KEYSTORE_B64` phải có.** Runner là máy sạch nên Gradle sinh khoá debug ngẫu nhiên mỗi lần build; chữ ký đổi thì Android từ chối cài đè và người dùng phải gỡ app — mất sạch localStorage. CI chặn job phát hành nếu thiếu secret. Alias/mật khẩu bắt buộc là `androiddebugkey`/`android`/`android`, xem `DEPLOY.md`.
- **Cách ký: `apksigner sign` ký đè SAU khi build, không phải đặt khoá cho Gradle tìm.** Đã thử ghi vào `~/.android/debug.keystore` và Gradle vẫn ký bằng khoá tự sinh (`CN=Android Debug`) — nó tìm khoá theo `ANDROID_USER_HOME`/`ANDROID_SDK_HOME` mà `setup-android` đặt, không theo `$HOME`. Ký đè thì không phụ thuộc biến môi trường nào.
- **Bước "Đối chiếu chữ ký" là thứ duy nhất bắt được sai khoá**, đừng gỡ: nó so vân tay SHA-256 của APK với `f73a128d…` và chặn phát hành nếu lệch. Sai khoá hỏng hoàn toàn im lặng — APK cài được, chạy được, chỉ là không ai nâng cấp đè lên nó được, và chỉ lộ ra vài tuần sau. Đúng ca này đã xảy ra ở v5.0.4. Bật cả v1 lẫn v2 khi ký để `keytool -printcert -jarfile` ngoài máy cũng kiểm được.

- `APP_VERSION` đến từ `__ENV__.VERSION` do `generate-env.js` chép từ `package.json`; hằng số dự phòng trong `app.js` chỉ dùng khi mở thư mục không qua build — smoke bắt nó phải trùng `package.json`, để nó cũ đi là app tự đòi cập nhật vô cớ.
- `compareVersions()` so theo **số** từng đoạn: `5.0.10 > 5.0.9`, so chuỗi thì ngược lại.
- Tự kiểm tra **chỉ trên bản native**, 3 giây sau khi mở, và **im lặng khi lỗi mạng** — trên web nút cập nhật là chính việc tải lại trang.
- `FINYOURTIN_UPDATE_DISMISSED` lưu *số phiên bản* đã bấm "Để sau", không phải boolean: bản kế tiếp phải hỏi lại. Local, không sync sang máy khác. Bấm **Tải** cũng ghi cờ này — người dùng rời app sang trình cài đặt rồi quay lại, hỏi lại đúng bản họ vừa tải là phiền.
- Dùng modal riêng `#update-modal`, **không** dùng `uiSheet()`: sheet chung đang phục vụ luồng đặt lại mật khẩu và bộ chọn dữ liệu cũ, mà hộp cập nhật thì tự bật sau 3 giây — hai thứ tranh nhau một element là chuyện sớm muộn.
- Ghi chú phát hành lấy từ `body` của release: **chuỗi Markdown từ mạng**. `formatReleaseNotes()` cắt còn 6 dòng, bỏ ký tự Markdown, và bắt buộc qua `esc()` trước khi vào `innerHTML`.

## PWA

`public/manifest.json` + `public/sw.js`, đăng ký ở `registerServiceWorker()`. Bốn luật của service worker, đừng nới:

1. **Không đụng vào Supabase** (`isSupabase(url)` → `return`) và bỏ qua mọi request không phải `GET`. Cache lại auth/REST là đường thẳng tới việc phục vụ session của người khác.
2. **`js/env.js` đi network-first** — nó chứa URL và anon key; ghim một key đã bị xoay vòng sẽ khoá người dùng ra ngoài.
3. **Chỉ tài nguyên cùng origin** (`url.origin !== self.location.origin` → `return`). Thứ duy nhất đi ra ngoài là engine OCR của trợ lý chat, tải theo yêu cầu và nặng hàng chục MB — để nó rơi vào cache của shell thì mỗi lần deploy là xoá đi tải lại, mà quota thì dùng chung với dữ liệu thật của người dùng.
4. Phần còn lại cache-first + revalidate ngầm.

Tên cache lấy từ `?v=` trên chính URL của `sw.js`, do `generate-env.js` đóng dấu (`__ENV__.BUILD`). Mỗi lần deploy là một script mới → cài lại → `activate` xoá cache cũ. **Đừng bỏ query đó**, không thì người dùng kẹt ở bundle cũ vĩnh viễn.

Icon là PNG thật, sinh bằng `npm run icons` (`scripts/generate-icons.js` tự encode PNG bằng `zlib`, không có thư viện ảnh). Đổi màu thương hiệu thì chạy lại. `npm run check` sẽ fail nếu manifest trỏ vào icon không tồn tại hoặc thiếu icon 512.

## Deploy

Vercel, static: `outputDirectory: public`, `buildCommand: node scripts/generate-env.js --strict`, không framework. `SUPABASE_URL` và `SUPABASE_ANON_KEY` đặt trong Environment Variables của project. `js/env.js` được set `Cache-Control: no-store`; `css/` và `js/` còn lại cache 1 giờ.

## `legacy/`

`legacy/index.offline-v4.html` là bản single-file v4 cũ, vẫn chạy độc lập, **không** được đồng bộ với code mới. Không sửa nó khi thay đổi bản cloud; nó chỉ tồn tại cho người dùng cần bản offline và làm nguồn cho luồng "nhập dữ liệu cũ trên máy này" (`normalizeLegacyArchive`).
