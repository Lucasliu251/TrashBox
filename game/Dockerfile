FROM node:22-alpine AS build
WORKDIR /app/game
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
WORKDIR /app/game
RUN corepack enable
COPY --from=build /app/game/package.json /app/game/pnpm-lock.yaml /app/game/pnpm-workspace.yaml ./
COPY --from=build /app/game/node_modules ./node_modules
COPY --from=build /app/game/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/game/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/game/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/game/packages/server/dist ./packages/server/dist
COPY --from=build /app/game/packages/client/dist ./packages/client/dist
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "packages/server/dist/index.js"]
