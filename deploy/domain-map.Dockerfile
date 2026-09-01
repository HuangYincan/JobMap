# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /src

COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci

FROM node:22-bookworm-slim AS builder
WORKDIR /src

COPY --from=deps /src/server/node_modules ./server/node_modules
COPY server ./server

# NEXT_PUBLIC_* values are intentionally public browser configuration. They
# must be supplied at build time because Next.js inlines them into the bundle.
ARG NEXT_PUBLIC_AMAP_KEY
ARG NEXT_PUBLIC_AMAP_SECURITY_CODE
ARG NEXT_PUBLIC_TENCENT_JSAPI_KEY
ARG NEXT_PUBLIC_BAIDU_AK
ENV NEXT_PUBLIC_AMAP_KEY="$NEXT_PUBLIC_AMAP_KEY" \
    NEXT_PUBLIC_AMAP_SECURITY_CODE="$NEXT_PUBLIC_AMAP_SECURITY_CODE" \
    NEXT_PUBLIC_TENCENT_JSAPI_KEY="$NEXT_PUBLIC_TENCENT_JSAPI_KEY" \
    NEXT_PUBLIC_BAIDU_AK="$NEXT_PUBLIC_BAIDU_AK"

# Keep COPY deterministic even when the app has no public directory.
RUN mkdir -p server/public \
    && npm --prefix server run build \
    && npm --prefix server prune --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app/server

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /src/server/package.json ./package.json
COPY --from=builder /src/server/node_modules ./node_modules
COPY --from=builder /src/server/.next ./.next
COPY --from=builder /src/server/public ./public
COPY --from=builder /src/server/data ./data
# Keep the one-shot importer available for release operations. The Next
# runtime itself executes from .next, while these files are used only by
# `npm run import:seed[:apply]` and related maintenance commands.
COPY --from=builder /src/server/src ./src
COPY --from=builder /src/server/scripts ./scripts

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
