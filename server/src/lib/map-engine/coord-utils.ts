// ============================================================
// 坐标转换工具 — MapEngine 内核(coord-utils)
//
// 中国标准坐标转换(纯函数,无副作用):
// - WGS84(国际 GPS) ↔ GCJ-02(国测局加密,高德/腾讯原生坐标系)
// - GCJ-02 ↔ BD-09(百度坐标系,百度地图原生)
//
// 规范坐标 = gcj02:引擎层对外一律用 gcj02,百度引擎适配层负责
// bd09→gcj02 换算。精度:固定点位对照 ±1e-5(约 1 米)。
// ============================================================

import type { LngLat } from './types.ts';

const PI = Math.PI;
/** 克拉索夫斯基椭球长半轴(米) */
const A = 6378245.0;
/** 克拉索夫斯基椭球偏心率平方 */
const EE = 0.00669342162296594323;

/** 是否在中国大陆以外(国测局偏移只对中国境内生效,境外零偏移直通) */
function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/** WGS84 → GCJ-02 偏移量(境外返回零偏移) */
function delta(lng: number, lat: number): { dlng: number; dlat: number } {
  if (outOfChina(lng, lat)) return { dlng: 0, dlat: 0 };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { dlng: dLng, dlat: dLat };
}

/** WGS84 → GCJ-02(高德/腾讯坐标系) */
export function wgs84ToGcj02(lng: number, lat: number): LngLat {
  const { dlng, dlat } = delta(lng, lat);
  return { lng: lng + dlng, lat: lat + dlat };
}

/**
 * GCJ-02 → WGS84(迭代逆变换:偏移场随位置缓变,2 次迭代后误差 < 1e-7;
 * 单向近似在沿海点位可到 ~1.5e-5,达不到 ±1e-5 契约)。
 */
export function gcj02ToWgs84(lng: number, lat: number): LngLat {
  // 迭代:每次用当前估计点的偏移量修正,向 gcj02 目标收敛
  let est = { lng, lat };
  for (let i = 0; i < 2; i++) {
    const { dlng, dlat } = delta(est.lng, est.lat);
    est = { lng: lng - dlng, lat: lat - dlat };
  }
  return est;
}

/** GCJ-02 → BD-09(百度坐标系) */
export function gcj02ToBd09(lng: number, lat: number): LngLat {
  const x = lng;
  const y = lat;
  const z = Math.sqrt(x * x + y * y) + 0.00002 * Math.sin((y * PI * 3000.0) / 180.0);
  const theta = Math.atan2(y, x) + 0.000003 * Math.cos((x * PI * 3000.0) / 180.0);
  return { lng: z * Math.cos(theta) + 0.0065, lat: z * Math.sin(theta) + 0.006 };
}

/** BD-09 → GCJ-02 */
export function bd09ToGcj02(lng: number, lat: number): LngLat {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin((y * PI * 3000.0) / 180.0);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos((x * PI * 3000.0) / 180.0);
  return { lng: z * Math.cos(theta), lat: z * Math.sin(theta) };
}
