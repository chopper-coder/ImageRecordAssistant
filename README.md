# 🐱 圖片紀錄整理助手 V3.7

**Case Management & Advanced Annotation Edition**

[![GitHub Pages](https://github.com/chopper-coder/ImageRecordAssistant/actions/workflows/pages.yml/badge.svg)](https://github.com/chopper-coder/ImageRecordAssistant/actions/workflows/pages.yml)
[![Quality Checks](https://github.com/chopper-coder/ImageRecordAssistant/actions/workflows/quality.yml/badge.svg)](https://github.com/chopper-coder/ImageRecordAssistant/actions/workflows/quality.yml)

一套純前端、可直接部署到 GitHub Pages 的照片紀錄整理工具。照片、註記、專案資料、Word/PDF 產出流程皆在瀏覽器本機處理，不需要自行架設後端上傳服務。

## 🌐 線上使用

**GitHub Pages：** https://chopper-coder.github.io/ImageRecordAssistant/

> 建議使用最新版 Microsoft Edge 或 Google Chrome。第一次開啟新版後若畫面仍是舊版，可使用 `Ctrl + F5` 強制重新整理。

## ✨ V3.7 主要功能

- 🐾 貓貓可愛風格介面＋照片優先工作區。
- 📁 多張照片／整個資料夾批次匯入。
- 🖼️ Lazy Thumbnail，數百張照片仍維持較低記憶體使用量。
- 🕒 EXIF 拍攝時間、來源資料夾、時間軸／檔名／匯入順序排序。
- 🧭 照片說明、地點、標籤、章節／分類與案件編號。
- ✏️ 非破壞式註記：框選、箭頭、文字、馬賽克、個資遮蔽。
- 🖱️ 已有註記可重新選取、移動、刪除；文字註記可再次修改。
- ⬛ 個資遮蔽會烘焙至預覽、Word 與 PDF 輸出影像。
- 📱 超長圖片智慧切頁，適合 LINE、聊天紀錄與網頁長截圖。
- 🔄 改善前／改善後比較組。
- 🧾 自訂輸出浮水印。
- 🩺 專案健康檢查：重複圖片、dHash 相似圖片、低品質、缺漏與 GPS/EXIF 提醒。
- ↶ Undo / Redo、Autosave、最多 5 代 Crash Recovery。
- 🔒 案件完成／封存唯讀模式。
- 💾 `.photojob` 專案格式可續編，維持 Schema 2 相容性。
- 📄 Word、PDF、Word + PDF 輸出與精準列印版面預覽。

## 🔐 隱私與安全

- Runtime 不使用 CDN。
- CSP 限制外部連線與動態程式執行。
- 圖片匯入前檢查檔案大小、magic bytes、尺寸與像素數。
- HEIC/HEIF 先做容器安全預檢，fallback decoder 於隔離 Worker 中執行並可逾時終止。
- `.photojob` 驗證 ZIP 路徑、entry 數、容量、壓縮比與 SHA-256 完整性。
- Word/PDF 圖片會重新編碼，避免直接攜帶來源 JPEG EXIF/GPS metadata。
- `.photojob` 是可續編專案，仍保留原始照片；不要把它當成已去識別化的外部交付檔。

完整說明請閱讀 [SECURITY.md](SECURITY.md)。

## 🚀 部署到 GitHub Pages

本 Repository 已附 GitHub Actions 部署流程。

1. 將檔案放在 Repository 根目錄。
2. GitHub → **Settings → Pages**。
3. `Build and deployment` 的 `Source` 選 **GitHub Actions**。
4. 推送到 `main`。
5. `pages.yml` 會先執行 regression gate；全部通過才部署網站。

更完整的中文操作步驟請閱讀 [GITHUB_DEPLOY_GUIDE.md](GITHUB_DEPLOY_GUIDE.md)。

## 🧪 本機測試

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run prepare:vendor
npm run verify:vendor
npm run test:syntax
npm run test:security
npx playwright install chromium
npm run test:e2e
```

> `prepare:vendor` 會準備 GitHub Pages 需要的固定版本 runtime vendor；正式部署前應保留 `verify:vendor` 雜湊驗證。

## 📁 Repository 結構

```text
ImageRecordAssistant/
├─ .github/
│  ├─ ISSUE_TEMPLATE/
│  ├─ workflows/
│  │  ├─ pages.yml
│  │  └─ quality.yml
│  └─ pull_request_template.md
├─ scripts/
├─ tests/
├─ vendor/
├─ app.js
├─ heic-worker.js
├─ image-worker.js
├─ index.html
├─ style.css
├─ package.json
├─ README.md
├─ SECURITY.md
├─ CHANGELOG.md
├─ CONTRIBUTING.md
├─ GITHUB_DEPLOY_GUIDE.md
├─ RELEASE_CHECKLIST.md
├─ LICENSE
└─ LICENSES_THIRD_PARTY.md
```

## 🐛 回報問題

請使用 GitHub **Issues** 中的 Bug Report 模板。若問題涉及真實案件照片、病患資訊、個資或機敏資料，請不要直接上傳到公開 Issue；改用最小化測試圖片或文字描述。

## 📜 授權

本專案主程式目前採 **All Rights Reserved**。第三方元件各自遵循原始授權，詳見 [LICENSES_THIRD_PARTY.md](LICENSES_THIRD_PARTY.md)。
