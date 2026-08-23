# Changelog

## V3.7.2 — HEIC Fast Import & Parallel Decode Edition

- HEIC fallback 解碼改為依裝置自動 1～3 路持久 Worker Pool。
- 避免每張 HEIC 重建 Worker 與重新載入 decoder module。
- 原生 HEIC 支援探測結果快取；不支援時後續直接走 Worker。
- HEIC 轉 JPEG 後不再做第二次完整影像 decode，只做格式與尺寸安全驗證。
- 大量 HEIC 匯入改為平行工作佇列並保留原始排序。
- Worker timeout 只重啟故障 slot，不影響其他平行任務。
- 取消匯入會清空等待佇列並終止所有正在解碼的 Worker。
- JPEG 轉換品質由 0.94 調整為 0.92，在文件輸出品質與轉檔速度／檔案大小間取得較佳平衡。
- 延續 V3.7.1 大量照片容量、180px 縮圖快取與不重建照片清單修正。

## V3.7.1 — Large Batch & Thumbnail Stability Hotfix

- 修正大型批次照片在約 300 MB 時提前停止匯入。
- 提高壓縮圖片 Blob 專案容量上限：512 MB / 768 MB / 1 GB。
- 專案檔讀取上限同步提高至約 1.15 GB。
- 左側縮圖改為 180px JPEG 小縮圖快取。
- 選取照片不再呼叫整個 `renderList()`，避免每點一張照片縮圖重新載入。
- 保留 `.photojob` Schema 2 相容性。

## V3.7

- 進階註記：選取、移動、刪除、文字重新編輯
- 個資不可逆遮蔽輸出
- 案件編號、章節與照片標籤
- 改善前／改善後比較
- 輸出浮水印
- 超長圖片智慧切頁
- 案件完成與封存
