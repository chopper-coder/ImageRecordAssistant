# GitHub 上傳與 GitHub Pages 部署說明

本文件適用於：`chopper-coder/ImageRecordAssistant`

正式網站：

https://chopper-coder.github.io/ImageRecordAssistant/

## 一、第一次上傳

1. 登入 GitHub，開啟 `ImageRecordAssistant` Repository。
2. 選擇 **Add file → Upload files**。
3. 將本 GitHub Ready 資料夾「裡面的所有檔案與資料夾」拖入上傳區。
4. 確認 `index.html`、`app.js`、`style.css`、`.github` 都位於 Repository 根目錄。
5. Commit message 可輸入：

   `發布 圖片紀錄整理助手 V3.7`

6. 按 **Commit changes**。

> 不要只上傳 ZIP；也不要多包一層資料夾，否則 GitHub Pages 根目錄會找不到 `index.html`。

## 二、開啟 GitHub Pages

1. Repository → **Settings**。
2. 左側選 **Pages**。
3. `Build and deployment` → `Source` 選 **GitHub Actions**。
4. 回到 Repository → **Actions**。
5. 等待 `Test and Deploy GitHub Pages - V3.7` 完成。
6. Regression 與 Deploy 都為綠色勾勾後，網站即完成更新。

## 三、之後更新版本

每次新版本只需要：

1. 解壓新版 GitHub Ready ZIP。
2. Repository → **Add file → Upload files**。
3. 將新版檔案全部拖進去，覆蓋同名檔案。
4. Commit changes。
5. 到 **Actions** 確認測試與部署成功。
6. 開啟網站，必要時按 `Ctrl + F5` 強制更新瀏覽器快取。

## 四、部署失敗怎麼看

進入 **Actions → Test and Deploy GitHub Pages - V3.7**，查看紅色的步驟。

常見分類：

- `Prepare pinned runtime vendor`：第三方套件準備失敗。
- `Verify pinned runtime vendor`：vendor SHA-256 與預期不符，請不要略過。
- `Run static security regression`：資安/結構回歸檢查失敗。
- `Run browser export regression`：瀏覽器實際操作或 Word/PDF 輸出回歸失敗。
- `Open generated DOCX with LibreOffice`：產出的 Word 文件無法被 LibreOffice 正常讀取。
- `Deploy to GitHub Pages`：Pages 權限或 Pages Source 設定有問題。

## 五、建議的 Repository Settings

### Pages

- Source：`GitHub Actions`

### Branch protection（可選，但推薦）

若之後多人共同維護，可為 `main` 設定：

- Require a pull request before merging
- Require status checks to pass
- 將 `Quality Checks` 設為必要檢查

### Issues

已內建：

- Bug Report
- Feature Request

回報 Bug 時不要上傳真實個資、病患資訊或機敏案件照片。

## 六、Repository 根目錄正確範例

```text
ImageRecordAssistant/
├─ .github/
├─ scripts/
├─ tests/
├─ vendor/
├─ index.html
├─ app.js
├─ style.css
├─ package.json
├─ README.md
└─ ...
```

錯誤範例：

```text
ImageRecordAssistant/
└─ ImageRecordAssistant_V3.7_GitHub_Ready/
   ├─ index.html
   └─ app.js
```

`index.html` 必須直接在 Repository 根目錄。
