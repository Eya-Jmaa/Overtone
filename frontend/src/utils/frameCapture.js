const DEFAULT_MAX_WIDTH = 640;
const DEFAULT_QUALITY = 0.6;

export function captureFrameDataUrl(videoEl, canvas, maxWidth = DEFAULT_MAX_WIDTH, quality = DEFAULT_QUALITY) {
  if (!videoEl || !videoEl.videoWidth) return null;
  const scale = Math.min(1, maxWidth / videoEl.videoWidth);
  const w = Math.round(videoEl.videoWidth * scale);
  const h = Math.round(videoEl.videoHeight * scale);
  if (w <= 0 || h <= 0) return null;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}
