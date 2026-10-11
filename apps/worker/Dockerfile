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
RUN pnpm --filter @solana-terminal/worker build

FROM node:22.14.0-alpine AS runner
ENV COREPACK_HOME=/corepack
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/risk-engine/package.json packages/risk-engine/package.json
RUN pnpm install --prod --frozen-lockfile --filter @solana-terminal/worker
COPY --from=builder /app/apps/worker/dist apps/worker/dist
ENV NODE_ENV=production
USER node
EXPOSE 4001
CMD ["node", "apps/worker/dist/index.js"]
