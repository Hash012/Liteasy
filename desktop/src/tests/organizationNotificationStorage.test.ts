import { afterEach, expect, test } from "vitest";
import {
  clearStoredOrganizationReadNotificationKeys,
  loadStoredOrganizationReadNotificationKeys,
  storeOrganizationReadNotificationKeys
} from "../app/features/organization/organizationNotificationStorage";

afterEach(() => {
  window.localStorage.clear();
});

test("stores only valid organization notification read keys", () => {
  storeOrganizationReadNotificationKeys(["org-demo-1:notice-1", "org-demo-1:notice-1", "invalid"]);

  expect(loadStoredOrganizationReadNotificationKeys()).toEqual(["org-demo-1:notice-1"]);
});

test("ignores malformed organization notification storage payloads", () => {
  window.localStorage.setItem("liteasy.organization.notifications.read.v1", JSON.stringify({ bad: true }));

  expect(loadStoredOrganizationReadNotificationKeys()).toEqual([]);
});


test("clears stored organization notification read keys", () => {
  storeOrganizationReadNotificationKeys(["org-demo-1:notice-1"]);

  clearStoredOrganizationReadNotificationKeys();

  expect(loadStoredOrganizationReadNotificationKeys()).toEqual([]);
});
