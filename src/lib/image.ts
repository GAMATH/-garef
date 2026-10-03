/**
 * Client-side image preparation: resize to ≤ 1280 px and encode WebP, lowering quality
 * until the file is under the 120 KB budget. Returns a data URL ready to upload.
 */
export async function compressImage(file: File, maxBytes = 120 * 1024, maxSide = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  let w = Math.round(bitmap.width * scale);
  let h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  for (let attempt = 0; attempt < 8; attempt++) {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(bitmap, 0, 0, w, h);
    for (const q of [0.8, 0.7, 0.6, 0.5]) {
      const url = canvas.toDataURL('image/webp', q);
      if (Math.ceil((url.length - url.indexOf(',') - 1) * 0.75) <= maxBytes) return url;
    }
    w = Math.round(w * 0.8);
    h = Math.round(h * 0.8);
  }
  return canvas.toDataURL('image/webp', 0.5);
}
