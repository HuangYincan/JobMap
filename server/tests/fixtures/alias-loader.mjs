// poi-click-vanish 回归测试用 @/ 别名解析器(node:test 下 tsconfig paths 不可用)
// SRC 从自身位置推导(server/tests/fixtures/ → server/src/),CI/本地均可用,
// 不得硬编码绝对路径(CI runner 目录不同会 ERR_MODULE_NOT_FOUND)。
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src') + '/';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    return next(pathToFileURL(SRC + specifier.slice(2) + '.ts').href, context);
  }
  // 无扩展名相对导入补 .ts(strip-types 下 node 不做 extension resolution)
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier)) {
    const parent = context.parentURL;
    if (parent && parent.startsWith(pathToFileURL(SRC).href)) {
      const dir = pathToFileURL(fileURLToPath(parent).split('/').slice(0, -1).join('/') + '/');
      return next(pathToFileURL(new URL(specifier, dir).href + '.ts').href, context);
    }
  }
  return next(specifier, context);
}
