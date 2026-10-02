import { getRecoveryRuntime } from "../local-recovery/runtimeProfile";
import { loadStoredAccountSession } from "../account/accountSessionStorage";

/** Local data follows one device but its catalog is isolated per signed-in account. */
export function resolveLocalAccountKey() {
  const recovery = getRecoveryRuntime();
  if (recovery) return recovery.scopeId === "local" ? "guest" : recovery.scopeId;
  const session = loadStoredAccountSession();
  if (!session) return "guest";
  const stableIdentity = session.userId?.trim() || session.email.trim().toLowerCase();
  return stableIdentity ? `user:${stableIdentity}` : "guest";
}
