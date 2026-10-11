FROM node:22.14.0-alpine
ENV COREPACK_HOME=/corepack
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/risk-engine/package.json packages/risk-engine/package.json
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm --filter @solana-terminal/worker build
ENV NODE_ENV=production
EXPOSE 4001
CMD ["pnpm", "--filter", "@solana-terminal/worker", "start"]
