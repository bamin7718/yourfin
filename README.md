# 💰 SoFin

Ứng dụng quản lý tài chính cá nhân **mobile-first**, chạy như một web app tĩnh, đồng bộ đa thiết bị qua **Supabase**. Không framework, không bundler — build step duy nhất là một script Node 20 dòng ghi biến môi trường ra file.

> Tính năng tương đương Money Lover: đa ví, ngân sách, sổ nợ, giao dịch định kỳ, sự kiện/chuyến đi, đa tiền tệ, báo cáo biểu đồ, khóa PIN, sao lưu JSON/CSV — cộng thêm tài khoản đám mây và đồng bộ realtime.

---

## 📂 Cấu trúc

```
SoFin/
├── public/                     ← thư mục được deploy
│   ├── index.html              giao diện (800 dòng)
│   ├── manifest.json           PWA manifest
│   ├── sw.js                   service worker (cache-first, bỏ qua Supabase)
│   ├── icons/                  icon 192/512 + maskable + apple-touch
│   ├── css/
│   │   ├── styles.css          design tokens + component (316 dòng)
│   │   └── shell.css           khung mobile 480px + màn hình mới
│   └── js/
│       ├── app.js              toàn bộ nghiệp vụ (~3.000 dòng)
│       ├── sync.js             Supabase client + auth + đồng bộ
│       └── env.js              ⚙️ sinh tự động, KHÔNG commit
├── supabase/
│   ├── config.js               hợp đồng cấu hình (Node, dùng khi build)
│   └── schema.sql              bảng + RLS + realtime — chạy 1 lần
├── scripts/
│   ├── generate-env.js         build: env → public/js/env.js (kèm BUILD stamp)
│   ├── generate-icons.js       vẽ bộ icon PWA bằng zlib, không cần thư viện ảnh
│   ├── check.js                kiểm tra wiring HTML ↔ JS + manifest/sw
│   ├── smoke.js                chạy thật app bằng jsdom (303 assertion)
│   ├── sync-test.js            hợp đồng đồng bộ: giữ mạng treo để soi UI (20 assertion)
│   ├── transfer-test.js        hợp đồng chuyển ví: hai ví luôn khớp nhau (23 assertion)
│   ├── chart-test.js           canvas giả để chạy thật hit-test biểu đồ (31 assertion)
│   └── header-test.js          app bar đồng nhất trên mọi màn hình (22 assertion)
├── legacy/
│   └── index.offline-v4.html   bản single-file cũ, vẫn chạy độc lập
├── DEPLOY.md                   checklist đưa lên PROD
├── .env.example
├── .gitignore
├── vercel.json
└── package.json
```

Không có runtime dependency. `@supabase/supabase-js` nạp qua CDN.

---

## 🚀 Bắt đầu trong 5 phút

### 1. Tạo dự án Supabase

