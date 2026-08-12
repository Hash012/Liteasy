FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920

ARG SOURCE_REVISION
ARG SOURCE_VERSION
ARG SOURCE_URL=https://github.com/Hash012/Liteasy
LABEL org.opencontainers.image.revision=${SOURCE_REVISION} \
      org.opencontainers.image.source=${SOURCE_URL} \
      org.opencontainers.image.version=${SOURCE_VERSION}

WORKDIR /app
COPY package.json ./
COPY src ./src

USER node
EXPOSE 9090
CMD ["node", "src/server.mjs"]
