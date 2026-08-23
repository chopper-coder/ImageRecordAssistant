# Security Notes — V3.7

## 安全邊界

圖片紀錄整理助手是瀏覽器端工具。GitHub Pages 版本不需要把使用者照片傳到應用程式後端；照片、註記、專案與輸出主要在本機瀏覽器記憶體／IndexedDB 中處理。

## V3.7 主要控制

- 嚴格 CSP；不允許 runtime CDN、`eval()`、`new Function()` 或外部 WebSocket。
- 圖片匯入前做檔案大小、magic bytes、尺寸與像素數預檢。
- HEIC/HEIF 做 ISO-BMFF 安全預檢；fallback decoder 使用隔離 Worker、逾時與強制終止。
- `.photojob` 驗證 ZIP 路徑、entry 數、容量、壓縮比、manifest 欄位上限與 SHA-256。
- 註記採正規化座標並限制在 0–1；註記目標照片以 ID 鎖定，避免選取狀態改變造成誤套。
- 個資遮蔽 (`redact`) 在預覽、Word/PDF 輸出圖片中以實心色塊烘焙，避免只靠可移除的 HTML 覆蓋層。
- 案件封存是應用層唯讀控制，不是密碼學簽章；需要法律或鑑識等級不可否認性時，應另搭配外部電子簽章／文件管理制度。
- JPEG EXIF/GPS 可偵測；Word/PDF 使用重新編碼影像，避免直接帶出來源 metadata。

## HEIC 第三方元件

專案仍釘選 `heic-to 1.5.2`。fallback 路徑採容器限制、still-image brand 限制、Worker 隔離與 timeout 作補償控制。第三方解碼器不是本專案自行修補的元件；部署者應持續追蹤上游安全更新並在可驗證時升級。

## 個資遮蔽限制

「個資遮蔽」保護的是輸出的預覽／Word／PDF 影像。`.photojob` 為可繼續編輯的專案格式，仍保留原始照片，因此不應把 `.photojob` 當成已去識別化的對外檔案。

## 回報問題

若發現可重現的安全問題，請避免附上真實敏感照片；使用最小化測試檔、操作步驟、瀏覽器版本與錯誤訊息描述問題。
