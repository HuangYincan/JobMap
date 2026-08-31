import type { RouteError, RouteErrorCode } from './types.ts';

const ROUTE_ERROR_MESSAGES: Record<RouteErrorCode, string> = {
  INVALID_REQUEST: '路线请求无效',
  UNSUPPORTED_MODE: '出行方式暂不支持',
  PROVIDER_UNAVAILABLE: '路线服务暂不可用',
  TIMEOUT: '路线服务响应超时',
  RATE_LIMITED: '路线服务请求过于频繁',
  UNAUTHORIZED: '路线服务未授权',
  NO_ROUTE: '未找到可用路线',
  EXPIRED: '路线结果已过期',
  NOT_FOUND: '路线结果不存在',
  FORBIDDEN: '无权读取该路线结果',
  COORDINATE_ERROR: '路线坐标无效',
  PROVIDER_ERROR: '路线服务返回失败',
  INTERNAL: '路线服务内部错误',
};

const RETRYABLE_ROUTE_ERRORS = new Set<RouteErrorCode>([
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
]);

export function createRouteError(code: RouteErrorCode): RouteError {
  return {
    code,
    message: ROUTE_ERROR_MESSAGES[code],
    retryable: RETRYABLE_ROUTE_ERRORS.has(code),
  };
}
