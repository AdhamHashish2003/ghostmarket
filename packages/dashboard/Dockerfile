FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./

# Copy the packages we need
COPY packages/shared/package.json packages/shared/
COPY packages/dashboard/package.json packages/dashboard/

RUN npm ci --workspace=@ghostmarket/dashboard --workspace=@ghostmarket/shared --include-workspace-root

# Build
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules 2>/dev/null || true
COPY --from=deps /app/packages/dashboard/node_modules ./packages/dashboard/node_modules 2>/dev/null || true

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/dashboard/ packages/dashboard/

# Build shared
WORKDIR /app/packages/shared
RUN npx tsc || true

# Build Next.js with standalone output
WORKDIR /app/packages/dashboard
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
RUN npx next build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/dashboard/.next/standalone ./
COPY --from=builder /app/packages/dashboard/.next/static ./packages/dashboard/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "packages/dashboard/server.js"]
