FROM node:24-bookworm-slim AS toolchain
ENV HUSKY=0 CI=true
RUN npm install --global pnpm@12.21.0

FROM toolchain AS sdk
WORKDIR /build/NestCloud-Sdk
COPY NestCloud-Sdk/ ./
RUN pnpm install --frozen-lockfile && pnpm run build

FROM toolchain AS dependencies
COPY --from=sdk /build/NestCloud-Sdk/package.json /build/NestCloud-Sdk/
COPY --from=sdk /build/NestCloud-Sdk/.husky /build/NestCloud-Sdk/.husky
COPY --from=sdk /build/NestCloud-Sdk/dist /build/NestCloud-Sdk/dist

FROM dependencies AS workspace
WORKDIR /build/SolaCloud
COPY SolaCloud/ ./
RUN pnpm install --frozen-lockfile

FROM workspace AS service-build
ARG SERVICE
RUN cd "apps/$SERVICE" && printf '%s\n' '{"extends":"./tsconfig.json","exclude":["src/__tests__","**/*.spec.ts","**/*.test.ts"]}' > tsconfig.build.json && pnpm run build
# Keep the workspace root in Node's resolution path: services import shared
# runtime dependencies declared by the root package as well as their own.
RUN mkdir /build/runtime \
    && cp --parents package.json pnpm-*.yaml apps/*/package.json packages/*/package.json web/*/package.json /build/runtime/ \
    && cp -r packages/. /build/runtime/packages/ \
    && cp -r "apps/$SERVICE/dist" "/build/runtime/apps/$SERVICE/" \
    && if [ -d "apps/$SERVICE/runtime" ]; then cp -r "apps/$SERVICE/runtime" "/build/runtime/apps/$SERVICE/"; fi \
    && cd /build/runtime \
    && npm pkg delete scripts.prepare \
    && pnpm --filter sola-cloud --filter "${SERVICE}..." install --offline --prod --frozen-lockfile

FROM node:24-bookworm-slim AS service-image
ARG SERVICE
ENV NODE_ENV=production NodeEnv=production
COPY --from=service-build --chown=node:node /build/runtime/ /app/
WORKDIR /app/apps/${SERVICE}
USER node
CMD ["node", "dist/main.js"]

FROM workspace AS web-build
ARG VITE_GATEWAY_ORIGIN
RUN pnpm run build:web

FROM nginx:stable-alpine AS web-image
COPY SolaCloud/docker/web.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /build/SolaCloud/web/NestCloudWeb/dist/ /usr/share/nginx/html/
EXPOSE 80
