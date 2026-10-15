FROM node:22-alpine AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/ai-service/package.json apps/ai-service/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/utils/package.json packages/utils/package.json
COPY packages/config/package.json packages/config/package.json
RUN npm ci --workspace @asteriq/api --workspace @asteriq/types --include-workspace-root --include=dev

FROM dependencies AS source
COPY packages/config packages/config
COPY packages/types packages/types
COPY apps/api apps/api
COPY database/migrations database/migrations
COPY scripts/migrate.mjs scripts/migrate.mjs
COPY infrastructure/docker/api-entrypoint.sh infrastructure/docker/api-entrypoint.sh
RUN npm run build --workspace @asteriq/types

FROM source AS development
ENV NODE_ENV=development
WORKDIR /workspace/apps/api
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "/workspace/infrastructure/docker/api-entrypoint.sh"]
CMD ["npm", "run", "dev"]

FROM source AS build
RUN npm run build --workspace @asteriq/api
RUN npm prune --omit=dev --workspace @asteriq/api --workspace @asteriq/types --include-workspace-root

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/packages/types ./packages/types
COPY --from=build /workspace/database/migrations ./database/migrations
COPY --from=build /workspace/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /workspace/infrastructure/docker/api-entrypoint.sh ./infrastructure/docker/api-entrypoint.sh
WORKDIR /workspace/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "/workspace/infrastructure/docker/api-entrypoint.sh"]
CMD ["node", "dist/server.js"]
