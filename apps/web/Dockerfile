FROM node:22.14.0-alpine AS builder
ENV COREPACK_HOME=/corepack
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/risk-engine/package.json packages/risk-engine/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @solana-terminal/web build

FROM node:22.14.0-alpine AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
