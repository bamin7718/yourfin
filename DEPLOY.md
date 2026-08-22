# 🚀 Checklist đưa SoFin lên PROD

Checklist này bám theo đúng cấu hình thật của repo (`vercel.json`, `scripts/generate-env.js`,
`supabase/schema.sql`, `public/sw.js`). Đi từ trên xuống; mục nào có ⚠️ là chỗ đã từng hoặc
rất dễ gây sự cố.

---

## 0. Cổng chặn — chạy trước khi push

```bash
npm install jsdom --no-save
npm test          # check + smoke (296) + sync-test (20) + transfer-test (23)
```

- [ ] `npm test` xanh cả ba suite
- [ ] `git status` không còn file tạm, file export (`sofin-*.csv`, `*-backup-*.json`)
- [ ] `git ls-files | grep env.js` **không** trả về `public/js/env.js`
- [ ] Không có `.env` nào bị `git add` (`.gitignore` đã chặn `.env` và `.env.*`)

### Ba suite kiểm cái gì

| Suite | Phạm vi |
|---|---|
| `check.js` | wiring HTML ↔ JS, cú pháp, rò rỉ khoá, manifest/sw hợp lệ, **mọi asset `index.html` nạp đều nằm trong precache** (quên một file = offline vỡ âm thầm, đây là thứ duy nhất bắt được) |
| `smoke.js` | 296 assertion chạy thật app trong jsdom: auth, onboarding, giao dịch, ví, ngân sách, nợ, định kỳ, báo cáo, PIN, PWA, giao diện |
| `sync-test.js` | 20 assertion giữ request Supabase treo để soi UI giữa chừng: cache render trước mạng, ghi optimistic, offline→online tự đẩy, **đóng tab lúc offline không mất dữ liệu** |
| `transfer-test.js` | 23 assertion cho chuyển ví — thao tác duy nhất phải giữ hai ví khớp nhau: có phí, khác tiền tệ, ngày tương lai, và xoá phải gỡ đúng mọi bản ghi nó tạo ra |

### ⚠️ Máy không kiểm được ba thứ này

jsdom không render và trả `canvas.getContext() === null`. Bắt buộc mở trình duyệt xem tay:

- [ ] **Tooltip biểu đồ** (donut + cột) — hit-test hoàn toàn chưa có test tự động
- [ ] **Cân bằng thị giác** trên màn hẹp 360px: header co/giãn khi chuyển tab, lưới Tiện ích 5 cột
- [ ] **Số tiền rất dài** (`-159.800.000.000 đ`) — logic thu nhỏ font có test, nhưng độ vừa vặn thật thì phải nhìn

---

## 1. Supabase — làm một lần cho project PROD

Dùng **project Supabase riêng cho PROD**, không dùng chung với bản thử nghiệm: dữ liệu tài
chính thật không nên nằm cùng chỗ với dữ liệu rác.

- [ ] Tạo project mới → **SQL Editor** → dán toàn bộ `supabase/schema.sql` → **Run**
      (idempotent, chạy lại nhiều lần vô hại)
- [ ] Kiểm tra bảng `public.user_state` đã có và **RLS đang bật**
- [ ] **Database → Replication**: `user_state` nằm trong publication `supabase_realtime`
      (script đã tự thêm; xác nhận lại vì thiếu nó thì đồng bộ đa thiết bị chết lặng)
- [ ] **Authentication → Providers → Email**: **BẬT** *Confirm email* cho PROD
      (chỉ tắt khi thử nghiệm)

### ⚠️ Redirect URL — chỗ hay quên nhất

`resetPassword()` gửi `redirectTo: location.origin + location.pathname`. Supabase **từ chối**
mọi redirect không nằm trong allow-list, và người dùng sẽ bấm link trong email rồi rơi vào
trang lỗi.

- [ ] **Authentication → URL Configuration → Site URL** = domain PROD (`https://...`)
- [ ] **Redirect URLs** có đủ:
  - `https://<domain-prod>/`
  - `https://<domain-preview>.vercel.app/` nếu muốn test trên preview
  - Thêm domain tuỳ chỉnh **ngay khi** gắn, không để sau
