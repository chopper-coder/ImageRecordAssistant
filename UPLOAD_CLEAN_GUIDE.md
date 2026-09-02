# V3.8.5 GitHub 更新步驟

1. 解壓縮 `ImageRecordAssistant_V3.8.5_Operation_Log_Audit_Trail_Edition.zip`。
2. 到 GitHub Repository：`chopper-coder/ImageRecordAssistant`。
3. 選擇 `Add file → Upload files`。
4. 將 ZIP **根目錄內的檔案**上傳並覆蓋同名檔案，不要把最外層資料夾整個再包一層上傳。
5. `.github` 若不方便拖曳：開啟 GitHub 現有 `.github/workflows/pages.yml`。
6. 將本包 `PAGES_WORKFLOW_COPY_THIS.yml` 的全部內容貼進 `pages.yml` 後 Commit。
7. Commit message 建議：`更新至 V3.8.5 Audit Log Quick Access Hotfix`。
8. 到 **Actions** 確認 `Validate and build Pages` 與 `Deploy Pages` 都是綠色。
9. 打開正式網站後按 `Ctrl + F5`，確認右上角版本為 **V3.8.5**。

## 更新後建議測試

- 匯入 2～3 張照片後，確認「操作紀錄」筆數增加。
- 修改單張照片說明後離開欄位，確認只記錄「修改照片說明」，不顯示說明全文。
- 分別匯出 TXT / CSV / JSON。
- 暫存 → 關閉／重新開啟 → 續編，確認操作紀錄仍在。
- 儲存 `.photojob` 後重新開啟，確認紀錄仍可繼續累積。
