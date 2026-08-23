(() => {
  'use strict';

  if (window.top !== window.self) {
    document.documentElement.innerHTML = '<head><meta charset="utf-8"><title>Blocked</title></head><body>基於安全性，本工具不可嵌入其他網站的框架中。</body>';
    throw new Error('Framed execution blocked');
  }

  const APP_NAME = '圖片紀錄整理助手';
  const APP_VERSION = 'V3.8';
  const PHOTOJOB_SCHEMA_VERSION = 2;
  const HISTORY_LIMIT = 30;
  const SUPPORTED_RE = /\.(jpe?g|png|webp|bmp|heic|heif)$/i;
  const HEIC_RE = /\.(heic|heif)$/i;
  const HEIC_DECODER_VERSION = '1.5.2-restricted';
  const HEIC_WORKER_PATH = './heic-worker.js';
  const HEIC_DECODER_TIMEOUT_MS = 60000;
  const HEIC_JPEG_QUALITY = 0.92;
  const HEIC_NATIVE_PROBE_TIMEOUT_MS = 8000;
  const HEIC_POOL_IDLE_RELEASE_MS = 30000;
  const HEIC_PREFLIGHT_SCAN_BYTES = 2 * 1024 * 1024;
  const MAX_IMAGE_WIDTH = 16000;
  const MAX_IMAGE_HEIGHT = 16000;
  const DEFAULT_MAX_IMAGE_PIXELS = 60_000_000;
  const IMAGE_PREFLIGHT_SCAN_BYTES = 2 * 1024 * 1024;
  const MAX_PROJECT_ARCHIVE_BYTES = 1150 * 1024 * 1024;
  const AUTOSAVE_JOURNAL_KEY = 'ImageRecordAssistantV350.recoveryJournals';
  const LEGACY_V340_AUTOSAVE_JOURNAL_KEY = 'ImageRecordAssistantV340.recoveryJournals';
  const LEGACY_AUTOSAVE_JOURNAL_KEY = 'ImageRecordAssistantV333.recoveryJournal';
  const RECOVERY_GENERATION_LIMIT = 5;
  const AUTOSAVE_DELAY_MS = 250;
  const DB_NAME = 'ImageRecordAssistantV2';
  const DB_VERSION = 1;
  const STORE_NAME = 'autosave';
  const AUTOSAVE_KEY = 'current';
  const CASE_TEMPLATE_KEY = 'ImageRecordAssistantV31.caseTemplates';
  const AUTOSAVE_PREF_KEY = 'ImageRecordAssistantV31.autosaveEnabled';
  const MAX_PHOTOS_HARD = 800;
  const MAX_SINGLE_IMAGE_BYTES = 40 * 1024 * 1024;
  const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 768 * 1024 * 1024;
  const MAX_SAFE_FILENAME_CODEPOINTS = 140;
  const MAX_QUICK_NOTES = 100;
  const MAX_QUICK_NOTE_CHARS = 500;
  const MAX_META_TEXT_CHARS = 1000;
  const MAX_DESCRIPTION_CHARS = 50000;
  const MAX_NOTE_CHARS = 20000;
  const MAX_PROJECT_FIELD_CHARS = 300;
  const MAX_ANNOTATIONS_PER_PHOTO = 100;
  const MAX_ANNOTATION_TEXT_CHARS = 200;
  const THUMB_MAX_EDGE = 180;
  const THUMB_JPEG_QUALITY = 0.78;

  const $ = (id) => document.getElementById(id);
  const state = {
    items: [],
    selected: -1,
    selectedIds: new Set(),
    logo: null,
    quickNotes: ['設備外觀', '設備序號', '安裝位置', '功能測試', '施工前', '施工後', '驗收情形正常'],
    zoom: 1,
    fitMode: true,
    dragIndex: null,
    autosaveTimer: null,
    autosaveFailed: false,
    autosaveLastError: '',
    lastAutosaveAt: null,
    autosaveEnabled: true,
    restoring: false,
    caseTemplates: [],
    pendingExport: null,
    previewUrls: [],
    dirty: false,
    historyUndo: [],
    historyRedo: [],
    historyCurrent: null,
    historyTimer: null,
    lastSavedSignature: null,
    pendingOpenFile: null,
    importRunning: false,
    importCancelRequested: false,
    activeHeicWorker: null,
    activeHeicCancel: null,
    heicPool: null,
    heicPoolGeneration: 0,
    heicPoolIdleTimer: null,
    nativeHeicSupport: null,
    nativeHeicProbePromise: null,
    autosaveInFlight: null,
    activeImageWorker: null,
    activeImageCancel: null,
    healthRunning: false,
    lastHealthResult: null,
    importSequence: 0,
    annotationTool: 'rect',
    annotationDraft: [],
    annotationBaseBlob: null,
    annotationPointer: null,
    annotationTargetId: null,
    annotationSelected: -1,
    annotationMove: null,
    caseArchived: false,
    caseArchivedAt: '',
    thumbObserver: null,
    lastRemovedSnapshot: null,
    toastTimer: null,
    failedImports: [],
    lastImportSummary: null,
    importProgress: { active: false, total: 0, completed: 0, heicTotal: 0, heicDone: 0, failed: 0 },
    };


  function sanitizeAnnotations(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const raw of value.slice(0, MAX_ANNOTATIONS_PER_PHOTO)) {
      if (!isPlainObject(raw)) continue;
      const type = ['rect', 'arrow', 'text', 'blur', 'redact'].includes(raw.type) ? raw.type : '';
      if (!type) continue;
      const clamp01 = (n) => {
        const value = Math.max(0, Math.min(1, Number.isFinite(Number(n)) ? Number(n) : 0));
        return Math.round(value * 1_000_000) / 1_000_000;
      };
      const item = {
        type,
        x1: clamp01(raw.x1), y1: clamp01(raw.y1),
        x2: clamp01(raw.x2), y2: clamp01(raw.y2),
      };
      if (type === 'text') item.text = String(raw.text || '').slice(0, MAX_ANNOTATION_TEXT_CHARS);
      out.push(item);
    }
    return out;
  }

  function annotationCountText(item) {
    const count = sanitizeAnnotations(item?.annotations).length;
    return count ? `已有 ${count} 個註記` : '尚無註記';
  }


  function rotateAnnotations(annotations, delta) {
    const safe = sanitizeAnnotations(annotations);
    const steps = (((Number(delta) || 0) % 360) + 360) % 360;
    const rotatePoint = (x, y) => {
      if (steps === 90) return [1 - y, x];
      if (steps === 180) return [1 - x, 1 - y];
      if (steps === 270) return [y, 1 - x];
      return [x, y];
    };
    return sanitizeAnnotations(safe.map((ann) => {
      const [x1, y1] = rotatePoint(ann.x1, ann.y1);
      const [x2, y2] = rotatePoint(ann.x2, ann.y2);
      return { ...ann, x1, y1, x2, y2 };
    }));
  }

  function renderTopAutosaveBadge() {
    const el = $('autosaveTopBadge');
    if (!el) return;
    if (!state.autosaveEnabled) {
      el.className = 'autosave-top-badge off';
      el.textContent = '💾 自動儲存已停用';
      return;
    }
    if (state.autosaveFailed) {
      el.className = 'autosave-top-badge err';
      el.textContent = '⚠️ 自動儲存失敗';
      return;
    }
    if (state.autosaveInFlight || state.autosaveTimer) {
      el.className = 'autosave-top-badge saving';
      el.textContent = '💾 儲存中…';
      return;
    }
    if (state.lastAutosaveAt instanceof Date && !Number.isNaN(state.lastAutosaveAt.getTime())) {
      el.className = 'autosave-top-badge ok';
      el.textContent = `💾 已儲存 ${state.lastAutosaveAt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`;
      return;
    }
    el.className = 'autosave-top-badge';
    el.textContent = '💾 尚未自動儲存';
  }

  function updateSmartSections() {
    const single = $('singlePhotoSection');
    const batch = $('batchSection');
    if (single && state.selected >= 0 && !single.dataset.userToggled) single.open = true;
    if (batch && state.selectedIds.size >= 2 && !batch.dataset.userToggled) batch.open = true;
  }

  function showActionToast(text, withUndo = false) {
    const toast = $('actionToast');
    if (!toast) return;
    clearTimeout(state.toastTimer);
    $('actionToastText').textContent = text;
    $('actionToastUndoBtn').hidden = !withUndo;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('show'));
    state.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.hidden = true; }, 180);
    }, 5000);
  }

  async function ensureItemThumbBlob(item) {
    if (!item) return null;
    if (item.thumbBlob instanceof Blob) return item.thumbBlob;
    if (item.thumbPromise) return item.thumbPromise;
    item.thumbPromise = (async () => {
      const image = await loadBlobImage(item.blob);
      const sourceW = Math.max(1, Number(image.naturalWidth || image.width || 1));
      const sourceH = Math.max(1, Number(image.naturalHeight || image.height || 1));
      const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(sourceW, sourceH));
      const width = Math.max(1, Math.round(sourceW * scale));
      const height = Math.max(1, Math.round(sourceH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('無法建立縮圖畫布');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, 'image/jpeg', THUMB_JPEG_QUALITY);
      canvas.width = 1;
      canvas.height = 1;
      item.thumbBlob = blob;
      return blob;
    })().finally(() => { item.thumbPromise = null; });
    return item.thumbPromise;
  }

  async function ensureItemThumbUrl(item) {
    if (!item) return '';
    if (item.thumbUrl?.startsWith('blob:')) return item.thumbUrl;
    const thumbBlob = await ensureItemThumbBlob(item);
    if (!(thumbBlob instanceof Blob)) return '';
    // 多個舊/新 DOM 同時等待縮圖時，再檢查一次，避免建立重複 Blob URL。
    if (item.thumbUrl?.startsWith('blob:')) return item.thumbUrl;
    item.thumbUrl = URL.createObjectURL(thumbBlob);
    return item.thumbUrl;
  }

  function releaseItemThumbUrl(item, dropCache = false) {
    if (!item) return;
    if (item.thumbUrl?.startsWith('blob:')) {
      try { URL.revokeObjectURL(item.thumbUrl); } catch (_) {}
      item.thumbUrl = '';
    }
    if (dropCache) {
      item.thumbBlob = null;
      item.thumbPromise = null;
    }
  }

  function resetThumbnailObserver({ releaseUrls = false, dropCache = false } = {}) {
    try { state.thumbObserver?.disconnect(); } catch (_) {}
    state.thumbObserver = null;
    if (releaseUrls || dropCache) state.items.forEach((item) => releaseItemThumbUrl(item, dropCache));
  }

  async function loadThumbnailTarget(target, photo) {
    if (!target || !photo || target.dataset.thumbLoading === '1') return;
    target.dataset.thumbLoading = '1';
    try {
      const url = await ensureItemThumbUrl(photo);
      if (!target.isConnected || target.dataset.photoId !== photo.id) return;
      if (url && target.src !== url) target.src = url;
    } catch (error) {
      console.warn('Thumbnail generation failed', photo.originalName || photo.displayName || photo.id, error);
    } finally {
      if (target?.dataset) delete target.dataset.thumbLoading;
    }
  }

  function observeLazyThumbnail(img, item) {
    if (!img || !item) return;
    img.dataset.photoId = item.id;
    if (typeof IntersectionObserver !== 'function') {
      loadThumbnailTarget(img, item);
      return;
    }
    if (!state.thumbObserver) {
      state.thumbObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const target = entry.target;
          const id = target?.dataset?.photoId || '';
          const photo = state.items.find((candidate) => candidate.id === id);
          if (!photo) continue;
          if (entry.isIntersecting) {
            if (!target.src) loadThumbnailTarget(target, photo);
          } else if (target.src) {
            // 只釋放可視 DOM 的 URL；真正的小縮圖 Blob 保留在記憶體快取，避免再次解碼原始大圖。
            target.removeAttribute('src');
            releaseItemThumbUrl(photo, false);
          }
        }
      }, { root: $('photoList'), rootMargin: '360px 0px', threshold: 0.01 });
    }
    state.thumbObserver.observe(img);
  }

  function librariesReady() {
    return Boolean(window.JSZip);
  }

  function setStatus(text, kind = '') {
    const el = $('status');
    el.textContent = text;
    el.className = `status ${kind}`.trim();
  }

  function localDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function localDateTimeString(date = new Date()) {
    try {
      return new Intl.DateTimeFormat('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(date);
    } catch (_) {
      return date.toLocaleString();
    }
  }

  function deviceMemoryGb() {
    const value = Number(navigator.deviceMemory || 0);
    return Number.isFinite(value) && value > 0 ? value : 4;
  }

  function memoryModeForDevice() {
    const gb = deviceMemoryGb();
    // 專案容量指的是「壓縮後圖片 Blob」總量，不等於所有圖片同時解碼進 RAM。
    // V3.7 的 120/200/300 MB 上限會讓一般手機照片約 60–80 張就停止匯入。
    // V3.7.2 延續小縮圖快取，並依裝置記憶體限制 HEIC 平行 Worker 數，避免用速度換取失控 RAM。
    if (gb <= 2) return { id: 'low', label: '低記憶體模式', maxPixels: 24_000_000, maxTotalBytes: 512 * 1024 * 1024, maxPhotos: 250 };
    if (gb <= 4) return { id: 'standard', label: '標準模式', maxPixels: 40_000_000, maxTotalBytes: 768 * 1024 * 1024, maxPhotos: 500 };
    return { id: 'performance', label: '高效能模式', maxPixels: DEFAULT_MAX_IMAGE_PIXELS, maxTotalBytes: 1024 * 1024 * 1024, maxPhotos: MAX_PHOTOS_HARD };
  }

  function maxImagePixelsForDevice() { return memoryModeForDevice().maxPixels; }

  function maxTotalImageBytesForDevice() { return memoryModeForDevice().maxTotalBytes; }

  function maxPhotosForDevice() { return memoryModeForDevice().maxPhotos; }

  function renderMemoryMode() {
    const el = $('memoryModeBadge');
    if (!el) return;
    const mode = memoryModeForDevice();
    el.textContent = `${mode.label}｜照片 ${mode.maxPhotos} 張｜單圖約 ${Math.round(mode.maxPixels / 1_000_000)} MP｜專案 ${formatMiB(mode.maxTotalBytes)}｜HEIC ${heicPoolSizeForDevice()} 路解碼`;
  }

  function formatMiB(bytes) {
    return `${Math.round(Number(bytes || 0) / 1024 / 1024)} MB`;
  }

  function projectBlobBytes() {
    return state.items.reduce((sum, item) => sum + Number(item.blob?.size || 0), 0);
  }

  function exportCandidateIndices(meta = null) {
    const scope = String(meta?.export_scope || $('exportScope')?.value || 'included');
    const selected = state.selectedIds;
    const out = [];
    state.items.forEach((item, index) => {
      if (item.excludeExport) return;
      if (scope === 'selected' && !selected.has(item.id)) return;
      out.push(index);
    });
    return out;
  }

  function renderExportScopeStatus() {
    const el = $('exportScopeStatus');
    if (!el) return;
    const count = exportCandidateIndices().length;
    const excluded = state.items.filter((item) => item.excludeExport).length;
    const scope = $('exportScope')?.value || 'included';
    el.textContent = scope === 'selected'
      ? `將輸出 ${count} 張已勾選照片${excluded ? `｜另有 ${excluded} 張標記不輸出` : ''}`
      : `將輸出 ${count} 張${excluded ? `｜已排除 ${excluded} 張` : ''}`;
  }

  function renderLargeProjectMonitor() {
    const ramText = $('ramStatusText');
    const ramFill = $('ramMeterFill');
    const importText = $('importProgressText');
    const failureText = $('importFailureText');
    const retryBtn = $('retryFailedImportsBtn');
    const projectBytes = projectBlobBytes();
    const safeLimit = Math.max(1, maxTotalImageBytesForDevice());
    let ratio = projectBytes / safeLimit;
    let text = `專案圖片 ${formatMiB(projectBytes)} / ${formatMiB(safeLimit)}`;
    const memory = performance?.memory;
    if (memory && Number(memory.jsHeapSizeLimit) > 0) {
      const used = Number(memory.usedJSHeapSize || 0), limit = Number(memory.jsHeapSizeLimit || 1);
      ratio = Math.max(ratio, used / limit);
      text += `｜JS Heap ${formatMiB(used)} / ${formatMiB(limit)}`;
    }
    if (ramText) ramText.textContent = `RAM：${text}`;
    if (ramFill) ramFill.style.width = `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;
    const progress = state.importProgress || {};
    if (importText) {
      if (progress.active) importText.textContent = `匯入中 ${progress.completed || 0} / ${progress.total || 0}｜HEIC ${progress.heicDone || 0} / ${progress.heicTotal || 0}`;
      else if (state.lastImportSummary) {
        const x = state.lastImportSummary;
        importText.textContent = `最近匯入：成功 ${x.accepted || 0}｜HEIC ${x.heic || 0}｜略過 ${x.skipped || 0}`;
      } else importText.textContent = '最近匯入：尚無紀錄';
    }
    if (failureText) failureText.textContent = `失敗 ${state.failedImports.length} 張`;
    if (retryBtn) retryBtn.disabled = !state.failedImports.length || state.importRunning;
    renderExportScopeStatus();
  }


  function capturedAtEpoch(value) {
    const t = Date.parse(String(value || ''));
    return Number.isFinite(t) ? t : null;
  }

  function formatCapturedAt(value) {
    const epoch = capturedAtEpoch(value);
    if (epoch === null) return '未知';
    return localDateTimeString(new Date(epoch));
  }

  function folderInfoFromFile(file, overridePath = '') {
    const relativePath = String(overridePath || file?.webkitRelativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = relativePath.split('/').filter(Boolean);
    const parentParts = parts.length > 1 ? parts.slice(0, -1) : [];
    return {
      relativePath,
      sourceFolder: parentParts.join('/').slice(0, MAX_META_TEXT_CHARS),
      suggestedLocation: (parentParts.at(-1) || '').slice(0, MAX_PROJECT_FIELD_CHARS),
    };
  }

  function nextImportOrder() {
    const max = state.items.reduce((value, item) => Math.max(value, Number(item.importOrder || 0)), state.importSequence || 0);
    state.importSequence = max + 1;
    return state.importSequence;
  }

  function healthScore(result) {
    if (!result) return null;
    return Math.max(0, 100 - Number(result.errors?.length || 0) * 20 - Math.min(40, Number(result.warnings?.length || 0) * 4));
  }

  function renderDashboard() {
    const host = $('projectDashboard');
    if (!host) return;
    const totalBytes = state.items.reduce((sum, item) => sum + Number(item.blob?.size || 0), 0);
    const metaLocation = String($('location')?.value || '').trim();
    const missingDesc = state.items.filter((item) => !String(item.description || '').trim()).length;
    const missingLocation = state.items.filter((item) => !String(item.location || '').trim() && !metaLocation).length;
    const heic = state.items.filter((item) => /hei[cf]/i.test(String(item.sourceFormat || ''))).length;
    const gps = state.items.filter((item) => item.privacy?.hasGps).length;
    const score = healthScore(state.lastHealthResult);
    const cards = [
      ['照片', String(state.items.length), ''],
      ['容量', formatMiB(totalBytes), totalBytes > maxTotalImageBytesForDevice() * 0.8 ? 'warn' : ''],
      ['缺說明', String(missingDesc), missingDesc ? 'warn' : 'good'],
      ['缺地點', String(missingLocation), missingLocation ? 'warn' : 'good'],
      ['HEIC/HEIF', String(heic), ''],
      ['GPS', String(gps), gps ? 'warn' : 'good'],
    ];
    if (score !== null) cards.push(['健康度', `${score}%`, score >= 90 ? 'good' : score >= 70 ? 'warn' : 'bad']);
    host.innerHTML = '';
    for (const [label, value, cls] of cards) {
      const card = createEl('div', `dash-card ${cls}`.trim());
      card.append(createEl('div', 'dash-value', value), createEl('div', 'dash-label', label));
      host.appendChild(card);
    }
    renderLargeProjectMonitor();
  }

  function sortPhotos(mode) {
    if (!state.items.length || mode === 'manual') return;
    const selectedId = state.items[state.selected]?.id || '';
    const withIndex = state.items.map((item, index) => ({ item, index }));
    const stable = (compare) => withIndex.sort((a, b) => compare(a.item, b.item) || a.index - b.index);
    if (mode === 'import') stable((a, b) => Number(a.importOrder || 0) - Number(b.importOrder || 0));
    else if (mode === 'name') stable((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'zh-Hant', { numeric: true, sensitivity: 'base' }));
    else if (mode === 'timeAsc' || mode === 'timeDesc') {
      stable((a, b) => {
        const ta = capturedAtEpoch(a.capturedAt), tb = capturedAtEpoch(b.capturedAt);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return mode === 'timeAsc' ? ta - tb : tb - ta;
      });
    }
    state.items = withIndex.map((entry) => entry.item);
    state.selected = Math.max(0, state.items.findIndex((item) => item.id === selectedId));
    renderList(); showSelected();
    setStatus(`已完成${mode === 'import' ? '匯入順序' : mode === 'name' ? '檔名' : '拍攝時間'}排序。`, 'ok');
    scheduleAutosave();
  }

  function renderAutosaveHealth() {
    const el = $('autosaveHealth');
    if (!el) return;
    if (!state.autosaveEnabled) {
      el.className = 'autosave-health off';
      el.textContent = '自動儲存：已停用。請定期手動儲存 .photojob。';
      renderTopAutosaveBadge();
      return;
    }
    const last = state.lastAutosaveAt instanceof Date && !Number.isNaN(state.lastAutosaveAt.getTime())
      ? `｜最後成功：${localDateTimeString(state.lastAutosaveAt)}` : '｜尚無成功紀錄';
    if (state.autosaveFailed) {
      el.className = 'autosave-health err';
      el.textContent = `⚠ 自動儲存失敗${last}｜${state.autosaveLastError || '請立即手動儲存 .photojob。'}`;
      renderTopAutosaveBadge();
      return;
    }
    el.className = 'autosave-health ok';
    el.textContent = `自動儲存：正常${last}`;
    renderTopAutosaveBadge();
  }

  function showLoading(title, text = '請稍候，不要關閉分頁。', options = {}) {
    $('loadingTitle').textContent = title;
    $('loadingText').textContent = text;
    const cancelBtn = $('loadingCancelBtn');
    if (cancelBtn) {
      cancelBtn.hidden = !options.cancelable;
      cancelBtn.disabled = false;
      cancelBtn.textContent = '停止後續匯入';
    }
    const progress = $('loadingProgress');
    if (progress) {
      progress.hidden = !options.progress;
      progress.value = 0;
      progress.max = 100;
    }
    $('loadingMask').classList.add('show');
  }

  function updateLoadingProgress(current, total) {
    const progress = $('loadingProgress');
    if (!progress || !total) return;
    progress.hidden = false;
    progress.value = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  }

  function hideLoading() {
    $('loadingMask').classList.remove('show');
    const cancelBtn = $('loadingCancelBtn');
    if (cancelBtn) { cancelBtn.hidden = true; cancelBtn.disabled = false; cancelBtn.textContent = '停止後續匯入'; }
    const progress = $('loadingProgress');
    if (progress) { progress.hidden = true; progress.value = 0; }
  }

  function uid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function defaultCrop() {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  function clampCrop(crop) {
    const c = { ...defaultCrop(), ...(crop || {}) };
    for (const k of ['left', 'top', 'right', 'bottom']) {
      c[k] = Math.max(0, Math.min(85, Number(c[k] || 0)));
    }
    if (c.left + c.right > 90) c.right = Math.max(0, 90 - c.left);
    if (c.top + c.bottom > 90) c.bottom = Math.max(0, 90 - c.top);
    return c;
  }

  function truncateCodePoints(value, max) {
    const chars = Array.from(String(value || ''));
    return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
  }

  function safeFilename(name, fallback = '照片紀錄表') {
    let cleaned = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim().replace(/[. ]+$/g, '');
    if (!cleaned) cleaned = String(fallback || '照片紀錄表').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim().replace(/[. ]+$/g, '') || '照片紀錄表';
    const parts = splitNameExt(cleaned);
    const windowsStem = parts.stem.replace(/[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(windowsStem)) cleaned = `_${cleaned}`;
    if (Array.from(cleaned).length > MAX_SAFE_FILENAME_CODEPOINTS) {
      const current = splitNameExt(cleaned);
      const extChars = Array.from(current.ext);
      const stemBudget = Math.max(1, MAX_SAFE_FILENAME_CODEPOINTS - extChars.length);
      cleaned = `${truncateCodePoints(current.stem, stemBudget)}${current.ext}`;
    }
    cleaned = cleaned.replace(/[. ]+$/g, '');
    return cleaned || '照片紀錄表';
  }

  function mimeFromName(name) {
    const ext = splitNameExt(name).ext.toLowerCase();
    return ({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.bmp':'image/bmp','.heic':'image/heic','.heif':'image/heif','.gif':'image/gif','.svg':'image/svg+xml'})[ext] || 'application/octet-stream';
  }

  function splitNameExt(name) {
    const value = String(name || '');
    const idx = value.lastIndexOf('.');
    if (idx > 0) return { stem: value.slice(0, idx), ext: value.slice(idx) };
    return { stem: value, ext: '' };
  }

  function buildDisplayName(raw, originalName) {
    const original = safeFilename(originalName, 'photo.jpg');
    const o = splitNameExt(original);
    const cleaned = safeFilename(raw, original);
    const e = splitNameExt(cleaned);
    return `${e.stem || o.stem || '照片'}${e.ext || o.ext || '.jpg'}`;
  }

  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('檔案讀取失敗'));
      reader.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(dataUrl) {
    const [head, body] = String(dataUrl).split(',');
    const mime = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
    const bytes = atob(body || '');
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) out[i] = bytes.charCodeAt(i);
    return new Blob([out], { type: mime });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('圖片無法讀取'));
      img.src = src;
    });
  }

  async function loadBlobImage(blob) {
    const url = URL.createObjectURL(blob);
    try { return await loadImage(url); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  }

  function ensureItemPreviewUrl(item) {
    if (!item) return '';
    if (!item.previewUrl || !item.previewUrl.startsWith('blob:')) item.previewUrl = URL.createObjectURL(item.blob);
    return item.previewUrl;
  }

  function releaseInactivePreviewUrls(keepId = null) {
    for (const item of state.items) {
      if (item.id === keepId) continue;
      if (item.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
        item.previewUrl = '';
      }
    }
  }

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.94) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('圖片轉換失敗')), type, quality);
    });
  }

  function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    ]).finally(() => clearTimeout(timer));
  }

  function terminateActiveImageWorker(reason = '圖片處理已取消。') {
    const cancel = state.activeImageCancel;
    if (typeof cancel === 'function') { cancel(new Error(reason)); return; }
    if (!state.activeImageWorker) return;
    try { state.activeImageWorker.terminate(); } catch (_) {}
    state.activeImageWorker = null;
  }

  async function processImageInWorker(item, maxDim, quality) {
    if (typeof Worker !== 'function' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('Image Worker unsupported');
    terminateActiveImageWorker();
    const worker = new Worker('./image-worker.js', { type: 'module', name: 'IRA-Image-Processor' });
    state.activeImageWorker = worker;
    return await new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (state.activeImageWorker === worker) state.activeImageWorker = null;
        if (state.activeImageCancel === cancelCurrent) state.activeImageCancel = null;
        try { worker.terminate(); } catch (_) {}
        fn(value);
      };
      const cancelCurrent = (error) => finish(reject, error instanceof Error ? error : new Error(String(error || '圖片處理已取消。')));
      state.activeImageCancel = cancelCurrent;
      timer = setTimeout(() => finish(reject, new Error('圖片 Worker 處理逾時，已強制終止。')), 60000);
      worker.onmessage = (event) => {
        const data = event.data || {};
        if (data.ok && data.blob instanceof Blob) finish(resolve, { blob: data.blob, width: data.width, height: data.height });
        else finish(reject, new Error(data.error || '圖片 Worker 處理失敗。'));
      };
      worker.onerror = () => finish(reject, new Error('圖片 Worker 執行失敗。'));
      worker.postMessage({ blob: item.blob, crop: clampCrop(item.crop), rotation: Number(item.rotation || 0), maxDim, quality });
    });
  }

  async function processImageFallback(item, maxDim = 2200, quality = 0.92) {
    const img = await loadBlobImage(item.blob);
    const c = clampCrop(item.crop);
    const sx = Math.round(img.naturalWidth * c.left / 100);
    const sy = Math.round(img.naturalHeight * c.top / 100);
    const sw = Math.max(1, Math.round(img.naturalWidth * (100 - c.left - c.right) / 100));
    const sh = Math.max(1, Math.round(img.naturalHeight * (100 - c.top - c.bottom) / 100));
    const rotation = ((Number(item.rotation || 0) % 360) + 360) % 360;
    const swap = rotation === 90 || rotation === 270;
    const rawW = swap ? sh : sw;
    const rawH = swap ? sw : sh;
    const scale = Math.min(1, maxDim / Math.max(rawW, rawH));
    const outW = Math.max(1, Math.round(rawW * scale));
    const outH = Math.max(1, Math.round(rawH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(rotation * Math.PI / 180);
    const drawW = sw * scale;
    const drawH = sh * scale;
    ctx.drawImage(img, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    canvas.width = 1; canvas.height = 1;
    if (!blob) throw new Error('圖片轉換失敗');
    return { blob, width: outW, height: outH };
  }

  async function processImage(item, maxDim = 2200, quality = 0.92) {
    let processed;
    try { processed = await processImageInWorker(item, maxDim, quality); }
    catch (error) {
      const message = String(error?.message || '');
      if (/逾時|取消/.test(message)) throw error;
      if (!/unsupported/i.test(message)) console.warn('Image worker fallback', error);
      processed = await processImageFallback(item, maxDim, quality);
    }
    return applyAnnotationsToProcessed(processed, item.annotations, quality);
  }


  function drawArrow(ctx, x1, y1, x2, y2, color = '#ff477e', width = 7) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(14, width * 3);
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function pixelateCanvasRegion(ctx, x, y, w, h) {
    const sx = Math.max(0, Math.floor(Math.min(x, x + w)));
    const sy = Math.max(0, Math.floor(Math.min(y, y + h)));
    const sw = Math.max(1, Math.floor(Math.abs(w)));
    const sh = Math.max(1, Math.floor(Math.abs(h)));
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const rw = Math.min(sw, cw - sx), rh = Math.min(sh, ch - sy);
    if (rw <= 1 || rh <= 1) return;
    const tiny = document.createElement('canvas');
    tiny.width = Math.max(4, Math.min(24, Math.round(rw / 18)));
    tiny.height = Math.max(4, Math.min(24, Math.round(rh / 18)));
    const tctx = tiny.getContext('2d', { alpha: false });
    tctx.drawImage(ctx.canvas, sx, sy, rw, rh, 0, 0, tiny.width, tiny.height);
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, sx, sy, rw, rh);
    ctx.strokeStyle = 'rgba(255,71,126,.75)'; ctx.lineWidth = Math.max(2, Math.round(Math.min(cw, ch) / 300)); ctx.strokeRect(sx, sy, rw, rh);
    ctx.restore(); tiny.width = 1; tiny.height = 1;
  }

  function drawAnnotationList(ctx, annotations, width, height) {
    const list = sanitizeAnnotations(annotations);
    const lineWidth = Math.max(4, Math.round(Math.min(width, height) / 180));
    for (const ann of list) {
      const x1 = ann.x1 * width, y1 = ann.y1 * height, x2 = ann.x2 * width, y2 = ann.y2 * height;
      if (ann.type === 'blur') {
        pixelateCanvasRegion(ctx, x1, y1, x2 - x1, y2 - y1);
      } else if (ann.type === 'redact') {
        const rx = Math.min(x1, x2), ry = Math.min(y1, y2), rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
        ctx.save(); ctx.fillStyle = '#111111'; ctx.fillRect(rx, ry, rw, rh); ctx.restore();
      } else if (ann.type === 'rect') {
        ctx.save(); ctx.strokeStyle = '#ff477e'; ctx.lineWidth = lineWidth; ctx.setLineDash([]);
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); ctx.restore();
      } else if (ann.type === 'arrow') {
        drawArrow(ctx, x1, y1, x2, y2, '#ff477e', lineWidth);
      } else if (ann.type === 'text' && ann.text) {
        const fontSize = Math.max(18, Math.round(Math.min(width, height) / 28));
        ctx.save(); ctx.font = `700 ${fontSize}px "Microsoft JhengHei",sans-serif`; ctx.textBaseline = 'top';
        const pad = Math.max(6, Math.round(fontSize * .28));
        const text = String(ann.text).slice(0, MAX_ANNOTATION_TEXT_CHARS);
        const tw = Math.min(width - x1 - 2, ctx.measureText(text).width + pad * 2);
        ctx.fillStyle = 'rgba(255,255,255,.90)'; ctx.fillRect(x1, y1, Math.max(30, tw), fontSize + pad * 2);
        ctx.strokeStyle = '#ff477e'; ctx.lineWidth = Math.max(2, lineWidth / 2); ctx.strokeRect(x1, y1, Math.max(30, tw), fontSize + pad * 2);
        ctx.fillStyle = '#b91c5c'; ctx.fillText(text, x1 + pad, y1 + pad); ctx.restore();
      }
    }
  }

  async function applyAnnotationsToProcessed(processed, annotations, quality = 0.92) {
    const safe = sanitizeAnnotations(annotations);
    if (!safe.length) return processed;
    const img = await loadBlobImage(processed.blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || processed.width; canvas.height = img.naturalHeight || processed.height;
    const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawAnnotationList(ctx, safe, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    const out = { blob, width: canvas.width, height: canvas.height };
    canvas.width = 1; canvas.height = 1;
    return out;
  }


  function annotationCanvasPoint(event) {
    const canvas = $('annotationCanvas');
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  }

  function annotationBounds(ann) {
    const x1 = Math.min(ann.x1, ann.x2), y1 = Math.min(ann.y1, ann.y2);
    let x2 = Math.max(ann.x1, ann.x2), y2 = Math.max(ann.y1, ann.y2);
    if (ann.type === 'text') { x2 = Math.min(1, ann.x1 + .32); y2 = Math.min(1, ann.y1 + .10); }
    return { x1, y1, x2, y2 };
  }

  function annotationHitTest(point) {
    const list = state.annotationDraft;
    const pad = .018;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const ann = list[i];
      const b = annotationBounds(ann);
      if (point.x >= b.x1 - pad && point.x <= b.x2 + pad && point.y >= b.y1 - pad && point.y <= b.y2 + pad) return i;
    }
    return -1;
  }

  function moveAnnotationBy(ann, dx, dy) {
    const b = annotationBounds(ann);
    dx = Math.max(-b.x1, Math.min(1 - b.x2, dx));
    dy = Math.max(-b.y1, Math.min(1 - b.y2, dy));
    return sanitizeAnnotations([{ ...ann, x1: ann.x1 + dx, y1: ann.y1 + dy, x2: ann.x2 + dx, y2: ann.y2 + dy }])[0] || ann;
  }

  function drawAnnotationSelection(ctx, ann, width, height) {
    if (!ann) return;
    const b = annotationBounds(ann);
    ctx.save();
    ctx.strokeStyle = '#29a3c7'; ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 260));
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(b.x1 * width, b.y1 * height, Math.max(3, (b.x2 - b.x1) * width), Math.max(3, (b.y2 - b.y1) * height));
    ctx.restore();
  }

  function renderAnnotationCanvas(preview = null) {
    const canvas = $('annotationCanvas');
    const img = state.annotationBaseImage;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawAnnotationList(ctx, state.annotationDraft, canvas.width, canvas.height);
    if (preview) drawAnnotationList(ctx, [preview], canvas.width, canvas.height);
    if (state.annotationSelected >= 0) drawAnnotationSelection(ctx, state.annotationDraft[state.annotationSelected], canvas.width, canvas.height);
    if ($('annotationSelectionStatus')) $('annotationSelectionStatus').textContent = state.annotationSelected >= 0 ? `已選取第 ${state.annotationSelected + 1} 個註記` : '尚未選取註記';
  }

  function setAnnotationTool(tool) {
    state.annotationTool = tool;
    if ($('annotationCanvas')) $('annotationCanvas').dataset.selectMode = tool === 'select' ? '1' : '0';
    if (tool !== 'select') state.annotationSelected = -1;
    document.querySelectorAll('[data-annotation-tool]').forEach((btn) => btn.classList.toggle('active', btn.dataset.annotationTool === tool));
    const help = {
      select: '點選既有註記可選取，拖曳可移動；文字註記可雙擊修改。',
      rect: '拖曳畫出粉紅色框選範圍。',
      arrow: '從起點拖到終點畫箭頭。',
      text: '在照片上點一下，再輸入文字。',
      blur: '拖曳選取要馬賽克的區域。',
      redact: '拖曳建立不可逆純色遮蔽；輸出 Word/PDF 時會直接烘焙進影像。',
    };
    $('annotationHelp').textContent = help[tool] || '';
    renderAnnotationCanvas();
  }

  async function openAnnotationEditor() {
    if (state.selected < 0 || !state.items[state.selected]) return;
    const item = state.items[state.selected];
    showLoading('正在準備照片註記…', '建立安全的編輯預覽。');
    try {
      const baseItem = { ...item, annotations: [] };
      state.annotationTargetId = item.id;
      const processed = await (async () => {
        try { return await processImageInWorker(baseItem, 1800, 0.94); }
        catch (error) {
          const message = String(error?.message || '');
          if (/逾時|取消/.test(message)) throw error;
          return processImageFallback(baseItem, 1800, 0.94);
        }
      })();
      state.annotationBaseBlob = processed.blob;
      state.annotationBaseImage = await loadBlobImage(processed.blob);
      state.annotationDraft = sanitizeAnnotations(item.annotations);
      state.annotationSelected = -1;
      state.annotationMove = null;
      const maxW = 1200, maxH = 760;
      const fit = fitDimensions(state.annotationBaseImage.naturalWidth, state.annotationBaseImage.naturalHeight, maxW, maxH);
      const canvas = $('annotationCanvas'); canvas.width = fit.width; canvas.height = fit.height;
      setAnnotationTool('select'); renderAnnotationCanvas();
      $('annotationModal').classList.add('show');
    } catch (error) {
      state.annotationTargetId = null;
      setStatus(`註記工具開啟失敗：${error.message}`, 'err');
    } finally { hideLoading(); }
  }

  function closeAnnotationEditor() {
    state.annotationPointer = null;
    state.annotationMove = null;
    state.annotationSelected = -1;
    state.annotationTargetId = null;
    state.annotationBaseBlob = null;
    if (state.annotationBaseImage) {
      try { state.annotationBaseImage.src = ''; } catch (_) {}
    }
    state.annotationBaseImage = null;
    state.annotationDraft = [];
    const canvas = $('annotationCanvas');
    if (canvas) { canvas.width = 1; canvas.height = 1; }
    $('annotationModal').classList.remove('show');
  }

  function beginAnnotationPointer(event) {
    if (!state.annotationBaseImage || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const point = annotationCanvasPoint(event);
    if (state.annotationTool === 'select') {
      const hit = annotationHitTest(point);
      state.annotationSelected = hit;
      if (hit >= 0) state.annotationMove = { id: event.pointerId, start: point, original: { ...state.annotationDraft[hit] } };
      try { $('annotationCanvas').setPointerCapture?.(event.pointerId); } catch (_) {}
      renderAnnotationCanvas(); event.preventDefault(); return;
    }
    if (state.annotationTool === 'text') {
      const text = prompt('請輸入要顯示在照片上的文字（最多 200 字）：', '');
      if (text && text.trim()) {
        state.annotationDraft.push({ type: 'text', x1: point.x, y1: point.y, x2: point.x, y2: point.y, text: text.trim().slice(0, MAX_ANNOTATION_TEXT_CHARS) });
        state.annotationSelected = state.annotationDraft.length - 1;
        setAnnotationTool('select');
      }
      return;
    }
    state.annotationPointer = { id: event.pointerId, start: point, current: point, tool: state.annotationTool };
    try { $('annotationCanvas').setPointerCapture?.(event.pointerId); } catch (_) {}
    event.preventDefault();
  }

  function moveAnnotationPointer(event) {
    if (state.annotationMove?.id === event.pointerId && state.annotationSelected >= 0) {
      const point = annotationCanvasPoint(event), move = state.annotationMove;
      state.annotationDraft[state.annotationSelected] = moveAnnotationBy(move.original, point.x - move.start.x, point.y - move.start.y);
      renderAnnotationCanvas(); event.preventDefault(); return;
    }
    const pointer = state.annotationPointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointer.current = annotationCanvasPoint(event);
    renderAnnotationCanvas({ type: pointer.tool, x1: pointer.start.x, y1: pointer.start.y, x2: pointer.current.x, y2: pointer.current.y });
  }

  function endAnnotationPointer(event) {
    if (state.annotationMove?.id === event.pointerId) {
      try { $('annotationCanvas').releasePointerCapture?.(event.pointerId); } catch (_) {}
      state.annotationMove = null; renderAnnotationCanvas(); return;
    }
    const pointer = state.annotationPointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointer.current = annotationCanvasPoint(event);
    const dx = Math.abs(pointer.current.x - pointer.start.x), dy = Math.abs(pointer.current.y - pointer.start.y);
    if (dx > .008 || dy > .008) {
      state.annotationDraft.push({ type: pointer.tool, x1: pointer.start.x, y1: pointer.start.y, x2: pointer.current.x, y2: pointer.current.y });
      state.annotationSelected = state.annotationDraft.length - 1;
      setAnnotationTool('select');
    }
    try { $('annotationCanvas').releasePointerCapture?.(event.pointerId); } catch (_) {}
    state.annotationPointer = null; renderAnnotationCanvas();
  }

  function cancelAnnotationPointer(event) {
    if (state.annotationMove?.id === event.pointerId) {
      if (state.annotationSelected >= 0) state.annotationDraft[state.annotationSelected] = state.annotationMove.original;
      state.annotationMove = null;
      try { $('annotationCanvas').releasePointerCapture?.(event.pointerId); } catch (_) {}
      renderAnnotationCanvas(); return;
    }
    const pointer = state.annotationPointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    try { $('annotationCanvas').releasePointerCapture?.(event.pointerId); } catch (_) {}
    state.annotationPointer = null;
    renderAnnotationCanvas();
  }

  function deleteSelectedAnnotation() {
    if (state.annotationSelected < 0 || !state.annotationDraft[state.annotationSelected]) return;
    state.annotationDraft.splice(state.annotationSelected, 1);
    state.annotationSelected = Math.min(state.annotationSelected, state.annotationDraft.length - 1);
    renderAnnotationCanvas();
  }

  function editSelectedAnnotationText() {
    const ann = state.annotationDraft[state.annotationSelected];
    if (!ann || ann.type !== 'text') return;
    const value = prompt('修改文字註記：', ann.text || '');
    if (value === null) return;
    const text = value.trim().slice(0, MAX_ANNOTATION_TEXT_CHARS);
    if (!text) return deleteSelectedAnnotation();
    ann.text = text; renderAnnotationCanvas();
  }

  async function applyOutputWatermark(processed, meta) {
    if (!meta?.watermark_enabled) return processed;
    const text = String(meta.watermark_text || meta.case_no || '僅供內部使用').trim().slice(0, 120);
    if (!text) return processed;
    const img = await loadBlobImage(processed.blob);
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth || processed.width; canvas.height = img.naturalHeight || processed.height;
    const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const fontSize = Math.max(18, Math.round(Math.min(canvas.width, canvas.height) / 24));
    ctx.save(); ctx.globalAlpha = .58; ctx.font = `700 ${fontSize}px "Microsoft JhengHei",sans-serif`; ctx.textBaseline = 'bottom';
    const pad = Math.max(10, Math.round(fontSize * .45)); const tw = ctx.measureText(text).width;
    const x = Math.max(pad, canvas.width - tw - pad * 2), y = canvas.height - pad;
    ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.fillRect(x - pad / 2, y - fontSize - pad / 2, Math.min(canvas.width - x + pad / 2, tw + pad), fontSize + pad);
    ctx.fillStyle = '#5b3d51'; ctx.fillText(text, x, y); ctx.restore();
    const blob = await canvasToBlob(canvas, 'image/jpeg', .92); const out = { blob, width: canvas.width, height: canvas.height };
    canvas.width = 1; canvas.height = 1; return out;
  }

  async function processOutputImage(item, maxDim, quality, meta) {
    const processed = await processImage(item, maxDim, quality);
    return applyOutputWatermark(processed, meta);
  }

  function hammingDistanceHex(a, b) {
    if (!/^[0-9a-f]{16}$/i.test(String(a || '')) || !/^[0-9a-f]{16}$/i.test(String(b || ''))) return 64;
    const pop = [0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
    let distance = 0;
    for (let i = 0; i < 16; i += 1) distance += pop[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
    return distance;
  }

  async function analyzeImageInWorker(item) {
    if (typeof Worker !== 'function' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('Image Worker unsupported');
    terminateActiveImageWorker();
    const worker = new Worker('./image-worker.js', { type: 'module', name: 'IRA-Image-Analyzer' });
    state.activeImageWorker = worker;
    return await new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (state.activeImageWorker === worker) state.activeImageWorker = null;
        if (state.activeImageCancel === cancelCurrent) state.activeImageCancel = null;
        try { worker.terminate(); } catch (_) {}
        fn(value);
      };
      const cancelCurrent = (error) => finish(reject, error instanceof Error ? error : new Error(String(error || '圖片分析已取消。')));
      state.activeImageCancel = cancelCurrent;
      timer = setTimeout(() => finish(reject, new Error('圖片品質分析逾時，已強制終止。')), 30000);
      worker.onmessage = (event) => {
        const data = event.data || {};
        if (data.ok && data.mode === 'analyze' && data.analysis) finish(resolve, data.analysis);
        else finish(reject, new Error(data.error || '圖片品質分析失敗。'));
      };
      worker.onerror = () => finish(reject, new Error('圖片分析 Worker 執行失敗。'));
      worker.postMessage({ mode: 'analyze', blob: item.blob });
    });
  }

  async function analyzeImageFallback(item) {
    const img = await loadBlobImage(item.blob);
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) throw new Error('此瀏覽器無法建立照片分析畫布。');
    ctx.drawImage(img, 0, 0, 64, 64);
    const pixels = ctx.getImageData(0, 0, 64, 64).data;
    const lum = new Float32Array(4096);
    let sum = 0;
    for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) { const v = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000; lum[p] = v; sum += v; }
    const mean = sum / lum.length;
    let varianceSum = 0, edgeSum = 0, edgeCount = 0;
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
      const idx = y * 64 + x, d = lum[idx] - mean; varianceSum += d * d;
      if (x < 63) { edgeSum += Math.abs(lum[idx] - lum[idx + 1]); edgeCount += 1; }
      if (y < 63) { edgeSum += Math.abs(lum[idx] - lum[idx + 64]); edgeCount += 1; }
    }
    const hashCanvas = document.createElement('canvas'); hashCanvas.width = 9; hashCanvas.height = 8;
    const hctx = hashCanvas.getContext('2d', { alpha: false, willReadFrequently: true, colorSpace: 'srgb' });
    hctx.drawImage(img, 0, 0, 9, 8);
    const hp = hctx.getImageData(0, 0, 9, 8).data; const g = [];
    for (let i = 0; i < hp.length; i += 4) g.push((hp[i] * 299 + hp[i + 1] * 587 + hp[i + 2] * 114) / 1000);
    let bits = '', hex = '';
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) bits += g[y * 9 + x] > g[y * 9 + x + 1] ? '1' : '0';
    for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    canvas.width = canvas.height = hashCanvas.width = hashCanvas.height = 1;
    return { dhash: hex.padStart(16, '0'), meanLuma: Number(mean.toFixed(2)), lumaVariance: Number((varianceSum / lum.length).toFixed(2)), edgeScore: Number((edgeCount ? edgeSum / edgeCount : 0).toFixed(2)) };
  }

  async function analyzeImage(item) {
    try { return await analyzeImageInWorker(item); }
    catch (error) {
      const message = String(error?.message || '');
      if (/逾時|取消/.test(message)) throw error;
      return analyzeImageFallback(item);
    }
  }

  async function processLogo(maxDim = 600) {
    if (!state.logo) return null;
    const img = await loadImage(state.logo.previewUrl);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    canvas.width = 1; canvas.height = 1;
    if (!blob) throw new Error('LOGO 轉換失敗');
    return { blob, width: w, height: h };
  }

  function fitDimensions(width, height, maxWidth, maxHeight) {
    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  function metaPayload() {
    return {
      org_name: $('orgName').value.trim(),
      title: $('title').value.trim() || '照片紀錄表',
      case: $('caseName').value.trim(),
      case_no: $('caseNumber')?.value.trim() || '',
      date: $('recordDate').value,
      location: $('location').value.trim(),
      per_page: Number($('perPage').value || 2),
      cover: $('cover').checked,
      page_numbers: $('includePageNumber').checked,
      watermark_enabled: Boolean($('watermarkEnabled')?.checked),
      watermark_text: $('watermarkText')?.value.trim() || '',
      smart_long_split: Boolean($('smartLongSplit')?.checked),
      export_scope: String($('exportScope')?.value || 'included'),
      archived: Boolean(state.caseArchived),
      archived_at: state.caseArchivedAt || '',
    };
  }

  const blobIdentityMap = new WeakMap();
  let blobIdentitySeq = 0;

  function blobIdentity(blob) {
    if (!(blob instanceof Blob)) return 'none';
    if (!blobIdentityMap.has(blob)) blobIdentityMap.set(blob, `b${++blobIdentitySeq}`);
    return `${blobIdentityMap.get(blob)}:${blob.size}:${blob.type || ''}`;
  }

  function captureEditableSnapshot() {
    return {
      format: 'ImageRecordAssistant.history',
      meta: metaPayload(),
      quick_notes: [...state.quickNotes],
      selected: state.selected,
      selected_ids: [...state.selectedIds],
      photos: state.items.map((item) => ({
        id: item.id,
        blob: item.blob,
        original_name: item.originalName,
        display_name: item.displayName,
        description: item.description || '',
        note: item.note || '',
        location: item.location || '',
        rotation: Number(item.rotation || 0),
        crop: clampCrop(item.crop), annotations: sanitizeAnnotations(item.annotations),
        source_format: item.sourceFormat || '', source_bytes: Number(item.sourceBytes || 0), decoder: item.decoder || '',
        source_dimensions: item.sourceDimensions || '', normalized_at: item.normalizedAt || '', privacy: item.privacy || { hasExif: false, hasGps: false },
        captured_at: item.capturedAt || '', capture_source: item.captureSource || '', source_folder: item.sourceFolder || '', import_order: Number(item.importOrder || 0),
        section: item.section || '', tags: item.tags || '', compare_group: item.compareGroup || '', compare_role: item.compareRole || '', exclude_export: Boolean(item.excludeExport),
      })),
      logo: state.logo ? { name: state.logo.name, blob: state.logo.blob } : null,
    };
  }

  function snapshotSignature(snapshot = captureEditableSnapshot()) {
    const safe = {
      meta: snapshot.meta,
      quick_notes: snapshot.quick_notes,
      selected: snapshot.selected,
      photos: (snapshot.photos || []).map((p) => ({
        id: p.id,
        blob: blobIdentity(p.blob),
        original_name: p.original_name,
        display_name: p.display_name,
        description: p.description,
        note: p.note,
        location: p.location,
        rotation: p.rotation,
        crop: p.crop, annotations: sanitizeAnnotations(p.annotations),
        source_format: p.source_format || '', source_bytes: Number(p.source_bytes || 0), decoder: p.decoder || '',
        source_dimensions: p.source_dimensions || '', normalized_at: p.normalized_at || '', privacy: p.privacy || { hasExif: false, hasGps: false },
        captured_at: p.captured_at || '', capture_source: p.capture_source || '', source_folder: p.source_folder || '', import_order: Number(p.import_order || 0),
        section: p.section || '', tags: p.tags || '', compare_group: p.compare_group || '', compare_role: p.compare_role || '', exclude_export: Boolean(p.exclude_export),
      })),
      logo: snapshot.logo ? { name: snapshot.logo.name, blob: blobIdentity(snapshot.logo.blob) } : null,
    };
    return JSON.stringify(safe);
  }

  function updateDirtyIndicator() {
    const badge = $('dirtyBadge');
    if (badge) {
      badge.hidden = !state.dirty;
      badge.textContent = state.dirty ? '● 尚未另存' : '';
    }
    document.title = `${state.dirty ? '● ' : ''}${APP_NAME} ${APP_VERSION}｜Large Project Control & Export Workflow Edition`;
  }

  function refreshDirtyState() {
    const current = snapshotSignature();
    state.dirty = state.lastSavedSignature ? current !== state.lastSavedSignature : state.items.length > 0;
    updateDirtyIndicator();
  }

  function commitHistoryCheckpoint() {
    clearTimeout(state.historyTimer);
    state.historyTimer = null;
    if (state.restoring) return;
    const next = captureEditableSnapshot();
    const nextSig = snapshotSignature(next);
    if (!state.historyCurrent) {
      state.historyCurrent = next;
      updateButtons();
      return;
    }
    const prevSig = snapshotSignature(state.historyCurrent);
    if (nextSig === prevSig) return;
    state.historyUndo.push(state.historyCurrent);
    if (state.historyUndo.length > HISTORY_LIMIT) state.historyUndo.shift();
    state.historyCurrent = next;
    state.historyRedo = [];
    updateButtons();
  }

  function queueHistoryCheckpoint() {
    clearTimeout(state.historyTimer);
    state.historyTimer = setTimeout(commitHistoryCheckpoint, 350);
  }

  function resetHistoryBaseline(saved = true) {
    clearTimeout(state.historyTimer);
    state.historyTimer = null;
    state.historyUndo = [];
    state.historyRedo = [];
    state.historyCurrent = captureEditableSnapshot();
    if (saved) state.lastSavedSignature = snapshotSignature(state.historyCurrent);
    else state.lastSavedSignature = null;
    state.dirty = !saved && state.items.length > 0;
    updateDirtyIndicator();
    updateButtons();
  }

  async function applyHistorySnapshot(snapshot) {
    state.restoring = true;
    try {
      await applyProjectData(snapshot);
      state.historyCurrent = captureEditableSnapshot();
      refreshDirtyState();
      await saveAutosaveNow();
    } finally {
      state.restoring = false;
    }
  }

  async function undoProjectChange() {
    commitHistoryCheckpoint();
    if (!state.historyUndo.length) return setStatus('沒有可復原的操作。');
    const current = captureEditableSnapshot();
    const previous = state.historyUndo.pop();
    state.historyRedo.push(current);
    if (state.historyRedo.length > HISTORY_LIMIT) state.historyRedo.shift();
    await applyHistorySnapshot(previous);
    setStatus('已復原上一個操作。', 'ok');
    updateButtons();
  }

  async function redoProjectChange() {
    commitHistoryCheckpoint();
    if (!state.historyRedo.length) return setStatus('沒有可重做的操作。');
    const current = captureEditableSnapshot();
    const next = state.historyRedo.pop();
    state.historyUndo.push(current);
    if (state.historyUndo.length > HISTORY_LIMIT) state.historyUndo.shift();
    await applyHistorySnapshot(next);
    setStatus('已重做上一個操作。', 'ok');
    updateButtons();
  }

  async function sha256Hex(data) {
    if (!crypto?.subtle) throw new Error('此瀏覽器不支援 Web Crypto SHA-256，無法建立完整性驗證專案。');
    let source = data;
    if (typeof data === 'string') source = new TextEncoder().encode(data);
    else if (data instanceof Blob) source = await data.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', source);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function detectSupportedImageMagic(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return { format: 'jpeg', mime: 'image/jpeg' };
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return { format: 'png', mime: 'image/png' };
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { format: 'webp', mime: 'image/webp' };
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4D) return { format: 'bmp', mime: 'image/bmp' };
    return null;
  }

  function ascii4(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) return '';
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  }

  function detectHeicHeifMagic(bytes, name = '') {
    if (bytes.length < 12 || ascii4(bytes, 4) !== 'ftyp') return null;
    const brands = new Set([ascii4(bytes, 8)]);
    for (let offset = 16; offset + 3 < bytes.length; offset += 4) brands.add(ascii4(bytes, offset));
    const sequenceBrands = ['msf1', 'hevc', 'hevx', 'hevm', 'hevs'];
    const stillBrands = ['heic', 'heix', 'heim', 'heis'];
    if (sequenceBrands.some((brand) => brands.has(brand))) {
      return { format: 'heic-sequence', mime: 'image/heic-sequence', sequence: true, brands: [...brands] };
    }
    if (brands.has('avif') || brands.has('avis')) return null;
    if (stillBrands.some((brand) => brands.has(brand))) {
      return { format: 'heic', mime: 'image/heic', sequence: false, brands: [...brands] };
    }
    if (brands.has('mif1')) return { format: 'heif', mime: 'image/heif', sequence: false, generic: true, brands: [...brands] };
    return null;
  }

  function readU16BE(bytes, offset) {
    if (offset < 0 || offset + 2 > bytes.length) return 0;
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  function readU16LE(bytes, offset) {
    if (offset < 0 || offset + 2 > bytes.length) return 0;
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readU24LE(bytes, offset) {
    if (offset < 0 || offset + 3 > bytes.length) return 0;
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  }

  function readU32BE(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) return 0;
    return (((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0);
  }

  function readI32LE(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) return 0;
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
  }

  function normalizeExifDate(value) {
    const text = String(value || '').trim().replace(/\0+$/g, '');
    const match = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(text);
    if (!match) return '';
    const [, y, m, d, hh, mm, ss] = match;
    const numeric = [y, m, d, hh, mm, ss].map(Number);
    if (numeric.some((v) => !Number.isFinite(v))) return '';
    if (numeric[1] < 1 || numeric[1] > 12 || numeric[2] < 1 || numeric[2] > 31 || numeric[3] > 23 || numeric[4] > 59 || numeric[5] > 59) return '';
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }

  function jpegMetadataInfo(bytes) {
    const out = { hasExif: false, hasGps: false, capturedAt: '', captureSource: '' };
    if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return out;
    let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p] !== 0xFF) { p += 1; continue; }
      const marker = bytes[p + 1];
      p += 2;
      if (marker === 0xD9 || marker === 0xDA) break;
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
      if (p + 2 > bytes.length) break;
      const len = readU16BE(bytes, p);
      if (len < 2 || p + len > bytes.length) break;
      if (marker === 0xE1 && len >= 8 && ascii4(bytes, p + 2) === 'Exif' && bytes[p + 6] === 0 && bytes[p + 7] === 0) {
        out.hasExif = true;
        try {
          const t = p + 8;
          const little = bytes[t] === 0x49 && bytes[t + 1] === 0x49;
          const big = bytes[t] === 0x4D && bytes[t + 1] === 0x4D;
          if (!little && !big) return out;
          const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const u16 = (off) => off >= 0 && off + 2 <= bytes.length ? dv.getUint16(off, little) : 0;
          const u32 = (off) => off >= 0 && off + 4 <= bytes.length ? dv.getUint32(off, little) : 0;
          const asciiValue = (entry) => {
            if (entry < 0 || entry + 12 > bytes.length || u16(entry + 2) !== 2) return '';
            const count = u32(entry + 4);
            if (!count || count > 128) return '';
            const pos = count <= 4 ? entry + 8 : t + u32(entry + 8);
            if (pos < 0 || pos + count > bytes.length) return '';
            let text = '';
            for (let j = 0; j < count; j += 1) {
              const c = bytes[pos + j];
              if (!c) break;
              if (c < 0x20 || c > 0x7E) return '';
              text += String.fromCharCode(c);
            }
            return text;
          };
          const ifdEntries = (offset) => {
            if (offset < 0 || offset + 2 > bytes.length) return [];
            const count = Math.min(u16(offset), 4096);
            const entries = [];
            for (let i = 0; i < count; i += 1) {
              const e = offset + 2 + i * 12;
              if (e + 12 > bytes.length) break;
              entries.push(e);
            }
            return entries;
          };
          const ifd0 = t + u32(t + 4);
          let exifIfd = 0;
          let fallbackDate = '';
          for (const e of ifdEntries(ifd0)) {
            const tag = u16(e);
            if (tag === 0x8825) out.hasGps = true;
            else if (tag === 0x8769) exifIfd = t + u32(e + 8);
            else if (tag === 0x0132) fallbackDate = normalizeExifDate(asciiValue(e));
          }
          if (exifIfd) {
            for (const e of ifdEntries(exifIfd)) {
              const tag = u16(e);
              if (tag === 0x9003 || tag === 0x9004) {
                const parsed = normalizeExifDate(asciiValue(e));
                if (parsed) { out.capturedAt = parsed; out.captureSource = 'exif'; break; }
              }
            }
          }
          if (!out.capturedAt && fallbackDate) { out.capturedAt = fallbackDate; out.captureSource = 'exif'; }
        } catch (_) {}
        return out;
      }
      p += len;
    }
    return out;
  }

  function jpegPrivacyFlags(bytes) {
    const meta = jpegMetadataInfo(bytes);
    return { hasExif: meta.hasExif, hasGps: meta.hasGps };
  }

  async function inspectImagePrivacy(blob, magic) {
    if (!blob || magic?.format !== 'jpeg') return { hasExif: false, hasGps: false };
    const scan = new Uint8Array(await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer());
    const meta = jpegMetadataInfo(scan);
    return { hasExif: meta.hasExif, hasGps: meta.hasGps, capturedAt: meta.capturedAt || '', captureSource: meta.captureSource || '' };
  }

  async function hasTopLevelIsoBoxInBlob(blob, target) {
    const total = Number(blob?.size || 0);
    let pos = 0;
    let boxes = 0;
    while (pos + 8 <= total && boxes < 100000) {
      const head = new Uint8Array(await blob.slice(pos, Math.min(total, pos + 16)).arrayBuffer());
      if (head.length < 8) return false;
      let size = readU32BE(head, 0);
      const type = ascii4(head, 4);
      let header = 8;
      if (size === 1) {
        if (head.length < 16) return false;
        const hi = readU32BE(head, 8);
        const lo = readU32BE(head, 12);
        if (hi > 0x1FFFFF) throw new Error('HEIF box size exceeds safe integer range.');
        size = hi * 0x100000000 + lo;
        header = 16;
      } else if (size === 0) {
        size = total - pos;
      }
      if (!Number.isSafeInteger(size) || size < header || pos + size > total) throw new Error('HEIF container box range is invalid.');
      if (type === target) return true;
      pos += size;
      boxes += 1;
    }
    if (boxes >= 100000) throw new Error('HEIF container contains too many top-level boxes.');
    return false;
  }

  async function preflightHeifSafety(blob, heicMagic) {
    const scanSize = Math.min(Number(blob?.size || 0), HEIC_PREFLIGHT_SCAN_BYTES);
    if (!scanSize) return { dimensions: null, sequence: Boolean(heicMagic?.sequence) };
    const bytes = new Uint8Array(await blob.slice(0, scanSize).arrayBuffer());
    const sequence = Boolean(heicMagic?.sequence) || await hasTopLevelIsoBoxInBlob(blob, 'moov');
    let best = null;
    for (let i = 4; i + 16 <= bytes.length; i += 1) {
      if (ascii4(bytes, i) !== 'ispe') continue;
      const boxStart = i - 4;
      const boxSize = readU32BE(bytes, boxStart);
      if (boxSize < 20 || boxStart + boxSize > bytes.length) continue;
      const width = readU32BE(bytes, i + 8);
      const height = readU32BE(bytes, i + 12);
      if (!width || !height || width > 200000 || height > 200000) continue;
      const pixels = width * height;
      if (!best || pixels > best.pixels) best = { width, height, pixels };
    }
    return { dimensions: best, sequence };
  }

  function parseJpegDimensions(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    const sofMarkers = new Set([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF]);
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos] !== 0xFF) { pos += 1; continue; }
      while (pos < bytes.length && bytes[pos] === 0xFF) pos += 1;
      if (pos >= bytes.length) break;
      const marker = bytes[pos++];
      if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) continue;
      if (pos + 2 > bytes.length) break;
      const length = readU16BE(bytes, pos);
      if (length < 2 || pos + length > bytes.length) break;
      if (sofMarkers.has(marker) && length >= 7) {
        const height = readU16BE(bytes, pos + 3);
        const width = readU16BE(bytes, pos + 5);
        return width && height ? { width, height } : null;
      }
      pos += length;
    }
    return null;
  }

  function parseStandardImageDimensions(bytes, magic) {
    if (!magic) return null;
    if (magic.format === 'png' && bytes.length >= 24) {
      return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
    }
    if (magic.format === 'bmp' && bytes.length >= 26) {
      const dibSize = new DataView(bytes.buffer, bytes.byteOffset + 14, 4).getUint32(0, true);
      if (dibSize === 12 && bytes.length >= 22) return { width: readU16LE(bytes, 18), height: readU16LE(bytes, 20) };
      return { width: Math.abs(readI32LE(bytes, 18)), height: Math.abs(readI32LE(bytes, 22)) };
    }
    if (magic.format === 'jpeg') return parseJpegDimensions(bytes);
    if (magic.format === 'webp' && bytes.length >= 30) {
      const chunk = ascii4(bytes, 12);
      if (chunk === 'VP8X') return { width: readU24LE(bytes, 24) + 1, height: readU24LE(bytes, 27) + 1 };
      if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2F) {
        const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
        return { width: 1 + (((b2 & 0x3F) << 8) | b1), height: 1 + (((b4 & 0x0F) << 10) | (b3 << 2) | ((b2 & 0xC0) >> 6)) };
      }
      if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9D && bytes[24] === 0x01 && bytes[25] === 0x2A) {
        return { width: readU16LE(bytes, 26) & 0x3FFF, height: readU16LE(bytes, 28) & 0x3FFF };
      }
    }
    return null;
  }

  async function preflightStandardImageDimensions(blob, magic, label) {
    const scanSize = Math.min(Number(blob?.size || 0), IMAGE_PREFLIGHT_SCAN_BYTES);
    const bytes = new Uint8Array(await blob.slice(0, scanSize).arrayBuffer());
    const dimensions = parseStandardImageDimensions(bytes, magic);
    if (!dimensions?.width || !dimensions?.height) throw new Error(`${label} 無法在解碼前安全取得圖片尺寸，已停止處理。`);
    assertSafeImageDimensions(dimensions.width, dimensions.height, label);
    return dimensions;
  }

  function assertSafeImageDimensions(width, height, label) {
    if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)) throw new Error(`${label} 的圖片尺寸不合法。`);
    const pixels = width * height;
    const maxPixels = maxImagePixelsForDevice();
    if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT || pixels > maxPixels) {
      throw new Error(`${label} 的像素尺寸過大（${width} × ${height}）；此裝置安全上限約 ${Math.round(maxPixels / 1_000_000)} MP。`);
    }
    const estimatedWorkingBytes = pixels * 4 * 3;
    const workingLimit = Math.max(256, deviceMemoryGb() * 256) * 1024 * 1024;
    if (estimatedWorkingBytes > workingLimit) throw new Error(`${label} 解碼後預估需要 ${formatMiB(estimatedWorkingBytes)} 工作記憶體，超過此裝置安全上限。`);
  }

  function heicPoolSizeForDevice() {
    const mem = deviceMemoryGb();
    const cores = Math.max(1, Number(navigator.hardwareConcurrency || 4));
    const mobile = /Android|iPhone|iPad|Mobile/i.test(String(navigator.userAgent || ''));
    if (mobile) return 1;
    // Chromium 的 navigator.deviceMemory 通常最高回報 8，因此高效能桌機以 8 GB + 8 threads 啟用 3 路。
    if (mem >= 8 && cores >= 8) return 3;
    if (mem >= 4 && cores >= 4) return 2;
    return 1;
  }

  function createHeicPoolSlot(pool, slotIndex) {
    const worker = new Worker(HEIC_WORKER_PATH, { type: 'module', name: `IRA-HEIC-Decoder-${slotIndex + 1}` });
    const slot = { worker, busy: false, current: null, timer: null, index: slotIndex };
    worker.onmessage = (event) => {
      const data = event.data || {};
      const task = slot.current;
      if (!task || data.taskId !== task.id) return;
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = null;
      slot.current = null;
      slot.busy = false;
      if (data.ok && data.blob instanceof Blob) task.resolve(data.blob);
      else task.reject(new Error(data.error || `${task.label} HEIC/HEIF 解碼失敗。`));
      dispatchHeicPool(pool);
    };
    worker.onerror = () => {
      const task = slot.current;
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = null;
      slot.current = null;
      slot.busy = false;
      if (task) task.reject(new Error(`${task.label} HEIC/HEIF Worker 執行失敗。`));
      try { worker.terminate(); } catch (_) {}
      if (state.heicPool === pool && pool.generation === state.heicPoolGeneration) {
        const replacement = createHeicPoolSlot(pool, slotIndex);
        pool.slots[slotIndex] = replacement;
        dispatchHeicPool(pool);
      }
    };
    return slot;
  }

  function ensureHeicPool() {
    if (typeof Worker !== 'function') throw new Error('此瀏覽器不支援安全隔離的 HEIC Worker。');
    const wanted = heicPoolSizeForDevice();
    if (state.heicPool && state.heicPool.size === wanted) return state.heicPool;
    terminateActiveHeicWorker('重新建立 HEIC 平行解碼器。');
    const pool = { size: wanted, slots: [], queue: [], taskSeq: 0, generation: state.heicPoolGeneration };
    for (let i = 0; i < wanted; i += 1) pool.slots.push(createHeicPoolSlot(pool, i));
    state.heicPool = pool;
    return pool;
  }

  function replaceTimedOutHeicSlot(pool, slot, task) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.current = null;
    slot.busy = false;
    try { slot.worker.terminate(); } catch (_) {}
    task.reject(new Error(`${task.label} HEIC/HEIF 轉換逾時，已重啟該解碼器。`));
    if (state.heicPool === pool && pool.generation === state.heicPoolGeneration) {
      pool.slots[slot.index] = createHeicPoolSlot(pool, slot.index);
      dispatchHeicPool(pool);
    }
  }

  function scheduleHeicPoolIdleRelease(pool) {
    if (!pool || state.heicPool !== pool) return;
    clearTimeout(state.heicPoolIdleTimer);
    if (pool.queue.length || pool.slots.some((slot) => slot.busy)) return;
    state.heicPoolIdleTimer = setTimeout(() => {
      if (state.heicPool === pool && !pool.queue.length && pool.slots.every((slot) => !slot.busy)) {
        terminateActiveHeicWorker('HEIC 解碼器閒置，已釋放記憶體。');
      }
    }, HEIC_POOL_IDLE_RELEASE_MS);
  }

  function dispatchHeicPool(pool = state.heicPool) {
    if (!pool || state.heicPool !== pool || pool.generation !== state.heicPoolGeneration) return;
    for (const slot of pool.slots) {
      if (slot.busy) continue;
      const task = pool.queue.shift();
      if (!task) break;
      slot.busy = true;
      slot.current = task;
      slot.timer = setTimeout(() => replaceTimedOutHeicSlot(pool, slot, task), HEIC_DECODER_TIMEOUT_MS);
      try {
        slot.worker.postMessage({ taskId: task.id, blob: task.file, type: 'image/jpeg', quality: HEIC_JPEG_QUALITY });
      } catch (error) {
        if (slot.timer) clearTimeout(slot.timer);
        slot.timer = null;
        slot.current = null;
        slot.busy = false;
        task.reject(error instanceof Error ? error : new Error(String(error || 'HEIC/HEIF Worker 傳送失敗。')));
        queueMicrotask(() => dispatchHeicPool(pool));
      }
    }
    scheduleHeicPoolIdleRelease(pool);
  }

  function terminateActiveHeicWorker(reason = 'HEIC/HEIF 解碼已取消。') {
    const error = new Error(reason);
    clearTimeout(state.heicPoolIdleTimer);
    state.heicPoolIdleTimer = null;
    state.heicPoolGeneration += 1;
    const pool = state.heicPool;
    state.heicPool = null;
    if (pool) {
      for (const task of pool.queue.splice(0)) {
        try { task.reject(error); } catch (_) {}
      }
      for (const slot of pool.slots) {
        if (slot.timer) clearTimeout(slot.timer);
        slot.timer = null;
        if (slot.current) {
          try { slot.current.reject(error); } catch (_) {}
          slot.current = null;
        }
        try { slot.worker.terminate(); } catch (_) {}
      }
    }
    const cancel = state.activeHeicCancel;
    state.activeHeicCancel = null;
    if (typeof cancel === 'function') {
      try { cancel(error); } catch (_) {}
    }
    if (state.activeHeicWorker) {
      try { state.activeHeicWorker.terminate(); } catch (_) {}
      state.activeHeicWorker = null;
    }
  }

  async function decodeHeicWithWorker(file, label, { priority = false } = {}) {
    if (globalThis.__IRA_HEIC_DECODER__?.heicTo) {
      return withTimeout(globalThis.__IRA_HEIC_DECODER__.heicTo({ blob: file, type: 'image/jpeg', quality: HEIC_JPEG_QUALITY }), HEIC_DECODER_TIMEOUT_MS, `${label} HEIC/HEIF 轉換逾時`);
    }
    const pool = ensureHeicPool();
    clearTimeout(state.heicPoolIdleTimer);
    state.heicPoolIdleTimer = null;
    return await new Promise((resolve, reject) => {
      const task = { id: `${pool.generation}-${++pool.taskSeq}`, file, label, resolve, reject };
      if (priority) pool.queue.unshift(task);
      else pool.queue.push(task);
      dispatchHeicPool(pool);
    });
  }

  async function tryNativeHeicCached(file, label, heicMagic) {
    if (state.nativeHeicSupport === false) return null;
    if (state.nativeHeicSupport === true) {
      try {
        return await withTimeout(nativeHeicToJpeg(file, label, heicMagic), HEIC_NATIVE_PROBE_TIMEOUT_MS, `${label} 原生 HEIC 解碼逾時`);
      } catch (_) {
        return null;
      }
    }

    const isProbeOwner = !state.nativeHeicProbePromise;
    if (isProbeOwner) {
      state.nativeHeicProbePromise = withTimeout(
        nativeHeicToJpeg(file, label, heicMagic),
        HEIC_NATIVE_PROBE_TIMEOUT_MS,
        `${label} 原生 HEIC 解碼逾時`,
      ).then((blob) => ({ supported: true, blob })).catch(() => ({ supported: false }));
    }
    const result = await state.nativeHeicProbePromise;
    state.nativeHeicSupport = Boolean(result?.supported);
    if (isProbeOwner) state.nativeHeicProbePromise = null;
    if (!result?.supported) return null;
    if (isProbeOwner && result.blob instanceof Blob) return result.blob;
    try {
      return await withTimeout(nativeHeicToJpeg(file, label, heicMagic), HEIC_NATIVE_PROBE_TIMEOUT_MS, `${label} 原生 HEIC 解碼逾時`);
    } catch (_) {
      return null;
    }
  }

  async function nativeHeicToJpeg(blob, label, heicMagic) {
    const typed = blob.type === heicMagic.mime ? blob : blob.slice(0, blob.size, heicMagic.mime);
    const img = await loadBlobImage(typed);
    if (!img.naturalWidth || !img.naturalHeight) throw new Error(`${label} 無法由瀏覽器原生解碼。`);
    assertSafeImageDimensions(img.naturalWidth, img.naturalHeight, label);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    if (!ctx) throw new Error('瀏覽器無法建立圖片轉換畫布。');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    try { return await canvasToBlob(canvas, 'image/jpeg', HEIC_JPEG_QUALITY); }
    finally { canvas.width = 1; canvas.height = 1; }
  }

  async function normalizeImportedImage(file, label = file?.name || '圖片') {
    const header = new Uint8Array(await file.slice(0, 128).arrayBuffer());
    const standard = detectSupportedImageMagic(header);
    if (standard) {
      await preflightStandardImageDimensions(file, standard, label);
      const validated = await validateDecodedProjectImage(file, label, { preflightDone: true });
      const privacy = await inspectImagePrivacy(file, standard);
      return { ...validated, converted: false, sourceFormat: standard.format, decoder: 'browser', sourceBytes: Number(file.size || 0), sourceDimensions: `${validated.width}x${validated.height}`, normalizedAt: '', privacy };
    }

    const heicMagic = detectHeicHeifMagic(header, file.name);
    if (!heicMagic) throw new Error(`${label} 的檔案內容不是支援的 JPG / PNG / WEBP / BMP / HEIC / HEIF 圖片。`);
    const heifSafety = await preflightHeifSafety(file, heicMagic);
    if (heifSafety.sequence) throw new Error(`${label} 是 HEIF/HEIC 影像序列；基於 2026 年 libheif 安全修補要求，本版只接受靜態 HEIC/HEIF。`);
    if (!heifSafety.dimensions) throw new Error(`${label} 無法在解碼前安全取得 HEIC/HEIF 像素尺寸，已停止處理。`);
    assertSafeImageDimensions(heifSafety.dimensions.width, heifSafety.dimensions.height, label);

    let jpegBlob = await tryNativeHeicCached(file, label, heicMagic);
    let decoder = jpegBlob instanceof Blob ? 'native-cached' : `heic-to ${HEIC_DECODER_VERSION} / persistent-worker-pool`;
    if (!(jpegBlob instanceof Blob)) {
      if (heicMagic.generic) throw new Error('此 HEIF 僅宣告通用 mif1 品牌，無法確認為安全的 HEVC 靜態影像；本版不交給 fallback decoder。');
      try {
        jpegBlob = await decodeHeicWithWorker(file, label);
      } catch (error) {
        if (/Failed to fetch|module|404|載入|Worker/i.test(String(error?.message || ''))) throw new Error('此瀏覽器無法原生讀取 HEIC，且本機 HEIC 解碼元件不存在或無法載入。請使用完整 V3.8 GitHub Pages 建置版。');
        throw new Error(`${label} HEIC/HEIF 轉換失敗：${error.message || '解碼器無法處理此檔案'}`);
      }
    }
    if (Array.isArray(jpegBlob)) jpegBlob = jpegBlob.find((item) => item instanceof Blob) || null;
    if (!(jpegBlob instanceof Blob)) throw new Error(`${label} HEIC/HEIF 轉換沒有產生有效圖片。`);
    // 解碼器已經完成一次完整 HEIC -> JPEG。這裡只做 JPEG header + 尺寸安全驗證，
    // 不再把整張 JPEG 再解碼一次，避免大量 iPhone 照片產生第二次昂貴 decode。
    const validated = await validateDecodedProjectImage(jpegBlob, label, { headerOnly: true });
    return { ...validated, converted: true, sourceFormat: heicMagic.format, decoder, sourceBytes: Number(file.size || 0), sourceDimensions: heifSafety.dimensions ? `${heifSafety.dimensions.width}x${heifSafety.dimensions.height}` : `${validated.width}x${validated.height}`, normalizedAt: new Date().toISOString(), privacy: { hasExif: false, hasGps: false } };
  }

  async function validateDecodedProjectImage(blob, label, options = {}) {
    const header = new Uint8Array(await blob.slice(0, 128).arrayBuffer());
    const magic = detectSupportedImageMagic(header);
    if (!magic) throw new Error(`${label} 的檔案內容不是支援的 JPG / PNG / WEBP / BMP 圖片。`);
    const dimensions = options.preflightDone ? null : await preflightStandardImageDimensions(blob, magic, label);
    const normalized = blob.type === magic.mime ? blob : new Blob([blob], { type: magic.mime });
    if (options.headerOnly) {
      const safeDimensions = dimensions || await preflightStandardImageDimensions(normalized, magic, label);
      return { blob: normalized, magic, width: safeDimensions.width, height: safeDimensions.height };
    }
    const img = await loadBlobImage(normalized);
    if (!img.naturalWidth || !img.naturalHeight) throw new Error(`${label} 無法解碼。`);
    assertSafeImageDimensions(img.naturalWidth, img.naturalHeight, label);
    return { blob: normalized, magic, width: img.naturalWidth, height: img.naturalHeight };
  }

  function effectiveLocation(item, meta = metaPayload()) {
    return String(item?.location || '').trim() || meta.location || '';
  }

  function getBatchSelectedItems() {
    return state.items.filter((item) => state.selectedIds.has(item.id));
  }

  function navigatePhoto(delta) {
    if (!state.items.length) return;
    const next = Math.max(0, Math.min(state.items.length - 1, (state.selected < 0 ? 0 : state.selected) + delta));
    if (next === state.selected) return;
    selectItem(next);
    const row = $('photoList').querySelector(`.photo-row[data-photo-index="${next}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }

  function textWeight(value) {
    const text = String(value || '');
    let score = 0;
    for (const ch of text) score += ch === '\n' ? 18 : (ch.codePointAt(0) > 0xFF ? 1 : 0.62);
    return score;
  }

  function itemTextWeight(item, meta) {
    return textWeight(item.description) + textWeight(item.note) * 0.85 + textWeight(effectiveLocation(item, meta)) * 0.25;
  }

  function itemLayoutCap(item, meta) {
    const requested = Math.max(1, Math.min(4, Number(meta.per_page || 2)));
    const weight = itemTextWeight(item, meta);
    if (requested === 1) return 1;
    if (weight > 220 || String(item.description || '').split('\n').length > 8) return 1;
    if (requested === 4 && (weight > 95 || String(item.description || '').split('\n').length > 4)) return 2;
    return requested;
  }


  function singlePageTextWouldTruncate(item, meta) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const pageWidth = 1240, pageHeight = 1754, margin = 64, gridTop = 138;
    const gridBottom = pageHeight - (meta.page_numbers ? 58 : 30);
    const h = gridBottom - gridTop;
    const w = pageWidth - margin * 2;
    const details = [
      ['案件／主題', meta.case || '—'],
      ...(meta.case_no ? [['案件編號', meta.case_no]] : []),
      ...(item.section ? [['章節', item.section]] : []),
      ...(item.compareGroup && item.compareRole ? [['前後比較', `${item.compareGroup}｜${item.compareRole === 'before' ? '改善前' : '改善後'}`]] : []),
      ...(item.tags ? [['標籤', item.tags]] : []),
      ['紀錄日期', meta.date || '—'],
      ['地點', effectiveLocation(item, meta) || '—'],
      ['照片說明', item.description || '（未填寫）'],
    ];
    if (item.note) details.push(['備註', item.note]);
    const weight = itemTextWeight(item, meta);
    const infoH = Math.min(Math.max(230, 190 + weight * 0.95), Math.max(230, h * 0.58));
    return fitInfoLines(ctx, details, w - 24, infoH - 18, 17).truncated;
  }

  function criticalPreflightIssues(meta = metaPayload()) {
    const candidateSet = new Set(exportCandidateIndices(meta));
    const overflow = state.items
      .map((item, index) => candidateSet.has(index) && singlePageTextWouldTruncate(item, meta) ? index + 1 : null)
      .filter(Boolean);
    if (!overflow.length) return [];
    return [`有 ${overflow.length} 張照片的說明／備註即使改成一頁 1 張仍超出版面（照片 ${overflow.slice(0, 8).map((n) => String(n).padStart(2, '0')).join('、')}${overflow.length > 8 ? '…' : ''}）。為避免正式文件截字，請先縮短文字後再輸出。`];
  }

  function itemOutputAspect(item) {
    const match = String(item?.sourceDimensions || '').match(/^(\d+)x(\d+)$/i);
    if (!match) return 0;
    let w = Number(match[1]), h = Number(match[2]);
    if (!w || !h) return 0;
    if ([90,270].includes(((Number(item.rotation || 0) % 360) + 360) % 360)) [w, h] = [h, w];
    const c = clampCrop(item.crop); w *= Math.max(.05, (100 - c.left - c.right) / 100); h *= Math.max(.05, (100 - c.top - c.bottom) / 100);
    return h / Math.max(1, w);
  }

  function longSplitCount(item, meta = metaPayload()) {
    if (!meta.smart_long_split) return 1;
    const ratio = itemOutputAspect(item);
    if (!Number.isFinite(ratio) || ratio <= 3.0) return 1;
    return Math.max(2, Math.min(6, Math.ceil(ratio / 1.9)));
  }

  function buildOutputEntries(meta = metaPayload()) {
    const entries = [];
    for (const index of exportCandidateIndices(meta)) {
      const item = state.items[index];
      if (!item) continue;
      const segmentCount = longSplitCount(item, meta);
      for (let segment = 0; segment < segmentCount; segment += 1) entries.push({ index, segment, segmentCount });
    }
    return entries;
  }

  function outputEntryKey(entry) { return `${entry.index}:${entry.segment || 0}:${entry.segmentCount || 1}`; }
  function outputEntrySuffix(entry) { return entry.segmentCount > 1 ? `-${entry.segment + 1}` : ''; }

  async function sliceProcessedForEntry(processed, entry, quality = .92) {
    if (!entry || entry.segmentCount <= 1) return processed;
    const img = await loadBlobImage(processed.blob); const w = img.naturalWidth || processed.width, h = img.naturalHeight || processed.height;
    const base = h / entry.segmentCount; const overlap = Math.min(base * .045, 80);
    const sy = Math.max(0, Math.floor(entry.segment * base - (entry.segment ? overlap : 0)));
    const ey = Math.min(h, Math.ceil((entry.segment + 1) * base + (entry.segment < entry.segmentCount - 1 ? overlap : 0)));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = Math.max(1, ey - sy);
    const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, sy, w, ey - sy, 0, 0, w, ey - sy);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality); const out = { blob, width: canvas.width, height: canvas.height };
    canvas.width = 1; canvas.height = 1; return out;
  }

  async function processOutputEntry(entry, maxDim, quality, meta) {
    const item = state.items[entry.index];
    let processed = await processImage(item, maxDim, quality);
    processed = await sliceProcessedForEntry(processed, entry, quality);
    return applyOutputWatermark(processed, meta);
  }

  function buildPhotoPagePlan(meta = metaPayload()) {
    const pages = [];
    const entries = buildOutputEntries(meta);
    let p = 0;
    const requested = Math.max(1, Math.min(4, Number(meta.per_page || 2)));
    while (p < entries.length) {
      const currentEntry = entries[p]; const current = state.items[currentEntry.index];
      if (currentEntry.segmentCount > 1) { pages.push([currentEntry]); p += 1; continue; }
      const nextEntry = entries[p + 1]; const next = nextEntry ? state.items[nextEntry.index] : null;
      const isComparePair = requested >= 2 && nextEntry?.segmentCount === 1 && current?.compareGroup && current?.compareRole === 'before' && next?.compareGroup === current.compareGroup && next?.compareRole === 'after';
      if (isComparePair) { pages.push([currentEntry, nextEntry]); p += 2; continue; }
      const firstCap = itemLayoutCap(current, meta);
      if (firstCap === 1) { pages.push([currentEntry]); p += 1; continue; }
      let cap = Math.min(requested, firstCap); const page = [];
      while (p < entries.length && page.length < cap) {
        const entry = entries[p]; const item = state.items[entry.index];
        if (entry.segmentCount > 1 && page.length) break;
        if (entry.segmentCount > 1) { page.push(entry); p += 1; cap = 1; break; }
        const nextCap = itemLayoutCap(item, meta);
        if (nextCap === 1 && page.length) break;
        if (nextCap === 1) { page.push(entry); p += 1; cap = 1; break; }
        if (nextCap === 2) cap = Math.min(cap, 2);
        if (page.length >= cap) break;
        page.push(entry); p += 1;
      }
      if (!page.length) { page.push(entries[p]); p += 1; }
      pages.push(page);
    }
    return pages;
  }

  function layoutAdjustmentCount(meta = metaPayload()) {
    const requested = Math.max(1, Math.min(4, Number(meta.per_page || 2)));
    return buildPhotoPagePlan(meta).filter((page) => page.length < requested).length;
  }

  async function computeProjectHealth() {
    const result = { errors: [], warnings: [], info: [], duplicates: [], similar: [], quality: { dark: 0, white: 0, soft: 0 }, privacy: { exif: 0, gps: 0 }, metadataChanged: false };
    if (!state.items.length) { result.errors.push('目前沒有照片。'); return result; }
    const ids = new Set();
    const hashes = new Map();
    const visual = [];
    let totalBytes = 0;
    for (let i = 0; i < state.items.length; i += 1) {
      const item = state.items[i];
      const n = i + 1;
      updateLoadingProgress(i, state.items.length);
      if ($('loadingText')) $('loadingText').textContent = `正在檢查 ${n} / ${state.items.length}：${item.displayName || item.originalName || '照片'}`;
      if (!item.id || ids.has(item.id)) result.errors.push(`照片 ${n} 的 ID 缺少或重複。`);
      ids.add(item.id);
      if (!(item.blob instanceof Blob) || item.blob.size <= 0) { result.errors.push(`照片 ${n} 沒有有效影像資料。`); continue; }
      totalBytes += item.blob.size;
      try {
        const header = new Uint8Array(await item.blob.slice(0, 128).arrayBuffer());
        const magic = detectSupportedImageMagic(header);
        if (!magic) result.errors.push(`照片 ${n} 的檔案內容不是支援的圖片格式。`);
        else {
          await preflightStandardImageDimensions(item.blob, magic, `照片 ${n}`);
          const privacy = await inspectImagePrivacy(item.blob, magic);
          const nextPrivacy = { hasExif: Boolean(privacy.hasExif), hasGps: Boolean(privacy.hasGps) };
          if (Boolean(item.privacy?.hasExif) !== nextPrivacy.hasExif || Boolean(item.privacy?.hasGps) !== nextPrivacy.hasGps) result.metadataChanged = true;
          item.privacy = nextPrivacy;
          if (!item.capturedAt && privacy.capturedAt) { item.capturedAt = privacy.capturedAt; item.captureSource = 'exif'; result.metadataChanged = true; }
          if (privacy.hasExif) result.privacy.exif += 1;
          if (privacy.hasGps) result.privacy.gps += 1;
        }
        const hash = await sha256Hex(item.blob);
        if (hashes.has(hash)) result.duplicates.push([hashes.get(hash), n]); else hashes.set(hash, n);
        const analysis = await analyzeImage(item);
        if (analysis?.dhash) visual.push({ n, ...analysis, exactHash: hash });
        if (analysis?.meanLuma < 18) { result.quality.dark += 1; result.warnings.push(`照片 ${n} 平均亮度很低，疑似過暗或近全黑，建議人工確認。`); }
        if (analysis?.meanLuma > 242 && analysis?.lumaVariance < 140) { result.quality.white += 1; result.warnings.push(`照片 ${n} 疑似接近全白或空白圖片，建議人工確認。`); }
        if (analysis?.edgeScore < 3.5 && analysis?.lumaVariance > 120 && analysis?.meanLuma >= 18 && analysis?.meanLuma <= 242) { result.quality.soft += 1; result.warnings.push(`照片 ${n} 的邊緣清晰度偏低，可能模糊；此為輔助判斷，請人工確認。`); }
      } catch (error) { result.errors.push(`照片 ${n} 檢查失敗：${error.message}`); }
      const c = clampCrop(item.crop);
      const remain = (100 - c.left - c.right) * (100 - c.top - c.bottom) / 100;
      if (remain < 15) result.warnings.push(`照片 ${n} 裁切後只剩約 ${remain.toFixed(1)}% 面積。`);
      if (!String(item.description || '').trim()) result.warnings.push(`照片 ${n} 尚未填寫說明。`);
      if (!String(item.location || '').trim() && !String(metaPayload().location || '').trim()) result.warnings.push(`照片 ${n} 沒有照片地點，文件地點也為空白。`);
    }
    updateLoadingProgress(state.items.length, state.items.length);
    const exactPairs = new Set(result.duplicates.map(([a, b]) => `${Math.min(a,b)}:${Math.max(a,b)}`));
    outer: for (let i = 0; i < visual.length; i += 1) {
      for (let j = i + 1; j < visual.length; j += 1) {
        if (visual[i].exactHash === visual[j].exactHash) continue;
        const distance = hammingDistanceHex(visual[i].dhash, visual[j].dhash);
        if (distance <= 5) {
          const key = `${Math.min(visual[i].n, visual[j].n)}:${Math.max(visual[i].n, visual[j].n)}`;
          if (!exactPairs.has(key)) result.similar.push([visual[i].n, visual[j].n, distance]);
          if (result.similar.length >= 50) break outer;
        }
      }
    }
    for (const [a, b] of result.duplicates) result.warnings.push(`照片 ${a} 與照片 ${b} 的 SHA-256 完全相同，疑似重複照片。`);
    for (const [a, b, distance] of result.similar) result.warnings.push(`照片 ${a} 與照片 ${b} 視覺特徵相似（dHash 距離 ${distance}/64），可能是不同壓縮或裁切版本；請人工確認。`);
    if (result.similar.length >= 50) result.info.push('視覺相似照片結果已達 50 組上限；為避免大量近似圖片造成報告過長，其餘不再列出。');
    if (result.privacy.gps) result.warnings.push(`有 ${result.privacy.gps} 張 JPEG 含 GPS EXIF；正式 Word/PDF 會經 Canvas 重新編碼並移除中繼資料，但 .photojob 仍保留來源圖片資料。`);
    else if (result.privacy.exif) result.info.push(`有 ${result.privacy.exif} 張 JPEG 含 EXIF；正式 Word/PDF 輸出會重新編碼並移除 EXIF。`);
    if (visual.length) result.info.push(`已完成 ${visual.length} 張照片的本機 dHash 相似度與亮度/清晰度輔助分析。`);
    const mode = memoryModeForDevice();
    if (totalBytes > mode.maxTotalBytes * 0.8) result.warnings.push(`專案圖片資料約 ${formatMiB(totalBytes)}，已超過目前 ${mode.label} 建議容量的 80%。`);
    result.info.push(`記憶體模式：${mode.label}；目前 ${state.items.length} 張、約 ${formatMiB(totalBytes)}。`);
    return result;
  }

  function renderHealthResults(result) {
    const host = $('healthResults');
    host.innerHTML = '';
    const score = healthScore(result);
    host.appendChild(createEl('div', result.errors.length ? 'preflight-critical' : result.warnings.length ? 'preflight-warn' : 'preflight-ok', `專案健康度：${score} / 100｜錯誤 ${result.errors.length}｜提醒 ${result.warnings.length}`));
    for (const [title, values, cls] of [['阻斷問題', result.errors, 'preflight-critical'], ['提醒', result.warnings, 'preflight-warn'], ['資訊', result.info, 'preflight-ok']]) {
      if (!values.length) continue;
      const box = createEl('div', cls);
      box.appendChild(createEl('strong', '', title));
      const ul = createEl('ul', 'preflight-list');
      values.slice(0, 100).forEach((v) => ul.appendChild(createEl('li', '', v)));
      box.appendChild(ul); host.appendChild(box);
    }
  }

  async function runProjectHealthCheck() {
    if (!state.items.length || state.healthRunning) return;
    state.healthRunning = true;
    showLoading('正在執行專案健康檢查…', '逐張檢查格式、尺寸、SHA-256、dHash 相似照片、亮度/清晰度與 EXIF/GPS。', { progress: true });
    try {
      const result = await computeProjectHealth();
      state.lastHealthResult = result;
      if (result.metadataChanged && !state.restoring) {
        refreshDirtyState();
        queueHistoryCheckpoint();
        writeRecoveryJournal();
        if (state.autosaveEnabled) { clearTimeout(state.autosaveTimer); state.autosaveTimer = setTimeout(saveAutosaveNow, AUTOSAVE_DELAY_MS); }
      }
      renderDashboard();
      renderList();
      showSelected();
      renderHealthResults(result);
      $('healthModal').classList.add('show');
      setStatus(result.errors.length ? `專案健康檢查完成：發現 ${result.errors.length} 項阻斷問題。` : `專案健康檢查完成：${result.warnings.length ? `有 ${result.warnings.length} 項提醒` : '狀態正常'}。`, result.errors.length ? 'err' : 'ok');
    } finally { state.healthRunning = false; hideLoading(); }
  }

  function preflightIssues() {
    const meta = metaPayload();
    const issues = [];
    const candidates = exportCandidateIndices(meta);
    const candidateSet = new Set(candidates);
    if (!candidates.length) return ['目前輸出範圍沒有可輸出的照片。'];
    if (!meta.case) issues.push('尚未填寫「案件／主題」。');
    if (!meta.date) issues.push('尚未填寫「紀錄日期」。');
    if (!meta.location && candidates.some((index) => !String(state.items[index]?.location || '').trim())) issues.push('文件地點未填寫，且輸出範圍內仍有照片沒有個別地點。');
    const missingDesc = state.items.map((item, index) => candidateSet.has(index) && !String(item.description || '').trim() ? index + 1 : null).filter(Boolean);
    if (missingDesc.length) issues.push(`輸出範圍內有 ${missingDesc.length} 張照片尚未填寫照片說明（照片 ${missingDesc.slice(0, 8).map((n) => String(n).padStart(2, '0')).join('、')}${missingDesc.length > 8 ? '…' : ''}）。`);
    const longCount = candidates.filter((index) => itemLayoutCap(state.items[index], meta) < meta.per_page).length;
    const splitCount = candidates.filter((index) => longSplitCount(state.items[index], meta) > 1).length;
    if (longCount) issues.push(`有 ${longCount} 張照片說明較長，輸出時會自動降低該頁照片數，避免文字被裁掉。`);
    if (splitCount) issues.push(`有 ${splitCount} 張超長照片會在輸出時智慧分段，原始照片與專案資料不會被切割。`);
    const gpsCount = candidates.filter((index) => state.items[index]?.privacy?.hasGps).length;
    if (gpsCount) issues.push(`有 ${gpsCount} 張來源 JPEG 含 GPS EXIF；正式 Word/PDF 會重新編碼移除中繼資料，但 .photojob 仍會保留來源圖片。`);
    return issues;
  }


  function preflightPhotoTargets() {
    const meta = metaPayload();
    const targets = [];
    const candidateSet = new Set(exportCandidateIndices(meta));
    state.items.forEach((item, index) => {
      if (!candidateSet.has(index)) return;
      if (!String(item.description || '').trim()) targets.push({ index, label: `照片 ${String(index + 1).padStart(2, '0')}：缺少說明` });
      else if (!String(item.location || '').trim() && !meta.location) targets.push({ index, label: `照片 ${String(index + 1).padStart(2, '0')}：缺少地點` });
    });
    return targets.slice(0, 30);
  }

  function appendPreflightJumpTargets() {
    const host = $('preflightResults');
    const targets = preflightPhotoTargets();
    if (!host || !targets.length) return;
    const box = createEl('div', 'preflight-jump-box');
    box.appendChild(createEl('strong', '', '快速前往問題照片：'));
    const wrap = createEl('div', 'preflight-jump-list');
    targets.forEach(({ index, label }) => {
      const btn = createEl('button', 'btn preflight-jump-btn', label); btn.type = 'button';
      btn.addEventListener('click', () => { $('preflightModal').classList.remove('show'); selectItem(index); $('singlePhotoSection').open = true; $('description').focus(); });
      wrap.appendChild(btn);
    });
    box.appendChild(wrap); host.appendChild(box);
  }

  function renderPreflightResults(issues, critical = []) {
    const host = $('preflightResults');
    host.innerHTML = '';
    if (!issues.length && !critical.length) {
      host.appendChild(createEl('div', 'preflight-ok', '✓ 檢查完成，未發現缺漏。'));
      return;
    }
    if (critical.length) {
      const box = createEl('div', 'preflight-critical');
      const title = createEl('strong', '', `發現 ${critical.length} 項阻斷問題，為避免文件內容遺失，暫停輸出：`);
      const ul = createEl('ul', 'preflight-list');
      critical.forEach((issue) => ul.appendChild(createEl('li', '', issue)));
      box.append(title, ul); host.appendChild(box);
    }
    if (issues.length) {
      const box = createEl('div', 'preflight-warn');
      const title = createEl('strong', '', `另有 ${issues.length} 項提醒：`);
      const ul = createEl('ul', 'preflight-list');
      issues.forEach((issue) => ul.appendChild(createEl('li', '', issue)));
      box.append(title, ul); host.appendChild(box);
    }
    appendPreflightJumpTargets();
  }

  function openPreflight(pendingExport = null) {
    const meta = metaPayload();
    const issues = preflightIssues();
    const critical = criticalPreflightIssues(meta);
    state.pendingExport = critical.length ? null : pendingExport;
    renderPreflightResults(issues, critical);
    $('continueExportBtn').hidden = !pendingExport || critical.length > 0 || issues.length === 0;
    $('cancelPreflightBtn').textContent = (issues.length || critical.length) ? '返回補填' : '關閉';
    $('preflightModal').classList.add('show');
    return { issues, critical };
  }

  async function guardedExport(exporter) {
    const meta = metaPayload();
    const critical = criticalPreflightIssues(meta);
    const issues = preflightIssues();
    if (!critical.length && !issues.length) return exporter();
    openPreflight(exporter);
    return undefined;
  }

  function loadCaseTemplates() {
    try {
      const raw = localStorage.getItem(CASE_TEMPLATE_KEY);
      state.caseTemplates = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.caseTemplates)) state.caseTemplates = [];
    } catch (_) { state.caseTemplates = []; }
    renderCaseTemplates();
  }

  function persistCaseTemplates() {
    try { localStorage.setItem(CASE_TEMPLATE_KEY, JSON.stringify(state.caseTemplates)); }
    catch (error) { setStatus(`案件範本儲存失敗：${error.message}`, 'err'); }
  }

  function renderCaseTemplates() {
    const select = $('caseTemplateSelect');
    select.innerHTML = '<option value="">請選擇範本</option>';
    state.caseTemplates.forEach((tpl, index) => {
      const option = document.createElement('option');
      option.value = String(index); option.textContent = tpl.name;
      select.appendChild(option);
    });
  }

  function saveCurrentCaseTemplate() {
    const name = $('caseTemplateName').value.trim();
    if (!name) return setStatus('請先輸入案件範本名稱。', 'err');
    const meta = metaPayload();
    const data = { name, org_name: meta.org_name, title: meta.title, case: meta.case, case_no: meta.case_no, location: meta.location, per_page: meta.per_page, cover: meta.cover, page_numbers: meta.page_numbers, watermark_enabled: meta.watermark_enabled, watermark_text: meta.watermark_text, smart_long_split: meta.smart_long_split };
    const existing = state.caseTemplates.findIndex((tpl) => tpl.name === name);
    if (existing >= 0) state.caseTemplates[existing] = data; else state.caseTemplates.push(data);
    persistCaseTemplates(); renderCaseTemplates();
    $('caseTemplateSelect').value = String(existing >= 0 ? existing : state.caseTemplates.length - 1);
    setStatus(`已儲存案件範本「${name}」。`, 'ok');
  }

  function applyCaseTemplate() {
    const rawIndex = $('caseTemplateSelect').value;
    if (rawIndex === '') return setStatus('請先選擇案件範本。', 'err');
    const index = Number(rawIndex);
    const tpl = Number.isInteger(index) ? state.caseTemplates[index] : null;
    if (!tpl) return setStatus('請先選擇案件範本。', 'err');
    $('orgName').value = tpl.org_name || '';
    $('title').value = tpl.title || '照片紀錄表';
    $('caseName').value = tpl.case || '';
    if ($('caseNumber')) $('caseNumber').value = tpl.case_no || '';
    if ($('watermarkEnabled')) $('watermarkEnabled').checked = Boolean(tpl.watermark_enabled);
    if ($('watermarkText')) $('watermarkText').value = tpl.watermark_text || '';
    if ($('smartLongSplit')) $('smartLongSplit').checked = tpl.smart_long_split !== false;
    $('location').value = tpl.location || '';
    $('perPage').value = String(tpl.per_page || 2);
    $('cover').checked = Boolean(tpl.cover);
    $('includePageNumber').checked = Boolean(tpl.page_numbers);
    setStatus(`已套用案件範本「${tpl.name}」。`, 'ok'); scheduleAutosave();
  }

  function applyArchiveMode() {
    const archived = Boolean(state.caseArchived);
    document.body.classList.toggle('case-archived', archived);
    const keepEnabled = new Set(['saveProjectBtn','openProjectBtn','previewBtn','wordBtn','pdfBtn','bothBtn','archiveProjectBtn','projectInput','photoFilter']);
    document.querySelectorAll('input,textarea,select,button').forEach((el) => {
      if (!el.id || keepEnabled.has(el.id) || el.closest('.modal')) return;
      if (archived) { if (!el.disabled) el.dataset.archiveDisabled = '1'; el.disabled = true; }
      else if (el.dataset.archiveDisabled === '1') { el.disabled = false; delete el.dataset.archiveDisabled; }
    });
    if ($('archiveProjectBtn')) $('archiveProjectBtn').textContent = archived ? '🔓 解除封存' : '🔒 完成案件並封存';
    if ($('archiveStatus')) $('archiveStatus').textContent = archived ? `已封存${state.caseArchivedAt ? `｜${new Date(state.caseArchivedAt).toLocaleString('zh-TW')}` : ''}｜目前為唯讀模式` : '尚未封存；封存前會先執行缺漏檢查。';
  }

  function completionBlockingIssues() {
    const meta = metaPayload(); const issues = [...criticalPreflightIssues(meta)];
    const candidates = exportCandidateIndices(meta);
    if (!candidates.length) issues.push('目前輸出範圍沒有可輸出的照片。');
    if (!meta.case) issues.push('尚未填寫案件／主題。');
    if (!meta.date) issues.push('尚未填寫紀錄日期。');
    if (!meta.location && candidates.some((index) => !String(state.items[index]?.location || '').trim())) issues.push('輸出範圍內仍有照片缺少地點。');
    const missing = candidates.filter((index) => !String(state.items[index]?.description || '').trim()).length;
    if (missing) issues.push(`輸出範圍內仍有 ${missing} 張照片缺少照片說明。`);
    return issues;
  }

  function toggleArchiveProject() {
    if (state.caseArchived) {
      if (!confirm('確定解除案件封存並重新允許編輯嗎？')) return;
      state.caseArchived = false; state.caseArchivedAt = ''; applyArchiveMode(); updateButtons(); scheduleAutosave(); setStatus('已解除案件封存，可繼續編輯。', 'ok'); return;
    }
    const blockers = completionBlockingIssues();
    if (blockers.length) { openPreflight(null); setStatus('案件仍有必要欄位或版面阻斷問題，請先修正後再封存。', 'err'); return; }
    if (!confirm('所有檢查已通過。封存後將切換為唯讀模式，確定完成案件並封存嗎？')) return;
    state.caseArchived = true; state.caseArchivedAt = new Date().toISOString(); applyArchiveMode(); scheduleAutosave(); setStatus('案件已完成並封存；請再儲存 .photojob 作為正式封存檔。', 'ok');
  }

  function updateButtons() {
    const ok = state.selected >= 0 && state.selected < state.items.length;
    const multiCount = state.selectedIds.size;
    ['upBtn', 'downBtn', 'removeBtn', 'applyNameBtn', 'restoreNameBtn', 'rotateLeftBtn', 'rotateRightBtn', 'cropBtn']
      .forEach((id) => { $(id).disabled = !ok; });
    $('prevPhotoBtn').disabled = !(ok && state.selected > 0);
    $('nextPhotoBtn').disabled = !(ok && state.selected < state.items.length - 1);
    $('copyPrevDescBtn').disabled = !(ok && state.selected > 0);
    $('copyPrevLocationBtn').disabled = !(ok && state.selected > 0);
    $('copyPrevNoteBtn').disabled = !(ok && state.selected > 0);
    $('annotationBtn').disabled = !ok;
    $('description').disabled = !ok;
    $('note').disabled = !ok;
    $('photoName').disabled = !ok;
    $('photoLocation').disabled = !ok;
    ['photoSection','photoTags','compareGroup','compareRole','excludeFromExport'].forEach((id) => { if ($(id)) $(id).disabled = !ok; });
    $('batchRenameBtn').disabled = !state.items.length;
    $('saveProjectBtn').disabled = !state.items.length;
    $('previewBtn').disabled = !state.items.length;
    ['wordBtn', 'pdfBtn', 'bothBtn', 'preflightBtn', 'healthBtn'].forEach((id) => { $(id).disabled = !state.items.length; });
    ['applyBatchDescBtn', 'applyBatchLocationBtn', 'batchRotateLeftBtn', 'batchRotateRightBtn', 'clearSelectionBtn', 'applyBatchSectionBtn', 'excludeSelectedBtn', 'includeSelectedBtn']
      .forEach((id) => { if ($(id)) $(id).disabled = multiCount === 0; });
    $('selectAllBtn').disabled = !state.items.length;
    $('selectedCount').textContent = `已勾選 ${multiCount} 張`;
    if ($('undoBtn')) $('undoBtn').disabled = state.historyUndo.length === 0;
    if ($('redoBtn')) $('redoBtn').disabled = state.historyRedo.length === 0;
    if ($('historyStatus')) $('historyStatus').textContent = `復原 ${state.historyUndo.length}｜重做 ${state.historyRedo.length}｜最多 30 個操作階段`;
    applyArchiveMode();
  }

  function photoListSubText(item) {
    const subParts = [];
    if (item?.capturedAt) subParts.push(formatCapturedAt(item.capturedAt));
    if (item?.sourceFolder) subParts.push(`📁 ${item.sourceFolder}`);
    if (item?.section) subParts.push(`§ ${item.section}`);
    if (item?.compareGroup && item?.compareRole) subParts.push(`${item.compareRole === 'before' ? '前' : '後'}:${item.compareGroup}`);
    if (item?.privacy?.hasGps) subParts.push('GPS');
    if (item?.excludeExport) subParts.push('🚫 不輸出');
    return subParts.join('｜') || (item?.sourceFormat ? String(item.sourceFormat).toUpperCase() : '圖片');
  }

  function refreshPhotoListRow(itemId) {
    const row = $('photoList')?.querySelector(`.photo-row[data-photo-id="${CSS.escape(String(itemId || ''))}"]`);
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (!row || !item) return;
    const name = row.querySelector('.fname');
    if (name) { name.textContent = item.displayName; name.title = `原始檔名：${item.originalName}`; }
    const sub = row.querySelector('.photo-sub');
    if (sub) sub.textContent = photoListSubText(item);
    row.classList.toggle('export-excluded', Boolean(item.excludeExport));
  }

  function renderList() {
    const list = $('photoList');
    resetThumbnailObserver();
    list.innerHTML = '';
    const validIds = new Set(state.items.map((item) => item.id));
    state.selectedIds = new Set([...state.selectedIds].filter((id) => validIds.has(id)));
    if (!state.items.length) {
      list.innerHTML = '<div class="empty">尚未加入照片</div>';
      state.selected = -1;
      state.selectedIds.clear();
      renderDashboard();
      updateButtons();
      return;
    }
    const query = String($('photoFilter')?.value || '').trim().toLocaleLowerCase('zh-Hant');
    const filterMode = String($('photoFilterMode')?.value || 'all');
    const docLocation = String($('location')?.value || '').trim();
    let visible = 0;
    state.items.forEach((item, index) => {
      const haystack = `${item.displayName || ''}
${item.originalName || ''}
${item.description || ''}
${item.location || ''}
${item.sourceFolder || ''}
${item.section || ''}
${item.tags || ''}
${item.compareGroup || ''}
${item.compareRole || ''}`.toLocaleLowerCase('zh-Hant');
      if (query && !haystack.includes(query)) return;
      if (filterMode === 'missingDesc' && String(item.description || '').trim()) return;
      if (filterMode === 'missingLocation' && (String(item.location || '').trim() || docLocation)) return;
      if (filterMode === 'heic' && !/hei[cf]/i.test(String(item.sourceFormat || ''))) return;
      if (filterMode === 'annotated' && !sanitizeAnnotations(item.annotations).length) return;
      if (filterMode === 'excluded' && !item.excludeExport) return;
      if (filterMode === 'selected' && !state.selectedIds.has(item.id)) return;
      visible += 1;
      const row = document.createElement('div');
      const multiSelected = state.selectedIds.has(item.id);
      row.className = `photo-row${index === state.selected ? ' active' : ''}${multiSelected ? ' multi-selected' : ''}${item.excludeExport ? ' export-excluded' : ''}${filterMode !== 'all' ? ' filter-highlight' : ''}`;
      row.dataset.photoId = item.id;
      row.dataset.photoIndex = String(index);
      row.draggable = true;
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'multi-check';
      check.checked = multiSelected;
      check.title = '勾選後可批次套用說明、地點或旋轉';
      check.addEventListener('click', (event) => event.stopPropagation());
      check.addEventListener('change', () => {
        if (check.checked) state.selectedIds.add(item.id); else state.selectedIds.delete(item.id);
        if (($('photoFilterMode')?.value || 'all') === 'selected') renderList(); else refreshListSelectionState();
      });
      const thumb = document.createElement('img');
      thumb.className = 'photo-thumb';
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      observeLazyThumbnail(thumb, item);
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(index + 1).padStart(2, '0');
      const nameWrap = document.createElement('span');
      nameWrap.className = 'fname-wrap';
      const name = document.createElement('span');
      name.className = 'fname';
      name.textContent = item.displayName;
      name.title = `原始檔名：${item.originalName}`;
      const sub = document.createElement('span');
      sub.className = 'photo-sub';
      sub.textContent = photoListSubText(item);
      nameWrap.append(name, sub);
      row.append(check, thumb, num, nameWrap);
      row.addEventListener('click', (event) => {
        if (event.shiftKey && state.selected >= 0) {
          const from = Math.min(state.selected, index), to = Math.max(state.selected, index);
          for (let i = from; i <= to; i += 1) state.selectedIds.add(state.items[i].id);
        }
        selectItem(index);
      });
      row.addEventListener('dragstart', () => { state.dragIndex = index; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); document.querySelectorAll('.photo-row.drag-before,.photo-row.drag-after').forEach((el) => el.classList.remove('drag-before','drag-after')); });
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        const rect = row.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        row.dataset.dropPosition = after ? 'after' : 'before';
        row.classList.toggle('drag-after', after); row.classList.toggle('drag-before', !after);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-before','drag-after'));
      row.addEventListener('drop', (event) => {
        event.preventDefault(); row.classList.remove('drag-before','drag-after');
        const from = state.dragIndex;
        if (from === null) return;
        let target = index + (row.dataset.dropPosition === 'after' ? 1 : 0);
        if (from < target) target -= 1;
        if (from === target) return;
        const [moved] = state.items.splice(from, 1);
        state.items.splice(target, 0, moved);
        state.selected = target;
        state.dragIndex = null;
        if ($('sortMode')) $('sortMode').value = 'manual';
        state.lastHealthResult = null;
        renderList();
        showSelected();
        scheduleAutosave();
      });
      list.appendChild(row);
    });
    if (!visible) list.innerHTML = '<div class="empty">找不到符合搜尋條件的照片</div>';
    renderDashboard();
    const history = $('historyStatus');
    if (history) history.textContent = `復原 ${state.historyUndo.length}｜重做 ${state.historyRedo.length}｜最多 30 個操作階段`;
    updateButtons();
    updateSmartSections();
  }

  function cropCss(crop) {
    const c = clampCrop(crop);
    return `inset(${c.top}% ${c.right}% ${c.bottom}% ${c.left}%)`;
  }

  function refreshListSelectionState() {
    const list = $('photoList');
    if (!list) return;
    list.querySelectorAll('.photo-row').forEach((row) => {
      const index = Number(row.dataset.photoIndex);
      const id = row.dataset.photoId || '';
      row.classList.toggle('active', Number.isInteger(index) && index === state.selected);
      row.classList.toggle('multi-selected', state.selectedIds.has(id));
      const check = row.querySelector('.multi-check');
      if (check) check.checked = state.selectedIds.has(id);
    });
    if ($('selectedCount')) $('selectedCount').textContent = `已勾選 ${state.selectedIds.size} 張`;
    renderExportScopeStatus();
    updateButtons();
    updateSmartSections();
  }

  function selectItem(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.items.length) return;
    if (state.selected === index) {
      showSelected();
      return;
    }
    state.selected = index;
    // 選取照片只更新 active 樣式，不重建整個清單，避免 100+ 張縮圖重新載入。
    refreshListSelectionState();
    showSelected();
  }

  function showSelected() {
    const preview = $('preview');
    preview.innerHTML = '';
    if (state.selected < 0 || !state.items[state.selected]) {
      $('selectedName').textContent = '尚未選取照片';
      $('description').value = '';
      $('note').value = '';
      $('photoName').value = '';
      $('photoLocation').value = '';
      if ($('photoSection')) $('photoSection').value = '';
      if ($('photoTags')) $('photoTags').value = '';
      if ($('compareGroup')) $('compareGroup').value = '';
      if ($('compareRole')) $('compareRole').value = '';
      if ($('excludeFromExport')) $('excludeFromExport').checked = false;
      $('rotateLabel').textContent = '目前：0°';
      $('cropSummary').textContent = '裁切：無';
      if ($('photoMeta')) $('photoMeta').textContent = '拍攝時間／來源資料夾：—';
      if ($('annotationCount')) $('annotationCount').textContent = '尚無註記';
      preview.className = 'preview fit';
      preview.innerHTML = '<span class="placeholder">尚未選取照片</span>';
      $('zoomLabel').textContent = '—';
      updateButtons();
      updateSmartSections();
      return;
    }
    const item = state.items[state.selected];
    releaseInactivePreviewUrls(item.id);
    const activePreviewUrl = ensureItemPreviewUrl(item);
    $('selectedName').textContent = `照片 ${String(state.selected + 1).padStart(2, '0')}｜${item.displayName}`;
    $('photoName').value = item.displayName;
    $('description').value = item.description || '';
    $('note').value = item.note || '';
    $('photoLocation').value = item.location || '';
    if ($('photoSection')) $('photoSection').value = item.section || '';
    if ($('photoTags')) $('photoTags').value = item.tags || '';
    if ($('compareGroup')) $('compareGroup').value = item.compareGroup || '';
    if ($('compareRole')) $('compareRole').value = item.compareRole || '';
    if ($('excludeFromExport')) $('excludeFromExport').checked = Boolean(item.excludeExport);
    $('rotateLabel').textContent = `目前：${item.rotation || 0}°`;
    if ($('annotationCount')) $('annotationCount').textContent = annotationCountText(item);
    if ($('photoMeta')) {
      const metaParts = [`拍攝時間：${item.capturedAt ? formatCapturedAt(item.capturedAt) : '未知'}`];
      if (item.captureSource) metaParts.push(`來源：${item.captureSource === 'exif' ? 'EXIF' : item.captureSource === 'file' ? '檔案時間' : item.captureSource}`);
      if (item.sourceFolder) metaParts.push(`資料夾：${item.sourceFolder}`);
      if (item.privacy?.hasGps) metaParts.push('⚠ 含 GPS EXIF');
      $('photoMeta').textContent = metaParts.join('｜');
    }
    const c = clampCrop(item.crop);
    $('cropSummary').textContent = (c.left || c.top || c.right || c.bottom)
      ? `裁切：左 ${c.left.toFixed(1)}%／上 ${c.top.toFixed(1)}%／右 ${c.right.toFixed(1)}%／下 ${c.bottom.toFixed(1)}%`
      : '裁切：無';
    const stage = document.createElement('div');
    stage.className = 'preview-stage';
    const img = document.createElement('img');
    img.id = 'previewImg';
    img.src = activePreviewUrl;
    img.alt = item.displayName;
    img.style.transform = `rotate(${item.rotation || 0}deg)`;
    img.style.clipPath = cropCss(item.crop);
    img.addEventListener('load', fitPreview);
    stage.appendChild(img);
    preview.appendChild(stage);
    updateButtons();
  }

  function fitPreview() {
    state.fitMode = true;
    state.zoom = 1;
    $('preview').classList.add('fit');
    const img = $('previewImg');
    if (img) {
      img.style.width = 'auto';
      img.style.height = 'auto';
    }
    $('zoomLabel').textContent = '適合';
  }

  function setZoom(percent) {
    const img = $('previewImg');
    if (!img) return;
    state.fitMode = false;
    state.zoom = Math.max(0.1, Math.min(5, percent / 100));
    $('preview').classList.remove('fit');
    img.style.width = `${Math.round(img.naturalWidth * state.zoom)}px`;
    img.style.height = `${Math.round(img.naturalHeight * state.zoom)}px`;
    $('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function renderQuickNotes() {
    const wrap = $('quickNotes');
    wrap.innerHTML = '';
    state.quickNotes.forEach((noteText) => {
      const button = document.createElement('button');
      button.className = 'quick';
      button.type = 'button';
      button.textContent = noteText;
      button.addEventListener('click', () => {
        if (state.selected < 0) return;
        state.items[state.selected].description = noteText;
        $('description').value = noteText;
        scheduleAutosave();
      });
      wrap.appendChild(button);
    });
  }

  function fileDescriptor(value) {
    const file = value?.file && typeof value.file.slice === 'function' ? value.file : value;
    if (!file || typeof file.slice !== 'function') return null;
    const info = folderInfoFromFile(file, value?.relativePath || '');
    return { file, ...info };
  }

  function readLegacyFileEntry(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }

  function readLegacyDirectoryBatch(reader) {
    return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  }

  async function walkLegacyDropEntry(entry, prefix, out) {
    if (!entry) return;
    if (entry.isFile) {
      const file = await readLegacyFileEntry(entry);
      out.push({ file, relativePath: `${prefix}${file.name}` });
      return;
    }
    if (!entry.isDirectory) return;
    const nextPrefix = `${prefix}${entry.name}/`;
    const reader = entry.createReader();
    while (true) {
      const batch = await readLegacyDirectoryBatch(reader);
      if (!batch.length) break;
      for (const child of batch) await walkLegacyDropEntry(child, nextPrefix, out);
      if (out.length > maxPhotosForDevice() * 4) throw new Error('拖入資料夾包含過多檔案，已停止掃描。');
    }
  }

  async function collectDroppedFiles(dataTransfer) {
    const out = [];
    const entries = [...(dataTransfer?.items || [])].map((item) => {
      try { return typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null; } catch (_) { return null; }
    }).filter(Boolean);
    if (entries.length) {
      for (const entry of entries) await walkLegacyDropEntry(entry, '', out);
      return out;
    }
    return [...(dataTransfer?.files || [])].map((file) => ({ file, relativePath: file.webkitRelativePath || '' }));
  }

  async function addFiles(files, options = {}) {
    const candidates = [...(files || [])].map(fileDescriptor).filter(Boolean);
    state.failedImports = [];
    state.lastImportSummary = null;
    if (!candidates.length) {
      setStatus('沒有可加入的檔案；可使用 JPG / PNG / WEBP / BMP / HEIC / HEIF。', 'err');
      return;
    }

    const currentBytes = state.items.reduce((sum, item) => sum + Number(item.blob?.size || 0), 0);
    const accepted = [];
    const skipped = [];
    let convertedHeic = 0;
    let totalBytes = currentBytes;
    let stopped = false;
    const availableSlots = Math.max(0, maxPhotosForDevice() - state.items.length);
    if (!availableSlots) {
      setStatus(`已達目前記憶體模式照片數量上限 ${maxPhotosForDevice()} 張。`, 'err');
      return;
    }
    const queue = candidates.slice(0, availableSlots);
    if (queue.length < candidates.length) skipped.push(`另有 ${candidates.length - queue.length} 項超過照片數量上限未處理`);

    const heicCount = queue.filter((descriptor) => HEIC_RE.test(descriptor.file?.name || '')).length;
    const parallelism = heicCount ? heicPoolSizeForDevice() : 1;
    const results = new Array(queue.length);
    let nextIndex = 0;
    let completed = 0;
    const newFailures = [];

    state.importRunning = true;
    state.importCancelRequested = false;
    state.importProgress = { active: true, total: queue.length, completed: 0, heicTotal: heicCount, heicDone: 0, failed: 0 };
    renderLargeProjectMonitor();
    showLoading(
      '正在快速匯入照片…',
      heicCount
        ? `偵測到 ${heicCount} 張 HEIC/HEIF；使用 ${parallelism} 路持久 Worker 平行解碼。`
        : `準備處理 ${queue.length} 個檔案。`,
      { cancelable: queue.length > 1, progress: true },
    );

    const normalizeWorker = async () => {
      while (true) {
        if (state.importCancelRequested) { stopped = true; return; }
        const index = nextIndex++;
        if (index >= queue.length) return;
        const descriptor = queue[index];
        const file = descriptor.file;
        try {
          if (!file.size) throw new Error('空白檔案');
          if (file.size > MAX_SINGLE_IMAGE_BYTES) throw new Error('單張照片不可超過 40 MB');
          const isHeic = HEIC_RE.test(file.name || '');
          $('loadingText').textContent = isHeic
            ? `HEIC 平行解碼 ${completed + 1} / ${queue.length}：${file.name || '未命名檔案'}（${parallelism} 路）`
            : `正在驗證 ${completed + 1} / ${queue.length}：${file.name || '未命名檔案'}`;
          const normalized = await normalizeImportedImage(file, file.name || `檔案 ${index + 1}`);
          results[index] = { ok: true, descriptor, normalized };
        } catch (error) {
          const message = String(error?.message || '圖片無法解碼');
          if (state.importCancelRequested || /取消|重新建立 HEIC 平行解碼器/.test(message)) {
            stopped = true;
            results[index] = { ok: false, canceled: true, descriptor, error: message };
          } else {
            results[index] = { ok: false, descriptor, error: message };
          }
        } finally {
          completed += 1;
          if (HEIC_RE.test(file.name || '')) state.importProgress.heicDone += 1;
          if (results[index] && !results[index].ok && !results[index].canceled) state.importProgress.failed += 1;
          state.importProgress.completed = completed;
          updateLoadingProgress(completed, queue.length);
          renderLargeProjectMonitor();
        }
      }
    };

    try {
      const workers = Array.from({ length: Math.max(1, Math.min(parallelism, queue.length)) }, () => normalizeWorker());
      await Promise.all(workers);
    } finally {
      state.importRunning = false;
      state.importProgress.active = false;
      hideLoading();
      renderLargeProjectMonitor();
    }

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (!result) continue;
      const file = result.descriptor.file;
      if (!result.ok) {
        if (!result.canceled) {
          skipped.push(`${file.name || '未命名檔案'}：${result.error}`);
          newFailures.push({ file, relativePath: result.descriptor.relativePath || '', error: result.error });
        }
        continue;
      }
      const normalized = result.normalized;
      if (normalized.blob.size > MAX_SINGLE_IMAGE_BYTES) {
        skipped.push(`${file.name || '未命名檔案'}：轉換後照片超過 40 MB 上限`);
        continue;
      }
      if (totalBytes + normalized.blob.size > maxTotalImageBytesForDevice()) {
        skipped.push(`${file.name || '未命名檔案'}：加入後會超過此裝置約 ${formatMiB(maxTotalImageBytesForDevice())} 的安全專案容量上限`);
        break;
      }
      const privacy = normalized.privacy || { hasExif: false, hasGps: false };
      const fileTime = Number(file.lastModified || 0) > 0 ? new Date(file.lastModified).toISOString() : '';
      accepted.push({
        blob: normalized.blob,
        originalName: file.name || `photo_${index + 1}.jpg`,
        displayName: file.name || `photo_${index + 1}.jpg`,
        converted: normalized.converted,
        decoder: normalized.decoder,
        sourceFormat: normalized.sourceFormat,
        sourceBytes: normalized.sourceBytes,
        sourceDimensions: normalized.sourceDimensions,
        normalizedAt: normalized.normalizedAt,
        privacy: { hasExif: Boolean(privacy.hasExif), hasGps: Boolean(privacy.hasGps) },
        capturedAt: privacy.capturedAt || fileTime,
        captureSource: privacy.capturedAt ? 'exif' : (fileTime ? 'file' : ''),
        sourceFolder: result.descriptor.sourceFolder || '',
        suggestedLocation: result.descriptor.suggestedLocation || '',
      });
      if (normalized.converted) convertedHeic += 1;
      totalBytes += normalized.blob.size;
    }

    state.failedImports = newFailures;
    state.lastImportSummary = { accepted: accepted.length, heic: convertedHeic, skipped: skipped.length, failed: newFailures.length, total: queue.length, stopped };
    renderLargeProjectMonitor();
    if (!accepted.length) {
      const stopText = stopped ? '匯入已停止。' : '沒有照片成功加入。';
      setStatus(skipped.length ? `${stopText}${skipped.slice(0, 2).join('；')}` : stopText, stopped ? '' : 'err');
      return;
    }

    const autoFolderLocation = Boolean($('folderToLocation')?.checked);
    for (const item of accepted) {
      state.items.push({
        id: uid(), blob: item.blob, originalName: item.originalName, displayName: item.displayName,
        description: '', note: '', location: autoFolderLocation ? item.suggestedLocation : '', rotation: 0, crop: defaultCrop(), annotations: [], section: '', tags: '', compareGroup: '', compareRole: '', excludeExport: false, previewUrl: '', thumbUrl: '',
        sourceFormat: item.sourceFormat || '', sourceBytes: Number(item.sourceBytes || 0), decoder: item.decoder || '',
        sourceDimensions: item.sourceDimensions || '', normalizedAt: item.normalizedAt || '', privacy: item.privacy || { hasExif: false, hasGps: false },
        capturedAt: item.capturedAt || '', captureSource: item.captureSource || '', sourceFolder: item.sourceFolder || '', importOrder: nextImportOrder(),
      });
    }
    if (state.selected < 0) state.selected = 0;
    state.lastHealthResult = null;
    if ($('sortMode')) $('sortMode').value = 'manual';
    renderList(); showSelected();
    const heicText = convertedHeic
      ? `；HEIC/HEIF 已以 ${parallelism} 路平行解碼 ${convertedHeic} 張${state.nativeHeicSupport === false ? '（已略過後續無效的原生解碼嘗試）' : ''}`
      : '';
    const folderText = accepted.some((item) => item.sourceFolder) ? '；已保留資料夾來源資訊' : '';
    const skippedText = skipped.length ? `；另略過 ${skipped.length} 項（${skipped.slice(0, 2).join('；')}${skipped.length > 2 ? '…' : ''}）` : '';
    const stoppedText = stopped ? '；使用者已停止後續匯入' : '';
    setStatus(`已加入 ${accepted.length} 張，目前共 ${state.items.length} 張${heicText}${folderText}${skippedText}${stoppedText}。`, skipped.length ? 'err' : 'ok');
    renderLargeProjectMonitor();
    scheduleAutosave();
    if (state.autosaveEnabled) await saveAutosaveNow();
  }

  function revokeStateUrls() {
    resetThumbnailObserver({ releaseUrls: true, dropCache: true });
    state.items.forEach((item) => {
      if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      item.previewUrl = '';
    });
    if (state.logo?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.logo.previewUrl);
  }

  function applySelectedName() {
    if (state.selected < 0) return;
    const item = state.items[state.selected];
    item.displayName = buildDisplayName($('photoName').value, item.originalName);
    refreshPhotoListRow(item.id);
    showSelected();
    setStatus('已更新照片檔名。', 'ok');
    scheduleAutosave();
  }

  function batchRenameAll() {
    const prefix = safeFilename($('renamePrefix').value, '').trim();
    if (!prefix) {
      setStatus('請先輸入批次重新命名的前綴。', 'err');
      return;
    }
    state.items.forEach((item, index) => {
      const ext = splitNameExt(item.originalName).ext || '.jpg';
      item.displayName = `${prefix}${String(index + 1).padStart(2, '0')}${ext}`;
    });
    renderList();
    showSelected();
    setStatus('已完成批次重新命名。', 'ok');
    scheduleAutosave();
  }

  function moveSelected(delta) {
    if (state.selected < 0) return;
    const next = state.selected + delta;
    if (next < 0 || next >= state.items.length) return;
    [state.items[state.selected], state.items[next]] = [state.items[next], state.items[state.selected]];
    state.selected = next;
    if ($('sortMode')) $('sortMode').value = 'manual';
    renderList();
    showSelected();
    scheduleAutosave();
  }


  function applyBatchDescription() {
    const items = getBatchSelectedItems();
    if (!items.length) return setStatus('請先在左側勾選照片。', 'err');
    const value = $('batchDescription').value;
    items.forEach((item) => { item.description = value; });
    showSelected();
    setStatus(`已將照片說明套用到 ${items.length} 張照片。`, 'ok'); scheduleAutosave();
  }

  function applyBatchLocation() {
    const items = getBatchSelectedItems();
    if (!items.length) return setStatus('請先在左側勾選照片。', 'err');
    const value = $('batchLocation').value.trim();
    items.forEach((item) => { item.location = value; });
    showSelected();
    setStatus(`已將照片地點套用到 ${items.length} 張照片。`, 'ok'); scheduleAutosave();
  }

  function batchRotate(delta) {
    const items = getBatchSelectedItems();
    if (!items.length) return setStatus('請先在左側勾選照片。', 'err');
    items.forEach((item) => {
      item.rotation = ((Number(item.rotation || 0) + delta) % 360 + 360) % 360;
      item.annotations = rotateAnnotations(item.annotations, delta);
    });
    showSelected(); refreshListSelectionState();
    setStatus(`已旋轉 ${items.length} 張照片。`, 'ok'); scheduleAutosave();
  }

  function applyBatchSection() {
    const items = getBatchSelectedItems();
    if (!items.length) return setStatus('請先在左側勾選照片。', 'err');
    const value = String($('batchSectionName')?.value || '').trim().slice(0, MAX_META_TEXT_CHARS);
    items.forEach((item) => { item.section = value; refreshPhotoListRow(item.id); });
    showSelected();
    setStatus(`已將章節／分類套用到 ${items.length} 張照片。`, 'ok');
    scheduleAutosave();
  }

  function setSelectedExportExclusion(excluded) {
    const items = getBatchSelectedItems();
    if (!items.length) return setStatus('請先在左側勾選照片。', 'err');
    items.forEach((item) => { item.excludeExport = Boolean(excluded); refreshPhotoListRow(item.id); });
    renderList(); showSelected(); renderExportScopeStatus();
    setStatus(`${excluded ? '已排除' : '已恢復'} ${items.length} 張照片的 Word / PDF 輸出。`, 'ok');
    scheduleAutosave();
  }

  function setCurrentExportExclusion(value) {
    if (state.selected < 0 || !state.items[state.selected]) return;
    const item = state.items[state.selected];
    item.excludeExport = Boolean(value);
    refreshPhotoListRow(item.id);
    if (($('photoFilterMode')?.value || 'all') === 'excluded') renderList();
    renderExportScopeStatus(); renderDashboard();
    scheduleAutosave();
  }

  async function retryFailedImports() {
    if (!state.failedImports.length || state.importRunning) return;
    const retry = state.failedImports.map((entry) => ({ file: entry.file, relativePath: entry.relativePath || '' }));
    setStatus(`正在重試 ${retry.length} 張失敗照片…`);
    await addFiles(retry, { retry: true });
  }

  function clearImportSummary() {
    state.failedImports = [];
    state.lastImportSummary = null;
    state.importProgress = { active: false, total: 0, completed: 0, heicTotal: 0, heicDone: 0, failed: 0 };
    renderLargeProjectMonitor();
  }

  function openCrop() {
    if (state.selected < 0) return;
    const item = state.items[state.selected];
    const c = clampCrop(item.crop);
    $('cropImage').style.transform = 'none';
    $('cropImage').src = ensureItemPreviewUrl(item);
    for (const key of ['Left', 'Top', 'Right', 'Bottom']) {
      const value = c[key.toLowerCase()] || 0;
      $(`crop${key}`).value = value;
      $(`crop${key}Text`).textContent = `${Number(value).toFixed(1)}%`;
    }
    $('cropModal').classList.add('show');
    $('cropImage').onload = () => requestAnimationFrame(updateCropPreview);
    requestAnimationFrame(updateCropPreview);
  }

  function getCropControls() {
    return clampCrop({
      left: Number($('cropLeft').value), top: Number($('cropTop').value),
      right: Number($('cropRight').value), bottom: Number($('cropBottom').value),
    });
  }

  function updateCropPreview() {
    const c = getCropControls();
    for (const key of ['Left', 'Top', 'Right', 'Bottom']) {
      const value = c[key.toLowerCase()];
      $(`crop${key}`).value = value;
      $(`crop${key}Text`).textContent = `${Number(value).toFixed(1)}%`;
    }
    const overlay = $('cropOverlay');
    overlay.style.left = `${c.left}%`;
    overlay.style.top = `${c.top}%`;
    overlay.style.width = `${100 - c.left - c.right}%`;
    overlay.style.height = `${100 - c.top - c.bottom}%`;
  }


  function setCropControls(crop) {
    const c = clampCrop(crop);
    for (const key of ['Left', 'Top', 'Right', 'Bottom']) $('crop' + key).value = c[key.toLowerCase()];
    updateCropPreview();
  }

  function beginCropPointer(event) {
    const wrap = $('cropImageWrap');
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const c = getCropControls();
    const box = {
      left: rect.width * c.left / 100,
      top: rect.height * c.top / 100,
      right: rect.width * (1 - c.right / 100),
      bottom: rect.height * (1 - c.bottom / 100),
    };
    state.cropPointer = {
      id: event.pointerId,
      mode: event.target?.dataset?.handle || 'move',
      startX: event.clientX - rect.left,
      startY: event.clientY - rect.top,
      box, width: rect.width, height: rect.height,
    };
    $('cropOverlay').setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveCropPointer(event) {
    const s = state.cropPointer;
    if (!s || s.id !== event.pointerId) return;
    const dx = (event.clientX - $('cropImageWrap').getBoundingClientRect().left) - s.startX;
    const dy = (event.clientY - $('cropImageWrap').getBoundingClientRect().top) - s.startY;
    let { left, top, right, bottom } = s.box;
    const minW = Math.max(24, s.width * 0.15), minH = Math.max(24, s.height * 0.15);
    if (s.mode === 'move') {
      const w = right - left, h = bottom - top;
      left = Math.max(0, Math.min(s.width - w, left + dx)); right = left + w;
      top = Math.max(0, Math.min(s.height - h, top + dy)); bottom = top + h;
    } else {
      if (s.mode.includes('w')) left = Math.max(0, Math.min(right - minW, left + dx));
      if (s.mode.includes('e')) right = Math.min(s.width, Math.max(left + minW, right + dx));
      if (s.mode.includes('n')) top = Math.max(0, Math.min(bottom - minH, top + dy));
      if (s.mode.includes('s')) bottom = Math.min(s.height, Math.max(top + minH, bottom + dy));
    }
    setCropControls({
      left: left / s.width * 100,
      top: top / s.height * 100,
      right: (s.width - right) / s.width * 100,
      bottom: (s.height - bottom) / s.height * 100,
    });
  }

  function endCropPointer(event) {
    if (state.cropPointer?.id === event.pointerId) state.cropPointer = null;
  }

  function renderLogo() {
    if (!state.logo) {
      $('logoPreview').hidden = true;
      $('logoPreview').removeAttribute('src');
      $('logoName').textContent = '尚未選擇';
      return;
    }
    $('logoPreview').src = state.logo.previewUrl;
    $('logoPreview').hidden = false;
    $('logoName').textContent = state.logo.name;
  }

  function projectSnapshot() {
    return {
      format: 'ImageRecordAssistant.autosave', app_version: APP_VERSION, schema_version: PHOTOJOB_SCHEMA_VERSION,
      meta: metaPayload(), quick_notes: [...state.quickNotes], selected: state.selected, selected_ids: [...state.selectedIds],
      photos: state.items.map((item) => ({
        id: item.id, blob: item.blob, original_name: item.originalName, display_name: item.displayName,
        description: item.description || '', note: item.note || '', location: item.location || '', rotation: item.rotation || 0,
        crop: clampCrop(item.crop), annotations: sanitizeAnnotations(item.annotations), source_format: item.sourceFormat || '', source_bytes: Number(item.sourceBytes || 0),
        decoder: item.decoder || '', source_dimensions: item.sourceDimensions || '', normalized_at: item.normalizedAt || '', privacy: item.privacy || { hasExif: false, hasGps: false },
        captured_at: item.capturedAt || '', capture_source: item.captureSource || '', source_folder: item.sourceFolder || '', import_order: Number(item.importOrder || 0),
        section: item.section || '', tags: item.tags || '', compare_group: item.compareGroup || '', compare_role: item.compareRole || '', exclude_export: Boolean(item.excludeExport),
      })),
      logo: state.logo ? { name: state.logo.name, blob: state.logo.blob } : null,
      saved_at: new Date().toISOString(),
    };
  }

  function recoveryJournalSnapshot() {
    return {
      version: APP_VERSION, saved_at: new Date().toISOString(),
      item_ids: state.items.map((item) => item.id),
      selected: state.selected, selected_ids: [...state.selectedIds],
      meta: metaPayload(), quick_notes: [...state.quickNotes],
      photos: state.items.map((item) => ({
        id: item.id, display_name: item.displayName, description: item.description || '',
        note: item.note || '', location: item.location || '', rotation: item.rotation || 0, crop: clampCrop(item.crop), annotations: sanitizeAnnotations(item.annotations),
        captured_at: item.capturedAt || '', capture_source: item.captureSource || '', source_folder: item.sourceFolder || '', import_order: Number(item.importOrder || 0),
        section: item.section || '', tags: item.tags || '', compare_group: item.compareGroup || '', compare_role: item.compareRole || '', exclude_export: Boolean(item.excludeExport),
      })),
    };
  }

  function writeRecoveryJournal() {
    if (!state.autosaveEnabled || state.restoring) return;
    try {
      let snapshot = recoveryJournalSnapshot();
      let text = JSON.stringify(snapshot);
      if (text.length > 1_500_000) {
        const current = state.items[state.selected];
        snapshot = { ...snapshot, partial: true, quick_notes: [], photos: current ? snapshot.photos.filter((p) => p.id === current.id) : [] };
      }
      const existingRaw = localStorage.getItem(AUTOSAVE_JOURNAL_KEY);
      let generations = [];
      if (existingRaw) {
        try { const parsed = JSON.parse(existingRaw); generations = Array.isArray(parsed) ? parsed : [parsed]; } catch (_) {}
      } else {
        const v340 = localStorage.getItem(LEGACY_V340_AUTOSAVE_JOURNAL_KEY);
        if (v340) { try { const parsed = JSON.parse(v340); generations = Array.isArray(parsed) ? parsed : [parsed]; } catch (_) {} }
        const legacy = !generations.length ? localStorage.getItem(LEGACY_AUTOSAVE_JOURNAL_KEY) : null;
        if (legacy) { try { const parsed = JSON.parse(legacy); if (isPlainObject(parsed)) generations = [parsed]; } catch (_) {} }
      }
      const previous = generations[0];
      if (!previous || JSON.stringify(previous) !== JSON.stringify(snapshot)) generations.unshift(snapshot);
      generations = generations.filter(isPlainObject).slice(0, RECOVERY_GENERATION_LIMIT);
      let packed = JSON.stringify(generations);
      while (packed.length > 4_000_000 && generations.length > 1) { generations.pop(); packed = JSON.stringify(generations); }
      localStorage.setItem(AUTOSAVE_JOURNAL_KEY, packed);
      localStorage.removeItem(LEGACY_V340_AUTOSAVE_JOURNAL_KEY);
      localStorage.removeItem(LEGACY_AUTOSAVE_JOURNAL_KEY);
    } catch (_) {}
  }

  function clearRecoveryJournal() {
    try { localStorage.removeItem(AUTOSAVE_JOURNAL_KEY); localStorage.removeItem(LEGACY_V340_AUTOSAVE_JOURNAL_KEY); localStorage.removeItem(LEGACY_AUTOSAVE_JOURNAL_KEY); } catch (_) {}
  }

  function readRecoveryJournals() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_JOURNAL_KEY) || localStorage.getItem(LEGACY_V340_AUTOSAVE_JOURNAL_KEY) || localStorage.getItem(LEGACY_AUTOSAVE_JOURNAL_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return (Array.isArray(parsed) ? parsed : [parsed]).filter(isPlainObject).slice(0, RECOVERY_GENERATION_LIMIT);
    } catch (_) { return []; }
  }

  function editableRecoveryFingerprint(data) {
    if (!data) return '';
    return JSON.stringify({
      meta: data.meta || {}, quick_notes: data.quick_notes || [], selected: data.selected, selected_ids: data.selected_ids || [],
      photos: (data.photos || []).map((p) => ({ id: p.id, display_name: p.display_name || p.displayName || '', description: p.description || '', note: p.note || '', location: p.location || '', rotation: Number(p.rotation || 0), crop: clampCrop(p.crop), annotations: sanitizeAnnotations(p.annotations), captured_at: p.captured_at || '', source_folder: p.source_folder || '', import_order: Number(p.import_order || 0), section: p.section || '', tags: p.tags || '', compare_group: p.compare_group || '', compare_role: p.compare_role || '', exclude_export: Boolean(p.exclude_export) })),
    });
  }

  function newestApplicableRecoveryJournal(autosave, journals) {
    for (const journal of journals || []) {
      const merged = applyRecoveryJournalToAutosave(autosave, journal);
      if (merged === autosave) continue;
      if (editableRecoveryFingerprint(merged) === editableRecoveryFingerprint(autosave)) return { journal: null, merged: autosave };
      return { journal, merged };
    }
    return { journal: null, merged: autosave };
  }

  function applyRecoveryJournalToAutosave(autosave, journal) {
    if (!autosave || !journal || !Array.isArray(autosave.photos) || !Array.isArray(journal.item_ids)) return autosave;
    const autosaveIds = autosave.photos.map((p) => p.id);
    if (autosaveIds.length !== journal.item_ids.length) return autosave;
    const savedSet = new Set(autosaveIds);
    if (savedSet.size !== autosaveIds.length || journal.item_ids.some((id) => !savedSet.has(id))) return autosave;
    const byId = new Map(autosave.photos.map((p) => [p.id, p]));
    const edits = new Map((journal.photos || []).map((p) => [p.id, p]));
    const ordered = journal.item_ids.map((id) => byId.get(id)).filter(Boolean);
    return {
      ...autosave,
      meta: isPlainObject(journal.meta) ? journal.meta : autosave.meta,
      quick_notes: Array.isArray(journal.quick_notes) && journal.quick_notes.length ? journal.quick_notes : autosave.quick_notes,
      selected: Number.isInteger(journal.selected) ? journal.selected : autosave.selected,
      selected_ids: Array.isArray(journal.selected_ids) ? journal.selected_ids.filter((id) => savedSet.has(id)) : autosave.selected_ids,
      photos: ordered.map((p) => {
        const e = edits.get(p.id);
        return e ? { ...p, ...e, blob: p.blob, original_name: p.original_name, source_format: p.source_format, source_bytes: p.source_bytes, decoder: p.decoder, source_dimensions: p.source_dimensions, normalized_at: p.normalized_at } : p;
      }),
      journal_recovered_at: journal.saved_at || '',
    };
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('無法開啟本機資料庫'));
    });
  }

  async function saveAutosaveNow() {
    renderTopAutosaveBadge();
    if (state.restoring || !state.autosaveEnabled) return true;
    if (state.autosaveInFlight) return state.autosaveInFlight;
    state.autosaveInFlight = (async () => {
      try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(projectSnapshot(), AUTOSAVE_KEY);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        });
        db.close();
        state.autosaveFailed = false;
        state.autosaveLastError = '';
        state.lastAutosaveAt = new Date();
        writeRecoveryJournal();
        renderAutosaveHealth();
        return true;
      } catch (error) {
        state.autosaveFailed = true;
        state.autosaveLastError = error?.message || '瀏覽器儲存空間不足或無法寫入';
        renderAutosaveHealth();
        console.warn('Autosave failed', error);
        setStatus(`⚠ 自動儲存失敗：${error?.message || '瀏覽器儲存空間不足或無法寫入'}。請立即儲存 .photojob。`, 'err');
        return false;
      } finally {
        state.autosaveInFlight = null;
        renderTopAutosaveBadge();
      }
    })();
    renderTopAutosaveBadge();
    return state.autosaveInFlight;
  }

  function scheduleAutosave(markChanged = true) {
    clearTimeout(state.autosaveTimer);
    if (markChanged && !state.restoring) {
      state.lastHealthResult = null;
      refreshDirtyState();
      queueHistoryCheckpoint();
      renderDashboard();
    }
    if (!state.autosaveEnabled || state.restoring) return;
    writeRecoveryJournal();
    state.autosaveTimer = setTimeout(() => { state.autosaveTimer = null; renderTopAutosaveBadge(); saveAutosaveNow(); }, AUTOSAVE_DELAY_MS);
    renderTopAutosaveBadge();
  }

  async function readAutosave() {
    try {
      const db = await openDb();
      const result = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(AUTOSAVE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return result;
    } catch (error) {
      console.warn('Autosave read failed', error);
      return null;
    }
  }

  async function clearAutosave() {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(AUTOSAVE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (error) {
      console.warn(error);
    }
  }


  function deleteAutosaveDatabase() {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error || new Error('IndexedDB 資料庫刪除失敗'));
        req.onblocked = () => reject(new Error('本機資料庫仍被其他分頁使用，請關閉其他本程式分頁後再重試'));
      } catch (error) { reject(error); }
    });
  }

  async function clearAllLocalProjectData() {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
    // Shared-computer privacy rule: clearing local data also disables autosave so
    // pagehide/beforeunload cannot silently recreate the just-deleted database.
    state.autosaveEnabled = false;
    state.autosaveFailed = false;
    state.autosaveLastError = '';
    state.lastAutosaveAt = null;
    $('autosaveEnabled').checked = false;
    try { localStorage.setItem(AUTOSAVE_PREF_KEY, 'false'); } catch (_) {}
    try {
      clearRecoveryJournal();
      await clearAutosave();
      await deleteAutosaveDatabase();
      localStorage.removeItem(CASE_TEMPLATE_KEY);
      state.caseTemplates = [];
      renderCaseTemplates();
      renderAutosaveHealth();
      setStatus('本機自動儲存與案件範本已確實清除，且已停用自動儲存；目前畫面中的照片仍保留。', 'ok');
      return true;
    } catch (error) {
      setStatus(`清除本機資料失敗：${error.message}`, 'err');
      return false;
    }
  }

  async function applyProjectData(data) {
    state.restoring = true;
    try {
      revokeStateUrls();
      state.failedImports = []; state.lastImportSummary = null; state.importProgress = { active: false, total: 0, completed: 0, heicTotal: 0, heicDone: 0, failed: 0 };
      state.items = [];
      state.selectedIds.clear();
      const photos = data.photos || [];
      for (const photo of photos) {
        const blob = photo.blob;
        if (!(blob instanceof Blob)) continue;
        state.items.push({
          id: photo.id || uid(), blob,
          originalName: photo.original_name || photo.originalName || 'photo.jpg',
          displayName: photo.display_name || photo.displayName || photo.original_name || 'photo.jpg',
          description: photo.description || '', note: photo.note || '', location: photo.location || '', rotation: Number(photo.rotation || 0) % 360,
          crop: clampCrop(photo.crop), annotations: sanitizeAnnotations(photo.annotations), previewUrl: '', thumbUrl: '',
          sourceFormat: photo.source_format || '', sourceBytes: Number(photo.source_bytes || 0), decoder: photo.decoder || '',
          sourceDimensions: photo.source_dimensions || '', normalizedAt: photo.normalized_at || '',
          privacy: isPlainObject(photo.privacy) ? { hasExif: Boolean(photo.privacy.hasExif), hasGps: Boolean(photo.privacy.hasGps) } : { hasExif: false, hasGps: false },
          capturedAt: String(photo.captured_at || photo.capturedAt || ''), captureSource: String(photo.capture_source || photo.captureSource || ''),
          sourceFolder: String(photo.source_folder || photo.sourceFolder || ''), importOrder: Number(photo.import_order || photo.importOrder || state.items.length + 1),
          section: String(photo.section || ''), tags: String(photo.tags || ''), compareGroup: String(photo.compare_group || photo.compareGroup || ''), compareRole: ['before','after'].includes(photo.compare_role || photo.compareRole) ? String(photo.compare_role || photo.compareRole) : '', excludeExport: Boolean(photo.exclude_export ?? photo.excludeExport),
        });
      }
      state.importSequence = state.items.reduce((max, item) => Math.max(max, Number(item.importOrder || 0)), 0);
      state.lastHealthResult = null;
      if ($('sortMode')) $('sortMode').value = 'manual';
      if ($('photoFilter')) $('photoFilter').value = '';
      if ($('photoFilterMode')) $('photoFilterMode').value = 'all';
      state.quickNotes = Array.isArray(data.quick_notes) && data.quick_notes.length ? [...data.quick_notes] : state.quickNotes;
      const meta = data.meta || {};
      $('orgName').value = meta.org_name || '';
      $('title').value = meta.title || '照片紀錄表';
      $('caseName').value = meta.case || '';
      if ($('caseNumber')) $('caseNumber').value = meta.case_no || '';
      $('recordDate').value = meta.date || localDateString();
      $('location').value = meta.location || '';
      $('perPage').value = String(meta.per_page || 2);
      $('cover').checked = Boolean(meta.cover);
      $('includePageNumber').checked = Boolean(meta.page_numbers);
      if ($('watermarkEnabled')) $('watermarkEnabled').checked = Boolean(meta.watermark_enabled);
      if ($('watermarkText')) $('watermarkText').value = meta.watermark_text || '';
      if ($('smartLongSplit')) $('smartLongSplit').checked = meta.smart_long_split !== false;
      if ($('exportScope')) $('exportScope').value = ['included','selected'].includes(meta.export_scope) ? meta.export_scope : 'included';
      state.caseArchived = Boolean(meta.archived);
      state.caseArchivedAt = meta.archived_at || '';
      if (state.logo?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.logo.previewUrl);
      if (data.logo?.blob instanceof Blob) {
        state.logo = { name: data.logo.name || 'logo.png', blob: data.logo.blob, previewUrl: URL.createObjectURL(data.logo.blob) };
      } else {
        state.logo = null;
      }
      state.selected = state.items.length ? Math.min(Math.max(0, Number(data.selected || 0)), state.items.length - 1) : -1;
      const validIds = new Set(state.items.map((item) => item.id));
      state.selectedIds = new Set((data.selected_ids || []).filter((id) => validIds.has(id)));
      renderQuickNotes();
      renderLogo();
      renderList();
      showSelected();
      applyArchiveMode();
    } finally {
      state.restoring = false;
    }
  }

  async function saveProject() {
    if (!state.items.length) return false;
    if (!librariesReady()) {
      setStatus('JSZip 元件尚未載入，請確認 vendor/jszip.min.js 是否存在後重新整理。', 'err');
      return false;
    }

    const base = safeFilename($('caseName').value || $('title').value || '照片紀錄專案');
    const filename = safeFilename(`${base}.photojob`, '照片紀錄專案.photojob');
    let fileHandle = null;
    let pickerMode = false;

    if (typeof window.showSaveFilePicker === 'function') {
      try {
        fileHandle = await window.showSaveFilePicker({
          id: 'image-record-assistant-photojob',
          suggestedName: filename,
          types: [{ description: '圖片紀錄整理助手專案', accept: { 'application/octet-stream': ['.photojob'] } }],
        });
        pickerMode = true;
      } catch (error) {
        if (error?.name === 'AbortError') {
          setStatus('已取消儲存；目前變更仍標示為尚未另存。');
          return false;
        }
        console.warn('File System Access API unavailable; falling back to browser download.', error);
      }
    }

    const projectBytes = state.items.reduce((sum, item) => sum + Number(item.blob?.size || 0), 0) + Number(state.logo?.blob?.size || 0);
    if (projectBytes > maxTotalImageBytesForDevice()) {
      setStatus(`專案圖片資料約 ${formatMiB(projectBytes)}，超過此裝置安全上限 ${formatMiB(maxTotalImageBytesForDevice())}；請先刪除部分照片再儲存。`, 'err');
      return false;
    }

    showLoading('正在建立 .photojob 專案檔…', '正在計算 SHA-256 完整性驗證碼。');
    try {
      const zip = new JSZip();
      const manifest = {
        format: 'ImageRecordAssistant.photojob', schema_version: PHOTOJOB_SCHEMA_VERSION, app_version: APP_VERSION,
        meta: metaPayload(), quick_notes: [...state.quickNotes], selected: state.selected,
        selected_ids: [...state.selectedIds], photos: [], logo: null,
      };
      const fileHashes = {};
      for (let i = 0; i < state.items.length; i += 1) {
        const item = state.items[i];
        $('loadingText').textContent = `正在驗證照片 ${i + 1} / ${state.items.length}…`;
        const validated = await validateDecodedProjectImage(item.blob, item.originalName || `照片 ${i + 1}`);
        const ext = ({ jpeg: '.jpg', png: '.png', webp: '.webp', bmp: '.bmp' })[validated.magic.format];
        const path = `images/${String(i + 1).padStart(4, '0')}${ext}`;
        zip.file(path, validated.blob); fileHashes[path] = await sha256Hex(validated.blob);
        manifest.photos.push({
          id: item.id, file: path, original_name: item.originalName, display_name: item.displayName,
          description: item.description || '', note: item.note || '', location: item.location || '',
          rotation: item.rotation || 0, crop: clampCrop(item.crop), annotations: sanitizeAnnotations(item.annotations), media_type: validated.magic.mime,
          source_format: item.sourceFormat || '', source_bytes: Number(item.sourceBytes || 0), decoder: item.decoder || '',
          source_dimensions: item.sourceDimensions || '', normalized_at: item.normalizedAt || '', privacy: item.privacy || { hasExif: false, hasGps: false },
        captured_at: item.capturedAt || '', capture_source: item.captureSource || '', source_folder: item.sourceFolder || '', import_order: Number(item.importOrder || 0),
        section: item.section || '', tags: item.tags || '', compare_group: item.compareGroup || '', compare_role: item.compareRole || '', exclude_export: Boolean(item.excludeExport),
        });
      }
      if (state.logo) {
        const validated = await validateDecodedProjectImage(state.logo.blob, state.logo.name || 'LOGO');
        const ext = ({ jpeg: '.jpg', png: '.png', webp: '.webp', bmp: '.bmp' })[validated.magic.format];
        const path = `assets/logo${ext}`;
        zip.file(path, validated.blob); fileHashes[path] = await sha256Hex(validated.blob);
        manifest.logo = { file: path, name: state.logo.name, media_type: validated.magic.mime };
      }
      validatePhotojobManifestShape(manifest, 1);
      const manifestHash = await sha256Hex(JSON.stringify(manifest));
      manifest.integrity = { algorithm: 'SHA-256', manifest_sha256: manifestHash, files: fileHashes };
      zip.file('project.json', JSON.stringify(manifest, null, 2));
      $('loadingText').textContent = '完整性驗證完成，正在壓縮專案…';
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });

      if (pickerMode && fileHandle) {
        $('loadingText').textContent = '正在寫入您選擇的檔案位置…';
        const writable = await fileHandle.createWritable();
        try {
          await writable.write(blob);
          await writable.close();
        } catch (error) {
          try { await writable.abort?.(); } catch (_) {}
          throw error;
        }
      } else {
        hideLoading();
        downloadBlob(blob, filename);
        const confirmed = window.confirm('專案下載已啟動。請先確認 .photojob 已出現在下載資料夾且可找到，再按「確定」完成備份；若不確定，請按「取消」，目前專案仍會保持「尚未另存」。');
        if (!confirmed) {
          setStatus('下載已啟動，但尚未確認備份成功；目前變更仍標示為尚未另存。', 'err');
          return false;
        }
      }

      commitHistoryCheckpoint();
      state.lastSavedSignature = snapshotSignature(); state.dirty = false; updateDirtyIndicator();
      setStatus(pickerMode ? '專案已確實寫入您選擇的位置（Schema 2 + SHA-256）。' : '已確認 .photojob 備份完成（Schema 2 + SHA-256）。', 'ok');
      return true;
    } catch (error) {
      setStatus(`儲存專案失敗：${error.message}`, 'err');
      return false;
    } finally {
      hideLoading();
    }
  }

  function parseZipCentralDirectoryBuffer(buffer, expectedEntries) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const result = [];
    let pos = 0;
    for (let i = 0; i < expectedEntries; i += 1) {
      if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP 中央目錄項目損毀。');
      const compressedSize = view.getUint32(pos + 20, true);
      const uncompressedSize = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const end = pos + 46 + nameLen + extraLen + commentLen;
      if (end > bytes.length) throw new Error('ZIP 中央目錄檔名範圍不正確。');
      const name = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLen));
      result.push({ name, compressedSize, uncompressedSize });
      pos = end;
    }
    return result;
  }

  async function inspectZipFileCentralDirectory(file) {
    const tailStart = Math.max(0, file.size - 65557);
    const tailBuffer = await file.slice(tailStart).arrayBuffer();
    const bytes = new Uint8Array(tailBuffer);
    const view = new DataView(tailBuffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('找不到 ZIP 中央目錄，專案檔可能已損毀。');
    const disk = view.getUint16(eocd + 4, true);
    const cdDisk = view.getUint16(eocd + 6, true);
    const entries = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    if (disk !== 0 || cdDisk !== 0) throw new Error('不支援分割式 ZIP 專案檔。');
    if (entries === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) throw new Error('不支援 ZIP64 專案檔。');
    if (entries > MAX_PHOTOS_HARD + 20) throw new Error('專案內檔案數量異常，已停止載入。');
    if (cdOffset + cdSize > file.size || cdSize > 32 * 1024 * 1024) throw new Error('ZIP 中央目錄範圍不正確或過大。');
    const centralBuffer = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
    return parseZipCentralDirectoryBuffer(centralBuffer, entries);
  }

  function validatePhotojobArchiveSizes(entries) {
    let total = 0;
    const names = new Set();
    for (const entry of entries) {
      const name = String(entry.name || '').replace(/\\/g, '/');
      if (names.has(name)) throw new Error(`專案包含重複 ZIP 路徑：${name}`);
      names.add(name);
      if (name.split('/').some((part) => part === '..')) throw new Error('專案包含不安全的 ZIP 路徑。');
      total += entry.uncompressedSize;
      if (total > maxTotalImageBytesForDevice() + 25 * 1024 * 1024) throw new Error(`專案宣告的解壓後容量超過此裝置安全上限（約 ${formatMiB(maxTotalImageBytesForDevice())} 圖片資料），已在解壓前停止載入。`);
      if (name === 'project.json' && entry.uncompressedSize > 2 * 1024 * 1024) throw new Error('project.json 過大，已在解壓前停止載入。');
      if (name.startsWith('images/') && entry.uncompressedSize > MAX_SINGLE_IMAGE_BYTES) throw new Error(`${name} 宣告的解壓大小超過單張 40 MB 上限。`);
      if (name.startsWith('assets/logo') && entry.uncompressedSize > 20 * 1024 * 1024) throw new Error('LOGO 宣告的解壓大小超過 20 MB 上限。');
      if (entry.uncompressedSize > 0 && entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 250) {
        throw new Error(`${name} 的壓縮比例異常，為避免 ZIP Bomb 已停止載入。`);
      }
    }
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function assertProjectString(value, label, maxChars, { optional = true } = {}) {
    if (value === undefined || value === null) {
      if (optional) return;
      throw new Error(`${label} 缺少。`);
    }
    if (typeof value !== 'string') throw new Error(`${label} 必須是文字。`);
    if (Array.from(value).length > maxChars) throw new Error(`${label} 超過 ${maxChars} 字元上限。`);
  }

  function assertSafeProjectPath(value, label) {
    assertProjectString(value, label, 300, { optional: false });
    if (value.startsWith('/') || value.startsWith('\\') || value.includes('\\') || value.split('/').includes('..')) throw new Error(`${label} 含有不安全的路徑。`);
  }

  function validatePhotojobManifestShape(raw, schema) {
    if (!isPlainObject(raw)) throw new Error('project.json 根節點必須是物件。');
    assertProjectString(raw.format, 'format', 80, { optional: false });
    assertProjectString(raw.app_version ?? raw.version, 'app_version', 80);
    if (raw.meta !== undefined && !isPlainObject(raw.meta)) throw new Error('meta 必須是物件。');
    const meta = raw.meta || {};
    for (const [key, label] of [['org_name','機關名稱'],['title','文件標題'],['case','案件／主題'],['case_no','案件編號'],['date','紀錄日期'],['location','地點'],['watermark_text','浮水印']]) assertProjectString(meta[key], label, MAX_META_TEXT_CHARS);
    if (meta.archived_at !== undefined) assertProjectString(meta.archived_at, '封存時間', 64, { optional: true });
    if (meta.per_page !== undefined && (typeof meta.per_page !== 'number' || ![1, 2, 4].includes(meta.per_page))) throw new Error('per_page 必須是數字 1、2 或 4。');
    if (meta.export_scope !== undefined && !['included','selected'].includes(meta.export_scope)) throw new Error('export_scope 不合法。');
    for (const key of ['cover', 'page_numbers', 'watermark_enabled', 'smart_long_split', 'archived']) if (meta[key] !== undefined && typeof meta[key] !== 'boolean') throw new Error(`${key} 必須是布林值。`);

    if (raw.quick_notes !== undefined) {
      if (!Array.isArray(raw.quick_notes)) throw new Error('quick_notes 必須是陣列。');
      if (raw.quick_notes.length > MAX_QUICK_NOTES) throw new Error(`常用說明超過 ${MAX_QUICK_NOTES} 筆上限。`);
      raw.quick_notes.forEach((value, index) => assertProjectString(value, `quick_notes[${index}]`, MAX_QUICK_NOTE_CHARS, { optional: false }));
    }
    if (raw.selected !== undefined && (typeof raw.selected !== 'number' || !Number.isInteger(raw.selected) || raw.selected < -1 || raw.selected > MAX_PHOTOS_HARD)) throw new Error('selected 索引不合法。');
    if (raw.selected_ids !== undefined) {
      if (!Array.isArray(raw.selected_ids) || raw.selected_ids.length > MAX_PHOTOS_HARD) throw new Error('selected_ids 不合法。');
      const selectedIdSet = new Set();
      raw.selected_ids.forEach((value, index) => {
        assertProjectString(value, `selected_ids[${index}]`, MAX_PROJECT_FIELD_CHARS, { optional: false });
        if (selectedIdSet.has(value)) throw new Error(`selected_ids 包含重複 ID：${value}`);
        selectedIdSet.add(value);
      });
    }

    if (!Array.isArray(raw.photos)) throw new Error('photos 必須是陣列。');
    if (raw.photos.length > MAX_PHOTOS_HARD) throw new Error(`專案照片超過 ${MAX_PHOTOS_HARD} 張硬性上限。`);
    const photoIds = new Set();
    raw.photos.forEach((photo, index) => {
      if (!isPlainObject(photo)) throw new Error(`photos[${index}] 必須是物件。`);
      assertSafeProjectPath(photo.file, `photos[${index}].file`);
      assertProjectString(photo.id, `photos[${index}].id`, MAX_PROJECT_FIELD_CHARS, { optional: schema < 2 });
      if (photo.id) {
        if (photoIds.has(photo.id)) throw new Error(`專案包含重複照片 ID：${photo.id}`);
        photoIds.add(photo.id);
      }
      assertProjectString(photo.original_name ?? photo.name, `photos[${index}].original_name`, 260);
      assertProjectString(photo.display_name, `photos[${index}].display_name`, 260);
      assertProjectString(photo.description, `photos[${index}].description`, MAX_DESCRIPTION_CHARS);
      assertProjectString(photo.note, `photos[${index}].note`, MAX_NOTE_CHARS);
      assertProjectString(photo.location, `photos[${index}].location`, MAX_META_TEXT_CHARS);
      if (photo.source_format !== undefined) assertProjectString(photo.source_format, `photos[${index}].source_format`, 32, { optional: true });
      if (photo.decoder !== undefined) assertProjectString(photo.decoder, `photos[${index}].decoder`, 120, { optional: true });
      if (photo.source_dimensions !== undefined) assertProjectString(photo.source_dimensions, `photos[${index}].source_dimensions`, 40, { optional: true });
      if (photo.normalized_at !== undefined) assertProjectString(photo.normalized_at, `photos[${index}].normalized_at`, 64, { optional: true });
      if (photo.captured_at !== undefined) assertProjectString(photo.captured_at, `photos[${index}].captured_at`, 64, { optional: true });
      if (photo.capture_source !== undefined) assertProjectString(photo.capture_source, `photos[${index}].capture_source`, 32, { optional: true });
      if (photo.source_folder !== undefined) assertProjectString(photo.source_folder, `photos[${index}].source_folder`, MAX_META_TEXT_CHARS, { optional: true });
      for (const [key, max] of [['section', MAX_META_TEXT_CHARS], ['tags', MAX_META_TEXT_CHARS], ['compare_group', MAX_META_TEXT_CHARS], ['compare_role', 16]]) if (photo[key] !== undefined) assertProjectString(photo[key], `photos[${index}].${key}`, max, { optional: true });
      if (photo.compare_role && !['before','after'].includes(photo.compare_role)) throw new Error(`photos[${index}].compare_role 不合法。`);
      if (photo.exclude_export !== undefined && typeof photo.exclude_export !== 'boolean') throw new Error(`photos[${index}].exclude_export 不合法。`);
      if (photo.import_order !== undefined && (!Number.isInteger(Number(photo.import_order)) || Number(photo.import_order) < 0 || Number(photo.import_order) > 10000000)) throw new Error(`photos[${index}].import_order 不合法。`);
      if (photo.privacy !== undefined) {
        if (!isPlainObject(photo.privacy)) throw new Error(`photos[${index}].privacy 必須是物件。`);
        for (const key of ['hasExif', 'hasGps']) if (photo.privacy[key] !== undefined && typeof photo.privacy[key] !== 'boolean') throw new Error(`photos[${index}].privacy.${key} 必須是布林值。`);
      }
      if (photo.source_bytes !== undefined && (!Number.isFinite(Number(photo.source_bytes)) || Number(photo.source_bytes) < 0 || Number(photo.source_bytes) > MAX_SINGLE_IMAGE_BYTES)) throw new Error(`photos[${index}].source_bytes 不合法。`);
      assertProjectString(photo.media_type, `photos[${index}].media_type`, 100);
      if (photo.rotation !== undefined && (typeof photo.rotation !== 'number' || !Number.isFinite(photo.rotation) || Math.abs(photo.rotation) > 100000)) throw new Error(`photos[${index}].rotation 不合法。`);
      if (photo.crop !== undefined) {
        if (!isPlainObject(photo.crop)) throw new Error(`photos[${index}].crop 必須是物件。`);
        for (const key of ['left', 'top', 'right', 'bottom']) if (photo.crop[key] !== undefined && (typeof photo.crop[key] !== 'number' || !Number.isFinite(photo.crop[key]))) throw new Error(`photos[${index}].crop.${key} 不合法。`);
      }
      if (photo.annotations !== undefined) {
        if (!Array.isArray(photo.annotations) || photo.annotations.length > MAX_ANNOTATIONS_PER_PHOTO) throw new Error(`photos[${index}].annotations 不合法。`);
        photo.annotations.forEach((ann, annIndex) => {
          if (!isPlainObject(ann) || !['rect','arrow','text','blur','redact'].includes(ann.type)) throw new Error(`photos[${index}].annotations[${annIndex}] 不合法。`);
          for (const key of ['x1','y1','x2','y2']) if (!Number.isFinite(Number(ann[key])) || Number(ann[key]) < 0 || Number(ann[key]) > 1) throw new Error(`photos[${index}].annotations[${annIndex}].${key} 不合法。`);
          if (ann.type === 'text') assertProjectString(ann.text, `photos[${index}].annotations[${annIndex}].text`, MAX_ANNOTATION_TEXT_CHARS, { optional: false });
        });
      }
    });
    if (schema >= 2 && Array.isArray(raw.selected_ids)) {
      for (const id of raw.selected_ids) if (!photoIds.has(id)) throw new Error(`selected_ids 指向不存在的照片 ID：${id}`);
    }
    if (raw.logo !== undefined && raw.logo !== null) {
      if (!isPlainObject(raw.logo)) throw new Error('logo 必須是物件或 null。');
      assertSafeProjectPath(raw.logo.file, 'logo.file');
      assertProjectString(raw.logo.name, 'logo.name', 260); assertProjectString(raw.logo.media_type, 'logo.media_type', 100);
    }
    if (schema >= 2) {
      if (!isPlainObject(raw.integrity)) throw new Error('Schema 2 專案缺少 integrity 物件。');
      if (raw.integrity.algorithm !== 'SHA-256') throw new Error('integrity.algorithm 必須是 SHA-256。');
      assertProjectString(raw.integrity.manifest_sha256, 'integrity.manifest_sha256', 64, { optional: false });
      if (!isPlainObject(raw.integrity.files)) throw new Error('integrity.files 必須是物件。');
      const entries = Object.entries(raw.integrity.files);
      if (entries.length > MAX_PHOTOS_HARD + 1) throw new Error('integrity.files 項目數異常。');
      for (const [path, hash] of entries) {
        assertSafeProjectPath(path, 'integrity.files 路徑');
        if (typeof hash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`${path} 的 SHA-256 格式不合法。`);
      }
    }
    return true;
  }

  function photojobSchemaVersion(manifest) {
    if (manifest?.schema_version === undefined || manifest?.schema_version === null) return 1;
    const value = Number(manifest.schema_version);
    if (!Number.isInteger(value) || value < 1) throw new Error('專案 Schema 版本不合法。');
    return value;
  }

  function migratePhotojobManifest(raw) {
    const sourceSchema = photojobSchemaVersion(raw);
    if (sourceSchema > PHOTOJOB_SCHEMA_VERSION) {
      throw new Error(`此專案使用較新的 Schema ${sourceSchema}；目前程式只支援到 Schema ${PHOTOJOB_SCHEMA_VERSION}。請使用較新版本程式開啟。`);
    }
    if (sourceSchema === 1) {
      return {
        manifest: {
          ...raw,
          schema_version: PHOTOJOB_SCHEMA_VERSION,
          app_version: raw.app_version || raw.version || 'legacy',
          selected_ids: Array.isArray(raw.selected_ids) ? raw.selected_ids : [],
        },
        sourceSchema,
      };
    }
    return { manifest: raw, sourceSchema };
  }

  async function verifyPhotojobManifestIntegrity(rawManifest) {
    const schema = photojobSchemaVersion(rawManifest);
    if (schema < 2) return { verified: false, legacy: true, files: {} };
    const integrity = rawManifest.integrity;
    if (!integrity || integrity.algorithm !== 'SHA-256' || !integrity.manifest_sha256 || typeof integrity.files !== 'object') {
      throw new Error('Schema 2 專案缺少完整的 SHA-256 integrity 資訊。');
    }
    const { integrity: _ignored, ...core } = rawManifest;
    const manifestHash = await sha256Hex(JSON.stringify(core));
    if (manifestHash !== String(integrity.manifest_sha256).toLowerCase()) throw new Error('project.json 完整性驗證失敗，專案可能已損毀或被修改。');
    const referenced = new Set((rawManifest.photos || []).map((p) => p.file).filter(Boolean));
    if (rawManifest.logo?.file) referenced.add(rawManifest.logo.file);
    for (const path of referenced) {
      const expected = String(integrity.files[path] || '').toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error(`${path} 缺少有效的 SHA-256 驗證碼。`);
    }
    return { verified: true, legacy: false, files: integrity.files };
  }

  async function openProject(file) {
    if (!librariesReady()) throw new Error('JSZip 元件尚未載入。');
    if (file.size > MAX_PROJECT_ARCHIVE_BYTES) throw new Error(`.photojob 檔案不可超過 ${formatMiB(MAX_PROJECT_ARCHIVE_BYTES)}。`);
    showLoading('正在檢查 .photojob 專案…');
    try {
      validatePhotojobArchiveSizes(await inspectZipFileCentralDirectory(file));
      $('loadingText').textContent = '安全檢查通過，正在解壓專案…';
      const zip = await JSZip.loadAsync(file);
      const projectEntry = zip.file('project.json');
      if (!projectEntry) throw new Error('這不是有效的 .photojob 專案檔。');
      const manifestText = await projectEntry.async('string');
      if (new Blob([manifestText]).size > 2 * 1024 * 1024) throw new Error('project.json 過大，已停止載入。');
      const rawManifest = JSON.parse(manifestText);
      if (rawManifest.format !== 'ImageRecordAssistant.photojob') throw new Error('不支援的專案格式。');
      const sourceSchema = photojobSchemaVersion(rawManifest);
      if (sourceSchema > PHOTOJOB_SCHEMA_VERSION) throw new Error(`此專案使用較新的 Schema ${sourceSchema}，目前只支援到 Schema ${PHOTOJOB_SCHEMA_VERSION}。`);
      validatePhotojobManifestShape(rawManifest, sourceSchema);
      $('loadingText').textContent = sourceSchema >= 2 ? '正在驗證 SHA-256 完整性…' : '正在載入舊版專案並準備相容性升級…';
      const integrityResult = await verifyPhotojobManifestIntegrity(rawManifest);
      const { manifest } = migratePhotojobManifest(rawManifest);
      if ((manifest.photos || []).length > MAX_PHOTOS_HARD) throw new Error(`專案照片超過 ${MAX_PHOTOS_HARD} 張硬性上限。`);
      const photos = [];
      let totalUncompressed = 0;
      for (let i = 0; i < (manifest.photos || []).length; i += 1) {
        const p = manifest.photos[i];
        const entry = zip.file(p.file);
        if (!entry) throw new Error(`專案缺少照片檔案：${p.file}`);
        $('loadingText').textContent = `正在驗證照片內容 ${i + 1} / ${manifest.photos.length}…`;
        const raw = await entry.async('uint8array');
        if (integrityResult.verified) {
          const actualHash = await sha256Hex(raw);
          const expectedHash = String(integrityResult.files[p.file] || '').toLowerCase();
          if (actualHash !== expectedHash) throw new Error(`${p.file} SHA-256 驗證失敗，專案可能已損毀或被修改。`);
        }
        if (raw.byteLength > MAX_SINGLE_IMAGE_BYTES) throw new Error(`專案中的 ${p.original_name || p.file} 超過單張 40 MB 上限。`);
        totalUncompressed += raw.byteLength;
        if (totalUncompressed > maxTotalImageBytesForDevice()) throw new Error(`專案照片總容量超過此裝置約 ${formatMiB(maxTotalImageBytesForDevice())} 的安全上限，已停止載入。`);
        const originalName = p.original_name || p.name || p.file.split('/').pop();
        const detected = detectSupportedImageMagic(raw.subarray(0, 16));
        if (!detected) throw new Error(`${originalName} 的實際內容不是支援的圖片格式。`);
        const candidateBlob = new Blob([raw], { type: detected.mime });
        const validated = await validateDecodedProjectImage(candidateBlob, originalName);
        photos.push({
          id: p.id || uid(),
          blob: validated.blob,
          original_name: originalName,
          display_name: p.display_name || originalName,
          description: p.description || '',
          note: p.note || '',
          location: p.location || '',
          rotation: p.rotation || 0,
          crop: clampCrop(p.crop), annotations: sanitizeAnnotations(p.annotations),
          source_format: p.source_format || '', source_bytes: Number(p.source_bytes || 0), decoder: p.decoder || '',
          source_dimensions: p.source_dimensions || '', normalized_at: p.normalized_at || '', privacy: p.privacy || { hasExif: false, hasGps: false },
        captured_at: p.captured_at || '', capture_source: p.capture_source || '', source_folder: p.source_folder || '', import_order: Number(p.import_order || 0),
        section: p.section || '', tags: p.tags || '', compare_group: p.compare_group || '', compare_role: p.compare_role || '', exclude_export: Boolean(p.exclude_export),
        });
      }
      let logo = null;
      if (manifest.logo?.file) {
        const entry = zip.file(manifest.logo.file);
        if (!entry) throw new Error(`專案缺少 LOGO 檔案：${manifest.logo.file}`);
        const logoName = manifest.logo.name || 'logo.png';
        const raw = await entry.async('uint8array');
        if (integrityResult.verified) {
          const actualHash = await sha256Hex(raw);
          const expectedHash = String(integrityResult.files[manifest.logo.file] || '').toLowerCase();
          if (actualHash !== expectedHash) throw new Error(`${manifest.logo.file} SHA-256 驗證失敗，專案可能已損毀或被修改。`);
        }
        if (raw.byteLength > 20 * 1024 * 1024) throw new Error('LOGO 超過 20 MB 上限。');
        const detected = detectSupportedImageMagic(raw.subarray(0, 16));
        if (!detected) throw new Error('LOGO 的實際內容不是支援的圖片格式。');
        const validated = await validateDecodedProjectImage(new Blob([raw], { type: detected.mime }), logoName);
        logo = { name: logoName, blob: validated.blob };
      }
      await applyProjectData({ ...manifest, photos, logo });
      resetHistoryBaseline(true);
      await saveAutosaveNow();
      const migrationNote = sourceSchema < PHOTOJOB_SCHEMA_VERSION ? `；舊版 Schema ${sourceSchema} 已在記憶體中安全升級為 Schema ${PHOTOJOB_SCHEMA_VERSION}` : '';
      const integrityNote = integrityResult.verified ? '；SHA-256 完整性驗證通過' : '；舊版專案無 SHA-256，建議重新儲存一次';
      setStatus(`專案已開啟，共 ${state.items.length} 張照片${integrityNote}${migrationNote}。`, 'ok');
      return true;
    } finally {
      hideLoading();
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function canvasBlob(canvas, type = 'image/jpeg', quality = 0.92) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas 輸出失敗')), type, quality);
    });
  }

  function canvasFont(ctx, size, bold = false) {
    ctx.font = `${bold ? '700 ' : ''}${size}px "Microsoft JhengHei","Noto Sans TC",sans-serif`;
    ctx.textBaseline = 'top';
  }

  function splitCanvasLines(ctx, text, maxWidth) {
    const value = String(text ?? '');
    if (!value) return [''];
    const out = [];
    let line = '';
    for (const ch of value) {
      if (ch === '\n') { out.push(line); line = ''; continue; }
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxWidth) { out.push(line); line = ch; }
      else line = test;
    }
    if (line || !out.length) out.push(line);
    return out;
  }

  function drawCenteredText(ctx, text, centerX, y, size, bold = false, color = '#123a63') {
    canvasFont(ctx, size, bold);
    ctx.fillStyle = color;
    const width = ctx.measureText(String(text)).width;
    ctx.fillText(String(text), centerX - width / 2, y);
  }

  async function drawContainImage(ctx, source, x, y, w, h) {
    const img = typeof source === 'string' ? await loadImage(source) : source;
    const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = Math.max(1, img.naturalWidth * scale);
    const dh = Math.max(1, img.naturalHeight * scale);
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function fitInfoLines(ctx, details, maxWidth, maxHeight, preferredSize) {
    for (let size = preferredSize; size >= 12; size -= 1) {
      canvasFont(ctx, size, false);
      const lineHeight = Math.round(size * 1.45);
      const lines = [];
      for (const [label, value] of details) {
        const wrapped = splitCanvasLines(ctx, `${label}：${value}`, maxWidth);
        lines.push(...wrapped);
      }
      if (lines.length * lineHeight <= maxHeight) return { lines, size, lineHeight, truncated: false };
    }
    const size = 12;
    canvasFont(ctx, size, false);
    const lineHeight = 17;
    const all = [];
    for (const [label, value] of details) all.push(...splitCanvasLines(ctx, `${label}：${value}`, maxWidth));
    const count = Math.max(1, Math.floor(maxHeight / lineHeight));
    const lines = all.slice(0, count);
    if (all.length > count && lines.length) {
      let last = lines[lines.length - 1];
      while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last}…`;
    }
    return { lines, size, lineHeight, truncated: all.length > count };
  }

  async function drawReportBlock(ctx, item, processed, number, meta, x, y, w, h, compact = false, segmentSuffix = '') {
    ctx.strokeStyle = '#c8d3e1'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    const headerH = compact ? 42 : 48;
    ctx.fillStyle = '#edf3fa'; ctx.fillRect(x, y, w, headerH);
    const headerSize = compact ? 16 : 18;
    canvasFont(ctx, headerSize, true); ctx.fillStyle = '#173e65';
    let header = `照片 ${String(number).padStart(2, '0')}${segmentSuffix}｜${item.displayName}`;
    while (header.length > 4 && ctx.measureText(header).width > w - 24) header = `${header.slice(0, -2)}…`;
    ctx.fillText(header, x + 12, y + Math.max(5, (headerH - headerSize) / 2 - 1));

    const details = [
      ['案件／主題', meta.case || '—'],
      ...(meta.case_no ? [['案件編號', meta.case_no]] : []),
      ...(item.section ? [['章節', item.section]] : []),
      ...(item.compareGroup && item.compareRole ? [['前後比較', `${item.compareGroup}｜${item.compareRole === 'before' ? '改善前' : '改善後'}`]] : []),
      ...(item.tags ? [['標籤', item.tags]] : []),
      ['紀錄日期', meta.date || '—'],
      ['地點', effectiveLocation(item, meta) || '—'],
      ['照片說明', item.description || '（未填寫）'],
    ];
    if (item.note) details.push(['備註', item.note]);
    const weight = itemTextWeight(item, meta);
    let infoH;
    if (compact) infoH = Math.min(Math.max(150, 120 + weight * 0.55), Math.max(150, h * 0.48));
    else if (meta.per_page === 1) infoH = Math.min(Math.max(230, 190 + weight * 0.95), Math.max(230, h * 0.58));
    else infoH = Math.min(Math.max(180, 155 + weight * 0.7), Math.max(180, h * 0.48));
    const imageY = y + headerH;
    const imageH = Math.max(80, h - headerH - infoH);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 2, imageY, w - 4, imageH);
    const img = await loadBlobImage(processed.blob);
    await drawContainImage(ctx, img, x + 12, imageY + 8, w - 24, imageH - 16);

    const infoY = imageY + imageH;
    ctx.strokeStyle = '#d9e2eb'; ctx.beginPath(); ctx.moveTo(x, infoY); ctx.lineTo(x + w, infoY); ctx.stroke();
    const info = fitInfoLines(ctx, details, w - 24, infoH - 18, compact ? 15 : 17);
    canvasFont(ctx, info.size, false); ctx.fillStyle = '#26384a';
    let ty = infoY + 9;
    for (const line of info.lines) { ctx.fillText(line, x + 12, ty); ty += info.lineHeight; }
    if (info.truncated) {
      canvasFont(ctx, 11, true); ctx.fillStyle = '#9a4c18';
      ctx.fillText('※ 文字過長，建議改為一頁 1 張或縮短說明', x + 12, y + h - 18);
    }
  }

  function drawCanvasPageNumber(ctx, current, total, width, height) {
    if (!$('includePageNumber').checked) return;
    drawCenteredText(ctx, `${current} / ${total}`, width / 2, height - 38, 15, false, '#74869a');
  }

  async function renderPageCanvas(pageIndex, meta, totalPages, pageWidth = 1240, pageHeight = 1754, suppliedPlan = null) {
    const canvas = document.createElement('canvas');
    canvas.width = pageWidth; canvas.height = pageHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pageWidth, pageHeight);
    const margin = 64;
    const coverOffset = meta.cover ? 1 : 0;

    if (meta.cover && pageIndex === 0) {
      let y = 330;
      if (state.logo) {
        const logo = await processLogo(700);
        const img = await loadBlobImage(logo.blob);
        await drawContainImage(ctx, img, pageWidth / 2 - 180, y - 140, 360, 190);
        y += 90;
      }
      if (meta.org_name) { drawCenteredText(ctx, meta.org_name, pageWidth / 2, y, 34, true, '#3b5369'); y += 84; }
      drawCenteredText(ctx, meta.title, pageWidth / 2, y, 54, true, '#123a63'); y += 145;
      const boxX = 200, boxW = pageWidth - 400;
      ctx.strokeStyle = '#d4dde7'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(boxX, y); ctx.lineTo(boxX + boxW, y); ctx.stroke(); y += 36;
      const details = [['案件／主題', meta.case || '—'], ...(meta.case_no ? [['案件編號', meta.case_no]] : []), ['紀錄日期', meta.date || '—'], ['地點', meta.location || '—']];
      canvasFont(ctx, 25, false); ctx.fillStyle = '#26384a';
      for (const [label, value] of details) { ctx.fillText(`${label}：${value}`, boxX + 20, y); y += 58; }
      drawCanvasPageNumber(ctx, 1, totalPages, pageWidth, pageHeight);
      return canvas;
    }

    const plan = suppliedPlan || buildPhotoPagePlan(meta);
    const reportIndex = pageIndex - coverOffset;
    const entries = plan[reportIndex] || [];
    const layoutCount = Math.max(1, entries.length);
    const pageMeta = { ...meta, per_page: layoutCount };

    if (!meta.cover && state.logo) {
      const logo = await processLogo(260);
      const img = await loadBlobImage(logo.blob);
      await drawContainImage(ctx, img, margin, 46, 120, 72);
    }
    drawCenteredText(ctx, meta.title, pageWidth / 2, 53, 35, true, '#123a63');
    if (meta.org_name) {
      canvasFont(ctx, 18, true); ctx.fillStyle = '#60758a';
      const tw = ctx.measureText(meta.org_name).width;
      ctx.fillText(meta.org_name, pageWidth - margin - tw, 62);
    }

    const gridTop = 138;
    const gridBottom = pageHeight - ($('includePageNumber').checked ? 58 : 30);
    const gridH = gridBottom - gridTop;
    const gap = 14;
    if (layoutCount >= 3) {
      const bw = (pageWidth - margin * 2 - gap) / 2;
      const bh = (gridH - gap) / 2;
      for (let local = 0; local < entries.length; local += 1) {
        const entry = entries[local]; const i = entry.index;
        const x = margin + (local % 2) * (bw + gap);
        const y = gridTop + Math.floor(local / 2) * (bh + gap);
        const processed = await processOutputEntry(entry, 1450, 0.88, meta);
        await drawReportBlock(ctx, state.items[i], processed, i + 1, pageMeta, x, y, bw, bh, true, outputEntrySuffix(entry));
      }
    } else {
      const bh = (gridH - gap * (layoutCount - 1)) / layoutCount;
      for (let local = 0; local < entries.length; local += 1) {
        const entry = entries[local]; const i = entry.index;
        const y = gridTop + local * (bh + gap);
        const processed = await processOutputEntry(entry, layoutCount === 1 ? 1900 : 1750, 0.89, meta);
        await drawReportBlock(ctx, state.items[i], processed, i + 1, pageMeta, margin, y, pageWidth - margin * 2, bh, false, outputEntrySuffix(entry));
      }
    }
    drawCanvasPageNumber(ctx, pageIndex + 1, totalPages, pageWidth, pageHeight);
    return canvas;
  }

  function reportTotalPages(meta = metaPayload()) {
    return buildPhotoPagePlan(meta).length + (meta.cover ? 1 : 0);
  }

  async function renderExactPreview() {
    const modal = $('previewModal');
    const pages = $('previewPages');
    if (!exportCandidateIndices().length) {
      pages.innerHTML = '<div class="status err">目前輸出範圍沒有可輸出的照片。</div>';
      modal.classList.add('show');
      setStatus('目前輸出範圍沒有可輸出的照片。', 'err');
      return;
    }
    // Preview uses the Canvas/PDF layout engine only; it must not depend on JSZip.
    state.previewUrls.forEach((url) => URL.revokeObjectURL(url)); state.previewUrls = [];
    pages.innerHTML = '<div class="tiny">正在依實際 PDF 排版產生預覽…</div>';
    modal.classList.add('show');
    showLoading('正在產生列印版面預覽…');
    try {
      const meta = metaPayload();
      const plan = buildPhotoPagePlan(meta);
      const total = plan.length + (meta.cover ? 1 : 0);
      const wrap = $('previewPages'); wrap.innerHTML = '';
      const adjusted = layoutAdjustmentCount(meta);
      if (adjusted) wrap.appendChild(createEl('div', 'layout-adjust-note', `有 ${adjusted} 頁因長文字或超長圖片，自動調整為較寬鬆版面以保留可讀性。`));
      for (let i = 0; i < total; i += 1) {
        $('loadingText').textContent = `正在產生第 ${i + 1} / ${total} 頁…`;
        const canvas = await renderPageCanvas(i, meta, total, 1240, 1754, plan);
        const blob = await canvasBlob(canvas, 'image/jpeg', 0.88);
        canvas.width = 1; canvas.height = 1;
        const url = URL.createObjectURL(blob); state.previewUrls.push(url);
        const sheet = createEl('div', 'preview-sheet');
        sheet.appendChild(createEl('div', 'page-chip', `第 ${i + 1} 頁`));
        const img = createEl('img'); img.src = url; img.alt = `第 ${i + 1} 頁預覽`; sheet.appendChild(img);
        wrap.appendChild(sheet);
      }
      setStatus('列印版面預覽已完成。', 'ok');
    } catch (error) {
      $('previewPages').innerHTML = `<div class="status err">預覽失敗：${escapeHtml(error.message)}</div>`;
      setStatus(`預覽失敗：${error.message}`, 'err');
    } finally { hideLoading(); }
  }

  async function downloadPdfFromPreview() {
    if (!exportCandidateIndices().length) {
      setStatus('目前輸出範圍沒有可輸出的照片。', 'err');
      return;
    }
    $('previewModal').classList.remove('show');
    await guardedExport(exportPdf);
  }

  function asciiBytes(text) { return new TextEncoder().encode(text); }

  function concatBytes(parts) {
    const arrays = parts.map((part) => part instanceof Uint8Array ? part : asciiBytes(String(part)));
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const array of arrays) { out.set(array, offset); offset += array.length; }
    return out;
  }

  function pdfPartLength(part) {
    if (part instanceof Blob) return part.size;
    if (part instanceof Uint8Array) return part.byteLength;
    return asciiBytes(String(part)).byteLength;
  }

  function pdfPartsLength(parts) {
    return parts.reduce((total, part) => total + pdfPartLength(part), 0);
  }

  function createPdfAssembler(pageCount) {
    const pageRefs = Array.from({ length: pageCount }, (_, i) => 3 + i * 3);
    const count = 2 + pageCount * 3;
    const bodyParts = [];
    const offsets = new Array(count + 1).fill(0);
    let pos = 0;
    const pushRaw = (part) => { bodyParts.push(part); pos += pdfPartLength(part); };
    const pushObject = (id, parts) => {
      offsets[id] = pos;
      pushRaw(asciiBytes(`${id} 0 obj\n`));
      for (const part of parts) pushRaw(part);
      pushRaw(asciiBytes('\nendobj\n'));
    };
    pushRaw(asciiBytes('%PDF-1.4\n%Standalone\n'));
    pushObject(1, [asciiBytes('<< /Type /Catalog /Pages 2 0 R >>')]);
    pushObject(2, [asciiBytes(`<< /Type /Pages /Kids [${pageRefs.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>`)]);
    return {
      addJpegPage(index, img) {
        const pageObj = 3 + index * 3, contentObj = pageObj + 1, imageObj = pageObj + 2;
        const content = asciiBytes('q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n');
        pushObject(pageObj, [asciiBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`)]);
        pushObject(contentObj, [asciiBytes(`<< /Length ${content.byteLength} >>\nstream\n`), content, asciiBytes('endstream')]);
        pushObject(imageObj, [asciiBytes(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.blob.size} >>\nstream\n`), img.blob, asciiBytes('\nendstream')]);
      },
      finish() {
        const xrefPos = pos;
        let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
        for (let id = 1; id <= count; id += 1) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
        xref += `trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
        pushRaw(asciiBytes(xref));
        return new Blob(bodyParts, { type: 'application/pdf' });
      },
    };
  }

  async function buildPdfFromJpegPages(pages) {
    const assembler = createPdfAssembler(pages.length);
    pages.forEach((page, index) => assembler.addJpegPage(index, page));
    return assembler.finish();
  }

  async function generatePdfBlob() {
    const meta = metaPayload();
    const plan = buildPhotoPagePlan(meta);
    const total = plan.length + (meta.cover ? 1 : 0);
    if (!total) throw new Error('沒有可輸出的頁面。');
    const profile = { w: 1240, h: 1754, quality: total > 150 ? 0.80 : total > 80 ? 0.84 : 0.89 };
    const assembler = createPdfAssembler(total);
    for (let i = 0; i < total; i += 1) {
      $('loadingText').textContent = `正在建立 PDF 第 ${i + 1} / ${total} 頁…`;
      const canvas = await renderPageCanvas(i, meta, total, profile.w, profile.h, plan);
      const blob = await canvasBlob(canvas, 'image/jpeg', profile.quality);
      canvas.width = 1; canvas.height = 1;
      assembler.addJpegPage(i, { width: profile.w, height: profile.h, blob });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return assembler.finish();
  }

  function detectImageMagic(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpeg';
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return 'png';
    if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif';
    return 'unknown';
  }

  function parseXmlOrThrow(xmlText, partName) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'application/xml');
    const hasParserError = xml.getElementsByTagName('parsererror').length > 0 || xml.getElementsByTagNameNS('*', 'parsererror').length > 0;
    if (hasParserError) throw new Error(`DOCX XML 驗證失敗：${partName} 不是合法 XML。`);
    return xml;
  }

  function parseContentTypeDefaults(xmlText) {
    const xml = parseXmlOrThrow(xmlText, '[Content_Types].xml');
    const defaults = new Map();
    const nodes = xml.getElementsByTagNameNS('*', 'Default');
    for (const node of nodes) {
      const ext = (node.getAttribute('Extension') || '').trim().toLowerCase();
      const mime = (node.getAttribute('ContentType') || '').trim().toLowerCase();
      if (ext) defaults.set(ext, mime);
    }
    return defaults;
  }

  async function validateDocxXmlParts(zip) {
    const xmlParts = Object.keys(zip.files).filter((name) => !zip.files[name].dir && (name.endsWith('.xml') || name.endsWith('.rels')));
    if (!xmlParts.includes('word/document.xml')) throw new Error('DOCX XML 驗證失敗：缺少 word/document.xml。');
    for (const name of xmlParts) {
      const text = await zip.file(name).async('text');
      parseXmlOrThrow(text, name);
    }
    return true;
  }

  async function validateDocxImagePackaging(zip) {
    const contentTypes = await zip.file('[Content_Types].xml')?.async('text');
    if (!contentTypes) throw new Error('DOCX 驗證失敗：缺少 [Content_Types].xml。');
    const typeDefaults = parseContentTypeDefaults(contentTypes);
    const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !zip.files[name].dir);
    for (const name of mediaFiles) {
      const bytes = await zip.file(name).async('uint8array');
      const magic = detectImageMagic(bytes);
      const ext = name.toLowerCase().split('.').pop();
      if (magic === 'unknown') throw new Error(`DOCX 圖片封裝無法辨識：${name}。`);
      if ((magic === 'jpeg' && !['jpg', 'jpeg'].includes(ext)) || (magic === 'png' && ext !== 'png') || (magic === 'gif' && ext !== 'gif')) throw new Error(`DOCX 圖片封裝不一致：${name} 實際內容為 ${magic.toUpperCase()}。`);
      if (magic === 'jpeg' && typeDefaults.get(ext) !== 'image/jpeg') throw new Error(`DOCX Content Types 宣告錯誤：.${ext} 應為 image/jpeg。`);
      if (magic === 'png' && typeDefaults.get(ext) !== 'image/png') throw new Error(`DOCX Content Types 宣告錯誤：.${ext} 應為 image/png。`);
      if (magic === 'gif' && typeDefaults.get(ext) !== 'image/gif') throw new Error(`DOCX Content Types 宣告錯誤：.${ext} 應為 image/gif。`);
    }
    return true;
  }

  async function validateDocxPackage(blob) {
    const zip = await JSZip.loadAsync(blob);
    await validateDocxXmlParts(zip);
    await validateDocxImagePackaging(zip);
    return true;
  }

  function isValidXml10CodePoint(cp) {
    return cp === 0x09 || cp === 0x0A || cp === 0x0D ||
      (cp >= 0x20 && cp <= 0xD7FF) ||
      (cp >= 0xE000 && cp <= 0xFFFD) ||
      (cp >= 0x10000 && cp <= 0x10FFFF);
  }

  function sanitizeXml10Text(value) {
    let result = '';
    for (const ch of String(value ?? '')) {
      if (isValidXml10CodePoint(ch.codePointAt(0))) result += ch;
    }
    return result;
  }

  function countInvalidXml10Chars(value) {
    let count = 0;
    for (const ch of String(value ?? '')) {
      if (!isValidXml10CodePoint(ch.codePointAt(0))) count += 1;
    }
    return count;
  }

  function countDocxInvalidInputChars() {
    const meta = metaPayload();
    const values = [meta.org_name, meta.title, meta.case, meta.case_no, meta.date, meta.location, meta.watermark_text];
    for (const item of state.items) values.push(item.displayName, item.description, item.note, item.location, item.section, item.tags, item.compareGroup);
    return values.reduce((sum, value) => sum + countInvalidXml10Chars(value), 0);
  }

  function xmlEscape(value) {
    return sanitizeXml10Text(value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[ch]));
  }

  function wordRun(text, { bold = false, size = 18, color = '26384A' } = {}) {
    return `<w:r><w:rPr><w:rFonts w:ascii="Microsoft JhengHei" w:hAnsi="Microsoft JhengHei" w:eastAsia="Microsoft JhengHei"/>${bold ? '<w:b/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
  }

  function wordParagraph(inner = '', { align = 'left', before = 0, after = 0, pageBreak = false } = {}) {
    const br = pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : '';
    return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="${before}" w:after="${after}"/></w:pPr>${inner}${br}</w:p>`;
  }

  function wordImage(rId, name, widthPx, heightPx, docPrId) {
    const cx = Math.max(1, Math.round(widthPx * 9525));
    const cy = Math.max(1, Math.round(heightPx * 9525));
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="${xmlEscape(name)}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${xmlEscape(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  function wordPhotoBlock(item, image, number, meta, segmentSuffix = '') {
    const title = wordParagraph(wordRun(`照片 ${String(number).padStart(2, '0')}${segmentSuffix}｜${item.displayName}`, { bold: true, size: 19, color: '173E65' }));
    const imgP = wordParagraph(wordImage(image.rId, image.name, image.displayW, image.displayH, image.docPrId), { align: 'center' });
    const details = [['案件／主題', meta.case || '—']];
    if (meta.case_no) details.push(['案件編號', meta.case_no]);
    if (item.section) details.push(['章節', item.section]);
    if (item.compareGroup && item.compareRole) details.push(['前後比較', `${item.compareGroup}｜${item.compareRole === 'before' ? '改善前' : '改善後'}`]);
    if (item.tags) details.push(['標籤', item.tags]);
    details.push(['紀錄日期', meta.date || '—'], ['地點', effectiveLocation(item, meta) || '—'], ['照片說明', item.description || '（未填寫）']);
    if (item.note) details.push(['備註', item.note]);
    const fontSize = meta.per_page >= 3 ? 15 : (itemTextWeight(item, meta) > 220 ? 15 : 17);
    const info = details.map(([label, value]) => wordParagraph(wordRun(`${label}：`, { bold: true, size: fontSize }) + wordRun(value, { size: fontSize }))).join('');
    const border = '<w:tcBorders><w:top w:val="single" w:sz="4" w:color="C8D3E1"/><w:left w:val="single" w:sz="4" w:color="C8D3E1"/><w:bottom w:val="single" w:sz="4" w:color="C8D3E1"/><w:right w:val="single" w:sz="4" w:color="C8D3E1"/></w:tcBorders>';
    const cell = (content, shade = '') => `<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9350" w:type="dxa"/>${border}${shade ? `<w:shd w:fill="${shade}"/>` : ''}<w:tcMar><w:top w:w="55" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="55" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>${content}</w:tc></w:tr>`;
    const inner = `<w:tbl><w:tblPr><w:tblW w:w="9350" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>${cell(title, 'EDF3FA')}${cell(imgP)}${cell(info)}</w:tbl>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="9350" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9350" w:type="dxa"/></w:tcPr>${inner}</w:tc></w:tr></w:tbl>`;
  }

  async function generateWordBlob() {
    if (!window.JSZip) throw new Error('JSZip 尚未載入。');
    const meta = metaPayload();
    const pagePlan = buildPhotoPagePlan(meta);
    const layoutByEntry = new Map();
    pagePlan.forEach((page) => page.forEach((entry) => layoutByEntry.set(outputEntryKey(entry), page.length)));
    const zip = new JSZip();
    const relationships = [];
    const images = new Map();
    let nextRel = 10;
    let nextDocPr = 1;

    const processedLogo = state.logo ? await processLogo(700) : null;
    let logoImage = null;
    if (processedLogo) {
      const rId = `rId${nextRel++}`;
      const name = 'logo.png';
      zip.file(`word/media/${name}`, processedLogo.blob);
      relationships.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
      const dims = fitDimensions(processedLogo.width, processedLogo.height, meta.cover ? 150 : 78, meta.cover ? 90 : 48);
      logoImage = { rId, name, displayW: dims.width, displayH: dims.height, docPrId: nextDocPr++ };
    }

    for (const entry of pagePlan.flat()) {
      const i = entry.index; const item = state.items[i]; const key = outputEntryKey(entry);
      const layoutCount = layoutByEntry.get(key) || meta.per_page;
      const weight = itemTextWeight(item, meta);
      let limits = layoutCount === 1 ? { w: 600, h: 610 } : layoutCount === 2 ? { w: 595, h: 235 } : { w: 560, h: 105 };
      if (layoutCount === 1 && weight > 220) limits = { w: 590, h: 430 };
      if (layoutCount === 2 && weight > 95) limits = { w: 585, h: 190 };
      const processed = await processOutputEntry(entry, 1800, 0.89, meta);
      const rId = `rId${nextRel++}`;
      const name = `photo${String(i + 1).padStart(4, '0')}${entry.segmentCount > 1 ? `_part${entry.segment + 1}` : ''}.jpg`;
      zip.file(`word/media/${name}`, processed.blob);
      relationships.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
      const dims = fitDimensions(processed.width, processed.height, limits.w, limits.h);
      images.set(key, { rId, name, displayW: dims.width, displayH: dims.height, docPrId: nextDocPr++ });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    let body = '';
    if (meta.cover) {
      if (logoImage) body += wordParagraph(wordImage(logoImage.rId, logoImage.name, logoImage.displayW, logoImage.displayH, logoImage.docPrId), { align: 'center', after: 160 });
      if (meta.org_name) body += wordParagraph(wordRun(meta.org_name, { size: 32, bold: true, color: '3B5369' }), { align: 'center', after: 120 });
      body += wordParagraph(wordRun(meta.title, { size: 48, bold: true, color: '123A63' }), { align: 'center', before: 180, after: 360 });
      for (const [label, value] of [['案件／主題', meta.case || '—'], ...(meta.case_no ? [['案件編號', meta.case_no]] : []), ['紀錄日期', meta.date || '—'], ['地點', meta.location || '—']]) {
        body += wordParagraph(wordRun(`${label}：`, { size: 26, bold: true }) + wordRun(value, { size: 26 }), { after: 120 });
      }
      body += wordParagraph('', { pageBreak: true });
    }
    if (!meta.cover && logoImage) body += wordParagraph(wordImage(logoImage.rId, logoImage.name, logoImage.displayW, logoImage.displayH, logoImage.docPrId), { align: 'left', after: 30 });
    if (!meta.cover && meta.org_name) body += wordParagraph(wordRun(meta.org_name, { size: 20, bold: true, color: '60758A' }), { align: 'right' });
    body += wordParagraph(wordRun(meta.title, { size: 32, bold: true, color: '123A63' }), { align: 'center', after: 80 });
    for (let pageIndex = 0; pageIndex < pagePlan.length; pageIndex += 1) {
      const page = pagePlan[pageIndex];
      const pageMeta = { ...meta, per_page: Math.max(1, page.length) };
      for (const entry of page) {
        const i = entry.index;
        body += wordPhotoBlock(state.items[i], images.get(outputEntryKey(entry)), i + 1, pageMeta, outputEntrySuffix(entry));
        body += wordParagraph('', { after: page.length === 2 ? 25 : 40 });
      }
      if (pageIndex < pagePlan.length - 1) body += wordParagraph('', { pageBreak: true });
    }

    relationships.unshift(
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'
    );
    let footerReference = '';
    if (meta.page_numbers) {
      relationships.push('<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>');
      footerReference = '<w:footerReference w:type="default" r:id="rId3"/>';
      const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:rFonts w:eastAsia="Microsoft JhengHei"/><w:color w:val="74869A"/><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple><w:r><w:rPr><w:rFonts w:eastAsia="Microsoft JhengHei"/><w:color w:val="74869A"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> / </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:rPr><w:rFonts w:eastAsia="Microsoft JhengHei"/><w:color w:val="74869A"/><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
      zip.file('word/footer1.xml', footer);
    }

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr>${footerReference}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="680" w:right="850" w:bottom="680" w:left="850" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft JhengHei" w:hAnsi="Microsoft JhengHei" w:eastAsia="Microsoft JhengHei"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;
    const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>`;
    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${meta.page_numbers ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}</Types>`;
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    zip.file('word/settings.xml', settingsXml);
    zip.file('word/_rels/document.xml.rels', relsXml);
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    await validateDocxPackage(blob);
    return blob;
  }

  async function exportWord() {
    if (!exportCandidateIndices().length) return setStatus('目前輸出範圍沒有可輸出的照片。', 'err');
    if (!librariesReady()) return setStatus('JSZip 元件尚未載入，請重新整理。', 'err');
    showLoading('正在建立 Word 文件…');
    try {
      const removed = countDocxInvalidInputChars();
      const blob = await generateWordBlob();
      downloadBlob(blob, `${safeFilename($('title').value || '照片紀錄表')}.docx`);
      setStatus(removed ? `Word 文件已建立；已自動移除 ${removed} 個 Word/XML 不支援的控制字元。` : 'Word 文件已建立。', 'ok');
    } catch (error) { console.error(error); setStatus(`Word 輸出失敗：${error.message}`, 'err'); }
    finally { hideLoading(); }
  }

  async function exportPdf() {
    if (!exportCandidateIndices().length) return setStatus('目前輸出範圍沒有可輸出的照片。', 'err');
    showLoading('正在建立 PDF…', 'V3.2 使用內建 Canvas + PDF Writer，不需 jsPDF。');
    try {
      const blob = await generatePdfBlob();
      downloadBlob(blob, `${safeFilename($('title').value || '照片紀錄表')}.pdf`);
      setStatus('PDF 已建立。', 'ok');
    } catch (error) { console.error(error); setStatus(`PDF 輸出失敗：${error.message}`, 'err'); }
    finally { hideLoading(); }
  }

  async function exportBoth() {
    if (!exportCandidateIndices().length) return setStatus('目前輸出範圍沒有可輸出的照片。', 'err');
    if (!librariesReady()) return setStatus('JSZip 元件尚未載入，請重新整理。', 'err');
    showLoading('正在建立 Word + PDF…', 'V3.2 會依序產生，降低瀏覽器記憶體尖峰。');
    try {
      const removed = countDocxInvalidInputChars();
      const wordBlob = await generateWordBlob();
      const pdfBlob = await generatePdfBlob();
      const base = safeFilename($('title').value || '照片紀錄表');
      const zip = new JSZip();
      zip.file(`${base}.docx`, wordBlob); zip.file(`${base}.pdf`, pdfBlob);
      const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      downloadBlob(out, `${base}_Word_PDF.zip`);
      setStatus(removed ? `Word + PDF 已建立；Word 已自動移除 ${removed} 個 XML 不支援的控制字元。` : 'Word + PDF 已建立。', 'ok');
    } catch (error) { console.error(error); setStatus(`同時輸出失敗：${error.message}`, 'err'); }
    finally { hideLoading(); }
  }


  function closeUnsavedModal() {
    $('unsavedModal').classList.remove('show');
  }

  async function proceedPendingOpen(file) {
    state.pendingOpenFile = null;
    closeUnsavedModal();
    try { await openProject(file); }
    catch (error) { console.error(error); setStatus(`開啟專案失敗：${error.message}`, 'err'); }
    finally { $('projectInput').value = ''; }
  }

  function requestProjectOpen(file) {
    if (!state.dirty) return proceedPendingOpen(file);
    state.pendingOpenFile = file;
    $('unsavedModal').classList.add('show');
    return undefined;
  }

  async function safeSharedComputerExit() {
    if (!confirm('這會清除本機自動儲存、案件範本，以及目前畫面中的所有照片與未另存變更。確定要安全離開嗎？')) return false;
    const cleared = await clearAllLocalProjectData();
    if (!cleared) return false;
    revokeStateUrls();
    state.items = [];
    state.selected = -1;
    state.selectedIds.clear();
    state.logo = null;
    state.importSequence = 0;
    state.lastHealthResult = null;
    if ($('photoFilter')) $('photoFilter').value = '';
    if ($('photoFilterMode')) $('photoFilterMode').value = 'all';
    if ($('exportScope')) $('exportScope').value = 'included';
    if ($('sortMode')) $('sortMode').value = 'manual';
    clearImportSummary();
    state.quickNotes = ['設備外觀', '設備序號', '安裝位置', '功能測試', '施工前', '施工後', '驗收情形正常'];
    $('orgName').value = '';
    $('title').value = '照片紀錄表';
    $('caseName').value = '';
    if ($('caseNumber')) $('caseNumber').value = '';
    if ($('watermarkEnabled')) $('watermarkEnabled').checked = false;
    if ($('watermarkText')) $('watermarkText').value = '';
    if ($('smartLongSplit')) $('smartLongSplit').checked = true;
    state.caseArchived = false; state.caseArchivedAt = '';
    $('recordDate').value = localDateString();
    $('location').value = '';
    $('perPage').value = '2';
    $('cover').checked = false;
    $('includePageNumber').checked = false;
    renderQuickNotes(); renderLogo(); renderList(); showSelected();
    resetHistoryBaseline(true);
    state.lastSavedSignature = snapshotSignature();
    state.dirty = false;
    updateDirtyIndicator();
    setStatus('共用電腦安全離開完成：本機資料、目前照片與記憶體預覽均已清除。', 'ok');
    return true;
  }

  function bindEvents() {
    const drop = $('dropZone');
    const photoInput = $('photoInput');
    const folderInput = $('folderInput');
    $('addBtn').addEventListener('click', () => photoInput.click());
    $('addFolderBtn').addEventListener('click', () => folderInput.click());
    $('loadingCancelBtn')?.addEventListener('click', () => {
      if (!state.importRunning) return;
      state.importCancelRequested = true;
      terminateActiveHeicWorker('使用者已取消目前的 HEIC/HEIF 解碼。');
      $('loadingCancelBtn').disabled = true;
      $('loadingCancelBtn').textContent = '停止中…';
      $('loadingText').textContent = '正在停止目前解碼，並取消後續檔案處理。';
    });
    drop.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', async () => { await addFiles(photoInput.files); photoInput.value = ''; });
    folderInput.addEventListener('change', async () => { await addFiles(folderInput.files); folderInput.value = ''; });
    ['dragenter', 'dragover'].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', async (event) => {
      try { await addFiles(await collectDroppedFiles(event.dataTransfer)); }
      catch (error) { console.error(error); setStatus(`資料夾拖曳匯入失敗：${error.message}`, 'err'); }
    });
    $('sortMode').addEventListener('change', () => sortPhotos($('sortMode').value));
    $('photoFilter').addEventListener('input', renderList);
    $('photoFilterMode')?.addEventListener('change', renderList);
    $('retryFailedImportsBtn')?.addEventListener('click', retryFailedImports);
    $('clearImportSummaryBtn')?.addEventListener('click', clearImportSummary);

    $('selectAllBtn').addEventListener('click', () => { state.items.forEach((item) => state.selectedIds.add(item.id)); if (($('photoFilterMode')?.value || 'all') === 'selected') renderList(); else refreshListSelectionState(); });
    $('clearSelectionBtn').addEventListener('click', () => { state.selectedIds.clear(); if (($('photoFilterMode')?.value || 'all') === 'selected') renderList(); else refreshListSelectionState(); });
    $('upBtn').addEventListener('click', () => moveSelected(-1));
    $('downBtn').addEventListener('click', () => moveSelected(1));
    $('prevPhotoBtn').addEventListener('click', () => navigatePhoto(-1));
    $('nextPhotoBtn').addEventListener('click', () => navigatePhoto(1));
    $('removeBtn').addEventListener('click', () => {
      if (state.selected < 0) return;
      const [removed] = state.items.splice(state.selected, 1);
      if (removed?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
      if (removed?.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(removed.thumbUrl);
      if (removed?.id) state.selectedIds.delete(removed.id);
      state.selected = Math.min(state.selected, state.items.length - 1);
      renderList(); showSelected(); scheduleAutosave();
      showActionToast(`已移除「${removed?.displayName || '照片'}」`, true);
    });
    $('clearBtn').addEventListener('click', async () => {
      if (state.items.length && !confirm('確定要清除目前所有照片與編輯內容嗎？')) return;
      revokeStateUrls(); state.items = []; state.selected = -1; state.selectedIds.clear(); state.logo = null; state.importSequence = 0; state.lastHealthResult = null;
      if ($('photoFilter')) $('photoFilter').value = '';
      if ($('photoFilterMode')) $('photoFilterMode').value = 'all';
      if ($('exportScope')) $('exportScope').value = 'included';
      if ($('sortMode')) $('sortMode').value = 'manual';
      clearImportSummary();
      renderLogo(); renderList(); showSelected(); await clearAutosave();
      setStatus('照片與自動儲存資料已清除。');
    });

    $('zoomOutBtn').addEventListener('click', () => setZoom((state.fitMode ? 100 : state.zoom * 100) - 10));
    $('zoomInBtn').addEventListener('click', () => setZoom((state.fitMode ? 100 : state.zoom * 100) + 10));
    $('actualBtn').addEventListener('click', () => setZoom(100));
    $('fitBtn').addEventListener('click', fitPreview);
    $('preview').addEventListener('wheel', (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom((state.fitMode ? 100 : state.zoom * 100) + (event.deltaY < 0 ? 10 : -10));
    }, { passive: false });

    $('applyNameBtn').addEventListener('click', applySelectedName);
    $('restoreNameBtn').addEventListener('click', () => {
      if (state.selected < 0) return;
      state.items[state.selected].displayName = state.items[state.selected].originalName;
      refreshPhotoListRow(state.items[state.selected].id); showSelected(); scheduleAutosave();
    });
    $('batchRenameBtn').addEventListener('click', batchRenameAll);
    $('photoName').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applySelectedName(); } });

    $('rotateLeftBtn').addEventListener('click', () => {
      if (state.selected < 0) return;
      state.items[state.selected].rotation = (state.items[state.selected].rotation + 270) % 360;
      state.items[state.selected].annotations = rotateAnnotations(state.items[state.selected].annotations, -90);
      showSelected(); scheduleAutosave();
    });
    $('rotateRightBtn').addEventListener('click', () => {
      if (state.selected < 0) return;
      state.items[state.selected].rotation = (state.items[state.selected].rotation + 90) % 360;
      state.items[state.selected].annotations = rotateAnnotations(state.items[state.selected].annotations, 90);
      showSelected(); scheduleAutosave();
    });
    $('batchRotateLeftBtn').addEventListener('click', () => batchRotate(-90));
    $('batchRotateRightBtn').addEventListener('click', () => batchRotate(90));
    $('applyBatchDescBtn').addEventListener('click', applyBatchDescription);
    $('applyBatchLocationBtn').addEventListener('click', applyBatchLocation);
    $('applyBatchSectionBtn')?.addEventListener('click', applyBatchSection);
    $('excludeSelectedBtn')?.addEventListener('click', () => setSelectedExportExclusion(true));
    $('includeSelectedBtn')?.addEventListener('click', () => setSelectedExportExclusion(false));

    $('description').addEventListener('input', () => {
      if (state.selected >= 0) { state.items[state.selected].description = $('description').value; scheduleAutosave(); }
    });
    $('note').addEventListener('input', () => {
      if (state.selected >= 0) { state.items[state.selected].note = $('note').value; scheduleAutosave(); }
    });
    $('photoLocation').addEventListener('input', () => {
      if (state.selected >= 0) { state.items[state.selected].location = $('photoLocation').value; scheduleAutosave(); }
    });
    $('copyPrevDescBtn').addEventListener('click', () => {
      if (state.selected <= 0) return;
      state.items[state.selected].description = state.items[state.selected - 1].description || '';
      $('description').value = state.items[state.selected].description;
      setStatus('已複製上一張照片說明。', 'ok'); scheduleAutosave();
    });
    $('copyPrevLocationBtn').addEventListener('click', () => {
      if (state.selected <= 0) return;
      state.items[state.selected].location = state.items[state.selected - 1].location || '';
      $('photoLocation').value = state.items[state.selected].location;
      setStatus('已複製上一張照片地點。', 'ok'); scheduleAutosave();
    });
    $('copyPrevNoteBtn').addEventListener('click', () => {
      if (state.selected <= 0) return;
      state.items[state.selected].note = state.items[state.selected - 1].note || '';
      $('note').value = state.items[state.selected].note;
      setStatus('已複製上一張備註。', 'ok'); scheduleAutosave();
    });
    $('addQuickNoteBtn').addEventListener('click', () => {
      const value = $('newQuickNote').value.trim();
      if (!value) return;
      if (!state.quickNotes.includes(value)) state.quickNotes.push(value);
      $('newQuickNote').value = ''; renderQuickNotes(); scheduleAutosave();
    });


    ['photoSection','photoTags','compareGroup','compareRole'].forEach((id) => $(id)?.addEventListener(id === 'compareRole' ? 'change' : 'input', () => {
      const item = state.items[state.selected]; if (!item || state.caseArchived) return;
      item.section = $('photoSection').value.trim(); item.tags = $('photoTags').value.trim(); item.compareGroup = $('compareGroup').value.trim(); item.compareRole = $('compareRole').value;
      state.lastHealthResult = null;
      if (String($('photoFilter')?.value || '').trim()) renderList(); else refreshPhotoListRow(item.id);
      scheduleAutosave();
    }));
    ['caseNumber','watermarkText'].forEach((id) => $(id)?.addEventListener('input', scheduleAutosave));
    $('watermarkEnabled')?.addEventListener('change', scheduleAutosave);
    $('smartLongSplit')?.addEventListener('change', scheduleAutosave);
    $('excludeFromExport')?.addEventListener('change', () => setCurrentExportExclusion($('excludeFromExport').checked));
    $('exportScope')?.addEventListener('change', () => { renderExportScopeStatus(); scheduleAutosave(); });
    $('archiveProjectBtn')?.addEventListener('click', toggleArchiveProject);
    $('annotationBtn').addEventListener('click', openAnnotationEditor);
    $('closeAnnotationBtn').addEventListener('click', closeAnnotationEditor);
    $('annotationModal').addEventListener('click', (event) => { if (event.target === $('annotationModal')) closeAnnotationEditor(); });
    document.querySelectorAll('[data-annotation-tool]').forEach((btn) => btn.addEventListener('click', () => setAnnotationTool(btn.dataset.annotationTool)));
    $('annotationCanvas').addEventListener('pointerdown', beginAnnotationPointer);
    $('annotationCanvas').addEventListener('pointermove', moveAnnotationPointer);
    $('annotationCanvas').addEventListener('pointerup', endAnnotationPointer);
    $('annotationCanvas').addEventListener('pointercancel', cancelAnnotationPointer);
    $('annotationUndoBtn').addEventListener('click', () => { state.annotationDraft.pop(); state.annotationSelected = Math.min(state.annotationSelected, state.annotationDraft.length - 1); renderAnnotationCanvas(); });
    $('annotationDeleteBtn')?.addEventListener('click', deleteSelectedAnnotation);
    $('annotationEditTextBtn')?.addEventListener('click', editSelectedAnnotationText);
    $('annotationCanvas').addEventListener('dblclick', () => editSelectedAnnotationText());
    $('annotationClearBtn').addEventListener('click', () => { if (state.annotationDraft.length && !confirm('確定清除這張照片的全部註記嗎？')) return; state.annotationDraft = []; state.annotationSelected = -1; renderAnnotationCanvas(); });
    $('annotationSaveBtn').addEventListener('click', () => {
      const targetId = state.annotationTargetId;
      const targetIndex = state.items.findIndex((item) => item.id === targetId);
      if (targetIndex < 0) {
        closeAnnotationEditor();
        setStatus('註記目標照片已不存在，未套用任何變更。', 'err');
        return;
      }
      state.items[targetIndex].annotations = sanitizeAnnotations(state.annotationDraft);
      const count = state.items[targetIndex].annotations.length;
      state.selected = targetIndex;
      closeAnnotationEditor(); showSelected(); refreshListSelectionState(); scheduleAutosave();
      showActionToast(count ? `已套用 ${count} 個照片註記` : '已清除照片註記', true);
    });

    $('cropBtn').addEventListener('click', openCrop);
    $('closeCropBtn').addEventListener('click', () => { state.cropPointer = null; $('cropModal').classList.remove('show'); });
    $('cropModal').addEventListener('click', (event) => { if (event.target === $('cropModal')) { state.cropPointer = null; $('cropModal').classList.remove('show'); } });
    ['Left', 'Top', 'Right', 'Bottom'].forEach((key) => $(`crop${key}`).addEventListener('input', updateCropPreview));
    $('cropOverlay').addEventListener('pointerdown', beginCropPointer);
    $('cropOverlay').addEventListener('pointermove', moveCropPointer);
    $('cropOverlay').addEventListener('pointerup', endCropPointer);
    $('cropOverlay').addEventListener('pointercancel', endCropPointer);
    $('resetCropBtn').addEventListener('click', () => setCropControls(defaultCrop()));
    $('applyCropBtn').addEventListener('click', () => {
      if (state.selected < 0) return;
      const item = state.items[state.selected];
      const hadAnnotations = sanitizeAnnotations(item.annotations).length > 0;
      if (hadAnnotations && !confirm('變更裁切會讓既有註記位置失準。是否清除這張照片的註記並套用裁切？')) return;
      if (hadAnnotations) item.annotations = [];
      item.crop = getCropControls();
      $('cropModal').classList.remove('show'); showSelected(); setStatus(hadAnnotations ? '已套用照片裁切，並清除原有註記。' : '已套用照片裁切。', 'ok'); scheduleAutosave();
    });

    $('logoBtn').addEventListener('click', () => $('logoInput').click());
    $('logoInput').addEventListener('change', async () => {
      const file = $('logoInput').files[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { setStatus('LOGO 檔案不可超過 20 MB。', 'err'); $('logoInput').value = ''; return; }
      showLoading('正在讀取 LOGO…', HEIC_RE.test(file.name) ? '正在轉換 HEIC / HEIF LOGO。' : '正在驗證圖片內容。');
      try {
        const normalized = await normalizeImportedImage(file, `LOGO ${file.name}`);
        if (normalized.blob.size > 20 * 1024 * 1024) throw new Error('轉換後 LOGO 超過 20 MB 上限');
        if (state.logo?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.logo.previewUrl);
        state.logo = { name: file.name, blob: normalized.blob, previewUrl: URL.createObjectURL(normalized.blob) };
        renderLogo();
        setStatus(normalized.converted ? `LOGO 已加入；${file.name} 已從 HEIC/HEIF 轉為內部 JPEG。` : 'LOGO 已加入。', 'ok');
        scheduleAutosave();
      } catch (error) {
        setStatus(`LOGO 匯入失敗：${error.message}`, 'err');
      } finally {
        $('logoInput').value = '';
        hideLoading();
      }
    });
    $('removeLogoBtn').addEventListener('click', () => {
      if (state.logo?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.logo.previewUrl);
      state.logo = null; renderLogo(); scheduleAutosave();
    });

    ['orgName', 'title', 'caseName', 'recordDate', 'location', 'perPage', 'cover', 'includePageNumber']
      .forEach((id) => $(id).addEventListener('change', scheduleAutosave));
    ['orgName', 'title', 'caseName', 'location'].forEach((id) => $(id).addEventListener('input', scheduleAutosave));

    $('saveCaseTemplateBtn').addEventListener('click', saveCurrentCaseTemplate);
    $('applyCaseTemplateBtn').addEventListener('click', applyCaseTemplate);
    $('deleteCaseTemplateBtn').addEventListener('click', () => {
      const rawIndex = $('caseTemplateSelect').value;
      if (rawIndex === '') return setStatus('請先選擇要刪除的案件範本。', 'err');
      const index = Number(rawIndex);
      const tpl = Number.isInteger(index) ? state.caseTemplates[index] : null;
      if (!tpl) return setStatus('請先選擇要刪除的案件範本。', 'err');
      if (!confirm(`確定刪除案件範本「${tpl.name}」嗎？`)) return;
      state.caseTemplates.splice(index, 1); persistCaseTemplates(); renderCaseTemplates(); setStatus('案件範本已刪除。', 'ok');
    });

    $('autosaveEnabled').addEventListener('change', () => {
      state.autosaveEnabled = $('autosaveEnabled').checked;
      try { localStorage.setItem(AUTOSAVE_PREF_KEY, state.autosaveEnabled ? 'true' : 'false'); } catch (_) {}
      clearTimeout(state.autosaveTimer);
      if (state.autosaveEnabled) { scheduleAutosave(false); setStatus('已啟用本機自動儲存。', 'ok'); }
      else setStatus('已停用本機自動儲存；建議定期手動儲存 .photojob。');
      renderAutosaveHealth();
    });
    $('clearLocalDataBtn').addEventListener('click', async () => {
      if (!confirm('確定要清除這個瀏覽器中的自動儲存專案與案件範本嗎？目前畫面中的照片不會被刪除。')) return;
      await clearAllLocalProjectData();
    });

    $('saveProjectBtn').addEventListener('click', saveProject);
    $('undoBtn').addEventListener('click', undoProjectChange);
    $('redoBtn').addEventListener('click', redoProjectChange);
    $('openProjectBtn').addEventListener('click', () => $('projectInput').click());
    $('projectInput').addEventListener('change', () => {
      const file = $('projectInput').files[0];
      if (!file) return;
      requestProjectOpen(file);
    });
    $('unsavedCancelBtn').addEventListener('click', () => { state.pendingOpenFile = null; closeUnsavedModal(); $('projectInput').value = ''; });
    $('unsavedDiscardBtn').addEventListener('click', () => { const file = state.pendingOpenFile; if (file) proceedPendingOpen(file); });
    $('unsavedSaveBtn').addEventListener('click', async () => {
      const file = state.pendingOpenFile;
      if (!file) return;
      const saved = await saveProject();
      if (saved) await proceedPendingOpen(file);
    });
    $('safeExitBtn').addEventListener('click', safeSharedComputerExit);

    $('previewBtn').addEventListener('click', renderExactPreview);
    $('refreshPreviewBtn').addEventListener('click', renderExactPreview);
    $('previewPdfBtn').addEventListener('click', downloadPdfFromPreview);
    const closePreview = () => {
      $('previewModal').classList.remove('show');
      state.previewUrls.forEach((url) => URL.revokeObjectURL(url)); state.previewUrls = [];
      $('previewPages').innerHTML = '<div class="tiny">尚未產生預覽。</div>';
    };
    $('closePreviewBtn').addEventListener('click', closePreview);
    $('previewModal').addEventListener('click', (event) => { if (event.target === $('previewModal')) closePreview(); });


    $('actionToastUndoBtn')?.addEventListener('click', () => { $('undoBtn').click(); $('actionToast').classList.remove('show'); $('actionToast').hidden = true; });
    ['documentSection','singlePhotoSection','batchSection','exportSection'].forEach((id) => {
      const section = $(id); if (!section) return;
      section.addEventListener('toggle', () => { section.dataset.userToggled = '1'; });
    });

    $('preflightBtn').addEventListener('click', () => openPreflight(null));
    $('healthBtn').addEventListener('click', runProjectHealthCheck);
    $('closeHealthBtn').addEventListener('click', () => $('healthModal').classList.remove('show'));
    $('healthModal').addEventListener('click', (event) => { if (event.target === $('healthModal')) $('healthModal').classList.remove('show'); });
    const closePreflight = () => { $('preflightModal').classList.remove('show'); state.pendingExport = null; };
    $('closePreflightBtn').addEventListener('click', closePreflight);
    $('cancelPreflightBtn').addEventListener('click', closePreflight);
    $('preflightModal').addEventListener('click', (event) => { if (event.target === $('preflightModal')) closePreflight(); });
    $('continueExportBtn').addEventListener('click', async () => {
      const action = state.pendingExport; closePreflight(); if (action) await action();
    });
    $('wordBtn').addEventListener('click', () => guardedExport(exportWord));
    $('pdfBtn').addEventListener('click', () => guardedExport(exportPdf));
    $('bothBtn').addEventListener('click', () => guardedExport(exportBoth));

    document.addEventListener('keydown', (event) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const editing = ['input', 'textarea', 'select'].includes(tag) || document.activeElement?.isContentEditable;
      const cmd = event.ctrlKey || event.metaKey;
      const openModal = document.querySelector('.modal.show');
      if (openModal) {
        if (openModal.id === 'annotationModal' && !editing && cmd && event.key.toLowerCase() === 'z') {
          event.preventDefault(); state.annotationDraft.pop(); state.annotationSelected = Math.min(state.annotationSelected, state.annotationDraft.length - 1); renderAnnotationCanvas(); return;
        }
        if (openModal.id === 'annotationModal' && !editing && event.key === 'Delete') { event.preventDefault(); deleteSelectedAnnotation(); return; }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (openModal.id === 'annotationModal') closeAnnotationEditor();
          else if (openModal.id === 'cropModal') $('closeCropBtn')?.click();
          else if (openModal.id === 'previewModal') $('closePreviewBtn')?.click();
          else if (openModal.id === 'healthModal') $('closeHealthBtn')?.click();
          else if (openModal.id === 'preflightModal') $('closePreflightBtn')?.click();
          else if (openModal.id === 'unsavedModal') $('unsavedCancelBtn')?.click();
        }
        return;
      }
      if (cmd && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return; }
      if (cmd && event.key.toLowerCase() === 'o') { event.preventDefault(); $('projectInput').click(); return; }
      if (!editing && cmd && event.key.toLowerCase() === 'a') { event.preventDefault(); state.items.forEach((item) => state.selectedIds.add(item.id)); refreshListSelectionState(); return; }
      if (!editing && cmd && event.key.toLowerCase() === 'e') { event.preventDefault(); openPreflight(null); return; }
      if (!editing && cmd && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undoProjectChange(); return; }
      if (!editing && cmd && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); redoProjectChange(); return; }
      if (!editing && event.key === 'Delete' && state.selected >= 0) { event.preventDefault(); $('removeBtn').click(); return; }
      if (!editing && event.key === 'ArrowLeft') { event.preventDefault(); navigatePhoto(-1); return; }
      if (!editing && event.key === 'ArrowRight') { event.preventDefault(); navigatePhoto(1); return; }
      if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); navigatePhoto(-1); return; }
      if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); navigatePhoto(1); return; }
      if (!editing && event.key === 'PageUp') { event.preventDefault(); navigatePhoto(-1); }
      if (!editing && event.key === 'PageDown') { event.preventDefault(); navigatePhoto(1); }
    });
  }

  async function startup() {
    $('recordDate').value = localDateString();
    try { state.autosaveEnabled = localStorage.getItem(AUTOSAVE_PREF_KEY) !== 'false'; } catch (_) { state.autosaveEnabled = false; }
    $('autosaveEnabled').checked = state.autosaveEnabled;
    renderAutosaveHealth();
    loadCaseTemplates();
    bindEvents(); renderQuickNotes(); renderLogo(); renderMemoryMode(); renderList(); showSelected(); renderLargeProjectMonitor();
    setInterval(() => { if (!document.hidden) renderLargeProjectMonitor(); }, 5000);
    if (!librariesReady()) setStatus('JSZip 元件未載入；請確認 vendor/jszip.min.js 是否存在後重新整理。');
    if (state.autosaveEnabled) {
      let autosave = await readAutosave();
      const journals = readRecoveryJournals();
      const recovery = newestApplicableRecoveryJournal(autosave, journals);
      const recoveredJournal = recovery.merged !== autosave;
      autosave = recovery.merged;
      if (autosave?.saved_at) {
        const parsed = new Date(autosave.saved_at);
        if (!Number.isNaN(parsed.getTime())) state.lastAutosaveAt = parsed;
        renderAutosaveHealth();
      }
      if (autosave?.photos?.length) {
        const journalText = recoveredJournal ? '，並找到關閉前尚未寫入 IndexedDB 的最後文字/版面變更' : '';
        const resume = confirm(`偵測到上次自動儲存的專案（${autosave.photos.length} 張照片）${journalText}，是否續編？`);
        if (resume) {
          try {
            await applyProjectData(autosave);
            resetHistoryBaseline(false);
            if (recoveredJournal) await saveAutosaveNow();
            setStatus(recoveredJournal ? '已還原上次專案與最後一筆同步復原紀錄；此內容尚未另存為 .photojob。' : '已還原上次自動儲存的專案；此內容尚未另存為 .photojob。', 'ok');
          } catch (error) { console.warn(error); setStatus(`自動儲存還原失敗：${error.message}`, 'err'); }
        }
      }
    }
    if (!state.historyCurrent) resetHistoryBaseline(true);
    updateButtons();
  }

  window.addEventListener('beforeunload', (event) => {
    clearTimeout(state.autosaveTimer);
    terminateActiveHeicWorker();
    terminateActiveImageWorker();
    if (state.items.length && state.autosaveEnabled) {
      writeRecoveryJournal();
      saveAutosaveNow();
    }
    if (state.dirty) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(state.autosaveTimer);
    if (state.items.length && state.autosaveEnabled) {
      writeRecoveryJournal();
      saveAutosaveNow();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.items.length && state.autosaveEnabled) {
      writeRecoveryJournal();
      saveAutosaveNow();
    }
  });
  document.addEventListener('freeze', () => {
    if (state.items.length && state.autosaveEnabled) writeRecoveryJournal();
  });

  startup().catch((error) => {
    console.error(error);
    setStatus(`程式初始化失敗：${error.message}`, 'err');
  });
})();
