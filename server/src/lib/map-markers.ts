// ============================================================
// POI 地图标记控制器 — Phase 2 卡片↔地图联动
//
// 纯逻辑类（无 React），包装一个 MapView 实例（引擎统一契约,ws-c 起）：
// - 根据 POI 列表创建/差分管理地图 Marker
// - Domain 用彩色图钉，Recruitment 用圆角方块 + 真实公司 logo
//   （logoUrl 图片优先，缺失/加载失败回退 emoji）
// - 支持选中（放大 + 强调环）与高亮（轻微放大 + 透明度）
// - 全部能力经 MapMarker 契约包装（view.createMarker 返回）：setPosition /
//   setContent / setZIndex / setVisible / on / off / remove——控制器不直碰
//   厂商裸实例（raw 仅保留给 getMarkerByPOIId 探针与 createCityClusterMarker
//   返回值，map-shell duck-type 依赖）；引擎差异（AMap 小写 z-index 命名、
//   TMap·BMapGL 大写 setZIndex、BMapGL addEventListener 等）由适配层吸收
// - 状态样式 = content 重渲染 + zIndex：offset 恒为基准锚点（图钉底尖 /
//   徽章中心），状态尺寸经内容负 margin 补偿，锚点跨状态零漂移（契约无
//   setOffset，删除 AMap.Pixel 依赖）；无浏览器环境（node 测试）下静默降级
//
// marker 生命周期(b2 修订):「只添加一次、跨视口/跨 zoom 保留实例」。
// - setPOIs 非空列表 = 只增不删(新增 + setPosition 存量),空列表 = 清空;
// - setVisiblePOIs(ids) 只切换 show/hide,实例保留在 markers Map——
//   zoom tier 过滤(LOD)与城市聚合(zoom ≤ 8)不再销毁重建 marker;
// - removeMarker 只由 clear()/destroy() 调用。
//
// 同步语义(ws-c):view 只会在 engine.load() 之后创建,控制器拿到 view 即引擎
// 就绪——旧版 loadAMap().then(flush) 异步门已删除,pendingPOIs 回放简化为同步。
// ============================================================

