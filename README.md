# 圖片紀錄整理助手 V3.8

**Large Project Control & Export Workflow Edition**

正式網站：<https://chopper-coder.github.io/ImageRecordAssistant/>

V3.8 延續 V3.7.2 的大量照片與 HEIC 平行解碼核心，新增大型專案監控、匯入摘要與失敗重試、進階照片篩選、批次章節，以及可精確控制 Word / PDF 輸出範圍的工作流程。

## V3.8 重點

- 大型專案監控：顯示專案圖片容量；Chromium 支援時同步顯示 JS Heap 使用量。
- 匯入進度與摘要：顯示完成數、HEIC 處理數、略過與失敗數。
- 失敗照片重試：只重新處理最近一次匯入中真正解碼失敗的照片，不必整批重來。
- 進階搜尋／篩選：缺說明、缺地點、HEIC、已有註記、排除輸出、已勾選照片。
- 單張「不輸出」：照片保留在專案，但不進 Word / PDF / 列印預覽。
- 批次「排除輸出／恢復輸出」。
- 批次套用照片章節／分類。
- 輸出範圍：全部可輸出照片，或只輸出左側已勾選照片。
- 輸出前缺漏檢查只檢查實際輸出範圍，排除照片不再阻擋案件完成。
- `exclude_export` 與 `export_scope` 會進 Undo / Redo、Autosave、Recovery、`.photojob`。
- 保留 V3.7.2：HEIC 1～3 路持久 Worker、180px 縮圖快取、149+ 張照片大量匯入、註記、個資遮蔽、長圖切頁、案件封存。

## GitHub Pages

Repository：`chopper-coder/ImageRecordAssistant`

1. GitHub `Settings → Pages`
2. `Build and deployment → Source`
3. 選擇 `GitHub Actions`

正式 workflow：`.github/workflows/pages.yml`

如果瀏覽器無法拖入 `.github`，請把根目錄 `PAGES_WORKFLOW_COPY_THIS.yml` 的內容貼到 GitHub 現有的 `.github/workflows/pages.yml`。

## 專案相容性

`.photojob` 繼續使用 Schema 2。V3.7.x 專案可直接開啟；舊專案沒有 V3.8 欄位時會採安全預設值。

## 隱私

照片整理、縮圖、註記、PDF/Word 產生皆在瀏覽器本機處理。GitHub Pages 只提供靜態程式檔，不接收使用者照片。
