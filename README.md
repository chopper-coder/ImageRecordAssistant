# 圖片紀錄整理助手 V3.7.2

**HEIC Fast Import & Parallel Decode Edition**

正式網站：<https://chopper-coder.github.io/ImageRecordAssistant/>

這是 GitHub Clean Package，延續 V3.7.1 的大量照片穩定性，並針對 iPhone HEIC / HEIF 大量匯入速度做優化。

## V3.7.2 重點

- HEIC 解碼改為 **1～3 路持久 Worker Pool**，依裝置記憶體與 CPU 自動調整。
- Worker 會重複使用，不再每張 HEIC 都重新建立／銷毀解碼器。
- 瀏覽器原生 HEIC 支援只探測一次；若確認不支援，後續直接走 Worker，不再每張重試。
- HEIC → JPEG 後改用 **Header + 尺寸安全驗證**，移除第二次完整 JPEG decode。
- 大量 HEIC 以平行工作佇列處理，保持原始匯入順序。
- 取消匯入會同時停止所有 Worker 與等待佇列。
- 延續 V3.7.1 的 180px 縮圖快取與 149+ 張照片清單穩定性修正。
- `.photojob` Schema 仍為 2，舊專案可直接開啟。

## 主要功能

- HEIC / HEIF、JPEG、PNG、WebP、BMP 圖片整理
- 照片縮圖、排序、批次說明與地點
- 非破壞式框線、箭頭、文字、馬賽克與個資遮蔽
- 案件編號、章節、標籤與前後比較
- 長圖智慧切頁
- Word / PDF 輸出與列印版面預覽
- 本機 Autosave、Recovery 與 `.photojob` 專案檔
- 案件完成與封存

## GitHub Pages

Repository：`chopper-coder/ImageRecordAssistant`

1. `Settings → Pages`
2. `Build and deployment → Source`
3. 選擇 `GitHub Actions`

正式 workflow 位於 `.github/workflows/pages.yml`。

若瀏覽器無法拖入 `.github` 資料夾，可打開既有 `.github/workflows/pages.yml`，將本包根目錄 `PAGES_WORKFLOW_COPY_THIS.yml` 的內容整份覆蓋並 Commit。
