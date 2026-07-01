import type { AccountSession } from "../account/account.types";
import { createCollectionClient, type CollectionTransport } from "./collectionClient";
import type { CollectionItem } from "./collection.types";

type CollectionRuntimeDeps = {
  transport?: CollectionTransport;
};

type SaveCollectionInput = {
  controlPlaneEndpoint: string;
  item: CollectionItem;
  session: AccountSession;
};

type ListCollectionInput = {
  controlPlaneEndpoint: string;
  session: AccountSession;
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

export async function saveCloudCollectionItem(
  input: SaveCollectionInput,
  deps: CollectionRuntimeDeps = {}
) {
  if (isMockEndpoint(input.controlPlaneEndpoint)) {
    return [input.item];
  }

  const client = createCollectionClient({
    endpoint: input.controlPlaneEndpoint,
    transport: deps.transport
  });

  return client.save(input.session.sessionId, input.item);
}

export async function loadCloudCollectionItems(
  input: ListCollectionInput,
  deps: CollectionRuntimeDeps = {}
) {
  if (isMockEndpoint(input.controlPlaneEndpoint)) {
    return [];
  }

  const client = createCollectionClient({
    endpoint: input.controlPlaneEndpoint,
    transport: deps.transport
  });

  return client.list(input.session.sessionId);
}
