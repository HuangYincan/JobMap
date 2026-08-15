// ============================================================
// POI 地图标记控制器 — Phase 2 卡片↔地图联动
//
// 纯逻辑类（无 React），包装一个 AMap.Map 实例：
// - 根据 POI 列表创建/差分管理 AMap.Marker
// - Domain 用彩色图钉，Recruitment 用圆角方块 + 公司 emoji
// - 支持选中（放大 + 强调环）与高亮（轻微放大 + 透明度）
// - 全部 AMap 调用都做了防御性守卫，无浏览器环境（node 测试）下静默降级
// ============================================================

import { loadAMap } from './amap-api.ts';
import type { POI } from './types.ts';
import { isDomainPOI, isRecruitmentPOI } from './types.ts';

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/** POI 地图标记控制器的公共接口。 */
export interface POIMarkerController {
  /** 全量替换地图上的标记（内部做差分：移除不在新列表中的、新增缺失的）。 */
  setPOIs(pois: POI[]): void;
  /** 移除地图上所有标记并清空内部状态。 */
  clear(): void;
  /** 高亮指定标记：轻微放大 + 透明度变化。 */
  highlight(id: string): void;
  /** 取消所有高亮，恢复为默认/选中样式。 */
  unhighlight(): void;
  /** 选中指定标记：放大 + 强调环。 */
  select(id: string): void;
  /** 取消选中，恢复为默认/高亮样式。 */
  deselect(): void;
  /** 平滑移动地图视野到指定标记（默认缩放级别 16）。 */
  flyTo(id: string, zoom?: number): void;
  /** 根据所有标记的分布自动调整视野，让全部标记可见。 */
  fitPOIs(): void;
  /** 按 POI id 获取底层 AMap Marker 实例（不存在返回 undefined）。 */
  getMarkerByPOIId(id: string): any;
  /** 销毁控制器：移除全部标记、清空引用，之后所有方法变为 no-op。 */
  destroy(): void;
}

/** createPOIMarkerController 的选项。 */
export interface POIMarkerControllerOptions {
  /** 标记点击回调，参数为被点击 POI 的 id。 */
  onMarkerClick?: (poiId: string) => void;
  /** 默认模式强调色（十六进制，如 '#FF6B35'），缺省为品牌蓝。 */
  color?: string;
  /** 可选：为每个标记生成文字标签内容的函数。 */
  getLabel?: (poi: POI) => string;
}

// ---------------------------------------------------------------------------
// 图标纯函数（不依赖 AMap，可独立测试）
// ---------------------------------------------------------------------------

/** 标记视觉状态。 */
type MarkerState = 'normal' | 'highlighted' | 'selected';

/** 默认强调色。 */
const DEFAULT_COLOR = '#3478F6';

/** 图钉基准尺寸（viewBox 坐标，像素）。 */
const PIN_BASE = { w: 32, h: 40 } as const;
/** 公司徽章基准尺寸（正方形，像素）。 */
const BADGE_BASE = 28;

/**
 * 根据状态返回缩放系数：
 * - selected 1.3（放大 + 强调环）
 * - highlighted 1.15（轻微放大）
 * - normal 1
 */
function stateScale(state: MarkerState): number {
  return state === 'selected' ? 1.3 : state === 'highlighted' ? 1.15 : 1;
}

