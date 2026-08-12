FROM node@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920

WORKDIR /app
COPY --chown=node:node clamavClient.mjs server.mjs ./

USER node
EXPOSE 8443
CMD ["node", "server.mjs"]
