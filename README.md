# 圖片紀錄整理助手 V3.5.2

Professional Workflow Edition / Photo List Accessibility Hotfix

這是 GitHub Pages 精簡版，只保留網站執行、測試與自動部署需要的檔案。

## 主要功能

- 圖片／資料夾批次匯入
- 照片清單、排序、搜尋與多選
- EXIF 拍攝時間與 GPS 隱私提示
- SHA-256 完全重複與 dHash 相似照片檢查
- 圖片品質提示
- `.photojob` 專案儲存／續編
- 5 代 Recovery、Undo／Redo
- Word／PDF 匯出
- HEIC/HEIF 安全隔離解碼
- V3.5.1 左側照片清單可用性修正
- V3.5.2 GitHub Pages 列印版面預覽 Hotfix：移除不必要的 JSZip 前置依賴，加入明確錯誤提示、重新產生與直接下載 PDF

## 部署到 GitHub Pages

1. 建立新的 GitHub Repository。
2. 將本資料夾內所有檔案上傳到 Repository 根目錄。
3. Repository → **Settings → Pages**。
4. Source 選擇 **GitHub Actions**。
5. 推送到 `main` 後，`.github/workflows/pages.yml` 會先跑測試，再部署 Pages。

> 第一次 Actions 會從 npm 安裝固定版本依賴，並產生 HEIC Worker vendor 檔案；Repository 不需要提交 `node_modules`。

## 本機測試

```bash
npm install --ignore-scripts
npm run prepare:vendor
npm run verify:vendor
npm run test:syntax
npm run test:security
npm run test:e2e
```

## Repository 內刻意沒有放的內容

- 歷代 V3.0～V3.5 測試報告與 Hotfix 文件
- Windows 離線伺服器與啟動 BAT
- Offline Package workflow
- 重複的 Regression workflow
- `node_modules`
- `_site`

這些都不是 GitHub Pages 原始專案日常維護所必需。

## 隱私

照片處理主要在瀏覽器本機執行；網站本身不包含照片上傳後端。詳見 `SECURITY.md`。
