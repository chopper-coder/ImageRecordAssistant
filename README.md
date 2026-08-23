# 圖片紀錄整理助手 V3.7

**Case Management & Advanced Annotation Edition**

正式網站：<https://chopper-coder.github.io/ImageRecordAssistant/>

這是 GitHub Clean Package，只保留目前 V3.7 網站與部署真正需要的檔案。

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

請在 GitHub：

1. `Settings → Pages`
2. `Build and deployment → Source`
3. 選擇 `GitHub Actions`

正式 workflow 位於：`.github/workflows/pages.yml`。

如果瀏覽器無法拖入 `.github` 資料夾，請開啟既有的 `.github/workflows/pages.yml`，將本包根目錄的 `PAGES_WORKFLOW_COPY_THIS.yml` 全部內容複製進去並 Commit。

詳細步驟請見 `UPLOAD_CLEAN_GUIDE.md`。