/** 校验强调色：只接受合法十六进制，防止注入非法 CSS 到 SVG 内联样式。 */
function normalizeColor(color?: string): string {
  if (color && /^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  return DEFAULT_COLOR;
}

/** 将 SVG 字符串编码为 data URI。 */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 取公司 logo（emoji），超长截断、缺失回退为 🏢。 */
function toEmojiLogo(logo?: string): string {
  if (!logo) return '🏢';
  const trimmed = logo.trim();
  if (!trimmed) return '🏢';
  // Array.from 按码点切分，保留 emoji 的变体选择符（如 🛰️）
  return Array.from(trimmed).slice(0, 2).join('');
}

/**
 * 生成 Domain 图钉 SVG。
 * 外圈光晕在非 normal 状态出现，作为放大/强调的视觉提示。
 */
export function domainPinSVG(color: string, state: MarkerState): string {
  const c = normalizeColor(color);
  const fillOpacity = state === 'highlighted' ? 0.85 : 1;
  const parts: string[] = [];

  if (state !== 'normal') {
    parts.push(
      `<circle cx="16" cy="15" r="14" fill="none" stroke="${c}" stroke-width="3" opacity="0.45"/>`
    );
  }
  parts.push(
    `<path d="M16 2C9 2 3 8 3 15c0 8.5 13 23 13 23s13-14.5 13-23C29 8 23 2 16 2Z" ` +
      `fill="${c}" fill-opacity="${fillOpacity}" stroke="#ffffff" stroke-width="2"/>`
  );
  parts.push(`<circle cx="16" cy="15" r="6" fill="#ffffff"/>`);
  if (state === 'selected') {
    parts.push(`<circle cx="16" cy="15" r="2.5" fill="${c}"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">${parts.join('')}</svg>`;
}

/**
 * 生成 Recruitment 公司徽章 SVG：白色圆角方块 + 公司 emoji。
 * 非 normal 状态带外圈强调环，作为放大/高亮的视觉提示。
 */
export function recruitmentBadgeSVG(logo: string | undefined, color: string, state: MarkerState): string {
  const c = normalizeColor(color);
  const emoji = toEmojiLogo(logo);
  const fillOpacity = state === 'highlighted' ? 0.9 : 1;
  const parts: string[] = [];

  if (state !== 'normal') {
    parts.push(
      `<rect x="1" y="1" width="26" height="26" rx="8" fill="none" stroke="${c}" stroke-width="2.5" opacity="0.45"/>`
    );
  }
  parts.push(
    `<rect x="1.5" y="1.5" width="25" height="25" rx="7" fill="#ffffff" fill-opacity="${fillOpacity}" ` +
      `stroke="${c}" stroke-width="2"/>`
  );
  parts.push(
    `<text x="14" y="15" font-size="13" text-anchor="middle" dominant-baseline="central">${emoji}</text>`
  );
  if (state === 'selected') {
    parts.push(
      `<circle cx="14" cy="14" r="11.5" fill="none" stroke="${c}" stroke-width="2" opacity="0.35"/>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">${parts.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// 控制器实现
// ---------------------------------------------------------------------------

class POIMarkerControllerImpl implements POIMarkerController {
  private map: any;
  private opts: POIMarkerControllerOptions;
  private color: string;
  /** poiId → AMap Marker 实例。 */
  private markers = new Map<string, any>();
  /** poiId → POI 数据（生成图标 / 还原样式时需要）。 */
  private poiById = new Map<string, POI>();
  /** poiId → 当前视觉状态，用于避免重复 setIcon 造成闪烁。 */
  private markerStates = new Map<string, MarkerState>();
  /** 最近一次 setPOIs 的列表；AMap 就绪前缓存，就绪后回放。 */
  private pendingPOIs: POI[] = [];
  private selectedId: string | null = null;
  private highlightedId: string | null = null;
  /** 加载到的 AMap 命名空间（异步）。 */
  private amap: any = null;
  private destroyed = false;

  constructor(map: any, opts: POIMarkerControllerOptions = {}) {
    this.map = map;
    this.opts = opts;
    this.color = normalizeColor(opts.color);

    loadAMap()
      .then((amap) => {
        if (this.destroyed) return;
        this.amap = amap;
        this.flush();
      })
      .catch(() => {
        // 非浏览器环境 / 缺少 key / 脚本加载失败：静默降级，
        // 只维护内部状态，不创建任何标记（保证 node 下可测且不抛错）。
      });
  }

  /** 是否具备创建标记的全部前提。 */
  private isReady(): boolean {
    return !this.destroyed && !!this.map && !!this.amap;
  }

  /** AMap 异步就绪后回放最近一次 POI 列表。 */
  private flush(): void {
    if (!this.isReady()) return;
    this.setPOIs(this.pendingPOIs);
  }

  // -- 标记创建 / 删除 ------------------------------------------------------

  /** 为单个 POI 创建并添加 AMap Marker。 */
  private addMarker(poi: POI): void {
    if (!this.isReady()) return;

    const state: MarkerState =
      poi.id === this.selectedId
        ? 'selected'
        : poi.id === this.highlightedId
          ? 'highlighted'
          : 'normal';

    const icon = this.buildIcon(poi, state);
    const offset = this.buildOffset(poi, state);
    const labelText = this.opts.getLabel?.(poi);

    const marker = new this.amap.Marker({
      position: [poi.location.lng, poi.location.lat],
      icon,
      offset,
      title: poi.name,
      ...(labelText
        ? { label: { content: labelText, direction: 'top', offset: new this.amap.Pixel(0, -6) } }
        : {}),
      map: this.map,
    });

    marker.on('click', () => {
      if (this.destroyed) return;
      this.opts.onMarkerClick?.(poi.id);
    });

    marker.setzIndex(this.zIndexFor(state, poi));
    this.markers.set(poi.id, marker);
    this.poiById.set(poi.id, poi);
    this.markerStates.set(poi.id, state);
  }

  /** 移除指定 id 的标记（从地图上摘除并清空内部记录）。 */
  private removeMarker(id: string): void {
    const marker = this.markers.get(id);
    if (marker && typeof marker.setMap === 'function') {
      marker.setMap(null);
    }
    this.markers.delete(id);
    this.poiById.delete(id);
    this.markerStates.delete(id);
  }

  /** 更新已有标记的视觉样式（图标 / 锚点偏移 / zIndex）。 */
  private applyStyle(marker: any, poi: POI, state: MarkerState): void {
    if (!this.amap || !marker) return;
    if (this.markerStates.get(poi.id) === state) return;
    this.markerStates.set(poi.id, state);
    marker.setIcon(this.buildIcon(poi, state));
    marker.setOffset(this.buildOffset(poi, state));
    marker.setzIndex(this.zIndexFor(state, poi));
  }

  /** 计算指定状态下的 zIndex：选中 > 高亮 > 普通（招聘徽章略高于图钉）。 */
  private zIndexFor(state: MarkerState, poi: POI): number {
    if (state === 'selected') return 100;
    if (state === 'highlighted') return 80;
    return isRecruitmentPOI(poi) ? 20 : 10;
  }

  /** 构建 AMap.Icon（data URI SVG）。 */
  private buildIcon(poi: POI, state: MarkerState): any {
    const scale = stateScale(state);
    if (isDomainPOI(poi)) {
      const w = Math.round(PIN_BASE.w * scale);
      const h = Math.round(PIN_BASE.h * scale);
      return new this.amap.Icon({
        size: new this.amap.Size(w, h),
        image: svgToDataUri(domainPinSVG(this.color, state)),
        imageSize: new this.amap.Size(w, h),
      });
    }
    const size = Math.round(BADGE_BASE * scale);
    return new this.amap.Icon({
      size: new this.amap.Size(size, size),
      image: svgToDataUri(
        recruitmentBadgeSVG(isRecruitmentPOI(poi) ? poi.company.logo : undefined, this.color, state)
      ),
      imageSize: new this.amap.Size(size, size),
    });
  }

  /** 构建锚点偏移：图钉锚定底部尖端，徽章锚定中心。 */
  private buildOffset(poi: POI, state: MarkerState): any {
    const scale = stateScale(state);
    if (isDomainPOI(poi)) {
      const w = PIN_BASE.w * scale;
      const h = PIN_BASE.h * scale;
      return new this.amap.Pixel(-w / 2, -h);
    }
    const size = BADGE_BASE * scale;
    return new this.amap.Pixel(-size / 2, -size / 2);
  }

  // -- 公共接口实现 ---------------------------------------------------------

  setPOIs(pois: POI[]): void {
    this.pendingPOIs = pois;
    if (!this.isReady()) return;

    const incoming = new Set(pois.map((p) => p.id));

    // 移除不在新列表中的标记
    for (const id of Array.from(this.markers.keys())) {
      if (!incoming.has(id)) {
        this.removeMarker(id);
      }
    }

    // 新增缺失标记 / 更新已有标记的位置与样式
    for (const poi of pois) {
      const existing = this.markers.get(poi.id);
      if (existing) {
        existing.setPosition([poi.location.lng, poi.location.lat]);
        if (poi.name) existing.setTitle(poi.name);
        this.poiById.set(poi.id, poi);
        const state: MarkerState =
          poi.id === this.selectedId
            ? 'selected'
            : poi.id === this.highlightedId
              ? 'highlighted'
              : 'normal';
        this.applyStyle(existing, poi, state);
      } else {
        this.addMarker(poi);
      }
    }
  }

  clear(): void {
    this.pendingPOIs = [];
    this.selectedId = null;
    this.highlightedId = null;
    for (const id of Array.from(this.markers.keys())) {
      this.removeMarker(id);
    }
  }

  highlight(id: string): void {
    this.highlightedId = id;
    const marker = this.markers.get(id);
    const poi = this.poiById.get(id);
    if (marker && poi && id !== this.selectedId) {
      this.applyStyle(marker, poi, 'highlighted');
    }
  }

  unhighlight(): void {
    this.highlightedId = null;
    for (const [id, marker] of this.markers) {
      const poi = this.poiById.get(id);
      if (!poi) continue;
      const state: MarkerState = id === this.selectedId ? 'selected' : 'normal';
      this.applyStyle(marker, poi, state);
    }
  }

  select(id: string): void {
    this.selectedId = id;
    if (this.highlightedId === id) this.highlightedId = null;
    const marker = this.markers.get(id);
    const poi = this.poiById.get(id);
    if (marker && poi) {
      this.applyStyle(marker, poi, 'selected');
    }
  }

  deselect(): void {
    this.selectedId = null;
    for (const [id, marker] of this.markers) {
      const poi = this.poiById.get(id);
      if (!poi) continue;
      const state: MarkerState = id === this.highlightedId ? 'highlighted' : 'normal';
      this.applyStyle(marker, poi, state);
    }
  }

  flyTo(id: string, zoom?: number): void {
    if (!this.map) return;
    const marker = this.markers.get(id);
    if (!marker) return;
    const pos = marker.getPosition();
    if (!pos) return;
    // AMap LngLat 实例或 [lng, lat] 数组，两种都兼容
    const center =
      typeof pos.getLng === 'function' ? [pos.getLng(), pos.getLat()] : pos;
    this.map.setZoomAndCenter(zoom || 16, center, false, 600);
  }

  fitPOIs(): void {
    if (!this.map) return;
    const markers = Array.from(this.markers.values());
    if (markers.length === 0) return;
    this.map.setFitView(markers, false, [40, 40, 40, 40]);
  }

  getMarkerByPOIId(id: string): any {
    return this.markers.get(id);
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
    this.map = null;
    this.amap = null;
    this.opts = {};
  }
}

/**
 * 创建 POI 地图标记控制器。
 *
 * @param map AMap.Map 实例（可为空，为空时所有方法安全 no-op）。
 * @param opts 配置项（点击回调 / 强调色 / 标签生成函数）。
 * @returns 遵循 POIMarkerController 接口的控制器实例。
 */
export function createPOIMarkerController(
  map: any,
  opts: POIMarkerControllerOptions = {}
): POIMarkerController {
  return new POIMarkerControllerImpl(map, opts);
}
