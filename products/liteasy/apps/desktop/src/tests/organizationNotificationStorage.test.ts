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
  storeOrganizationReadNotificationKeys(["org-demo-1:notice-1", "org-demo-1:notice-1", "invalid"], "actor-a");

  expect(loadStoredOrganizationReadNotificationKeys("actor-a")).toEqual(["org-demo-1:notice-1"]);
});

test("ignores malformed organization notification storage payloads", () => {
  window.localStorage.setItem("liteasy.organization.notifications.read.v2:actor-a", JSON.stringify({ bad: true }));

  expect(loadStoredOrganizationReadNotificationKeys("actor-a")).toEqual([]);
});


test("clears stored organization notification read keys", () => {
  storeOrganizationReadNotificationKeys(["org-demo-1:notice-1"], "actor-a");

  clearStoredOrganizationReadNotificationKeys("actor-a");

  expect(loadStoredOrganizationReadNotificationKeys("actor-a")).toEqual([]);
});


test("legacy unbound records are not assigned to a new account", () => {
  localStorage.setItem("liteasy.organization.notifications.read.v1", '["org-demo-1:notice-1"]');
  expect(loadStoredOrganizationReadNotificationKeys("actor-a")).toEqual([]);
  expect(loadStoredOrganizationReadNotificationKeys()).toEqual([]);
  storeOrganizationReadNotificationKeys(["org-demo-1:notice-2"]);
  expect(loadStoredOrganizationReadNotificationKeys()).toEqual([]);
  expect(localStorage.getItem("liteasy.organization.notifications.read.v1")).toBe('["org-demo-1:notice-1"]');
});

test("reading or clearing one actor never reads or clears another actor", () => {
  storeOrganizationReadNotificationKeys(["org-demo-1:notice-1"], "actor-a");
  expect(loadStoredOrganizationReadNotificationKeys("actor-b")).toEqual([]);
  clearStoredOrganizationReadNotificationKeys("actor-b");
  expect(loadStoredOrganizationReadNotificationKeys("actor-a")).toEqual(["org-demo-1:notice-1"]);
});
