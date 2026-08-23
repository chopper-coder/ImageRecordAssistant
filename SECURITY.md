# Security

圖片紀錄整理助手以瀏覽器本機處理為原則，不主動將照片上傳至伺服器。

- HEIC 解碼元件於 GitHub Actions 部署時由固定版本 `heic-to 1.5.2` 安裝。
- HEIC fallback 解碼在隔離 Worker 中執行；V3.8 最多同時 3 路，行動裝置固定 1 路。
- HEIC Worker Pool 閒置約 30 秒後會自動終止並釋放記憶體。
- 每張 HEIC 仍先做容器、靜態影像與像素尺寸安全預檢；HEIF/HEIC sequence 仍拒絕處理。
- ZIP 專案功能使用固定版本 `JSZip 3.10.1`。
- 個資遮蔽在輸出流程中烘焙進輸出影像；原始專案仍可能包含未遮蔽來源照片，因此 `.photojob` 應視為敏感資料妥善保管。
- 不要將含真實敏感照片的 `.photojob`、原始照片或測試資料提交到公開 Repository。
