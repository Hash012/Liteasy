export class CliError extends Error {
  constructor(code, message, exitCode = 2, detail = {}) {
    super(message);
    Object.assign(this, { code, exitCode, ...detail });
  }
}
export function exitCode(error) {
  if (error.exitCode) return error.exitCode;
  if (["context_schema_unsupported", "context_protocol_invalid", "context_path_invalid"].includes(error.code)) return 8;
  if (error.status === 401) return 3;
  if (error.status === 403) return 4;
  if (error.status === 404) return 5;
  if (error.status === 409) return 6;
  if (error.status === 0 || error.status >= 500) return 7;
  return error.status >= 400 ? 2 : 8;
}
