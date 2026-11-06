export function loadImages(entries, onProgress) {
  const total = entries.length;
  let done = 0;
  const images = new Map();
  return new Promise((resolve, reject) => {
    if (!total) {
      resolve(images);
      return;
    }
    entries.forEach(({ key, src }) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        images.set(key, img);
        done += 1;
        onProgress?.(done / total);
        if (done === total) resolve(images);
      };
      img.onerror = () => reject(new Error(`failed to load ${src}`));
      img.src = src;
    });
  });
}

export function drawSprite(ctx, img, x, y, size, rotation = 0, alpha = 1, flip = false) {
  if (!img) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (rotation) ctx.rotate(rotation);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}
