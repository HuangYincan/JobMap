// ============================================================
// POI 地图标记控制器 — Phase 2 卡片↔地图联动
//
// 纯逻辑类（无 React），包装一个 AMap.Map 实例：
// - 根据 POI 列表创建/差分管理 AMap.Marker
// - Domain 用彩色图钉，Recruitment 用圆角方块 + 真实公司 logo
//   （logoUrl 图片优先，缺失/加载失败回退 emoji）
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
export type MarkerState = 'normal' | 'highlighted' | 'selected';

/** 选中优先于高亮；同一时刻最多一个 selected、一个 highlighted。 */
export function resolveMarkerState(
  id: string,
  selectedId: string | null,
  highlightedId: string | null
): MarkerState {
  if (id === selectedId) return 'selected';
  if (id === highlightedId) return 'highlighted';
  return 'normal';
}

/** 默认强调色。 */
const DEFAULT_COLOR = '#3478F6';

/** 图钉基准尺寸（viewBox 坐标，像素）。 */
const PIN_BASE = { w: 32, h: 40 } as const;
/** 公司徽章基准尺寸（正方形，像素）。 */
const BADGE_BASE = 40;

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

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 公司徽章 HTML（AMap Marker content）。
 * data-URI SVG 无法加载远程 favicon，必须用真 <img>。
 */
export function recruitmentBadgeHTML(
  logo: string | undefined,
  logoUrl: string | undefined,
  color: string,
  state: MarkerState
): string {
  const c = normalizeColor(color);
  const emoji = toEmojiLogo(logo);
  const size = Math.round(BADGE_BASE * stateScale(state));
  const img = logoUrl
    ? `<img src="${escapeAttr(logoUrl)}" width="${size - 12}" height="${size - 12}" alt="" ` +
      `referrerpolicy="no-referrer" decoding="async" ` +
      `onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='block')"/>`
    : '';
  const emojiDisplay = logoUrl ? 'none' : 'block';
  return (
    `<div class="dm-badge dm-badge-${state}" style="` +
    `width:${size}px;height:${size}px;border-color:${c};opacity:${state === 'highlighted' ? 0.92 : 1}` +
    `">${img}<span class="dm-badge-emoji" style="display:${emojiDisplay}">${emoji}</span></div>`
  );
}

