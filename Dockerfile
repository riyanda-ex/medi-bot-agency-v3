# syntax=docker/dockerfile:1
# Next.js 16 standalone output: lihat node_modules/next/dist/docs/.../output.md.

FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# openssl: Prisma. dumb-init: PID 1 yang meneruskan SIGTERM ke server/worker.
RUN apk add --no-cache libc6-compat openssl dumb-init

FROM base AS deps
# Prisma CLI adalah devDependency; build stage perlu dev deps.
ENV NODE_ENV=development
COPY package.json package-lock.json .npmrc prisma7.config.ts ./
COPY prisma ./prisma
ENV DATABASE_URL="file:./dev.db"
RUN npm ci --ignore-scripts && npx prisma generate --schema prisma/schema.prisma

FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/generated ./generated
COPY . .
# Repo belum memiliki folder public; Next standalone tetap mengharapkannya saat disalin.
RUN mkdir -p public && npm run build

# Hanya dependency produksi yang dipakai worker (tsx sudah dependencies).
FROM base AS runtime-deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts

FROM base AS runner
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nextjs -u 1001 \
    && mkdir -p /app/reports /app/data \
    && chown -R nextjs:nodejs /app

# Aplikasi Next standalone (sudah memuat node_modules yang ter-trace).
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Worker dan skrip operasional tidak ikut ter-trace Next, jadi disalin eksplisit.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated
# tsx + esbuild (termasuk biner linux-x64) untuk `node --import tsx` pada worker.
COPY --from=runtime-deps --chown=nextjs:nodejs /app/node_modules/tsx ./node_modules/tsx
COPY --from=runtime-deps --chown=nextjs:nodejs /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=runtime-deps --chown=nextjs:nodejs /app/node_modules/@esbuild ./node_modules/@esbuild

USER nextjs
ENV PORT=3000 HOSTNAME="0.0.0.0"
EXPOSE 3000
# Server standalone Next dan worker menangani SIGINT/SIGTERM; compose memberi
# stop_grace_period 30 detik agar job dan request selesai sebelum paksa mati.
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
