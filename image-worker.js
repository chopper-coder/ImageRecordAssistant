'use strict';

function clampPct(value) {
  return Math.max(0, Math.min(85, Number(value || 0)));
}

function dhashFromGray(gray) {
  let hex = '';
  let nibble = 0;
  let bitCount = 0;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const bit = gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0;
      nibble = (nibble << 1) | bit;
      bitCount += 1;
      if (bitCount === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bitCount = 0;
      }
    }
  }
  return hex.padStart(16, '0');
}

async function analyzeBitmap(bitmap) {
  const hashCanvas = new OffscreenCanvas(9, 8);
  const hashCtx = hashCanvas.getContext('2d', { alpha: false, willReadFrequently: true, colorSpace: 'srgb' });
  if (!hashCtx) throw new Error('無法建立相似照片分析畫布。');
  hashCtx.drawImage(bitmap, 0, 0, 9, 8);
  const hashPixels = hashCtx.getImageData(0, 0, 9, 8).data;
  const gray = [];
  for (let i = 0; i < hashPixels.length; i += 4) gray.push((hashPixels[i] * 299 + hashPixels[i + 1] * 587 + hashPixels[i + 2] * 114) / 1000);
  const dhash = dhashFromGray(gray);

  const side = 64;
  const qualityCanvas = new OffscreenCanvas(side, side);
  const qualityCtx = qualityCanvas.getContext('2d', { alpha: false, willReadFrequently: true, colorSpace: 'srgb' });
  if (!qualityCtx) throw new Error('無法建立照片品質分析畫布。');
  qualityCtx.drawImage(bitmap, 0, 0, side, side);
  const pixels = qualityCtx.getImageData(0, 0, side, side).data;
  const lum = new Float32Array(side * side);
  let sum = 0;
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const value = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
    lum[p] = value;
    sum += value;
  }
  const mean = sum / lum.length;
  let varianceSum = 0;
  let gradientSum = 0;
  let gradientCount = 0;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const idx = y * side + x;
      const d = lum[idx] - mean;
      varianceSum += d * d;
      if (x + 1 < side) { gradientSum += Math.abs(lum[idx] - lum[idx + 1]); gradientCount += 1; }
      if (y + 1 < side) { gradientSum += Math.abs(lum[idx] - lum[idx + side]); gradientCount += 1; }
    }
  }
  return {
    dhash,
    meanLuma: Number(mean.toFixed(2)),
    lumaVariance: Number((varianceSum / lum.length).toFixed(2)),
    edgeScore: Number((gradientCount ? gradientSum / gradientCount : 0).toFixed(2)),
  };
}

self.onmessage = async (event) => {
  const data = event.data || {};
  try {
    const blob = data.blob;
    if (!(blob instanceof Blob)) throw new Error('缺少有效圖片資料。');
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') throw new Error('此瀏覽器不支援 OffscreenCanvas 圖片處理。');
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
    try {
      if (data.mode === 'analyze') {
        const analysis = await analyzeBitmap(bitmap);
        self.postMessage({ ok: true, mode: 'analyze', width: bitmap.width, height: bitmap.height, analysis });
        return;
      }

      const crop = { left: 0, top: 0, right: 0, bottom: 0, ...(data.crop || {}) };
      const left = clampPct(crop.left), top = clampPct(crop.top), right = clampPct(crop.right), bottom = clampPct(crop.bottom);
      const sx = Math.round(bitmap.width * left / 100);
      const sy = Math.round(bitmap.height * top / 100);
      const sw = Math.max(1, Math.round(bitmap.width * (100 - left - right) / 100));
      const sh = Math.max(1, Math.round(bitmap.height * (100 - top - bottom) / 100));
      const rotation = ((Number(data.rotation || 0) % 360) + 360) % 360;
      const swap = rotation === 90 || rotation === 270;
      const rawW = swap ? sh : sw;
      const rawH = swap ? sw : sh;
      const maxDim = Math.max(256, Math.min(4096, Number(data.maxDim || 2200)));
      const scale = Math.min(1, maxDim / Math.max(rawW, rawH));
      const width = Math.max(1, Math.round(rawW * scale));
      const height = Math.max(1, Math.round(rawH * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
      if (!ctx) throw new Error('無法建立離線圖片處理畫布。');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate(rotation * Math.PI / 180);
      const drawW = sw * scale;
      const drawH = sh * scale;
      ctx.drawImage(bitmap, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
      const quality = Math.max(0.5, Math.min(1, Number(data.quality || 0.92)));
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      self.postMessage({ ok: true, mode: 'transform', blob: out, width, height });
    } finally {
      try { bitmap.close(); } catch (_) {}
    }
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || String(error) });
  }
};