- [ ] Mở **Authentication → Email Templates → Reset Password**, đổi nội dung sang tiếng Việt
      nếu muốn (không bắt buộc)

---

## 2. Biến môi trường trên Vercel

`vercel.json` chạy `node scripts/generate-env.js --strict` — thiếu key là **build fail ngay**
(đã kiểm chứng: exit 1). Không có chuyện deploy ra một bản trắng trang.

- [ ] **Settings → Environment Variables**, môi trường **Production**:
  - `SUPABASE_URL` = `https://<ref>.supabase.co`
  - `SUPABASE_ANON_KEY` = key **anon public**
- [ ] ⚠️ **Tuyệt đối không dùng `service_role`**. Nó bỏ qua RLS và sẽ đi thẳng vào bundle
      trình duyệt. `generate-env.js` có chốt chặn, nhưng đừng thử.
- [ ] Thêm luôn cho môi trường **Preview** nếu cần test trước khi merge
- [ ] Không cần khai báo `VERCEL_GIT_COMMIT_SHA` — Vercel tự cấp, script dùng nó làm
      `BUILD` để version service worker

---

### ⚠️ Giới hạn đã biết: không có key thì không dùng được

Chưa điền `SUPABASE_URL` / `SUPABASE_ANON_KEY` thì app hiện **màn hình cấu hình** — không crash,
nhưng cũng không vào được. Đây là lựa chọn có chủ đích từ khi bỏ tài khoản cục bộ: danh tính
lấy từ Supabase Auth, `storageNamespace` chính là `user.id`.

Nếu **đã đăng nhập rồi** thì mất mạng vẫn dùng bình thường — session đọc từ localStorage,
service worker phục vụ shell, dữ liệu đọc/ghi vào cache và tự đẩy khi có mạng lại.

---

## 3. Cấu hình deploy

- [ ] Framework Preset: **Other** (`vercel.json` đã đặt `"framework": null`)
- [ ] Output Directory: `public` — đã khai trong `vercel.json`, không cần chỉnh trên UI
- [ ] Node version ≥ 18 (`package.json` → `engines`)
- [ ] Không cần Install Command (dự án **không có runtime dependency**)

---

## 4. PWA & Service Worker

- [ ] ⚠️ PROD **phải chạy HTTPS** — service worker không đăng ký trên HTTP
- [ ] `public/icons/` đã được commit (5 file PNG). Thiếu → `npm run icons`
- [ ] ⚠️ `/icons/*` đặt `immutable` 7 ngày. Đổi bộ icon mà giữ nguyên tên file thì
      trình duyệt **không** tải lại trong 1 tuần. Người đã cài app tự khỏi (service
      worker precache bằng `cache:'reload'` mỗi lần cài bản mới); khách vãng lai thì
      phải đổi tên file nếu muốn thấy ngay
- [ ] Sau deploy, mở DevTools → **Application → Service Workers**: thấy
      `sw.js?v=<commit-sha>` ở trạng thái *activated*
- [ ] **Application → Cache Storage**: có bucket `sofin-<sha>` chứa shell
- [ ] Test offline thật: tick **Offline** trong tab *Service Workers* (không phải Network
      throttling — cái đó không chặn SW) → Ctrl+R → app vẫn mở
- [ ] Lighthouse → **PWA** không còn cảnh báo installable

### ⚠️ Phụ thuộc CDN

`@supabase/supabase-js` nạp từ `cdn.jsdelivr.net`. Service worker có precache nó nên lần mở
sau vẫn chạy offline, nhưng **lần truy cập đầu tiên bắt buộc phải tải được jsDelivr**. Nếu
người dùng ở mạng chặn CDN, app sẽ dừng ở màn hình cấu hình.

- [ ] Cân nhắc self-host file này vào `public/js/` nếu người dùng ở mạng nội bộ có chặn CDN

---

## 5. Smoke test trên PROD (làm tay, ~10 phút)

Đăng ký một tài khoản thật rồi đi hết luồng:

- [ ] Đăng ký → nhận **email xác nhận** → xác nhận → đăng nhập được
- [ ] **Quên mật khẩu** → nhận email → bấm link → **hiện form đặt mật khẩu mới** → đổi được
      → đăng nhập bằng mật khẩu mới *(đây là luồng phụ thuộc mục 1, test kỹ)*