import { faviconCandidatesFromUrl } from './company-logo.ts';
import { CLUSTER_MAX_ZOOM, type CityCluster } from './city-cluster.ts';
import type { POI, RecruitmentPOI } from './types.ts';
import { isDomainPOI, isRecruitmentPOI } from './types.ts';
import type { MapMarker, MapMarkerOptions, MapView } from './map-engine/types.ts';

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/** POI 地图标记控制器的公共接口。 */
export interface POIMarkerController {
  /**
   * 全量同步标记(b2):非空列表 = 只增不删——新增缺失的标记、更新存量标记的
   * 位置/样式,离开列表的 id 保留实例(可见性由 setVisiblePOIs 控制);
   * 空列表 = 清空全部标记(刷新/重置路径)。
   */
  setPOIs(pois: POI[]): void;
  /**
   * 可见性切换(b2):只显示给定 id 集的标记(其余 hide),实例保留在内部表,
   * 跨调用差分,后续 setPOIs 新增的标记按同一可见集应用。null = 全部显示。
   */
  setVisiblePOIs(ids: string[] | null): void;
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
  /** 按 POI id 获取底层厂商 Marker 实例（不存在返回 undefined；测试探针，raw 逃生舱）。 */
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
function normalizeColor(color?: string, fallback: string = DEFAULT_COLOR): string {
  if (color && /^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  return fallback;
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
 * Domain 图钉 DOM 内容（引擎 Marker content）：data URI SVG 的 <img>。
 * 状态尺寸 = 基准 × 缩放（32×40 → 42×52 等比，含强调环），offset 恒为
 * [-16,-40]（图钉底尖），尺寸溢出经负 margin 收回底尖——跨状态锚点零漂移
 * （契约无 setOffset/setIcon，不构造任何 AMap Icon/Size/Pixel）。
 */
function domainPinContent(color: string, state: MarkerState): string {
  const scale = stateScale(state);
  const w = Math.round(PIN_BASE.w * scale);
  const h = Math.round(PIN_BASE.h * scale);
  const ml = (PIN_BASE.w - w) / 2;
  const mt = PIN_BASE.h - h;
  return (
    `<img src="${svgToDataUri(domainPinSVG(color, state))}" width="${w}" height="${h}" alt="" ` +
    `style="display:block;margin-left:${ml}px;margin-top:${mt}px"/>`
  );
}

/**
 * 公司徽章 HTML（引擎 Marker content）。
 * data-URI SVG 无法加载远程 favicon，必须用真 <img>。
 * fallbackUrls：logoUrl 加载失败后依次尝试的候选（favicon.im → icon.horse，
 * 由调用方从 company.careerUrl 派生）；全部失败才隐藏 img 显示 emoji。
 *
 * 锚点约定（引擎无关，契约无 setOffset）：offset 恒为基准 [-20,-20]（40px
 * 中心），状态尺寸（40/46/52）经负 margin 补偿回中心——跨状态锚点零漂移。
 */
export function recruitmentBadgeHTML(
  logo: string | undefined,
  logoUrl: string | undefined,
  color: string,
  state: MarkerState,
  fallbackUrls: string[] = []
): string {
  const c = normalizeColor(color);
  const emoji = toEmojiLogo(logo);
  const size = Math.round(BADGE_BASE * stateScale(state));
  // 中心锚点补偿：offset 恒定 [-20,-20]，状态尺寸偏移经 margin 收回中心
  const shift = (BADGE_BASE - size) / 2;
  const fallbackJson = escapeAttr(JSON.stringify(fallbackUrls));
  const img = logoUrl
    ? `<img src="${escapeAttr(logoUrl)}" width="${size - 12}" height="${size - 12}" alt="" ` +
      `referrerpolicy="no-referrer" decoding="async" data-fb="${fallbackJson}" ` +
      `onerror="this._i=(this._i||0)+1;var f=JSON.parse(this.dataset.fb||'[]');if(this._i<=f.length){this.src=f[this._i-1]}else{this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='block')}"/>`
    : '';
  const emojiDisplay = logoUrl ? 'none' : 'block';
  return (
    `<div class="dm-badge dm-badge-${state}" style="` +
    `width:${size}px;height:${size}px;border-color:${c};opacity:${state === 'highlighted' ? 0.92 : 1};` +
    `margin-left:${shift}px;margin-top:${shift}px` +
    `">${img}<span class="dm-badge-emoji" style="display:${emojiDisplay}">${emoji}</span></div>`
  );
}

/** 徽章 logo 失败后的候选：从公司 careerUrl 派生 favicon 链（含裸 IP 域名映射），去重。 */
function logoFallbackUrls(poi: RecruitmentPOI): string[] {
  if (!poi.company.logoUrl) return [];
  return faviconCandidatesFromUrl(poi.company.careerUrl).filter(
    (u) => u !== poi.company.logoUrl
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
// 城市聚合徽章(tech/21)— 全国/省级视野密度管理,渲染层第二种模式
//
// 不侵入 POIMarkerController 内部实现:调用方(map-shell)在 work 模式
// zoom <= 8 时创建聚合徽章、zoom > 8 时摘除,与个体 marker 模式互斥切换。
// 徽章样式复用品牌语言:白底 + 品牌蓝 #007AFF 描边 + 圆形 + 「城市名 N」。
// ---------------------------------------------------------------------------

/** 城市聚合徽章基准直径(px)。 */
export const CLUSTER_BADGE_SIZE = 54;

/** 聚合徽章缺省强调色：品牌蓝(tech/21 布局图：#007AFF 描边、白底)。 */
const CLUSTER_DEFAULT_COLOR = '#007AFF';

/**
 * 聚合/LOD 可见性分桶 zoom(b2)——「zoom≤8 分桶变化」的记忆化键。
 *
 * 城市聚合与 LOD 计数只依赖 floor(zoom)(maxTierForZoom 语义),分桶内的
 * zoom 微调(8.1→8.4、5.2→5.9)不改变任何可见性结果:
 * - zoom ≤ CLUSTER_MAX_ZOOM(8)→ 返回 floor(zoom)(聚合区间内的 LOD 分桶,
 *   徽章计数/个体可见集在该桶内恒定,跨整数分桶 7→8 才变化);
 * - zoom > 8 → 返回 CLUSTER_MAX_ZOOM + 1(恒个体 pin 模式,与
 *   clusterCities 的 zoom > 8 → null 判定一致)——8.0→8.1 即聚合↔个体的
 *   唯一一次切换,8.1→8.9 内零变化。
 *
 * map-shell 用它作为 clusterState/可见性 memo 的依赖键:跨分桶才重建徽章
 * 或切换可见性,同一桶内的 zoom 变化零重建。
 */
export function clusterZoomForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return CLUSTER_MAX_ZOOM + 1;
  return zoom <= CLUSTER_MAX_ZOOM ? Math.floor(zoom) : CLUSTER_MAX_ZOOM + 1;
}

/** 城市聚合徽章创建选项。 */
export interface CityClusterMarkerOptions {
  /** 强调色(十六进制),缺省品牌蓝 #007AFF(描边 + 计数)。 */
  color?: string;
  /** 徽章直径(px),缺省 CLUSTER_BADGE_SIZE。 */
  size?: number;
  /** 点击回调(下钻到该城市)。 */
  onClick?: () => void;
}

const CLUSTER_STYLE = `
    .dm-cluster{display:flex;flex-direction:column;align-items:center;justify-content:center;
      border-radius:50%;background:#fff;border:2.5px solid #007AFF;
      box-shadow:0 6px 16px rgba(24,33,41,.22);box-sizing:border-box;cursor:pointer;
      user-select:none}
    .dm-cluster:hover{box-shadow:0 0 0 3px rgba(0,122,255,.28),0 8px 18px rgba(24,33,41,.25)}
    .dm-cluster-city{font-size:13px;font-weight:700;color:#111;line-height:1.1;
      max-width:calc(100% - 8px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dm-cluster-count{font-size:11px;font-weight:800;color:#007AFF;line-height:1.2}
  `;

function injectClusterStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('dm-cluster-style') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'dm-cluster-style';
    document.head.appendChild(style);
  }
  style.textContent = CLUSTER_STYLE;
}

/**
 * 城市聚合徽章 HTML(AMap Marker content)。
 * 圆形、白底、强调色描边、「城市名 N」两行;城市名 HTML 转义防注入。
 */
export function cityClusterBadgeHTML(
  group: Pick<CityCluster, 'city' | 'count'>,
  color?: string,
  size: number = CLUSTER_BADGE_SIZE
): string {
  const c = normalizeColor(color, CLUSTER_DEFAULT_COLOR);
  const city = escapeAttr(group.city);
  const citySize = Math.max(11, Math.round(size * 0.24));
  const countSize = Math.max(10, Math.round(size * 0.21));
  return (
    `<div class="dm-cluster" style="width:${Math.round(size)}px;height:${Math.round(size)}px;border-color:${c}">` +
    `<span class="dm-cluster-city" style="font-size:${citySize}px">${city}</span>` +
    `<span class="dm-cluster-count" style="font-size:${countSize}px;color:${c}">${group.count}</span>` +
    `</div>`
  );
}

/**
 * 创建城市聚合徽章 Marker(tech/21)。
 * 中心锚定(offset 居中,元组 → 引擎内部转 Pixel);`bubble: false` 阻止点击冒泡
 * 到地图(地图 click 会清选中);防御性守卫:无 view/构造失败 → 返回 null,
 * node 测试下不抛错。返回原始 marker 实例(测试探针 + 调用方摘除)。
 */
export function createCityClusterMarker(
  view: MapView | null,
  group: CityCluster,
  opts: CityClusterMarkerOptions = {}
): any | null {
  if (!view || !group) return null;
  injectClusterStyles();
  const size = opts.size ?? CLUSTER_BADGE_SIZE;

  let wrapper: MapMarker;
  try {
    wrapper = view.createMarker({
      position: { lng: group.lng, lat: group.lat },
      offset: [-size / 2, -size / 2],
      content: cityClusterBadgeHTML(group, opts.color, size),
      zIndex: 50,
      onClick: opts.onClick,
      // AMap 专属选项(契约未含):duck-type 透传,点击不冒泡到地图
      bubble: false,
    } as MapMarkerOptions);
  } catch {
    return null;
  }
  return wrapper.raw;
}


// ---------------------------------------------------------------------------
// 控制器实现
// ---------------------------------------------------------------------------

class POIMarkerControllerImpl implements POIMarkerController {
  private view: MapView | null;
  private opts: POIMarkerControllerOptions;
  private color: string;
  /** poiId → MapMarker 契约包装。 */
  private markers = new Map<string, MapMarker>();
  /**
   * 本控制器登记到地图上的全部 Marker（含簿记丢失的）。
   * 与 markers 的差异：addMarker 一成功构造就入账，任何后续异常都不会
   * 造成「marker 在地图上、但 destroy/差分无法摘除」的永久泄漏（Bug1 伴生）。
   */
  private placed = new Set<MapMarker>();
  /** poiId → POI 数据（生成图标 / 还原样式时需要）。 */
  private poiById = new Map<string, POI>();
  /** poiId → 当前视觉状态，用于避免重复 setIcon 造成闪烁。 */
  private markerStates = new Map<string, MarkerState>();
  /**
   * 可见 id 集(b2)：null = 全部显示。跨 setPOIs 保留——marker 实例只增不删,
   * zoom tier(LOD)/聚合边界只切换 show/hide,不销毁重建。
   */
  private visibleIds: Set<string> | null = null;
  private selectedId: string | null = null;
  private highlightedId: string | null = null;
  private destroyed = false;

  constructor(view: MapView | null, opts: POIMarkerControllerOptions = {}) {
    this.view = view;
    this.opts = opts;
    this.color = normalizeColor(opts.color);
    injectBadgeStyles();
  }

  /** 是否具备创建标记的全部前提（含地图未被销毁）。 */
  private isReady(): boolean {
    if (this.destroyed || !this.view) return false;
    // 地图已被销毁时不再创建 marker：已销毁实例的 overlay 注册表无人清理，
    // 会造成 getAllOverlays 计数 > catalog 的永久残留（Bug1 伴生）。
    if (typeof this.view.isDestroyed === 'function' && this.view.isDestroyed()) {
      return false;
    }
    return true;
  }

  /**
   * 从地图摘除一个 marker（若仍挂在地图上）。异常不影响内部状态清理：
   * 地图已销毁等场景下 remove() 可能抛错，绝不能因单个 marker 中断
   * clear/destroy 的清扫循环。
   */
  private detachFromMap(marker: MapMarker | undefined): void {
    if (!marker) return;
    try {
      marker.remove();
    } catch {
      // 忽略：内部簿记照常删除，避免 cleanup 中途抛错留下半清状态
    }
  }

  // -- 标记创建 / 删除 ------------------------------------------------------

  /** 为单个 POI 创建并添加 Marker（经 view.createMarker，全程持契约包装）。 */
  private addMarker(poi: POI): void {
    if (!this.isReady() || !this.view) return;

    const state = resolveMarkerState(poi.id, this.selectedId, this.highlightedId);

    const markerOpts: MapMarkerOptions = {
      position: { lng: poi.location.lng, lat: poi.location.lat },
      offset: this.buildOffset(poi), // [x, y] 元组,引擎内部转厂商锚点
    };
    // Domain 图钉与招聘徽章统一走 content（契约无 setIcon/setOffset）：
    // 状态样式经 setContent 重渲染，尺寸变化由内容负 margin 补偿锚点
    if (isRecruitmentPOI(poi)) {
      markerOpts.content = recruitmentBadgeHTML(
        poi.company.logo,
        poi.company.logoUrl,
        this.color,
        state,
        logoFallbackUrls(poi)
      );
    } else {
      markerOpts.content = domainPinContent(this.color, state);
    }

    let wrapper: MapMarker;
    try {
      wrapper = this.view.createMarker(markerOpts);
    } catch {
      // 构造即失败（如地图销毁竞态）→ 不登记任何簿记，不留残留
      return;
    }

    // 先入 placed 账：view.createMarker 已把 marker 注册到地图上，
    // 若后续步骤（绑定事件/设 zIndex）抛错，destroy/clear 仍能凭 placed 摘除
    this.placed.add(wrapper);
    try {
      wrapper.on?.('click', () => {
        if (this.destroyed) return;
        this.opts.onMarkerClick?.(poi.id);
      });

      wrapper.setZIndex?.(this.zIndexFor(state, poi));
    } catch {
      // 绑定/样式失败 → 摘除刚注册的 marker，避免无主残留
      this.detachFromMap(wrapper);
      this.placed.delete(wrapper);
      return;
    }

    this.markers.set(poi.id, wrapper);
    this.poiById.set(poi.id, poi);
    this.markerStates.set(poi.id, state);
    // 新增标记按当前可见集应用 show/hide(b2:实例保留,zoom/聚合切换不重建)
    this.applyVisibility(poi.id, wrapper);
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

  /** 更新已有标记的视觉样式（content 重渲染 + zIndex；offset 恒为基准锚点）。 */
  private applyStyle(wrapper: MapMarker, poi: POI, state: MarkerState): void {
    if (!wrapper) return;
    if (this.markerStates.get(poi.id) === state) return;
    this.markerStates.set(poi.id, state);
    if (isRecruitmentPOI(poi)) {
      wrapper.setContent?.(
        recruitmentBadgeHTML(
          poi.company.logo,
          poi.company.logoUrl,
          this.color,
          state,
          logoFallbackUrls(poi)
        )
      );
    } else {
      wrapper.setContent?.(domainPinContent(this.color, state));
    }
    wrapper.setZIndex?.(this.zIndexFor(state, poi));
  }

  /** 计算指定状态下的 zIndex：选中 > 高亮 > 普通（招聘徽章略高于图钉）。 */
  private zIndexFor(state: MarkerState, poi: POI): number {
    if (state === 'selected') return 100;
    if (state === 'highlighted') return 80;
    return isRecruitmentPOI(poi) ? 20 : 10;
  }

  /** 构建锚点偏移元组 [x, y]：图钉锚定底部尖端，徽章锚定中心（基准尺寸；
   *  状态缩放由内容负 margin 补偿，offset 跨状态恒定——契约无 setOffset）。 */
  private buildOffset(poi: POI): [number, number] {
    if (isDomainPOI(poi)) return [-PIN_BASE.w / 2, -PIN_BASE.h];
    return [-BADGE_BASE / 2, -BADGE_BASE / 2];
  }

  // -- 公共接口实现 ---------------------------------------------------------

  setPOIs(pois: POI[]): void {
    if (!this.isReady()) return;

    // 空列表 = 清空(刷新/重置路径,等价 clear;b2 保留该语义以释放实例)
    if (pois.length === 0) {
      this.clear();
      return;
    }

    // b2 只增不删:marker 实例跨视口/跨 zoom 保留,离开列表的 id 不销毁
    // (可见性由 setVisiblePOIs 切换)——「只 add 新的 + setPosition 存量」,
    // removeMarker 只留给 clear/destroy。
    for (const poi of pois) {
      const existing = this.markers.get(poi.id);
      if (existing) {
        existing.setPosition({ lng: poi.location.lng, lat: poi.location.lat });
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

  /** 只显示给定 id 集(b2)：实例保留,show/hide 切换;null = 全部显示。 */
  setVisiblePOIs(ids: string[] | null): void {
    this.visibleIds = ids ? new Set(ids) : null;
    for (const [id, marker] of this.markers) {
      this.applyVisibility(id, marker);
    }
  }

  /** 按当前可见集对单个 marker 应用可见性（契约 setVisible；无方法则跳过）。 */
  private applyVisibility(id: string, wrapper: MapMarker): void {
    const visible = this.visibleIds === null || this.visibleIds.has(id);
    wrapper.setVisible?.(visible);
  }

  clear(): void {
    this.selectedId = null;
    this.highlightedId = null;
    this.visibleIds = null;
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

  getMarkerByPOIId(id: string): any {
    return this.markers.get(id)?.raw;
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
    this.sweepPlaced();
    this.view = null;
    this.opts = {};
  }
}

/**
 * 创建 POI 地图标记控制器。
 *
 * @param view MapView 实例（可为 null，为空时所有方法安全 no-op）。
 * @param opts 配置项（点击回调 / 强调色 / 标签生成函数）。
 * @returns 遵循 POIMarkerController 接口的控制器实例。
 */
export function createPOIMarkerController(
  view: MapView | null,
  opts: POIMarkerControllerOptions = {}
): POIMarkerController {
  return new POIMarkerControllerImpl(view, opts);
}
