// ============================================================
// 头像字节校验(无第三方图片库,服务端只做哨兵校验):
// 魔数嗅探 + JPEG SOF / PNG IHDR 尺寸解析 + 字节/尺寸上限。
// 客户端裁剪后已是 256px JPEG(canvas),这里防止直接调 API 存垃圾字节。
// route 层(api/me/avatar)从本模块取常量与校验,单测可直连 import。
// ============================================================

export const MAX_AVATAR_BYTES = 512 * 1024; // 256px JPEG ~15-60KB;上限留足余量
export const MAX_DIMENSION = 4096;
export const MIN_DIMENSION = 1;

export type AvatarMime = "image/jpeg" | "image/png";

export type AvatarCheck =
  | { ok: true; mime: AvatarMime; width: number; height: number }
  | { ok: false; reason: "too-large" | "not-image" | "bad-dimensions" };

/** 字节头嗅探图片类型:JPEG(FF D8 FF)/ PNG(89 50 4E 47...),不可识别 → null。 */
export function sniffImage(bytes: Uint8Array): AvatarMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}

/** JPEG 尺寸:扫 SOF0-3/5-7/9-11/13 标记(C0-C3, C5-C7, C9-CB, CD),找不到 → null。 */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    if (bytes[i + 1] === 0xff) {
      i++; // JPEG 合法填充字节(FF FF),跳过
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0xda || marker === 0xd9) return null; // SOI 后无 SOF / SOS / EOI
    if (marker >= 0xd0 && marker <= 0xd7) {
      i += 2; // RSTn 无长度段
      continue;
    }
    if (i + 3 >= bytes.length) return null;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      marker === 0xcd;
    if (isSof) {
      if (i + 9 >= bytes.length) return null;
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }
    i += 2 + len;
  }
  return null;
}

/** PNG 尺寸:IHDR 固定偏移 16/20(大端,无符号 32 位)。 */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  return {
    width: ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0,
    height: ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0,
  };
}

export function imageDimensions(bytes: Uint8Array, mime: AvatarMime) {
  return mime === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
}

/** 完整校验:字节上限 → 魔数 → 尺寸头解析 + 上限。 */
export function checkAvatarImage(bytes: Uint8Array): AvatarCheck {
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return { ok: false, reason: "too-large" };
  const mime = sniffImage(bytes);
  if (!mime) return { ok: false, reason: "not-image" };
  const dims = imageDimensions(bytes, mime);
  if (
    !dims ||
    !Number.isInteger(dims.width) ||
    !Number.isInteger(dims.height) ||
    dims.width < MIN_DIMENSION ||
    dims.height < MIN_DIMENSION ||
    dims.width > MAX_DIMENSION ||
    dims.height > MAX_DIMENSION
  ) {
    return { ok: false, reason: "bad-dimensions" };
  }
  return { ok: true, mime, width: dims.width, height: dims.height };
}
