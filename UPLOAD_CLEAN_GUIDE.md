# V3.7.2 GitHub Clean Package 上傳方式

## 先清除舊檔

在 GitHub Repository 按鍵盤 `.` 開啟 github.dev，比較容易一次刪除舊檔案。

建議刪除舊版網站與舊說明檔，再保留或重建：

- `.github/workflows/pages.yml`
- `LICENSE`

不要刪除 Repository 本身。

## 上傳本包的根目錄檔案

解壓縮後，將下列檔案上傳到 Repository 根目錄：

- `index.html`
- `app.js`
- `style.css`
- `heic-worker.js`
- `image-worker.js`
- `package.json`
- `.nojekyll`
- `.gitignore`
- `README.md`
- `SECURITY.md`
- `CHANGELOG.md`
- `LICENSE`
- `LICENSES_THIRD_PARTY.md`

`PAGES_WORKFLOW_COPY_THIS.yml` 是備用副本，可以不上傳。

## .github 無法拖曳時

你現在已經建立 `.github/workflows/pages.yml`，因此最簡單：

1. GitHub → `Code`
2. `.github → workflows → pages.yml`
3. 按鉛筆 Edit
4. 將 `PAGES_WORKFLOW_COPY_THIS.yml` 的內容全部貼上覆蓋
5. Commit message：`更新 V3.7.2 HEIC Fast Import Pages workflow`
6. Commit 到 `main`

## 部署成功判斷

到 `Actions → Deploy GitHub Pages - V3.7.2`。

應看到：

- `Validate and build Pages` ✅
- `Deploy Pages` ✅

最後開啟：

<https://chopper-coder.github.io/ImageRecordAssistant/>

按 `Ctrl + F5`，右上角應顯示 `V3.7.2`。
