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
RUN npm ci --workspace @asteriq/web --workspace @asteriq/types --workspace @asteriq/ui --workspace @asteriq/utils --include-workspace-root --include=dev

FROM dependencies AS source
COPY packages/config packages/config
COPY packages/types packages/types
COPY packages/ui packages/ui
COPY packages/utils packages/utils
COPY apps/web apps/web
RUN npm run build --workspace @asteriq/types && npm run build --workspace @asteriq/ui && npm run build --workspace @asteriq/utils

FROM source AS development
ENV NODE_ENV=development
WORKDIR /workspace/apps/web
EXPOSE 5173
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:5173/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "dev"]

FROM source AS build
# Public URL only. Never place secrets in Vite build arguments.
ARG VITE_API_URL=/api/v1
ARG VITE_TRACING_ENABLED=false
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_TRACING_ENABLED=${VITE_TRACING_ENABLED}
RUN npm run build --workspace @asteriq/web

FROM nginx:stable-alpine AS runtime
COPY infrastructure/docker/nginx.conf /etc/nginx/asteriq.conf.template
COPY infrastructure/docker/nginx-config.sh /docker-entrypoint.d/25-asteriq-config.sh
RUN chmod +x /docker-entrypoint.d/25-asteriq-config.sh
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
