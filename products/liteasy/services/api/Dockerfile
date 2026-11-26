ARG NODE_IMAGE=node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
FROM ${NODE_IMAGE}

ENV NODE_ENV=production
WORKDIR /app/products/liteasy/services/api

COPY --chown=node:node products/liteasy/services/api/package.json products/liteasy/services/api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node products/liteasy/services/api/migrations ./migrations
COPY --chown=node:node products/liteasy/services/api/scripts ./scripts
COPY --chown=node:node products/liteasy/services/api/src ./src
COPY --chown=node:node products/liteasy/packages/shared /app/products/liteasy/packages/shared
COPY --chown=node:node products/liteasy/packages/context-contracts /app/products/liteasy/packages/context-contracts
COPY --chown=node:node products/liteasy/packages/device-control /app/products/liteasy/packages/device-control

RUN node --input-type=module -e "await import('./src/server.mjs')"

USER node
EXPOSE 8787
CMD ["node", "src/server.mjs"]
