# Contributing

感謝協助改善圖片紀錄整理助手。

## 開發原則

1. 不得新增會把使用者照片、`.photojob` 或案件內容自動上傳到第三方服務的功能。
2. 不得以 CDN 取代目前的本機 runtime vendor，除非另案完整評估 CSP、供應鏈與離線需求。
3. 不得移除既有的 magic bytes、尺寸、ZIP、SHA-256、HEIC Worker、XML/OOXML 等防護而沒有對等替代控制。
4. UI 修改必須考慮 1280×800、1366×768、1440×900 等一般筆電視窗，照片清單不可再次被壓縮到無法操作。
5. 註記、裁切、旋轉與輸出修改必須驗證預覽、PDF、Word 的一致性。
6. 新欄位若寫入 `.photojob`，必須考慮舊 Schema 2 專案的缺省值與向下相容性。

## 建議工作流程

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run prepare:vendor
npm run verify:vendor
npm run test:syntax
npm run test:security
npx playwright install chromium
npm run test:e2e
```

## Pull Request

PR 請說明：

- 修改目的
- 影響範圍
- 是否改變 `.photojob` 欄位
- 是否涉及圖片解碼、ZIP、XML、HEIC、IndexedDB、Worker 或輸出流程
- 已完成哪些測試
- UI 修改時使用過的視窗尺寸

請勿在 Issue 或 PR 中附上真實敏感照片。
