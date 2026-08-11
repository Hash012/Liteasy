ARG NODE_IMAGE=node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
ARG CADDY_IMAGE
FROM ${NODE_IMAGE} AS intuecho-web-build

WORKDIR /src
COPY products/intuecho/package.json products/intuecho/package-lock.json ./
COPY products/intuecho/apps/web/package.json ./apps/web/package.json
COPY products/intuecho/packages/contracts/package.json ./packages/contracts/package.json
COPY products/intuecho/services/api/package.json ./services/api/package.json
RUN npm ci --workspace=@intuecho/web --workspace=@intuecho/contracts
COPY products/intuecho/apps/web ./apps/web
COPY products/intuecho/packages/contracts ./packages/contracts
ARG VITE_INTUECHO_API_URL
ARG VITE_LITEASY_IDENTITY_URL
ENV VITE_INTUECHO_API_URL=${VITE_INTUECHO_API_URL}
ENV VITE_LITEASY_IDENTITY_URL=${VITE_LITEASY_IDENTITY_URL}
RUN npm run build --workspace=@intuecho/web

FROM ${NODE_IMAGE} AS admin-web-build

WORKDIR /src
COPY products/liteasy/apps/admin/package.json products/liteasy/apps/admin/package-lock.json ./
RUN npm ci
COPY products/liteasy/apps/admin ./
ARG VITE_INTUECHO_API_URL
ARG VITE_LITEASY_CLOUD_URL
ENV VITE_INTUECHO_API_URL=${VITE_INTUECHO_API_URL}
ENV VITE_LITEASY_CLOUD_URL=${VITE_LITEASY_CLOUD_URL}
RUN npm run build

FROM ${CADDY_IMAGE}

COPY deployment/staging/Caddyfile /etc/caddy/Caddyfile
COPY products/marketing /srv/marketing
COPY --from=intuecho-web-build /src/apps/web/dist /srv/community
COPY --from=admin-web-build /src/dist /srv/admin