- [ ] Onboarding tạo ví, số dư đầu kỳ hiển thị có dấu phân cách nghìn
- [ ] Thêm 1 giao dịch chi → số dư giảm đúng
- [ ] Thêm 1 giao dịch **ngày tương lai** → **không** trừ số dư, hiện ở *Dự kiến phải chi*
- [ ] Nút `000` nhân đúng nghìn
- [ ] **Đồng bộ 2 thiết bị**: mở app trên máy thứ hai cùng tài khoản → sửa ở máy A →
      máy B tự cập nhật (chấm đồng bộ chuyển xanh)
- [ ] Bật khoá PIN → tải lại trang → yêu cầu PIN → đổi PIN cần nhập PIN cũ
- [ ] Xuất JSON + CSV, mở CSV bằng Excel → **tiếng Việt không lỗi font** (BOM)
- [ ] Cài app lên điện thoại: Android/Chrome bấm nút trong *Cài đặt → Thông tin ứng dụng*;
      iOS Safari theo hướng dẫn Chia sẻ → Thêm vào MH chính
- [ ] Kiểm tra dark mode và màn hình hẹp (iPhone SE / 360px)
- [ ] Bấm qua lại **Dashboard ↔ Cài đặt ↔ Báo cáo**: tiêu đề trang không bị nền xanh che,
      header co/giãn mượt (Dashboard giữ vành cho thẻ số dư đè lên, trang khác phẳng lại)
- [ ] Chạm vào **donut và biểu đồ cột** ở Báo cáo: tooltip hiện đúng số, phần trăm ở tâm
      donut đổi theo lát đang chạm
- [ ] Bật **con mắt** ẩn số dư → đi hết Dashboard, Giao dịch, Báo cáo: không con số tiền nào
      còn đọc được (kể cả nhãn trục biểu đồ)

---

## 6. Sau khi lên sóng

- [ ] Supabase → **Settings → Database → Backups**: xác nhận có backup tự động
      (gói Free chỉ giữ 7 ngày — cân nhắc nâng gói hoặc tự export định kỳ)
- [ ] Ghi lại **URL PROD** và **project ref** Supabase vào nơi lưu trữ nội bộ
- [ ] Đặt lịch nhắc **xoay anon key** nếu có nghi ngờ rò rỉ (RLS vẫn bảo vệ dữ liệu, nhưng
      xoay key là vệ sinh tốt) — nhớ cập nhật lại biến môi trường rồi redeploy

---

## 7. Rollback

Không có migration dữ liệu phá huỷ nào trong bản này, nên rollback an toàn:

- [ ] Vercel → **Deployments** → chọn bản trước → **Promote to Production**
- [ ] Service worker: bản cũ có `BUILD` khác → tự cài lại và **xoá sạch cache mới**
      (`activate()` xoá mọi cache khác cache hiện tại)
- [ ] Schema Supabase **không cần rollback** — bản này chỉ thêm trường trong JSONB
      (`transactions[].status`, `wallets[].displayOrder`), Postgres không biết tới chúng
- [ ] ⚠️ Dữ liệu người dùng đã ghi `status`/`displayOrder` vẫn đọc được bởi bản cũ; bản cũ
      chỉ bỏ qua hai trường đó (giao dịch tương lai sẽ bị tính vào số dư trở lại)

---

## Những thứ **không** được đụng khi deploy

| Thứ | Vì sao |
|---|---|
| `FINYOURTIN_STATE_V4`, `FINYOURTIN_THEME`, `FINYOURTIN_SUPABASE_CFG`, `FINYOURTIN_DEVICE_ID` | Đổi tên = bỏ rơi toàn bộ cache cục bộ, mất theme, mất cấu hình nhập tay, cấp `device_id` mới |
| Muối băm PIN `'finyourtin::'` | Đổi = **vô hiệu hoá mọi mã PIN đang dùng**, khoá người dùng ra ngoài |
| Query `?v=` trên URL đăng ký `sw.js` | Bỏ đi = người dùng kẹt vĩnh viễn ở bundle cũ |

Chi tiết xem `CLAUDE.md` → *Tên thương hiệu vs khoá lưu trữ*.
