#!/usr/bin/env node
/* ============================================================
   Chèn Share Target (nhận ảnh biên lai từ app ngoài) vào bản Android.

   android/ KHÔNG nằm trong repo — CI sinh lại bằng `npx cap add android` mỗi
   lần build, nên mọi tuỳ biến native phải áp SAU bước đó. Script này chạy ngay
   sau `npx cap sync android`, chèn khai báo activity của plugin send-intent vào
   AndroidManifest.xml để SoFin xuất hiện trong bảng "Chia sẻ" của hệ điều hành
   khi người dùng chia sẻ một tấm ảnh.

   Phải IDEMPOTENT: chạy lại lần nữa (hoặc build lại) mà manifest đã có khối này
   thì không nhân đôi — Android sẽ từ chối manifest có hai activity trùng tên.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST = path.resolve(
  __dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

/* Activity do chính plugin @mindlib-capacitor/send-intent cung cấp (lớp đã biên
   dịch sẵn trong thư viện). Tên lớp KHÔNG được đổi — đổi là crash. intent-filter
   khai các loại mime nhận được; ảnh biên lai là image/*. */
const BLOCK = `
        <activity
            android:name="de.mindlib.sendIntent.SendIntentActivity"
            android:label="@string/app_name"
            android:exported="true"
            android:theme="@style/AppTheme.NoActionBar">
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
            </intent-filter>
        </activity>
`;

function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error('[patch-android-share] Không thấy AndroidManifest.xml — chạy sau `npx cap add android`?');
    process.exit(1);
  }
  let xml = fs.readFileSync(MANIFEST, 'utf8');

  if (xml.indexOf('de.mindlib.sendIntent.SendIntentActivity') > -1) {
    console.log('[patch-android-share] Đã có Share Target — bỏ qua (idempotent).');
    return;
  }
  const close = '</application>';
  const at = xml.lastIndexOf(close);
  if (at === -1) {
    console.error('[patch-android-share] Không tìm thấy </application> để chèn vào.');
    process.exit(1);
  }
  xml = xml.slice(0, at) + BLOCK + '    ' + xml.slice(at);
  fs.writeFileSync(MANIFEST, xml);
  console.log('[patch-android-share] Đã chèn SendIntentActivity vào AndroidManifest.xml.');
}

main();
