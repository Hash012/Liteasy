ARG NODE_IMAGE=node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
FROM ${NODE_IMAGE}

ARG SOURCE_REVISION
ARG SOURCE_VERSION
ARG SOURCE_URL=https://github.com/Hash012/Liteasy
LABEL org.opencontainers.image.revision=${SOURCE_REVISION} \
      org.opencontainers.image.source=${SOURCE_URL} \
      org.opencontainers.image.version=${SOURCE_VERSION}

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node packages/contracts/package.json ./packages/contracts/package.json
COPY --chown=node:node services/api/package.json ./services/api/package.json
RUN npm ci --omit=dev --workspace=@intuecho/api --workspace=@intuecho/contracts && npm cache clean --force

COPY --chown=node:node packages/contracts/src ./packages/contracts/src
COPY --chown=node:node services/api/migrations ./services/api/migrations
COPY --chown=node:node services/api/scripts ./services/api/scripts
COPY --chown=node:node services/api/src ./services/api/src

USER node
EXPOSE 4040
CMD ["npm", "start", "--workspace=@intuecho/api"]
