# Build APK trên GitHub Actions — công thức dùng lại được

Tài liệu này rút ra từ cấu hình thật của SoFin (`.github/workflows/build-apk.yml`), viết để
**dự án khác chép về dùng**. Mỗi mục "⚠️ đã cắn thật" là một sự cố đã xảy ra trong repo này,
kèm triệu chứng để bạn nhận ra khi gặp lại.

Công thức áp dụng cho: **web tĩnh (hoặc SPA build ra thư mục) + Capacitor**. Nếu dự án của bạn
là React Native / Flutter thì phần đóng gói khác, nhưng **toàn bộ mục 4 (Ký APK) và mục 5 (Cạm
bẫy) vẫn đúng nguyên** — chúng là chuyện của Android và GitHub Actions, không phải của Capacitor.

---

## 1. Quyết định kiến trúc: KHÔNG commit thư mục `android/`

```gitignore
/android/
/ios/
```

CI chạy `npx cap add android` mỗi lần build, sinh lại dự án native từ đầu.

| | Được | Mất |
|---|---|---|
| Không commit `android/` | Không bao giờ có dự án native lệch khỏi thư mục web. Không phải review 200 file Gradle/Java sinh tự động. Nâng Capacitor là xong, không cần migrate thủ công | Mọi tuỳ biến native **phải** nằm trong `capacitor.config.json`. Sửa tay trong `android/` là bay mất ở lần build sau |
| Commit `android/` | Tuỳ biến native tự do (thêm plugin thủ công, sửa `AndroidManifest`, splash screen phức tạp) | Phải tự giữ nó đồng bộ với web, và nó sẽ lệch |

Chọn "không commit" nếu app của bạn về bản chất là web đóng gói lại. Chọn "có commit" nếu bạn
cần chạm vào code native.

`capacitor.config.json` của SoFin — `webDir` là thứ duy nhất bắt buộc phải đúng:

```json
{
  "appId": "com.sofin.app",
  "appName": "SoFin",
  "webDir": "public",
  "server": { "androidScheme": "https" }
}
```

⚠️ `androidScheme: "https"` làm origin của app thành `https://localhost`. Bất kỳ dịch vụ nào
kiểm allow-list redirect (OAuth, magic link, reset mật khẩu) sẽ **từ chối** origin đó — xem mục
5.7.

---

## 2. Workflow đầy đủ

Chép nguyên file này vào `.github/workflows/build-apk.yml`, đổi những chỗ đánh `# ĐỔI`.

```yaml
name: Build and Release APK

on:
  push:
    branches: [main]
    paths-ignore: ['**.md']
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: write            # cần để tạo Release

concurrency:
  group: apk-${{ github.ref }}      # ⚠️ PHẢI có github.ref — xem 5.4
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22          # ⚠️ @capacitor/cli đặt engines.node >=22
          cache: npm

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21          # ⚠️ Capacitor 8 / AGP 8.13 đặt sourceCompatibility 21

      - uses: android-actions/setup-android@v3

      # Chặn TRƯỚC khi tốn 5 phút build
      - name: Đối chiếu tag với package.json
        if: startsWith(github.ref, 'refs/tags/v')
        run: |
          PKG=$(node -p "require('./package.json').version")
          TAG="${GITHUB_REF_NAME#v}"
          test "$PKG" = "$TAG" || { echo "::error::Tag $GITHUB_REF_NAME khong khop $PKG"; exit 1; }

      - run: npm ci
      - run: npm test             # ĐỔI: cổng chặn của bạn

      # ĐỔI: bước sinh cấu hình / build web của bạn.
      # Thiếu bước này thì APK ra lò không có khoá backend.
      - name: Sinh cấu hình
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          SITE_URL: ${{ secrets.SITE_URL }}
        run: node scripts/generate-env.js --strict

      # `cap sync` một mình sẽ lỗi vì chưa có android/ để mà sync
      - name: Dựng dự án Android
        run: |
          npx cap add android
          npx cap sync android

      - name: Nạp khoá ký
        env:
          KS: ${{ secrets.ANDROID_DEBUG_KEYSTORE_B64 }}
        run: |
          if [ -z "$KS" ]; then
            if [ "${GITHUB_REF#refs/tags/v}" != "$GITHUB_REF" ]; then
              echo "::error::Thiếu ANDROID_DEBUG_KEYSTORE_B64 — bản này KHÔNG cài đè được."
              exit 1
            fi
            echo "::warning::Không có khoá cố định — artifact này ký ngẫu nhiên."
          else
            echo "$KS" | base64 -d > "$RUNNER_TEMP/app.keystore"
          fi

      - name: Build APK
        run: |
          chmod +x android/gradlew
          cd android && ./gradlew assembleDebug --no-daemon --stacktrace

      # KÝ ĐÈ sau khi build — xem 5.3
      - name: Đặt tên file và ký
        run: |
          SRC=android/app/build/outputs/apk/debug/app-debug.apk
          if [ -f "$RUNNER_TEMP/app.keystore" ]; then
            APKSIGNER=$(ls "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
            "$APKSIGNER" sign \
              --ks "$RUNNER_TEMP/app.keystore" --ks-pass pass:android \
              --ks-key-alias androiddebugkey --key-pass pass:android \
              --v1-signing-enabled true --v2-signing-enabled true \
              --out myapp.apk "$SRC"          # ĐỔI tên file
          else
            cp "$SRC" myapp.apk
          fi

      # Cổng chặn quan trọng nhất — xem 5.5
      - name: Đối chiếu chữ ký
        run: |
          APKSIGNER=$(ls "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
          "$APKSIGNER" verify --print-certs myapp.apk | tee /tmp/certs.txt
          GOT=$(sed -n 's/.*SHA-256 digest:[[:space:]]*\([0-9a-fA-F]\{64\}\).*/\1/p' /tmp/certs.txt \
                | head -1 | tr 'A-F' 'a-f')
          WANT=<64-ky-tu-hex-cua-ban>       # ĐỔI: xem 3.3
          echo "signer=$GOT"
          test -n "$GOT" || { echo "::error::Không đọc được vân tay — xem log trên."; exit 1; }
          test "$GOT" = "$WANT" || { echo "::error::APK ký bằng khoá LẠ ($GOT)."; exit 1; }

      - uses: actions/upload-artifact@v4
        with:
          name: myapp-apk
          path: myapp.apk
          retention-days: 30

      - name: Phát hành
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          name: MyApp ${{ github.ref_name }}
          body: Bản Android dựng tự động từ `${{ github.sha }}`.
          files: myapp.apk
```

