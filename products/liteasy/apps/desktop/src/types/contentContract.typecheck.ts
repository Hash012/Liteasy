import type { ContentFragment } from "../app/features/markdown/contentFragment";
import type { ContentViewProps } from "../app/features/markdown/ContentView";
import type { ResourceCapability } from "../app/features/resource-filesystem/resourceTypeRegistry";
// Compiled by ci:contracts. These must stay errors; no runtime code imports this module.
// @ts-expect-error Rich bodies require a validated envelope.
const raw: ContentFragment = "<table>";
// @ts-expect-error Public renderer does not accept a naked string.
const rawView: ContentViewProps = { content: "text" };
// @ts-expect-error A supported capability must supply its implementation.
const handler: ResourceCapability<() => void> = { supported: true };
// @ts-expect-error Unsupported capability must explain its reason.
const unavailable: ResourceCapability<() => void> = { supported: false };
void [raw, rawView, handler, unavailable];
