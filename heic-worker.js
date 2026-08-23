'use strict';

const HEIC_DECODER_PATH = './vendor/heic-to/heic-to-worker.js';
let decoderPromise = null;

async function getDecoder() {
  if (!decoderPromise) {
    decoderPromise = import(HEIC_DECODER_PATH).then((mod) => {
      const heicTo = mod.heicTo || mod.default;
      if (typeof heicTo !== 'function') throw new Error('HEIC decoder module format invalid');
      return heicTo;
    }).catch((error) => {
      decoderPromise = null;
      throw error;
    });
  }
  return decoderPromise;
}

self.onmessage = async (event) => {
  const { taskId = '', blob, type = 'image/jpeg', quality = 0.92 } = event.data || {};
  try {
    if (!(blob instanceof Blob)) throw new Error('Invalid HEIC input');
    const heicTo = await getDecoder();
    let output = await heicTo({ blob, type, quality });
    if (Array.isArray(output)) output = output.find((item) => item instanceof Blob) || null;
    if (!(output instanceof Blob)) throw new Error('HEIC decoder returned no image');
    self.postMessage({ taskId, ok: true, blob: output });
  } catch (error) {
    self.postMessage({ taskId, ok: false, error: String(error?.message || error || 'HEIC decode failed') });
  }
};