1. Vào [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Mở **SQL Editor** → dán toàn bộ nội dung `supabase/schema.sql` → **Run**.
3. Mở **Project Settings → API**, chép `Project URL` và key `anon public`.

Nếu muốn bỏ bước xác nhận email khi thử nghiệm: **Authentication → Providers → Email** → tắt *Confirm email*.

### 2. Chạy cục bộ

```bash
cp .env.example .env          # rồi điền SUPABASE_URL và SUPABASE_ANON_KEY
npm run dev                   # sinh env.js + phục vụ public/ tại :5173
```

Không muốn tạo `.env`? Cứ mở app — nó sẽ hiện **màn hình cấu hình** để dán URL và anon key, lưu vào `localStorage` của máy đó.

### 3. Kiểm thử

```bash
npm run check                             # wiring HTML ↔ JS, syntax, rò rỉ khoá, phủ offline
npm install jsdom --no-save && npm test   # smoke 303 + sync 20 + transfer 23 + chart 31 + header 22
```

---

## ☁️ Kiến trúc đồng bộ

Toàn bộ app xoay quanh **một object `state` duy nhất**. Mọi thao tác đều đi qua `saveStorage()`:

```
saveStorage()
   ├─ localStorage['FINYOURTIN_STATE_V4::<uid>']   ← đồng bộ, tức thì, chạy offline
   └─ Sync.queuePush(state)                        ← debounce 800ms → Supabase
```

Chiều ngược lại: `Sync.pull()` khi đăng nhập và khi quay lại tab, cộng với Postgres Realtime khi thiết bị khác ghi.

### Vì sao là JSONB thay vì bảng quan hệ

Một bảng `user_state(user_id, data jsonb)` thay vì 8 bảng chuẩn hoá. Đánh đổi có chủ đích:

| | JSONB snapshot | Bảng chuẩn hoá |
|---|---|---|
| Sửa logic nghiệp vụ | không phải đụng | viết lại ~2.000 dòng thành async |
| Hoạt động offline | mặc định có | phải tự dựng hàng đợi |
| Query phía server | không | có |
| Ghi đồng thời nhiều thiết bị | last-write-wins cả snapshot | theo từng dòng |

Với một người dùng trên vài thiết bị, snapshot là lựa chọn đúng. Nếu sau này cần báo cáo phía server hoặc chia sẻ sổ nhiều người, `transactions` là bảng nên tách ra trước.

### Xung đột

Last-write-wins theo `data.updatedAt` (đồng hồ client, đóng dấu bởi `saveStorage()`). Mỗi thiết bị có `device_id` riêng nên không bao giờ phản ứng với chính tiếng vọng của mình. Đây **không phải CRDT**: nếu sửa cùng lúc trên hai máy đang offline, bên lưu sau sẽ thắng trọn snapshot.

### Bảo mật

- Row-Level Security: mọi policy đều là `auth.uid() = user_id`. Không có đường nào đọc được dữ liệu người khác.
- `anon public` key **được thiết kế để lộ ra trình duyệt** — RLS mới là thứ bảo vệ dữ liệu. `scripts/generate-env.js` sẽ **fail build** nếu phát hiện bạn đưa nhầm `service_role` key vào.
- Mã PIN băm SHA-256 qua WebCrypto, không lưu dạng thô.

---

## ✨ Tính năng

| | |
|---|---|
| **Đa ví** | Tiền mặt · Ngân hàng · Thẻ tín dụng · Sổ tiết kiệm (lãi suất, ngày đáo hạn). Chuyển tiền có phí, khác tiền tệ. Cờ *không tính vào tổng tài sản*. |
| **Thẻ tín dụng** | Dư nợ đi chung sổ cái: `startingBalance` âm, mỗi lần quẹt trừ tiếp — hạn mức đã dùng không bao giờ lệch khỏi lịch sử. Có ngày chốt, hạn thanh toán, trả toàn bộ hoặc một phần. |
| **Danh mục** | CRUD đầy đủ, danh mục con, đổi emoji/màu. Xóa danh mục đang dùng → tự dời giao dịch sang *Khác*. Danh mục hệ thống được bảo vệ. |
| **Ngân sách** | Tuần/Tháng/Năm, theo danh mục hoặc tổng chi, giới hạn theo ví. Progress bar vàng ở 80%, đỏ khi vượt. Cảnh báo ngay lúc lưu giao dịch. |
| **Sổ nợ** | Đi vay và cho vay riêng, trả/thu từng phần hoặc tất toán, tự sinh giao dịch, nhắc hạn và đánh dấu quá hạn. |
| **Định kỳ** | Ngày/Tuần/Tháng/Năm, lặp mỗi N kỳ, tự ghi nhận và bù các kỳ đã lỡ khi mở lại app. Bấm ✓ để ghi tay: sheet xác nhận cho **chọn lại ngày và ví** trước khi tạo giao dịch; lịch vẫn neo theo ngày đến hạn nên trả muộn không làm trôi cả chu kỳ. |
| **Báo cáo** | Bộ lọc mốc thời gian **Tháng này · Tháng trước · 3 tháng · Năm nay · Tùy chỉnh** (mặc định tháng hiện tại). Thứ tự thị giác: 3 **thẻ tổng quan** Thu / Chi / Dòng tiền ròng → **donut** cơ cấu danh mục (phần trăm ở tâm, đổi theo lát đang chạm) → **cột nhóm** Thu vs Chi 6 tháng → **xếp hạng chi tiêu** có progress bar. Tooltip chạm/hover trên cả donut lẫn cột. Vẽ bằng Canvas thuần, xử lý `devicePixelRatio`, tự đổi màu theo theme. |
| **Đa tiền tệ** | 10 loại tiền, mỗi ví một tiền tệ, quy đổi về tiền tệ chính. Tỷ giá chỉnh tay trong Cài đặt. |
| **Nhập số tiền** | Mọi ô tiền tự chèn dấu phân cách nghìn ngay lúc gõ (`1.250.000`), giữ nguyên vị trí con trỏ. Nút **`000`** trong ô nhân giá trị lên nghìn: `50` → `50.000` → `50.000.000`. Xuống `state`/localStorage luôn là `number` sạch. Chung một cặp `formatMoneyText()` / `readMoney()` cho tất cả form. |
| **Giao dịch dự kiến** | Chọn ngày trong tương lai → giao dịch vào trạng thái `pending`: **chưa trừ ví, chưa vào tổng tài sản, chưa vào báo cáo/ngân sách**. Nó hiện ở "Dự kiến phải chi" theo đúng tab Trong tháng / 7 ngày tới / Tháng tới, và trong sổ Giao dịch với nhãn *Dự kiến*. Tới ngày thì tự chốt; bấm ✓ để chốt sớm. Báo cáo có chip **🔮 Gồm dự kiến** để xem trước. |
| **Sự kiện** | Gom chi tiêu theo chuyến đi/sự kiện, có ngân sách riêng và phân tích riêng. |
| **Điều hướng** | Thanh nav đúng 4 mục — Tổng quan · Giao dịch · Báo cáo · Cài đặt — cộng nút **+**. Các màn hình phụ (ví, ngân sách, sổ nợ, định kỳ, sự kiện, danh mục) vào từ lưới **Truy cập nhanh** ở Tổng quan. Chạm một ví → nhảy sang Giao dịch đã lọc sẵn ví đó; chạm một danh mục → lọc theo danh mục. Bộ lọc **Ví** nằm ngay trên màn hình Giao dịch, không phải mở panel nâng cao. |
| **PWA** | Cài lên máy được, chạy standalone, mở offline 100% nhờ service worker cache-first. Cài đặt → *Thông tin ứng dụng* có nút cài (và hướng dẫn riêng cho iOS Safari), báo trạng thái offline và nút tải bản cập nhật. |
| **Bảo mật** | Khóa PIN 4 chữ số (SHA-256, WebCrypto). Một form đổi **mã PIN** hoặc **mật khẩu đăng nhập**: nhập mã/mật khẩu hiện tại → mới → xác nhận. PIN đối chiếu hash trong `state`; mật khẩu thì xác thực lại với Supabase vì `updateUser()` không tự hỏi mật khẩu cũ. |
| **Giao diện** | Ngôn ngữ thiết kế **VietinBank iPay**: app bar gradient xanh gọn một hàng (~70px), thẻ tổng tài sản trắng bo 16px đè lên app bar với nút con mắt ngay cạnh con số, thẻ ví dạng **hàng ngang thu gọn ~78px** cuộn ngang, nền `#F4F7FA`. Lưới **Tiện ích 5 ô** nằm cuối trang, icon trong khung gradient nhạt có inner shadow. Bottom nav kính mờ (`backdrop-filter`), tab active xanh kèm vạch đỏ `#ED1C24`; nút **+** là FAB gradient xanh–đỏ có glow thở nhẹ. Ripple + rung nhẹ khi chạm. Mobile-first 480px, Dark/Light/Tự động. |
| **Hệ thống icon** | Icon *của app* (nav, nút, hàng cài đặt, empty state, cảnh báo) là SVG stroke 24×24 inline, khai báo trong `ICON_PATHS` và dựng bằng `icon(name)` — thừa kế `currentColor` và cỡ chữ nên một rule CSS chỉnh được tất cả. Emoji **do người dùng chọn** (ví, danh mục, sự kiện) là dữ liệu trong `state`, giữ nguyên. |

---

## 🗃 Mô hình dữ liệu

Bảng duy nhất trên Supabase:

```sql
public.user_state(
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null default '{}',
  device_id  text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
)
```

Nội dung `data`:

```js
{
  version: 4,
  updatedAt: 1755648000000,        // đồng hồ client, dùng để giải xung đột
  app: { theme, pinEnabled, pinHash, privacy, mainCurrency, rates },
  wallets:      [{ id, userId, name, icon, type, currency, startingBalance,
                   creditLimit, statementDate, paymentDueDate,
                   interestRate, maturityDate, excludeFromTotal }],
  transactions: [{ id, userId, type, status, amount, walletId, categoryId, subcategoryId,
                   note, date, eventId, transferId, recurringId, debtId, createdAt }],
  budgets:      [{ id, userId, categoryId, period, periodKey, limit, walletId, repeat }],
  recurring:    [{ id, userId, name, type, amount, walletId, categoryId, subcategoryId,
                   frequency, interval, dueDate, endDate, autoProcess }],
  debts:        [{ id, userId, kind, party, amount, walletId, date, dueDate, note,
                   payments: [{ id, amount, date, walletId, txId }] }],
  events:       [{ id, userId, name, icon, startDate, endDate, budget }],
  categories:   { "<uid>": { expense: [...], income: [...] } },
  onboardingStatus: { "<uid>": true }
}
```

`type` của giao dịch: `expense` · `income` · `transfer_out` · `transfer_in`. Mỗi lần chuyển ví tạo **một cặp** `transfer_out` + `transfer_in` chung `transferId`.

`status`: `completed` · `pending`. Bất biến của hệ thống: **`completed` ⟺ `date <= hôm nay`**. Lưu giao dịch thì `status` được suy ra từ ngày chứ không nhập tay; xác nhận sớm thì kéo `date` về hôm nay; `autoSettlePending()` lật phần còn lại khi tới ngày. Nhờ vậy `completed` luôn có nghĩa "tiền đã thực sự chuyển", và không có trạng thái nào mâu thuẫn với ngày.

### Chuyển từ bản offline cũ

Bản v4 lưu dữ liệu trong `localStorage` theo username (`chi.a`, `chi.b`…). Khi bạn đăng nhập tài khoản đám mây mới trên chính trình duyệt đó, app **tự phát hiện và mời nhập** hồ sơ cũ, remap toàn bộ `userId` sang tài khoản mới. Cũng gọi lại được bất cứ lúc nào: **Cài đặt → Tài khoản & Đồng bộ → Nhập dữ liệu cũ trên máy này**.

---

## 📤 Sao lưu & Khôi phục

| Định dạng | Xuất | Nhập |
|---|---|---|
| **JSON** | Toàn bộ dữ liệu tài khoản hiện tại | Khôi phục & **thay thế** |
| **CSV** | Danh sách giao dịch, mở bằng Excel / Google Sheets | **Thêm** vào sổ hiện tại |

```
Ngay, Loai, SoTien, TienTe, Vi, DanhMuc, DanhMucCon, GhiChu, SuKien
```

Khi nhập CSV: ví/danh mục/danh mục con/sự kiện chưa tồn tại sẽ được tạo tự động; hỗ trợ cả `yyyy-mm-dd` và `dd/mm/yyyy`; bỏ qua và báo số dòng lỗi. File xuất có BOM UTF-8 nên Excel hiển thị đúng tiếng Việt.

---

## 🧪 Kiểm thử

`scripts/smoke.js` dựng app thật trong jsdom với một Supabase client giả, rồi bấm qua toàn bộ luồng: đăng ký sai/đúng, onboarding, thêm giao dịch, 12 màn hình, đổi theme, đẩy/kéo snapshot, nhận realtime từ thiết bị khác, bỏ qua echo của chính mình, tick ✓ ở "Dự kiến phải chi" (định kỳ / trả nợ / ví đã bị xóa), đặt lại mật khẩu (ngắn / trùng cũ / hợp lệ / liên kết hết hạn), xuất JSON/CSV (kiểm tra cả BOM), nạp dữ liệu mẫu, đăng xuất, và trường hợp build thiếu khoá.

```bash
npm run check                                          # tĩnh, không cần dependency
npm install jsdom --no-save && npm test   # smoke 296 + sync 20 + transfer 23 + chart 25
```

`npm run check` bắt được thứ mà mắt người hay bỏ sót ở dự án không bundler: inline handler gọi hàm không tồn tại, `getElementById` trỏ vào id đã đổi tên, JWT lỡ commit vào HTML.

---

## 🐛 Nhật ký lỗi đã sửa

### Kế thừa từ bản offline
| Lỗi | Ảnh hưởng |
|---|---|
| Dùng `new Date().toISOString()` để lấy ngày hôm nay | Sai ngày với mọi giao dịch tạo trước 07:00 sáng (lệch UTC+7) |
| Không escape dữ liệu người dùng khi render HTML | Tên ví / ghi chú chứa `<` làm vỡ giao diện |
| `matchMedia.addEventListener` gọi ở top-level | Chết **toàn bộ** script trên Safari cũ |
| Canvas context không kiểm tra null | Crash khi trình duyệt không hỗ trợ canvas |
| CSS `.form-group>label` (chỉ con trực tiếp) | Nhãn trong hàng 2 cột mất style ở 6 modal |
| Định kỳ: ngày kết thúc trước ngày đến hạn vẫn lưu | Khoản định kỳ chết lặng, không bao giờ chạy |
| Định kỳ: nút ✓ bỏ qua ngày kết thúc | Sinh giao dịch vô hạn sau khi đã hết hạn |
| Định kỳ: ví đã xóa làm `walletId` rỗng | Tiền biến mất khỏi mọi số dư |

### Phát hiện khi chuyển sang bản đám mây
| Lỗi | Ảnh hưởng |
|---|---|
| `sync.js` đọc `window.state` | `let` ở top-level của classic script nằm trong global **lexical** scope, không phải property của `window` — đồng bộ sẽ không bao giờ chạy. Thay bằng bridge accessor tường minh. |
| Hai tài khoản dùng chung một key `localStorage` | Đăng nhập tài khoản khác trên cùng máy sẽ đè lên cache của người trước. Nay key có namespace theo `uid`. |
| `location.reload()` ngay sau khi xóa dữ liệu | Reload xảy ra trước khi hết debounce 800ms → mất lệnh ghi. Nay flush trước rồi mới điều hướng. |
| Quên mật khẩu chỉ gửi được email | Bấm liên kết trong email thì đăng nhập được nhưng **không có chỗ đặt mật khẩu mới** — luồng đi vào ngõ cụt. Nay bắt sự kiện `PASSWORD_RECOVERY` và mở sheet đặt lại. |
| Liên kết đặt lại hết hạn không báo gì | Supabase trả về `#error=otp_expired` và người dùng rơi vào màn đăng nhập im lặng. Nay đọc lỗi từ URL **trước khi** `supabase-js` dọn nó, rồi hiển thị. |
| Một `#modal-sheet` cho cả app | Sheet đặt mật khẩu và sheet "nhập dữ liệu cũ" tranh nhau cùng một thẻ, cái sau xoá cái trước. Nay recovery được ưu tiên và trả sheet lại khi xong. |

### "Dự kiến phải chi" — tick ✓
| Lỗi | Ảnh hưởng |
|---|---|
| `saveDebtPayment()` gọi cứng `renderDebtsView()` | Tick ✓ từ Dashboard **có** tạo giao dịch nhưng thẻ dự kiến không vẽ lại — khoản vừa trả vẫn nằm đó, trông như không có gì xảy ra. Nay dùng `renderAll()` để vẽ đúng tab đang mở. |
| ✓ trên khoản định kỳ mất ví → toast lỗi rồi dừng | Ngõ cụt: không ghi nhận được, cũng không sửa được từ đó. Nay sheet xác nhận cho chọn ví khác, ghi nhận xong **sửa luôn `walletId` của lịch**. |
| `autoProcessRecurring()` ghi vào ví đã xóa | Giao dịch tồn tại nhưng `walletId` không khớp ví nào → tiền biến mất khỏi mọi số dư. Nay bỏ qua và cảnh báo, để người dùng tự chọn ví. |
| `openDebtPayModal` không kiểm tra danh sách ví | Không còn ví thường nào → lưu với `walletId` rỗng, mất tiền y hệt trên. Nay chặn từ đầu. |
| Khoản định kỳ mất ví bị quy đổi tỷ giá bằng 1 | `rateOf(undefined)` trả về 1, tổng "dự kiến phải chi" sai khi tiền tệ chính không phải VND. Nay coi như đã ở tiền tệ chính. |

### Bộ lọc giữa các tab
| Lỗi | Ảnh hưởng |
|---|---|
| `txFilters` sống qua lần đăng xuất | Đăng nhập tài khoản khác trên cùng máy thì bộ lọc vẫn giữ `walletId` của người trước → mọi danh sách trống trơn không rõ lý do. Nay `resetSessionFilters()` chạy ở cả `enterSession()` lẫn nhánh `SIGNED_OUT`. |
| Bộ lọc trỏ vào ví/danh mục/sự kiện đã xóa | Danh sách im lặng trống rỗng vì lọc theo một id không còn tồn tại. Nay `renderTransactionsList()` tự đưa về `all`. |
| "Đổi mã PIN" không hỏi mã cũ | Hàng này gọi `startPinSetup(true)` — mà hàm đó bỏ qua tham số và nhảy thẳng vào màn đặt PIN mới. Ai cầm được máy đang mở khóa đều đổi được PIN. Nay bắt buộc nhập mã hiện tại và đối chiếu hash. |
| `margin-top:-20px` áp cho **mọi** `.view` | Chỉ Dashboard có thẻ nền trắng để đè lên vành header. Các trang phụ mở đầu bằng tiêu đề trần nên bị nền xanh nuốt mất chữ ("⚙️ Cài đặt" bị che). Nay chỉ Dashboard đè; trang khác header phẳng lại + `padding-top:20px`. |
| `jumpToCategory()` đặt `txFilters` nhưng không đồng bộ chip | Chip "Chi/Thu" và khoảng thời gian vẫn sáng theo lựa chọn cũ trong khi bộ lọc thật đã là `all` — UI nói một đằng, danh sách một nẻo. Nay đi chung `jumpToTransactions()`. |

---

## ⚠️ Giới hạn đã biết

- **Không có Supabase thì không dùng được app.** Đây là lựa chọn có chủ đích khi bỏ đăng nhập cục bộ. Bản offline cũ vẫn nằm ở `legacy/index.offline-v4.html` nếu bạn cần.
- Xung đột giải theo **last-write-wins trên cả snapshot**, không merge theo từng bản ghi.
- Toàn bộ state đi trong một dòng JSONB. Postgres chịu được vài MB thoải mái, nhưng mỗi lần ghi là gửi lại cả snapshot — với hàng chục nghìn giao dịch nên cân nhắc tách bảng `transactions`.
- Tỷ giá **nhập tay**, không tự cập nhật.
- `localStorage` giới hạn ~5 MB cho bản cache offline.

---

## 📄 Phiên bản

**v5.0** · 20/08/2026 · Static web app + Supabase cloud sync
Tiền thân: v4.0 single-file offline (`legacy/`)
