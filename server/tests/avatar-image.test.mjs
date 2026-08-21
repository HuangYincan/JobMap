import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AVATAR_BYTES,
  checkAvatarImage,
  imageDimensions,
  jpegDimensions,
  pngDimensions,
  sniffImage,
} from "../src/lib/avatar-image.ts";

/** 最小可解析 JPEG:SOI + APP0(跳过)+ SOF0(宽 300 高 42)。 */
function minimalJpeg(width, height) {
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, len=17, precision=8
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // 3 components
  ]);
  return bytes;
}

/** 最小可解析 PNG:签名 + IHDR(宽 300 高 42)。 */
function minimalPng(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR 长度
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  bytes.set([(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff], 16);
  bytes.set([(height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff], 20);
  return bytes;
}

test("sniffImage 识别 JPEG / PNG 魔数,拒绝垃圾字节", () => {
  assert.equal(sniffImage(minimalJpeg(300, 42)), "image/jpeg");
  assert.equal(sniffImage(minimalPng(300, 42)), "image/png");
  assert.equal(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38])), null); // GIF 不支持
  assert.equal(sniffImage(new Uint8Array([0x00, 0x00, 0x00])), null);
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8])), null); // 截断的 SOI
  assert.equal(sniffImage(new Uint8Array([])), null);
});

test("jpegDimensions 扫 SOF 段,无 SOF 返回 null", () => {
  assert.deepEqual(jpegDimensions(minimalJpeg(300, 42)), { width: 300, height: 42 });
  assert.deepEqual(jpegDimensions(minimalJpeg(4096, 1)), { width: 4096, height: 1 });
  // 只有 SOI + 空 APP0,无 SOF → null
  const noSof = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
  assert.equal(jpegDimensions(noSof), null);
  assert.equal(jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff])), null); // 截断
});

test("pngDimensions 读 IHDR 固定偏移", () => {
  assert.deepEqual(pngDimensions(minimalPng(300, 42)), { width: 300, height: 42 });
  assert.deepEqual(pngDimensions(minimalPng(1, 4096)), { width: 1, height: 4096 });
  assert.equal(pngDimensions(new Uint8Array(20)), null); // 不足 24 字节
});

test("checkAvatarImage 完整门禁:字节上限 / 魔数 / 尺寸", () => {
  assert.deepEqual(checkAvatarImage(minimalJpeg(256, 256)), { ok: true, mime: "image/jpeg", width: 256, height: 256 });
  assert.deepEqual(checkAvatarImage(minimalPng(100, 100)), { ok: true, mime: "image/png", width: 100, height: 100 });

  // 空 / 超上限
  assert.deepEqual(checkAvatarImage(new Uint8Array(0)), { ok: false, reason: "too-large" });
  const oversized = new Uint8Array(MAX_AVATAR_BYTES + 1);
  oversized.set(minimalJpeg(10, 10));
  assert.deepEqual(checkAvatarImage(oversized), { ok: false, reason: "too-large" });

  // 非图片
  assert.deepEqual(checkAvatarImage(new Uint8Array([0x00, 0x01, 0x02, 0x03])), { ok: false, reason: "not-image" });
  // JPEG 魔数但无 SOF
  assert.deepEqual(checkAvatarImage(new Uint8Array([0xff, 0xd8, 0xff, 0x00])), { ok: false, reason: "bad-dimensions" });

  // 尺寸越界(0 / 超 4096)
  assert.deepEqual(checkAvatarImage(minimalPng(0, 10)), { ok: false, reason: "bad-dimensions" });
  assert.deepEqual(checkAvatarImage(minimalJpeg(5000, 10)), { ok: false, reason: "bad-dimensions" });
  assert.deepEqual(checkAvatarImage(minimalPng(10, 5000)), { ok: false, reason: "bad-dimensions" });
});

test("imageDimensions 按 mime 分派", () => {
  assert.deepEqual(imageDimensions(minimalJpeg(3, 4), "image/jpeg"), { width: 3, height: 4 });
  assert.deepEqual(imageDimensions(minimalPng(3, 4), "image/png"), { width: 3, height: 4 });
  // mime 错配(JPEG 字节但按 PNG 读)→ IHDR 偏移处不是尺寸
  assert.notDeepEqual(imageDimensions(minimalJpeg(3, 4), "image/png"), { width: 3, height: 4 });
});
