import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { getAvatarData, updateAvatar } from "@/lib/account-store";
import { checkAvatarImage } from "@/lib/avatar-image";

// ============================================================
// 头像真实存储:POST 上传(二进制进 users.avatar_data)、GET 读回。
// 客户端裁剪后已是 256px JPEG(canvas),服务端做无三方依赖的哨兵校验
// (魔数 + 尺寸头 + 字节上限,见 lib/avatar-image.ts)。
// 上传后 avatar_url 写入 /api/me/avatar?v=<时间戳> 版本化路径,
// 换头像即换 URL,GET 可安全 immutable 缓存。OAuth 外部头像不动。
// ============================================================

export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("file");
    file = entry instanceof File ? entry : null;
  } catch {
    return NextResponse.json({ code: "BAD_REQUEST", message: "invalid multipart form" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "missing file field" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkAvatarImage(bytes);
  if (!check.ok) {
    const code = check.reason === "too-large" ? "AVATAR_TOO_LARGE" : "INVALID_AVATAR";
    const message =
      check.reason === "too-large"
        ? "avatar too large"
        : check.reason === "not-image"
          ? "avatar must be a JPEG or PNG image"
          : "unreadable or oversized image dimensions";
    return NextResponse.json({ code, message }, { status: 400 });
  }

  const next = await updateAvatar(user.id, {
    data: bytes,
    url: `/api/me/avatar?v=${Date.now()}`,
  });
  return NextResponse.json({ user: next });
}

export async function GET() {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  const data = await getAvatarData(user.id);
  if (!data || data.length === 0) {
    return NextResponse.json({ code: "NOT_FOUND", message: "no avatar uploaded" }, { status: 404 });
  }
  const check = checkAvatarImage(data);
  const mime = check.ok ? check.mime : "image/jpeg";
  // 拷进独立的 ArrayBuffer(TS:Buffer 派生 Uint8Array 不满足 BodyInit)
  const body = new Uint8Array(data.byteLength);
  body.set(data);
  return new Response(body, {
    headers: {
      "Content-Type": mime,
      // URL 带 ?v= 版本号(换头像即换 URL),可放心 immutable。
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
