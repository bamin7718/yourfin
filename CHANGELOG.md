# Nhật ký thay đổi

Mọi thay đổi đáng kể của SoFin, bản mới nhất ở trên.

Số phiên bản đi theo `package.json`, và **tag `v*` phải bằng đúng số đó** —
CI chặn job ngay từ đầu nếu lệch, còn `checkAppUpdate()` thì so `tag_name` của
release mới nhất với `APP_VERSION` để biết có bản mới. Chỉ tag mới tạo release;
push nhánh chỉ ra artifact. Xem `DEPLOY.md`.

Mỗi mục dưới đây trả lời "cái gì đổi" **và** "tại sao" — cái *tại sao* mới là
thứ khó tìm lại sau nửa năm.

---

## [5.1.3] — 11/09/2026

### Sửa

- **Nút Back cứng của Android giờ đi qua chính history của app.** Nút cứng và
  cú vuốt predictive back (Android 13+) đi qua tầng native **trước**, và mặc
  định của Capacitor là chuyện của Capacitor — không có gì bảo đảm nó tra
  history của WebView thay vì đóng luôn activity. Đó là lý do trên máy thật
  vuốt lùi vẫn thoát app dù phần JS đã đúng. `navBindNativeBack()` đăng ký
  listener `backButton` của `@capacitor/app`: còn entry thì `history.back()`
  (cùng một đường với cú vuốt trên trình duyệt), hết entry mà còn overlay mở
  thì đóng overlay chứ **tuyệt đối không thoát**, hết cả hai mới `exitApp()`.
  Cái bẫy: **có listener là tắt mặc định của Capacitor**, nên handler buộc
  phải tự lo cả việc thoát app.

### Thêm

- `@capacitor/app` vào `devDependencies` — CI tự wire vào APK qua
  `npx cap add android` + `cap sync`. Thiếu plugin thì `navBindNativeBack()`
  trả `false` và Capacitor giữ hành vi mặc định của nó, không crash.

---

## [5.1.2] — 11/09/2026

### Thêm

- **Ghi nhanh giao dịch (Direct-to-Keypad).** Nút **+** mở thẳng bàn phím số
  thay vì form: con số là thứ người ta biết trước khi biết mình sẽ xếp nó vào
  đâu. Gõ ghi chú thì ví và danh mục tự nhảy theo lịch sử; chọn tay thì lựa
  chọn của người dùng thắng. Đây là **chế độ thứ ba của chính `#amount-sheet`**
  (`amtKind === 'quick'`), không phải overlay mới — app vẫn chỉ có đúng một
  lưới bàn phím 4×4, và "Thêm chi tiết ›" chỉ là mở form đầy đủ ra vì cả hai
  dùng chung một bộ biến.
- **Gợi ý ví thông minh.** `buildHistoryMappingIndex()` đếm thêm tần suất ví
  cho mỗi từ khoá: "xăng" ra Di chuyển **và** đúng cái ví hay trả tiền xăng.
  Chỉ nuôi bằng lịch sử (tên danh mục không nói gì về việc tiền ra từ ví nào),
  ví đã xoá không bao giờ được đề nghị, và không đủ dữ liệu thì trả `null` để
  chỗ gọi dùng ví mặc định — không bịa ra một ví "trông có lý".
- **Hỏi trợ lý về số liệu.** *"tháng này chi nhiều nhất vào đâu?"*, *"ăn uống
  tháng trước bao nhiêu?"*, *"còn bao nhiêu tiền?"*. Con số tính bằng **chính**
  `getUserTransactions()` + `txMain()` mà tab Báo cáo dùng, nên hai chỗ không
  thể ra hai con số. Kèm hyperlink sang màn hình đã lọc sẵn đúng kỳ/ví/danh
  mục; hỏi về một khoản cụ thể thì bấm vào là mở thẳng chi tiết bản ghi đó.
- **Chuyển ví và định kỳ bằng lời.** *"chuyển 2tr từ Ngân hàng sang Tiền mặt"*,
  *"tiền nhà 4tr hàng tháng ngày 5"*. Thiếu thông tin thì **hỏi lại bằng nút
  bấm** (chip danh sách ví, ba nút chu kỳ) chứ không đoán — đoán hộ ví đích là
  đoán hộ chỗ tiền sẽ nằm. Bot tạo lịch với `autoProcess: false`: nó tạo *lịch
  nhắc*, không tự mở một đường ghi tiền định kỳ mà người dùng chưa bật.
- **Đọc biên lai Techcombank / MoMo** (`parseBankReceiptOCR()`): nhận nhà phát
  hành, bóc số tiền theo nhóm nghìn có dấu phân cách (`2,000,000 VND`,
  `-55.000đ`), nội dung chuyển khoản, ngày, rồi tự chọn ví tương ứng trong sổ.
  **Mọi regex chạy trên chuỗi đã bỏ dấu** — OCR đọc dấu tiếng Việt rất tệ, nên
  khớp "Nội dung" là đánh cược vào đúng thứ máy đọc sai nhiều nhất.
- **Khối "Giao dịch gần đây"** (5 dòng) dưới lưới Tiện ích ở Tổng quan, dùng
  lại đúng hàng giao dịch của tab Giao dịch. Chỉ khoản **đã ghi nhận**: dùng cả
  khoản dự kiến thì một khoản chi *ngày mai* sẽ chiếm đầu danh sách "gần đây".

### Đổi

