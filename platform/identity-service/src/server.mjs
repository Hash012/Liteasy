import http from "node:http";
import { createIdentityManagementHandler } from "./app.mjs";
import { loadIdentityManagementConfig } from "./config.mjs";
import { KeycloakClient } from "./keycloakClient.mjs";

const config = loadIdentityManagementConfig();
const keycloak = new KeycloakClient(config.admin);
const server = http.createServer(createIdentityManagementHandler(config, keycloak));
server.listen(config.port, config.host, () => {
  process.stdout.write(`identity-management listening on ${config.host}:${config.port}\n`);
});
