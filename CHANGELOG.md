# Nhật ký thay đổi

Mọi thay đổi đáng kể của SoFin, bản mới nhất ở trên.

Số phiên bản đi theo `package.json`, và **tag `v*` phải bằng đúng số đó** —
CI chặn job ngay từ đầu nếu lệch, còn `checkAppUpdate()` thì so `tag_name` của
release mới nhất với `APP_VERSION` để biết có bản mới. Chỉ tag mới tạo release;
push nhánh chỉ ra artifact. Xem `DEPLOY.md`.

Mỗi mục dưới đây trả lời "cái gì đổi" **và** "tại sao" — cái *tại sao* mới là
thứ khó tìm lại sau nửa năm.

---

## [5.2.1] — 15/09/2026

### Thêm

- **Đọc hoá đơn in nhiệt** (`parseThermalReceiptOCR`) — tầng giữa giữa biên
  lai ngân hàng và luật chung. Hai đặc thù quyết định cách bóc tách:

  *Con số lớn nhất không phải tổng phải trả* (khách đưa 200.000 cho hoá đơn
  95.000), và con số **cuối cùng** cũng không (sau dòng tổng còn "Tiền khách
  trả", "Tiền thối lại", rồi số điện thoại ở chân bill). Nên nó đi theo nhãn —
  và nhãn ở dòng *sau* thắng, vì bill in "Tổng tiền hàng" → giảm giá → "Tổng
  cộng" — cộng một danh sách nhãn **bị loại thẳng**.

  *OCR in nhiệt hay đọc dấu ngăn nghìn thành dấu cách* ("95 000"), nên có bước
  gộp lại — nhưng chỉ khi cụm đó đứng riêng, không thì hai số cạnh nhau bị dán
  thành một.

  Danh mục suy từ tên cửa hàng (quán ăn, cây xăng, siêu thị, nhà thuốc…) theo
  một thang 6 bậc, trong đó **lịch sử của người dùng luôn thắng** bảng đoán
  sẵn — nhưng chỉ khi nó khớp được một **cụm từ**, không phải một từ đơn: bỏ
  dấu xong "QUÁN cơm tấm" dùng chung chữ "quan" với "QUẦN áo", và dữ liệu mẫu
  có đúng ghi chú đó.

- **Phát hiện quét thất bại và nói rõ phải làm gì** (`validateOCRResult`). Ba
  kiểu thất bại, ba câu trả lời: không đọc được chữ nào · đọc được chữ nhưng
  không thấy dòng số tiền · số tiền đáng ngờ (to bất thường và không nằm cạnh
  nhãn nào — rất có thể là mã hoá đơn hay số điện thoại). Hai kiểu đầu **không
  dựng thẻ xác nhận** nữa: một thẻ thiếu số tiền thì nút "Tự động lưu" trên đó
  chỉ toast một câu rồi đứng im. Thay vào đó là trạng thái thất bại có nêu lại
  thứ đã đọc được và ba đường đi tiếp: nhập tay số tiền · chọn ảnh khác · mở
  form đầy đủ.

- Thẻ xác nhận **hiện cả ghi chú** và cho sửa tại chỗ. Ghi chú đi vào sổ *và*
  vào ma trận từ khoá, nên một chuỗi OCR đọc sai mà lưu luôn thì nó dạy sai
  cho cả lần sau.

---

## [5.2.0] — 14/09/2026

### Đổi

- **Ngân sách gộp vào danh sách "Chi tiêu & ngân sách" trên Trang chủ**, bỏ
  khối "Ngân sách tháng này" riêng. Hai khối nói về cùng những danh mục đó,
  chỉ khác góc nhìn — đứng cạnh nhau là đọc cùng một dữ liệu hai lần và ăn hai
  lần chiều dọc.

  Một hàng danh mục giờ có hai trạng thái: **có ngân sách** thì thanh và phần
  trăm nói về *hạn mức* (`2.602.000 đ / 3.000.000 đ`, `Còn 398.000 đ`, đổi màu
  vàng/đỏ từ 80%/100%); **không có** thì vẫn là tỷ trọng trong tổng chi như cũ.

  Ba chi tiết đáng nói: con số lấy từ `getBudgetSpent()` chứ không phải tổng
  theo danh mục của Tổng quan (ngân sách có thể giới hạn theo ví, hai chỗ ra
  hai con số thì không ai tin con nào); danh mục có ngân sách **luôn** có mặt
  kể cả khi chưa chi đồng nào, vì đây là chỗ duy nhất còn nói ra hạn mức của
  nó; và cột phải rộng cố định để hai loại hàng không lệch nhau.

---

## [5.1.9] — 14/09/2026

### Sửa

- **Trợ lý: lưu xong giao dịch thì phải xong ngay, không cần mở lại app.** Sau
  khi bấm "Tự động lưu", thẻ trong chat chỉ còn một dòng *"✓ Đã lưu 55.000 đ"*
  — không thông tin giao dịch, không nút "Tạo lại". Thẻ đầy đủ chỉ xuất hiện
  khi `restoreChatHistory()` vẽ lại, tức là sau khi đóng app mở lại. Giờ thẻ
  xác nhận biến thành **đúng cái thẻ mà lịch sử sẽ vẽ ra**: số tiền, ghi chú,
  ví, danh mục, ngày, và nút 🔄 Tạo lại ngay tại chỗ.
- **Nút "Tạo lại" từng trỏ theo chỉ số mảng lịch sử.** `slice(-100)` cắt từ
  đầu, nên mỗi lần cắt là mọi chỉ số trượt đi và một nút đã vẽ ra sẽ dựng lại
  **nhầm giao dịch khác**. Giờ mỗi bản ghi có `lid` riêng và nút khoá theo nó.

---

## [5.1.8] — 14/09/2026

### Thêm

- **Vuốt ngang đổi tab**: Tổng quan → Giao dịch → Báo cáo → Cài đặt, đúng thứ
  tự trên nav bar. Mỗi cú vuốt là **một bước lịch sử** nên Back lùi đúng một
  tab.

  Phần khó không phải việc bắt cú vuốt mà là **không cướp cử chỉ của thứ
  khác**, nên có bốn vùng chừa ra: overlay đang mở (kể cả khi ngón tay đặt
  ngoài nó — đổi tab sau lưng một modal thì đóng modal ra là thấy mình ở màn
  hình khác), vùng cuộn ngang (không chừa thì thanh ví không cuộn được nữa),
  `canvas` (biểu đồ có tooltip theo ngón tay), và **24px sát mép trái** — vùng
  cử chỉ Back của iOS/Android, không chừa thì một động tác cho ra hai bước.

  Vuốt chéo (dọc nhiều hơn ngang), vuốt ngắn hơn 60px và hai ngón đều bị bỏ
  qua. Màn hình con (Ví, Ngân sách, Sổ nợ…) không có tab kế bên nên vuốt ở đó
  không làm gì.

---

## [5.1.7] — 14/09/2026

### Sửa

- **Bấm chip Danh mục / chip Ví trong màn ghi nhanh thì không thấy gì.** `.modal`
  (z-index 100) thấp hơn `#amount-sheet` (120), nên sheet mở **ra sau** bàn
  phím — người dùng bấm và tưởng app đơ. Modal luôn được mở *từ* một bề mặt
  nào đó nên phải nằm trên bề mặt đó; giờ `.modal` ở 130. Loại lỗi này jsdom
  không thấy (không layout), nên test so trực tiếp hai con số z-index.
- **Nút "Chỉnh sửa ➔" trên thẻ chuyển ví / định kỳ ném ReferenceError** — nó
  gọi một hàm không tồn tại (`navCloseSilently`, mất trong một lần revert).
  Test cũ chỉ bấm nút xác nhận nên không chạm tới; giờ có test cho cả hai nút.
- **Tên quận lọt vào ghi chú biên lai**: thiếu nhãn "Địa điểm" trong danh sách
  mốc dừng nên "Thu Duc" theo vào ghi chú rồi khớp sang danh mục "Giáo dục".

### Thêm

- **Trung tâm thông báo.** Cảnh báo ngân sách / nợ đến hạn / thẻ tới ngày trả
  rời khỏi Trang chủ, vào quả chuông trên app bar với chấm đỏ khi chưa đọc.
  Banner cũ không có trạng thái "đã đọc" nên hiện lại y nguyên mỗi lần mở app,
  và người ta học cách nhìn xuyên qua nó. Bấm một tin là đánh dấu đã đọc và mở
  thẳng màn hình xử lý được nó. Trạng thái đã đọc đồng bộ đa thiết bị.
- **Bố cục Trang chủ mới**: Tổng tài sản → **Giao dịch gần đây** → Tiện ích →
  **Ví (thanh cuộn ngang)** → cụm cảnh báo (tự ẩn khi không có gì để nhắc).
  Ví chuyển từ lưới 2 cột sang thanh cuộn — một lần **đảo ngược** quyết định
  cũ, vì sau khi hai khối trên lên đầu thì chiều dọc đắt hơn chiều ngang. Thẻ
  rộng 46% để luôn hở một phần thẻ kế tiếp: mảnh hở đó là tín hiệu duy nhất
  nói rằng cuộn được.
- **Lịch sử hội thoại 100 bản ghi** + nút **🔄 Tạo lại** trên mỗi giao dịch cũ
  (dựng lại với ngày hôm nay, kiểm lại ví/danh mục lúc bấm). Lưu riêng theo
  tài khoản trên máy, không đẩy lên cloud.
- **Hỏi lại khi thiếu số tiền** thay vì tạo bản ghi lỗi: giữ ý định dở dang
  (hạn 10 phút) và gộp với con số ở tin nhắn sau — nhưng chỉ khi tin đó *thực
  sự chỉ có con số*, vì "cà phê 30k" là một giao dịch mới.
- **Chọn ví ngay trên bàn phím nhập tiền**: thẻ "Trừ vào ví" thành một nút có
  mũi tên ▾. Và ví mặc định lấy theo **tần suất của đúng loại giao dịch**, không
  phải "ví vừa dùng gần nhất".

---

## [5.1.6] — 14/09/2026

### Sửa

- **Giao dịch từ ảnh biên lai bị ghi thành khoản THU.** Tờ giấy nói rõ
  `-39.000đ`, nhưng `draft.type` lại được đoán lại bằng từ khoá trên **toàn
  văn OCR** — và ở đó tên một quận là đủ để lật chiều tiền: "Thủ Đức" chứa
  "thu". Giờ ảnh biên lai lấy chiều tiền từ chính bằng chứng trên giấy:
  **dấu của con số** (`-`/`+`, kể cả khi OCR đọc thành gạch dài), rồi tới từ
  khoá *nói về hướng* ("nhận từ", "tiền vào" ⇔ vào; "thanh toán", "chuyển
  tiền" ⇔ ra), cuối cùng mặc định **chi** — lỗi nghiêng về phía an toàn, số
  dư thiếu chứ không phình.
- **Danh mục con bị bịa từ chữ trên trang.** "Mã đơn **hàng**" khớp vào danh
  mục con "Nhà **hàng**", nên một quán cà phê thành nhà hàng. Ảnh biên lai
  không đoán danh mục trên toàn văn nữa: nó dùng đúng ba nguồn có bằng chứng
  (dòng "Danh mục" do app in ra → nội dung chuyển khoản → tên cửa hàng).

Bài học chung, đã ghi vào CLAUDE.md: **trên một tờ biên lai, đừng đoán bằng
từ khoá rải rác.** Trang đó đầy tên riêng, tên quận huyện và chữ nghiệp vụ;
bằng chứng thật thì nằm ở dấu của con số và ở các nhãn do chính app in ra.

---

## [5.1.5] — 12/09/2026

### Sửa

Soi lại kết quả trên ảnh MoMo thật, hai chỗ vẫn còn sai:

- **Bịa ra danh mục con.** Biên lai ghi "Danh mục: Ăn uống" — nó *không* nói
  "Ăn sáng", nhưng code lấy `subs[0]` cho đủ ô, và một giao dịch 10:58 ở quán
  cà phê bị gán "Ăn sáng". Danh mục con sai thì tệ hơn là để trống: nó hiện
  lên thẻ xác nhận như thể ta biết, rồi người dùng lưu luôn. Giờ để trống, và
  ma trận từ khoá tự điền sau lần đầu người dùng chọn.
- **Ghi chú lấy dòng "Nội dung" máy sinh.** Trên biên lai MoMo, dòng đó mở đầu
  bằng tên người *trả* ("Nguyễn Văn Nam Thanh toán cho The Orange Coffee…"):
  đưa vào sổ thì khó đọc, mà còn nhồi tên của chính mình vào ma trận từ khoá.
  Giờ ưu tiên dòng **"Cửa hàng"** → ghi chú thành "The Orange Coffee - 259 Man
  Thiện", đúng thứ một người sẽ tự tay ghi, và là từ khoá học lại được. Biên
  lai chuyển tiền ngân hàng không có dòng này nên vẫn dùng "Lời nhắn" — ở đó
  thì đúng, vì lời nhắn do người gửi tự viết.

---

## [5.1.4] — 11/09/2026

### Sửa

Chạy bộ bóc tách trên **ảnh biên lai thật** của Techcombank và MoMo, và tìm ra
bốn chỗ đọc sai — cả bốn đều là loại lỗi chỉ ảnh thật mới lộ ra:

- **"Chuyển khoản" bị hiểu thành danh mục "Di chuyển".** Hai chữ dùng chung
  một từ gốc, nên **mọi** biên lai chuyển tiền đều bị gán vào Di chuyển. Giờ
  chữ nghiệp vụ ngân hàng bị bóc khỏi nội dung trước khi khớp danh mục; memo
  chỉ có "chuyển khoản nhanh qua Zalo" thì trả về *Khác* kèm nhắc "bấm để
  đổi", vì nó thật sự không mang thông tin danh mục nào.
- **Số tài khoản 14 chữ số bị đọc thành số tiền** (19027323500017 → mười chín
  nghìn tỷ). Trên biên lai, số tiền luôn có dấu ngăn nghìn, nên một dãy trần
  từ 10 chữ số trở lên không bao giờ là tiền.
- **Nhà phát hành chọn sai khi tờ biên lai có hai tên ngân hàng.** Ảnh mẫu có
  cả "TECHCOMBANK" (ví nguồn) và "VIETCOMBANK" (ngân hàng người nhận); giờ lấy
  tên xuất hiện **sớm nhất** trong văn bản, vì biên lai in tên app ở đầu trang.
- **Nội dung bị cắt đứt giữa từ** và ăn sang khối kế tiếp: thiếu nhãn "Mã đơn
  hàng" trong danh sách mốc dừng thì memo của MoMo kéo theo cả mã 40 ký tự.

### Thêm

- **Đọc dòng "Danh mục" do chính app ngân hàng in ra.** MoMo ghi sẵn
  *"Danh mục: Ăn uống"* trên biên lai — đó là phân loại của chính giao dịch
  đó, đáng tin hơn mọi phép đoán từ tên cửa hàng.
- **Dấu của con số quyết định chiều tiền** (`-VND 262,000` ⇒ chi,
  `+VND 5,000,000` ⇒ thu). Mạnh hơn đoán theo từ khoá trên một trang đầy chữ
  nghiệp vụ, nơi "Thủ Đức" chứa "thu" và "Ngoại thương" chứa "thương".
- 18 test case dùng văn bản của hai biên lai thật (đã ẩn danh tên người và số
  tài khoản, giữ nguyên độ dài và hình dạng — chính chúng mới là thứ làm bộ
  bóc tách sai). `.gitignore` chặn ảnh biên lai ở gốc repo: đó là ảnh chụp
  thật, mà repo này public.

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
