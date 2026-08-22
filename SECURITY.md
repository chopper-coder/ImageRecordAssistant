# Security Notes — V3.5.1

## 威脅模型

本工具處理使用者匯入的圖片與 `.photojob` ZIP。主要風險包括：畸形/惡意圖片造成記憶體耗盡、HEIC decoder 問題、ZIP Bomb/路徑穿越、專案資料竄改、DOM 注入、共用電腦殘留資料與 EXIF/GPS 隱私。

## V3.5.1 控制

- CSP 限制同源 script/connect，禁止 object、form action，並阻擋 iframe 執行。
- 圖片依 magic bytes 判斷，不信任副檔名。
- JPG/PNG/WebP/BMP 在完整 decode 前先做 Header 尺寸檢查。
- HEIC/HEIF 做 ISO BMFF 容器與尺寸預檢；sequence/generic 高風險路徑拒絕 fallback。
- HEIC fallback 在可 terminate Worker 中執行。
- Word/PDF 圖片處理優先在獨立 Image Worker 中進行；逾時/取消不回退主執行緒重做。
- 依裝置 RAM 動態限制像素、照片數、專案總量。
- `.photojob` 防 ZIP Bomb、路徑穿越、重複 ID/無效 selected ID，Schema 2 使用 SHA-256 驗證 manifest 與 media。
- Autosave + 最多 5 代同步 Recovery Journal。
- Blob preview URL 採 Lazy 建立並主動 revoke。
- JPEG EXIF/GPS 可被健康檢查偵測；Word/PDF 圖片會重新編碼以避免直接攜帶來源 metadata。
- Offline server 綁定 loopback，並提供 CSP、X-Frame-Options、nosniff、Referrer-Policy、Permissions-Policy、COOP。

## 限制

SHA-256 integrity 用來偵測意外或未授權修改，不是數位簽章，無法證明檔案來自特定人員。`.photojob` 會保存專案圖片 Blob，因此若來源 JPEG 自帶 EXIF/GPS，中繼資料可能仍存在於工作檔；不要把 `.photojob` 當成已匿名化的外部交換格式。
