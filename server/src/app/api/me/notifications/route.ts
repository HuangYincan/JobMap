import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { enqueueNotification, listNotifications } from "@/lib/account-store";
import { BoundedRateStore } from "@/lib/bounded-rate-store";
import { matchJobAlerts } from "@/lib/job-alerts";
import { loadServerCatalog } from "@/lib/server-catalog";

// 加固（quality-scan #11）：同用户 60s 冷却，防反复触发全量 job-alert 扫描 + enqueue。
// 选 429 而非幂等回放上次结果：enqueue 本身在 DB 层 ON CONFLICT 幂等，
// 回放旧 payload 反而会拿过期数据；429 + Retry-After 信号更明确。
// 用进程内有界存储（取舍：单实例部署有效、重启清零；不落 DB——account-store 是账号读写面，
// 每次 POST 多一次写库会把「扫描+入队」变成「扫描+写库+入队」，且本 WS 不碰 account-store）。
const NOTIFY_COOLDOWN_MS = 60_000;
const NOTIFY_COOLDOWN_CAPACITY = 10_000;
const notifyCooldown = new BoundedRateStore<number>(NOTIFY_COOLDOWN_CAPACITY); // userId → lastScanAt

export async function GET() {
  const user = await readSessionUser();
  if (!user) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: await listNotifications(user.id) });
}

export async function POST() {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  const now = Date.now();
  const last = notifyCooldown.get(user.id, now);
  if (last != null && now - last < NOTIFY_COOLDOWN_MS) {
    const waitSec = Math.ceil((NOTIFY_COOLDOWN_MS - (now - last)) / 1000);
    return NextResponse.json(
      { code: "RATE_LIMITED", message: `notification scan cooled down; retry in ${waitSec}s` },
      { status: 429, headers: { "Retry-After": String(waitSec) } },
    );
  }
  notifyCooldown.set(user.id, now, NOTIFY_COOLDOWN_MS, now);
  const catalog = await loadServerCatalog("work");
  const matches = matchJobAlerts(catalog, user.preferences.career, user.preferences.notifications);
  const items = [];
  for (const match of matches) {
    items.push(
      await enqueueNotification(user.id, {
        kind: match.kind,
        positionId: match.positionId,
        companyPoiId: match.companyPoiId,
        title: match.title,
        companyName: match.companyName,
        applyUrl: match.applyUrl,
        channels: match.channels,
        status: "queued",
      }),
    );
  }
  return NextResponse.json({ items, scanned: matches.length });
}
