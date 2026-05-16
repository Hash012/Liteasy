import { buildAdminDemoReseedPayload } from "../services/dev-cloud/payloads/adminDemoActionPayloads.mjs";

const result = buildAdminDemoReseedPayload();
console.log(JSON.stringify(result, null, 2));