/** 无远程图时的 SVG 徽章（测试 / 无 logoUrl 回退）。 */
export function recruitmentBadgeSVG(
  logo: string | undefined,
  _logoUrl: string | undefined,
  color: string,
  state: MarkerState
): string {
  const c = normalizeColor(color);
  const emoji = toEmojiLogo(logo);
  const fillOpacity = state === 'highlighted' ? 0.9 : 1;
  const parts: string[] = [];
  if (state !== 'normal') {
    parts.push(
      `<rect x="1" y="1" width="38" height="38" rx="11" fill="none" stroke="${c}" stroke-width="2.5" opacity="0.45"/>`
    );
  }
  parts.push(
    `<rect x="2" y="2" width="36" height="36" rx="10" fill="#ffffff" fill-opacity="${fillOpacity}" ` +
      `stroke="${c}" stroke-width="2"/>`
  );
  parts.push(
    `<text x="20" y="21" font-size="16" text-anchor="middle" dominant-baseline="central">${emoji}</text>`
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">${parts.join('')}</svg>`;
}

const BADGE_STYLE = `
    .dm-badge{display:flex;align-items:center;justify-content:center;border-radius:12px;
      background:#fff;border:2.5px solid #007AFF;box-shadow:0 6px 16px rgba(24,33,41,.22);
      overflow:hidden;box-sizing:border-box}
    .dm-badge img{width:70%;height:70%;object-fit:contain;display:block}
    .dm-badge-emoji{font-size:18px;line-height:1}
    .dm-badge-selected{box-shadow:0 0 0 3px rgba(0,122,255,.35),0 8px 18px rgba(24,33,41,.25)}
    .dm-badge-highlighted{box-shadow:0 0 0 2px rgba(0,122,255,.28),0 6px 14px rgba(24,33,41,.2)}
  `;

function injectBadgeStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('dm-badge-style') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'dm-badge-style';
    document.head.appendChild(style);
  }
  style.textContent = BADGE_STYLE;
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
  /**
   * 本控制器登记到地图上的全部 Marker（含簿记丢失的）。
   * 与 markers 的差异：addMarker 一成功构造就入账，任何后续异常都不会
   * 造成「marker 在地图上、但 destroy/差分无法摘除」的永久泄漏（Bug1 伴生）。
   */
  private placed = new Set<any>();
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
    injectBadgeStyles();

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

  /** 是否具备创建标记的全部前提（含地图未被销毁）。 */
  private isReady(): boolean {
    if (this.destroyed || !this.map || !this.amap) return false;
    // 地图已被销毁时不再创建 marker：已销毁实例的 overlay 注册表无人清理，
    // 会造成 getAllOverlays 计数 > catalog 的永久残留（Bug1 伴生）。
    if (typeof this.map.isDestroyed === 'function' && this.map.isDestroyed()) {
      return false;
    }
    return true;
  }

  /**
   * 从地图摘除一个 marker（若仍挂在地图上）。异常不影响内部状态清理：
   * 地图已销毁等场景下 setMap(null) 可能抛错，绝不能因单个 marker 中断
   * clear/destroy 的清扫循环。
   */
  private detachFromMap(marker: any): void {
    if (!marker) return;
    try {
      if (typeof marker.setMap === 'function') marker.setMap(null);
    } catch {
      // 忽略：内部簿记照常删除，避免 cleanup 中途抛错留下半清状态
    }
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

    const state = resolveMarkerState(poi.id, this.selectedId, this.highlightedId);

    const offset = this.buildOffset(poi, state);
    const markerOpts: Record<string, unknown> = {
      position: [poi.location.lng, poi.location.lat],
      offset,
      map: this.map,
    };
    if (isRecruitmentPOI(poi)) {
      markerOpts.content = recruitmentBadgeHTML(
        poi.company.logo,
        poi.company.logoUrl,
        this.color,
        state
      );
    } else {
      markerOpts.icon = this.buildIcon(poi, state);
    }

    let marker: any;
    try {
      marker = new this.amap.Marker(markerOpts);
    } catch {
      // 构造即失败（如地图销毁竞态）→ 不登记任何簿记，不留残留
      return;
    }

    // 先入 placed 账：map: 选项在构造时已把 marker 注册到地图上，
    // 若后续步骤（绑定事件/设 zIndex）抛错，destroy/clear 仍能凭 placed 摘除
    this.placed.add(marker);
    try {
      marker.on('click', () => {
        if (this.destroyed) return;
        this.opts.onMarkerClick?.(poi.id);
      });

      marker.setzIndex(this.zIndexFor(state, poi));
    } catch {
      // 绑定/样式失败 → 摘除刚注册的 marker，避免无主残留
      this.detachFromMap(marker);
      this.placed.delete(marker);
      return;
    }

    this.markers.set(poi.id, marker);
    this.poiById.set(poi.id, poi);
    this.markerStates.set(poi.id, state);
  }

  /** 移除指定 id 的标记（从地图上摘除并清空内部记录）。 */
  private removeMarker(id: string): void {
    const marker = this.markers.get(id);
    this.detachFromMap(marker);
    this.markers.delete(id);
    this.poiById.delete(id);
    this.markerStates.delete(id);
    if (marker) this.placed.delete(marker);
  }

  /** 更新已有标记的视觉样式（图标 / 锚点偏移 / zIndex / label 可见性）。 */
  private applyStyle(marker: any, poi: POI, state: MarkerState): void {
    if (!this.amap || !marker) return;
    if (this.markerStates.get(poi.id) === state) return;
    this.markerStates.set(poi.id, state);
    if (isRecruitmentPOI(poi) && typeof marker.setContent === 'function') {
      marker.setContent(
        recruitmentBadgeHTML(poi.company.logo, poi.company.logoUrl, this.color, state)
      );
    } else {
      marker.setIcon(this.buildIcon(poi, state));
    }
    marker.setOffset(this.buildOffset(poi, state));
    marker.setzIndex(this.zIndexFor(state, poi));
    if (typeof marker.setLabel === 'function') marker.setLabel(null);
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
        recruitmentBadgeSVG(
          isRecruitmentPOI(poi) ? poi.company.logo : undefined,
          isRecruitmentPOI(poi) ? poi.company.logoUrl : undefined,
          this.color,
          state
        )
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
        this.poiById.set(poi.id, poi);
        this.applyStyle(
          existing,
          poi,
          resolveMarkerState(poi.id, this.selectedId, this.highlightedId)
        );
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

  /**
   * 兜底清扫：无论内部簿记是否丢失，凡本控制器登记到地图上的 overlay
   * 一律摘除。保证不变式「销毁后地图上无该控制器管理过的 marker」。
   */
  private sweepPlaced(): void {
    for (const marker of Array.from(this.placed)) {
      this.detachFromMap(marker);
    }
    this.placed.clear();
  }

  /** 按当前 selected / highlighted 重绘指定标记。 */
  private refresh(id: string | null): void {
    if (!id) return;
    const marker = this.markers.get(id);
    const poi = this.poiById.get(id);
    if (!marker || !poi) return;
    this.applyStyle(marker, poi, resolveMarkerState(id, this.selectedId, this.highlightedId));
  }

  highlight(id: string): void {
    const prev = this.highlightedId;
    this.highlightedId = id;
    if (prev && prev !== id) this.refresh(prev);
    this.refresh(id);
  }

  unhighlight(): void {
    const prev = this.highlightedId;
    this.highlightedId = null;
    this.refresh(prev);
  }

  select(id: string): void {
    const prev = this.selectedId;
    this.selectedId = id;
    if (this.highlightedId === id) this.highlightedId = null;
    if (prev && prev !== id) this.refresh(prev);
    this.refresh(id);
  }

  deselect(): void {
    const prev = this.selectedId;
    this.selectedId = null;
    this.refresh(prev);
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
    this.sweepPlaced();
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
