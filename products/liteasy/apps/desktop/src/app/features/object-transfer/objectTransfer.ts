import { z } from "zod";
import {
  objectLink,
  objectRefSchema,
  type ObjectRef,
} from "../objects/object.types";
export const OBJECT_TRANSFER_MIME =
  "application/x-liteasy-object-transfer+json";
export const objectTransferSchema = z.strictObject({
  schemaVersion: z.literal("liteasy.object-transfer/v1"),
  transferId: z.string().uuid(),
  refs: z.array(objectRefSchema).min(1).max(100),
  text: z.string().max(100000).optional(),
  mode: z.enum(["reference", "copy"]),
});
export type ObjectTransfer = z.infer<typeof objectTransferSchema>;
export function makeObjectTransfer(
  refs: ObjectRef[],
  text?: string,
): ObjectTransfer {
  return {
    schemaVersion: "liteasy.object-transfer/v1",
    transferId: crypto.randomUUID(),
    refs,
    text,
    mode: "reference",
  };
}
export function writeObjectTransfer(
  data: Pick<DataTransfer, "setData">,
  transfer: ObjectTransfer,
) {
  data.setData(OBJECT_TRANSFER_MIME, JSON.stringify(transfer));
  data.setData(
    "text/plain",
    [transfer.text, ...transfer.refs.map(objectLink)]
      .filter(Boolean)
      .join("\n"),
  );
}
export function readObjectTransfer(
  data: Pick<DataTransfer, "getData">,
): ObjectTransfer | null {
  const raw = data.getData(OBJECT_TRANSFER_MIME);
  if (!raw) return null;
  if (raw.length > 200000) throw new Error("拖入内容过大。");
  return objectTransferSchema.parse(JSON.parse(raw));
}
// Temporary captures stay in this host-owned registry. Drag data cannot assert author, scope or source identity.
export type PendingCapture = {
  transferId: string;
  capture: () => Promise<ObjectRef[]>;
  expiresAt: number;
};
export const PENDING_CAPTURE_MIME = "application/x-liteasy-capture-ticket";
export function createCaptureTickets() {
  const tickets = new Map<string, PendingCapture>();
  const inFlight = new Map<string, Promise<ObjectRef[]>>();
  return {
    register(capture: PendingCapture["capture"]) {
      const transferId = crypto.randomUUID();
      const now = Date.now();
      for (const [key, ticket] of tickets)
        if (ticket.expiresAt < now) tickets.delete(key);
      tickets.set(transferId, { transferId, capture, expiresAt: now + 60000 });
      return transferId;
    },
    async consume(transferId: string) {
      const ticket = tickets.get(transferId);
      if (!ticket || ticket.expiresAt < Date.now())
        throw new Error("拖拽已失效，请重新拖入。");
      let result = inFlight.get(transferId);
      if (!result) {
        result = ticket.capture();
        inFlight.set(transferId, result);
        result.catch(() => inFlight.delete(transferId));
      }
      return result;
    },
    clear() {
      tickets.clear();
      inFlight.clear();
    },
  };
}
