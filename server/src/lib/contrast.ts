// ============================================================
// WCAG 2.1 相对亮度 / 对比度（sRGB）
//
// 正文 ≥ 4.5:1，大号/粗体 ≥ 3:1。色值来自 globals.css 与语义绿。
// ============================================================

export function srgbChannel(hexPair: string): number {
  const n = parseInt(hexPair, 16) / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (full.length !== 6) return 0;
  const r = srgbChannel(full.slice(0, 2));
  const g = srgbChannel(full.slice(2, 4));
  const b = srgbChannel(full.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const L1 = relativeLuminance(a);
  const L2 = relativeLuminance(b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsContrast(fg: string, bg: string, min = 4.5): boolean {
  return contrastRatio(fg, bg) >= min;
}

/** 浅色正文底：霜面白；深色正文底：soft-strong 近似。 */
export const CONTRAST_TOKENS = {
  inkLight: '#18212c',
  mutedLight: '#4f5b65',
  blueInkLight: '#0062CC',
  brandBlue: '#007AFF',
  semanticGreen: '#1B7F3A',
  frostLight: '#e6efe4',
  white: '#ffffff',
  inkDark: '#f4f7f5',
  mutedDark: '#a4b0b5',
  blueInkDark: '#7ab8ff',
  semanticGreenDark: '#3dce6a',
  frostDark: '#1a2227',
} as const;
