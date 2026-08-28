import {
  createRouteArtifactStore,
  type RouteArtifactStore,
} from './route-artifacts.ts';
import { createRouteService } from './route-service.ts';

type NavigationRuntimeGlobal = typeof globalThis & {
  __domainMapNavigationRouteArtifacts?: RouteArtifactStore;
};

const runtimeGlobal = globalThis as NavigationRuntimeGlobal;

/**
 * Route handlers can be compiled as separate entry points. Keeping the
 * process-local store on globalThis preserves the POST -> GET seam inside one
 * Node process (and remains intentionally non-durable across processes).
 */
export const navigationRouteArtifacts =
  runtimeGlobal.__domainMapNavigationRouteArtifacts ??= createRouteArtifactStore();

/** No live provider is registered until product authorization is approved. */
export const navigationRouteService = createRouteService({
  providers: [],
  artifactStore: navigationRouteArtifacts,
});
