/** Keep the model's working area separate from the pixels the user chose to edit. */
export type InpaintMask = Uint8Array | Uint8ClampedArray;

// Four latent cells keep the model's hard mask boundary away from the kept patch.
export const NAI_INPAINT_CONTEXT_PADDING = 32;

/** Expand model context without changing the exact user/composite selection. */
export function expandInpaintMask(mask: InpaintMask, width: number, height: number, radius: number): Uint8ClampedArray {
  assertMask(mask, width, height);
  if (!Number.isSafeInteger(radius) || radius < 0) throw new RangeError("遮罩扩展半径必须为非负整数");
  const horizontal = new Uint8ClampedArray(mask.length);
  const result = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x <= Math.min(radius, width - 1); x++) count += Number(mask[y * width + x] > 0);
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = count > 0 ? 255 : 0;
      if (x - radius >= 0) count -= Number(mask[y * width + x - radius] > 0);
      if (x + radius + 1 < width) count += Number(mask[y * width + x + radius + 1] > 0);
    }
  }
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y <= Math.min(radius, height - 1); y++) count += Number(horizontal[y * width + x] > 0);
    for (let y = 0; y < height; y++) {
      result[y * width + x] = count > 0 ? 255 : 0;
      if (y - radius >= 0) count -= Number(horizontal[(y - radius) * width + x] > 0);
      if (y + radius + 1 < height) count += Number(horizontal[(y + radius + 1) * width + x] > 0);
    }
  }
  return result;
}

function assertMask(mask: InpaintMask, width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !Number.isSafeInteger(width * height) || mask.length !== width * height) {
    throw new RangeError("重绘遮罩尺寸与画布不一致");
  }
}

/** Expand every touched latent cell for the API, without changing the selection. */
export function alignInpaintMaskToGrid(mask: InpaintMask, width: number, height: number, gridSize = 8): Uint8ClampedArray {
  assertMask(mask, width, height);
  if (!Number.isSafeInteger(gridSize) || gridSize <= 0) throw new RangeError("遮罩网格大小必须为正整数");
  const aligned = new Uint8ClampedArray(mask.length);
  for (let top = 0; top < height; top += gridSize) {
    for (let left = 0; left < width; left += gridSize) {
      const bottom = Math.min(height, top + gridSize);
      const right = Math.min(width, left + gridSize);
      let selected = false;
      for (let y = top; y < bottom && !selected; y++) {
        for (let x = left; x < right; x++) {
          if (mask[y * width + x] > 0) { selected = true; break; }
        }
      }
      if (selected) for (let y = top; y < bottom; y++) aligned.fill(255, y * width + left, y * width + right);
    }
  }
  return aligned;
}

/** Feather only inside the exact selection; a zero-coverage pixel always stays zero. */
export function featherInpaintMaskInward(mask: InpaintMask, width: number, height: number, radius = 0): Uint8ClampedArray {
  assertMask(mask, width, height);
  if (!Number.isFinite(radius) || radius < 0) throw new RangeError("羽化半径必须为非负数");
  const result = new Uint8ClampedArray(mask);
  if (radius === 0) return result;
  // Two-pass chamfer distance avoids a radius-squared blur and its outward bleed.
  const distance = new Float32Array(mask.length);
  const diagonal = Math.SQRT2;
  for (let i = 0; i < mask.length; i++) distance[i] = mask[i] === 0 ? 0 : Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (distance[i] === 0) continue;
      if (x > 0) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
      if (y > 0) {
        distance[i] = Math.min(distance[i], distance[i - width] + 1);
        if (x > 0) distance[i] = Math.min(distance[i], distance[i - width - 1] + diagonal);
        if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i - width + 1] + diagonal);
      }
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (distance[i] === 0) continue;
      if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
      if (y + 1 < height) {
        distance[i] = Math.min(distance[i], distance[i + width] + 1);
        if (x > 0) distance[i] = Math.min(distance[i], distance[i + width - 1] + diagonal);
        if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i + width + 1] + diagonal);
      }
      const t = Math.min(1, distance[i] / (radius + 1));
      result[i] = Math.round(mask[i] * t * t * (3 - 2 * t));
    }
  }
  return result;
}

export function prepareInpaintMasks(mask: InpaintMask, width: number, height: number, featherRadius = 0) {
  return {
    requestMask: alignInpaintMaskToGrid(mask, width, height),
    compositeMask: featherInpaintMaskInward(mask, width, height, featherRadius),
  };
}
