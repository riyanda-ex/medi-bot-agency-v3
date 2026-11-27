# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat openssl

FROM base AS deps
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate --schema prisma/schema.prisma

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
