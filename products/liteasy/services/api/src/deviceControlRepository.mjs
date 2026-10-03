import { emptyDeviceState, DeviceControlError } from "../../../packages/device-control/src/service.mjs";
import { withAccountWriteTransaction } from "./accountDeletionFence.mjs";

/** One bounded account transaction serializes device consent, idempotency and task leases together. */
export class PostgresDeviceControlRepository {
  constructor(pool) { this.pool = pool; }
  async transaction(subjectId, operation) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await withAccountWriteTransaction(this.pool, subjectId, async (client) => {
          await client.query("INSERT INTO device_control_accounts(subject_id,state) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING", [subjectId, JSON.stringify(emptyDeviceState())]);
          const result = await client.query("SELECT state FROM device_control_accounts WHERE subject_id=$1 FOR UPDATE", [subjectId]);
          const state = result.rows[0].state; const before = JSON.stringify(state);
          const value = operation(state); const after = JSON.stringify(state);
          if (Buffer.byteLength(after) > 32 * 1024 * 1024) throw new DeviceControlError("device_history_full", 409);
          if (before !== after) await client.query("UPDATE device_control_accounts SET state=$2::jsonb,revision=revision+1,updated_at=now() WHERE subject_id=$1", [subjectId, after]);
          return value;
        });
      } catch (error) {
        if (!["40001", "40P01"].includes(error.code) || attempt >= 4) throw error;
      }
    }
  }
}
