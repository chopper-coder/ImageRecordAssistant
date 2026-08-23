# V3.7 GitHub 發布檢查表

每次要把新版本推到 `main` 前，建議依序確認：

- [ ] `index.html` 顯示正確版本號。
- [ ] `app.js` 的 `APP_VERSION` 正確。
- [ ] `package.json` 版本正確。
- [ ] `README.md` 與 `CHANGELOG.md` 已更新。
- [ ] 不包含真實照片、`.photojob`、個資、API Key、Token 或密碼。
- [ ] `npm run prepare:vendor` 成功。
- [ ] `npm run verify:vendor` 成功。
- [ ] `npm run test:syntax` 通過。
- [ ] `npm run test:security` 通過。
- [ ] `npm run test:e2e` 通過。
- [ ] UI 至少檢查 1280×800、1366×768、1440×900。
- [ ] 列印版面預覽、PDF、Word 輸出一致。
- [ ] `.photojob` 舊 Schema 2 專案可開啟。
- [ ] GitHub Actions Regression gate 為綠色。
- [ ] GitHub Pages 部署成功。
- [ ] 線上版按 `Ctrl + F5` 後顯示正確版本。

## 建議 Commit message

```text
發布 圖片紀錄整理助手 V3.7
```

## 建議 Tag

```text
v3.7.0
```

## 建議 GitHub Release 標題

```text
圖片紀錄整理助手 V3.7｜Case Management & Advanced Annotation Edition
```
