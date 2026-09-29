import { createContext } from "react";

export type LocalMcpInfo = {
  enabled: boolean; writable: boolean; scopeId?: string; generation?: string;
  executable: string; connectionFile: string;
};
export type LocalMcpModel = {
  info?: LocalMcpInfo; busy: boolean; error: string;
  recent?: { tool: string; failed: boolean; at: string };
  configure(enabled: boolean, writable: boolean): void;
};
export const LocalMcpContext = createContext<LocalMcpModel | null>(null);

/** JSON strings also safely encode the paths used by TOML basic strings. */
export function localMcpCodexConfig(info: LocalMcpInfo) {
  return `[mcp_servers.liteasy]\ncommand = ${JSON.stringify(info.executable)}\nargs = ["--local-mcp", ${JSON.stringify(info.connectionFile)}]\nstartup_timeout_sec = 15\ntool_timeout_sec = 120\n`;
}
