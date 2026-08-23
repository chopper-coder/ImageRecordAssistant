# V3.7 GitHub Pages Deploy Hotfix

這個版本只調整 GitHub Pages 部署流程，不改動 V3.7 應用程式功能。

## 為什麼需要這個 Hotfix
原本 `pages.yml` 把完整 Playwright + LibreOffice E2E 當成部署前置條件。只要 E2E 因 runner、瀏覽器或 LibreOffice 環境問題失敗，即使 V3.7 網站檔案已上傳，GitHub Pages 仍會停在舊版。

## 新部署策略
- `pages.yml`：只做 Syntax、Vendor、Security、Build，通過即可部署。
- `quality.yml`：保留完整瀏覽器 E2E，作為 PR/手動品質檢查，不阻擋正式 Pages 更新。
- GitHub Pages 仍使用 GitHub Actions artifact 部署。

## 上傳後確認
1. GitHub Repository → Actions。
2. 找到 `Deploy GitHub Pages - V3.7`。
3. `Validate and build Pages` 與 `Deploy Pages` 都應為綠色勾勾。
4. Settings → Pages → Source 必須為 `GitHub Actions`。
5. 開啟 https://chopper-coder.github.io/ImageRecordAssistant/ 並按 Ctrl+F5。
6. 右上角應顯示 `V3.7`。
