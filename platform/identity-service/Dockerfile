FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920

WORKDIR /app
COPY package.json ./
COPY src ./src

USER node
EXPOSE 9090
CMD ["node", "src/server.mjs"]
