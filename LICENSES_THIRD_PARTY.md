# Third-party licenses — V3.5.1

## JSZip 3.10.1

用途：`.photojob` / DOCX ZIP 封裝與讀取。完整授權資訊依上游套件授權。

## heic-to 1.5.2

用途：瀏覽器無法原生處理、且已通過 V3.5.1 HEIC 安全預檢之靜態 HEIC fallback。完整離線包以 `heic-to/next` Worker build 置於 `vendor/heic-to/heic-to-worker.js`。

V3.5.1 未宣稱 heic-to 1.5.2 底層 libheif 已完成上游安全修補；本程式以 preflight、sequence/generic gate、Worker 隔離與 terminate 作補償控制。