- `commitTransfer()` là **chỗ duy nhất** dựng một lần chuyển ví — `saveTransfer()`
  (form) và trợ lý đều gọi nó. Trước đó hàm lưu đọc thẳng từ DOM nên trợ lý sẽ
  phải tự dựng bản ghi, mà một `transferId` ứng với **ba** bản ghi (hai chân +
  phí) và cả ba phải dùng **chung một `status`**. Hai đường ghi song song thì
  sớm muộn một đường quên phần đó và hai ví bất đồng về chỗ tiền đang nằm.
  Tương tự, `recurringRecord()` là hình dạng bản ghi định kỳ dùng chung.
- `buildCategoryKeywordIndex()` → `buildHistoryMappingIndex()`,
  `matchCategoryFromInput()` → `matchWalletAndCategory()`: một hàm quét lịch sử
  cho ra hai bản đồ (danh mục + ví). Hai index trên cùng nguồn dữ liệu thì lệch
  nhau nghĩa là bot đề nghị danh mục của khoản này và ví của khoản khác.
- `initNavigationHistory()` dựng state gốc ngay khi app load, trước cả khi biết
  ai đăng nhập — thiếu nó thì `popstate` đầu tiên nhận `event.state === null`.

---

## [5.1.1] — 11/09/2026

### Thêm

- **Trợ lý chat & quét bill.** Nút nổi 💬 mở ngăn chat: nhắn *"cà phê 35k"* hoặc
  gửi/dán ảnh hoá đơn, bot bóc số tiền (`35k`, `1.2tr`, `50.000`), ngày và loại
  thu/chi rồi dựng **thẻ xác nhận** kèm *Tự động lưu* / *Tùy chỉnh thêm*. Danh
  mục thì nó **tự học từ ghi chú của chính người dùng** trong sổ (không dấu cũng
  khớp, nhớ cả danh mục con). Không nhận ra thì gán *Khác* và **nói thẳng** là
  chưa nhận diện được — im lặng nhận bừa thì người dùng không bao giờ sửa, và ma
  trận học luôn cái sai đó. Bot **không tự ghi vào sổ**: draft sống trong RAM,
  phải bấm mới lưu.
- **Lịch sử điều hướng toàn cục.** Mỗi bước — đổi tab, vào màn hình con, mở
  modal, mở bàn phím số hay ngăn chat, gấp panel lọc — là một entry `history`,
  nên nút Back và cú vuốt lùi lùi **đúng một bước** thay vì thoát app. Quay lại
  một tab thì bộ lọc của nó trở về đúng như lúc rời đi; đóng hộp xác nhận bằng
  Back được hiểu là *Huỷ* (trước đây promise sẽ treo mãi). URL không bị đụng
  tới: hash là của Supabase Auth.
- Service worker thêm luật **bỏ qua mọi origin khác**: engine OCR tải theo yêu
  cầu nặng hàng chục MB, để nó rơi vào cache của shell thì mỗi lần deploy là
  xoá đi tải lại, mà quota thì dùng chung với dữ liệu thật của người dùng.

---

## [5.1.0] — 02/09/2026

### Thêm

- **Bàn phím nhập tiền riêng** (`#amount-sheet`, kiểu Techcombank): bàn phím hệ
  điều hành chiếm nửa màn hình và che mất ví nguồn cùng số dư khả dụng — đúng
  hai thứ người dùng cần thấy khi quyết định gõ bao nhiêu.
- **Gộp mục dự kiến**: khoản định kỳ / thẻ tín dụng / nợ đến hạn hiện thành
  *dòng ảo* ở tab Giao dịch. Chúng **không** nằm trong sổ nên không bao giờ đi
  vào số dư — chỉ là lịch.
- **Số dư đầu kỳ / cuối kỳ** ở Báo cáo, đọc một mạch *đầu kỳ → thu/chi → ròng →
  cuối kỳ*. Số dư đầu kỳ phát lại từ sổ chứ không trừ ngược, và có dòng "Chuyển
  ví ròng" khi lọc theo một ví để phép cộng luôn khớp.

---

## [5.0.0] – [5.0.5] — 23/08/2026

Bản đầu của kiến trúc web tĩnh + Supabase cloud sync (tiền thân: v4.0
single-file offline, vẫn nằm ở `legacy/`).

### Thêm

- Đồng bộ đa thiết bị qua một bảng JSONB duy nhất, last-write-wins trên
  `data.updatedAt` (đồng hồ client), realtime bỏ qua echo của chính máy mình.
- Bản Android đóng gói bằng Capacitor, APK dựng tự động trong CI.
- App tự kiểm tra bản cập nhật trên bản native: đọc `tag_name` của release mới
  nhất rồi so với `APP_VERSION`.
- Ví xếp lưới 2 cột, app bar `position:fixed`, hiện phiên bản ở màn đăng nhập.

### Sửa

- **Khoá ký APK cố định** trong CI. Runner là máy sạch nên Gradle sinh khoá
  debug ngẫu nhiên mỗi lần build; chữ ký đổi thì Android từ chối cài đè và
  người dùng phải gỡ app — mất sạch `localStorage`. Kèm bước **đối chiếu vân
  tay SHA-256**, vì sai khoá hỏng hoàn toàn im lặng: APK vẫn cài được, vẫn
  chạy, chỉ là không ai nâng cấp đè lên nó được, và chỉ lộ ra vài tuần sau.
- `concurrency.group` phải kèm `${{ github.ref }}`: `git push origin main v5.0.2`
  đẩy nhánh và tag cùng lúc → hai run song song, nhóm chung thì cái sau giết
  cái trước, và đã có lần cái bị giết là run của tag — tag lên remote nhưng
  **không có release nào**, không một dòng báo lỗi.
- Nav bar biến mất sau lần đăng nhập đầu, nút `000` văng ra ngoài ô nhập.