**Hai chế độ, cố ý tách:**

| Trigger | Làm gì | Vì sao |
|---|---|---|
| push `main` | Build, chỉ để **artifact** | Biết ngay là native còn dựng được, không tạo release rác cho mỗi commit |
| tag `v*` | Build **và phát hành** | Chỉ những mốc bạn chủ động chọn mới thành bản người dùng tải |

⚠️ Theo tài liệu GitHub, `paths-ignore` **không** được xét cho push tag — nên push tag vẫn build
dù commit đó chỉ đổi `.md`. Đáng xác nhận một lần trên repo của bạn.

---

## 3. Khoá ký — phần dễ làm sai nhất

### 3.1 Vì sao phải có khoá cố định

Runner của GitHub là máy sạch. Không tìm thấy khoá debug nào, Gradle **tự sinh một khoá ngẫu
nhiên cho mỗi lần build**. Chữ ký đổi thì Android từ chối cài đè:

```
INSTALL_FAILED_UPDATE_INCOMPATIBLE
```

Người dùng buộc phải gỡ app rồi cài lại — và **gỡ app là xoá sạch localStorage / IndexedDB**.
Với một app tài chính offline-first thì đó là mất dữ liệu.

### 3.2 Tạo keystore và nạp vào secret

```bash
keytool -genkeypair -v -keystore app-debug.keystore \
  -storepass android -keypass android -alias androiddebugkey \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Android Debug,O=Android,C=US"

# Linux / macOS / Git Bash
base64 app-debug.keystore | tr -d '\n'
```

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("app-debug.keystore")) | Set-Clipboard
```

Dán chuỗi vào **Settings → Secrets and variables → Actions → New repository secret**.

Alias và hai mật khẩu ở trên (`androiddebugkey` / `android` / `android`) là **quy ước khoá debug
của Android**; giữ đúng để `assembleDebug` và các công cụ khác không thắc mắc. Nếu bạn đổi thì
phải đổi khớp trong bước `apksigner sign`.

> **Giữ file `.keystore` ở nơi an toàn và ĐỪNG commit.** Mất nó là mất luôn khả năng phát hành
> bản cài đè được lên những bản đã ra — mọi người dùng hiện tại phải gỡ app. Không có cách khôi
> phục. Đây là tài sản, không phải file tạm.

### 3.3 Lấy giá trị `WANT` cho cổng chặn chữ ký

Sau lần build đầu tiên có khoá, tải APK về rồi đọc vân tay — hoặc lấy luôn từ log của bước
"Đối chiếu chữ ký" (nó in `signer=...`):

```bash
apksigner verify --print-certs myapp.apk | grep -i "SHA-256 digest"
# hoặc không có Android SDK trong tay:
keytool -printcert -jarfile myapp.apk
```

Vân tay chứng chỉ **không phải bí mật** — nó nằm sẵn trong mọi APK bạn phát hành. Cứ để thẳng
trong workflow, đừng nhét vào secret (nhét vào secret thì log bị che, và bước này mất hết tác
dụng chẩn đoán).

### 3.4 Muốn ký release thật thay vì debug

APK ký debug vẫn khiến Android cảnh báo "nguồn không xác định". Muốn hết:

1. Tạo keystore **release** (mật khẩu mạnh, alias riêng), nạp vào secret khác.
2. `assembleDebug` → `assembleRelease`.
3. Đường dẫn đầu ra đổi thành `android/app/build/outputs/apk/release/app-release-unsigned.apk`.
4. Thêm bước `zipalign -p 4` **trước** `apksigner sign`.
5. Cập nhật `WANT` bằng vân tay của khoá mới.

Cảnh báo "nguồn ngoài Play Store" thì **không** mất — cái đó chỉ mất khi phát hành qua Play
Store. Ký release chỉ bỏ nhãn "debug".

---

## 4. Secrets cần tạo

| Secret | Bắt buộc | Dùng ở đâu |
|---|---|---|
| `ANDROID_DEBUG_KEYSTORE_B64` | **Có** (workflow chặn job phát hành nếu thiếu) | Ký đè APK |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Tuỳ dự án | Sinh cấu hình vào bundle web |
| `SITE_URL` | Có, nếu app dùng email redirect | Xem 5.7 |

---

## 5. Bảy cạm bẫy đã cắn thật

### 5.1 JDK 17 → Gradle fail

**Triệu chứng:** build đỏ ở bước Gradle, log nói về `sourceCompatibility` / class file version.
**Nguyên nhân:** Capacitor 8 dùng AGP 8.13, đặt `sourceCompatibility = 21`.
**Chặn:** `java-version: 21`. Nâng Capacitor thì kiểm lại con số này.

### 5.2 Node 20 → `cap add` bỏ cuộc

**Triệu chứng:** `npx cap add android` thoát với lỗi engine.
**Nguyên nhân:** `@capacitor/cli` đặt `engines.node >= 22`.
**Chặn:** `node-version: 22`, và khai `engines.node` trong `package.json` để máy local cũng cảnh
báo. SoFin còn có một test tĩnh đối chiếu `node-version` trong workflow với `engines` của mọi
devDependency — mất một vòng CI mới tìm ra lỗi này nên nó đáng có test.

### 5.3 ⚠️ Đặt khoá cho Gradle tìm là KHÔNG ĐỦ

**Triệu chứng:** không có triệu chứng gì cả. APK cài được, chạy được. Chỉ là vài tuần sau người
dùng không nâng cấp được, và bạn không hiểu tại sao.
**Nguyên nhân:** đã thử ghi khoá vào `~/.android/debug.keystore` và Gradle **vẫn** ký bằng khoá
tự sinh (`CN=Android Debug`). Nó tìm khoá theo `ANDROID_USER_HOME` / `ANDROID_SDK_HOME` mà
`setup-android` đặt, **không** theo `$HOME`.
**Chặn:** thôi không đoán Gradle tìm ở đâu. Để nó ký bằng gì tuỳ nó, rồi **`apksigner sign` ký
đè sau khi build**. Không phụ thuộc biến môi trường nào.

Bật cả `--v1-signing-enabled` và `--v2-signing-enabled`: chỉ có v2 thì `keytool -printcert
-jarfile` ngoài máy không đọc được, mất một đường tự kiểm.

### 5.4 ⚠️ `concurrency.group` thiếu `github.ref` → mất release, im lặng

**Triệu chứng:** tag đã lên remote nhưng **không có release nào**. Không một dòng báo lỗi.
**Nguyên nhân:** `git push origin main v5.0.2` đẩy nhánh và tag cùng lúc → hai run song song.
Với một nhóm concurrency chung (`group: apk`), `cancel-in-progress` khiến run sau giết run
trước — và có lần cái bị giết chính là run của tag.
**Chặn:** `group: apk-${{ github.ref }}`. Mỗi ref chỉ huỷ run cũ của chính nó.

### 5.5 ⚠️ Không có cổng chặn chữ ký → sai khoá hỏng lặng lẽ

Đúng ca 5.3 đã xảy ra ở SoFin v5.0.4: khoá **có** nằm sẵn, log **có** nói "đã nạp khoá", mà APK
vẫn ký bằng khoá lạ. Nạp được file khoá không có nghĩa là nó đã được dùng.

Bước "Đối chiếu chữ ký" là thứ **duy nhất** bắt được. Nếu nó đỏ, đừng gỡ nó đi — vấn đề nằm ở
khoá. Hai chi tiết nhỏ trong bước đó cũng là từ sự cố:

- `| tee /tmp/certs.txt` **in nguyên văn ra log**: có lần bước này đỏ vì lệnh bóc chuỗi sai chứ
  không phải chữ ký sai, mà log không có gì để đối chiếu.
- `sed` bám vào chính **chuỗi 64 ký tự hex**, không bám vào vị trí dấu hai chấm hay tên nhãn:
  định dạng output của `apksigner` đổi theo phiên bản build-tools.

### 5.6 Tag lệch `package.json` → app vừa cập nhật đã tự thấy lỗi thời

Nếu app tự kiểm cập nhật bằng cách đọc `tag_name` của release mới nhất rồi so với phiên bản
đang chạy, thì tag **phải bằng** version trong `package.json`. Chặn ngay đầu job, trước khi tốn
build.

Ba chỗ phải khớp nhau, đừng để lẻ chỗ nào:

1. `package.json` → `version`
2. Hằng số dự phòng trong code (nếu bạn có, cho trường hợp chạy không qua build)
3. Tên tag git

SoFin có một assertion trong test đối chiếu (1) với (2), và workflow đối chiếu (1) với (3).

Và **so phiên bản theo số từng đoạn**, không so chuỗi: `"5.0.10" < "5.0.9"` nếu so chuỗi.

### 5.7 `androidScheme: https` → link email chết trên bản native

**Triệu chứng:** reset mật khẩu / magic link hoạt động trên web, nhưng trong APK thì backend từ
chối redirect, hoặc mail mở ra trang lỗi.
**Nguyên nhân:** origin của app là `https://localhost`, không có trong allow-list của nhà cung
cấp auth, và cũng không có ứng dụng mail nào mở được nó.
**Chặn:** khi chạy native thì truyền `redirectTo` là domain web thật (SoFin lấy từ
`__ENV__.SITE_URL`, sinh từ secret `SITE_URL`). Cần một hàm `isNativeApp()` để phân biệt.

