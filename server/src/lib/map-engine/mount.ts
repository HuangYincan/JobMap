// ============================================================
// 挂载引擎视图 + 失败回退 — MapEngine 内核(mount)
//
// 页面**挂载**路径的引擎启动:偏好引擎 load → createView;失败自动回退到
// 其余已配置引擎(按 ENGINE_PRIORITY 序)重试——修复「sessionStorage 偏好
// 指向故障引擎时刷新页面即空白、use-map-engine 只 warn 无视图」的缺口
// (2026-08-22 ws-8;交互式切换的回滚由 switch.ts 负责,与此互补)。
//
// 语义:
// - 尝试顺序:preferred(会话偏好引擎)优先;失败后按 ENGINE_PRIORITY 序回退
//   其余已配置引擎(preferred 已在 configured 中时跳过——不回试同一故障引擎)。
// - 首个引擎 load/createView 成功 → 返回其 view(携带所属 engine);
// - 全部失败 → 抛错(调用方保持空视图 + warn,回退 CSS fallback 地图);
// - 取消(isCancelled)/视图被接管(isViewTaken)→ 返回 null,已建视图自行
//   destroy(不泄漏双实例、不继续回退);
// - 本模块不写偏好(挂载/回退均不覆盖 sessionStorage;偏好由手动切换专属,
//   见 engine-preference.ts 与 use-map-engine 注释)。
//
// 纯函数、无 React 依赖、无 @ 别名(与 switch.ts / saved-camera-sync.ts 同款
// 可测性):node 测试可直接 import。
// ============================================================

import type { LngLat, MapEngine, MapStyleId, MapView } from './types.ts';

export interface MountViewOptions {
  /** 地图挂载容器(ref;调用方持有) */
  container: HTMLElement;
  /** 初始中心(gcj02;首渲染快照) */
  center: LngLat;
  /** 初始 zoom(首渲染快照) */
  zoom: number;
  /** 初始底图样式(首渲染快照) */
  style: MapStyleId;
  /**
   * 取消检查:每次 await 恢复后调用;true → 放弃本轮(不继续回退、不落地
   * 视图),返回 null。挂载路径的 teardown/卸载竞态由调用方经此通知。
   */
  isCancelled: () => boolean;
  /**
   * 视图接管检查:createView 成功后落地前调用;true → 同容器已被其他路径
   * (如 switchEngine 抢先落地)接管,销毁刚建视图并返回 null,避免双实例。
   */
  isViewTaken: () => boolean;
}

/**
 * 挂载引擎视图(带失败回退)。
 *
 * @param preferred 偏好引擎(resolveEngine 结果;可为 null,此时从 configured
 *   优先序第一个开始);失败后回退 configured 中其余引擎。
 * @param configured 已配置引擎列表,**必须已按 ENGINE_PRIORITY 排序**
 *   (调用方传 engine-registry.getConfiguredEngines());preferred 不在其中时
 *   按序插队尝试。
 * @returns 成功 → 首个挂载完成的 view;取消/被接管 → null;全部失败 → 抛错。
 */
export async function mountEngineView(
  preferred: MapEngine | null,
  configured: MapEngine[],
  opts: MountViewOptions,
): Promise<MapView | null> {
  // 尝试顺序:preferred 优先;其后按优先级序的其余已配置引擎(去重,不回试
  // 同一引擎——preferred 已在 configured 中时跳过)
  const candidates: MapEngine[] = [];
  if (preferred) candidates.push(preferred);
  for (const engine of configured) {
    if (!candidates.some((candidate) => candidate.id === engine.id)) {
      candidates.push(engine);
    }
  }

  let lastError: unknown = null;
  for (const engine of candidates) {
    try {
      await engine.load();
      if (opts.isCancelled()) return null; // 卸载竞态:不创建视图、不继续回退
      const created = await engine.createView({
        container: opts.container,
        center: opts.center,
        zoom: opts.zoom,
        style: opts.style,
      });
      // 创建后竞态:取消(teardown 恰在 resolve 后)→ 已建视图销毁;或被
      // 切换路径抢先接管(同容器双实例防护)→ 销毁。两种情况都不落地。
      if (opts.isCancelled() || opts.isViewTaken()) {
        created.destroy();
        return null;
      }
      return created;
    } catch (err) {
      lastError = err; // 单引擎失败 → 回退下一个候选
    }
  }

  // 全部候选失败:上抛最后一个错误(调用方保持空视图 + warn)
  if (lastError instanceof Error) throw lastError;
  throw new Error('[map-engine] 所有已配置引擎挂载失败');
}
