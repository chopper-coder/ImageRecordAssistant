# CHANGELOG

## V3.8.4 — Operation Log & Audit Trail Edition

- 新增本機操作紀錄時間軸與最近 8 筆顯示。
- 新增 TXT / CSV / JSON 操作紀錄匯出。
- 操作紀錄隨 Autosave、手動暫存與 `.photojob` 保存。
- `.photojob` SHA-256 manifest 完整性驗證涵蓋 `operation_log`。
- 重要操作包含匯入、編輯、批次、註記、裁切、輸出、封存、暫存與專案開啟／儲存。
- 單張照片說明、備註與照片地點全文不重複寫入操作紀錄。
- CSV 增加試算表公式注入防護。
- 操作紀錄上限 1,500 筆。

## V3.8.3 — Temporary Session & Resume Edition

- 新增「暫存目前工作」、「繼續上次暫存」與「清除暫存」。
- 手動暫存沿用既有 IndexedDB 專案快照，不複製第二份照片資料。
- 即使停用背景自動儲存，仍可手動暫存。
- 下次開啟網站時，手動暫存優先提示續編。

## V3.8.2 — Batch Rename Workflow Hotfix

- 將「批次重新命名」移至「批次操作」。
- 保留既有事件 ID 與重新命名邏輯。

## V3.8.1 — Single Photo Metadata Workflow Hotfix

- 照片地點改為單張自行輸入，不再沿用文件地點。
- 常用說明、照片說明與備註回歸單張照片設定。

## V3.8 — Large Project Control & Export Workflow Edition

- 大型專案 RAM / 容量監控。
- 匯入進度、摘要與失敗照片重試。
- 進階照片篩選。
- 單張／批次排除輸出。
- 只輸出已勾選照片。
- 批次章節／分類。
- 輸出前檢查與封存依實際輸出範圍判定。

## V3.7.2

- HEIC 1～3 路持久 Worker 平行解碼。
- 原生 HEIC 支援探測快取。
- 移除 HEIC→JPEG 後不必要的第二次完整解碼。

## V3.7.1

- 修正大量照片容量限制。
- 180px 真縮圖快取。
- 點選照片不再重建整個縮圖清單。