Hai chỗ khác cũng phải phân biệt native/web, cùng lý do:

- **Không đăng ký service worker** trên bản native — asset đã nằm sẵn trên máy, worker chỉ cache
  một bản sao của bản sao và thêm một đường cập nhật không bao giờ áp được.
- **Ẩn nút "Tải APK"** khi đang chạy trong chính APK đó.

### 5.8 Tên file APK lệch với link tải trong app

`files: myapp.apk` trong workflow phải khớp với URL mà app dùng để tải bản mới. Lệch là nút 404
mà **không có gì báo**. Nên có một assertion khoá cặp đó lại.

Link nên trỏ vào bí danh `latest` của GitHub để không đổi theo phiên bản:

```
https://github.com/<owner>/<repo>/releases/latest/download/myapp.apk
```

---

## 6. Quy trình phát hành

```bash
npm version patch --no-git-tag-version    # hoặc minor / major
# sửa hằng số phiên bản dự phòng trong code nếu có
npm test
git commit -am "chore: 5.1.0"
git tag v5.1.0
git push origin main v5.1.0               # đẩy cả hai — nhớ mục 5.4
```

Thử workflow mà không cần push: **Actions → chọn workflow → Run workflow**
(`workflow_dispatch`). Không có tag nên nó chỉ ra artifact, không tạo release.

