# V3.8.2 GitHub 更新步驟

1. 解壓縮 V3.8.2 ZIP。
2. 到 `chopper-coder/ImageRecordAssistant`。
3. `Add file → Upload files`，上傳根目錄檔案並覆蓋同名檔案。
4. `.github` 若無法拖曳，不必重建資料夾：開啟 GitHub 既有 `.github/workflows/pages.yml`。
5. 將本包 `PAGES_WORKFLOW_COPY_THIS.yml` 全部內容複製進 `pages.yml`。
6. Commit message 建議：`更新至 V3.8.2 Single Photo Metadata Workflow Hotfix`。
7. 到 Actions 確認：`Validate and build Pages`、`Deploy Pages` 都為綠色。
8. 打開正式網站後按 `Ctrl + F5`，右上角確認為 V3.8.2。


V3.8.2 僅調整批次重新命名的 UI 歸類；更新網站檔案後，請同步更新 pages.yml。
