// 共享 env 加载 (server/.env.local → process.env 注入, 不打印任何值)。
// 2026-08-25 (fix/plan-env-load): 从 geocode-sites-apply.mjs 内联实现抽出,
// plan-site-geocode.mjs 复用 —— dry-run 的 PROVIDERS 行此前全 missing,
// 根因是 plan 脚本从不加载 .env.local (apply 有内联 loadEnv, plan 没有)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', '..');

/** 读 server/.env.local (存在时), 返回 {KEY: value}。注释/空行/非法行跳过。 */
export function loadEnv() {
  const envFile = path.join(SERVER_DIR, '.env.local');
  if (!fs.existsSync(envFile)) return {};
  const out = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}

/**
 * 文件里的 key 在 process.env 缺失时注入 (不覆盖调用方已 export 的值)。
 * 与 geocode-sites-apply.mjs 原内联行为一致 — 仅注入, 绝不打印值。
 */
export function injectEnv(keys) {
  const env = { ...loadEnv(), ...process.env };
  for (const k of keys) {
    if (env[k] && !process.env[k]) process.env[k] = env[k];
  }
  return env;
}