---

## 7. Checklist port sang dự án khác

- [ ] `webDir` trong `capacitor.config.json` trỏ đúng thư mục web đã build
- [ ] `/android/` và `/ios/` vào `.gitignore` (nếu chọn hướng không commit)
- [ ] `node-version` khớp `engines.node` của `@capacitor/cli` đang dùng
- [ ] `java-version` khớp `sourceCompatibility` của Capacitor/AGP đang dùng
- [ ] `concurrency.group` **có** `${{ github.ref }}`
- [ ] Tạo keystore, nạp `ANDROID_DEBUG_KEYSTORE_B64`, **lưu file keystore ra ngoài repo**
- [ ] Build một lần, lấy vân tay SHA-256, điền vào `WANT`
- [ ] Đổi mọi chỗ `myapp.apk` thành tên file của bạn, và khớp với link tải trong app
- [ ] Nếu app tự kiểm cập nhật: tag = `package.json.version`, so phiên bản theo số
- [ ] Nếu app dùng email redirect: truyền domain web thật khi chạy native

---

## 8. Đọc thêm trong repo này

| File | Nội dung |
|---|---|
| `.github/workflows/build-apk.yml` | Workflow thật, chú thích đầy đủ lý do từng bước |
| `DEPLOY.md` | Checklist phát hành của SoFin (Supabase, Vercel, PWA, APK) |
| `CLAUDE.md` § *Bản Android (Capacitor)* | Ba chỗ bản native khác web, và vì sao |
