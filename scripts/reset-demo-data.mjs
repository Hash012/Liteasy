import { buildAdminDemoResetPayload } from "../services/dev-cloud/payloads/adminDemoActionPayloads.mjs";

const result = buildAdminDemoResetPayload();
console.log(JSON.stringify(result, null, 2));
