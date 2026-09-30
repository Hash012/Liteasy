import { emptyDeviceState, DeviceControlError } from "../../../products/liteasy/packages/device-control/src/service.mjs";

export class SqliteDeviceControlRepository {
  constructor(database) { this.database = database; }
  transaction(subjectId, operation) {
    return this.database.transaction(() => {
      const row = this.database.prepare("SELECT state FROM device_control_accounts WHERE subject_id=?").get(subjectId);
      const state = row ? JSON.parse(row.state) : emptyDeviceState();
      const result = operation(state); const value = JSON.stringify(state);
      if (Buffer.byteLength(value) > 32 * 1024 * 1024) throw new DeviceControlError("device_history_full", 409);
      this.database.prepare("INSERT INTO device_control_accounts(subject_id,state) VALUES (?,?) ON CONFLICT(subject_id) DO UPDATE SET state=excluded.state,revision=revision+1").run(subjectId, value);
      return result;
    }).immediate();
  }
}
