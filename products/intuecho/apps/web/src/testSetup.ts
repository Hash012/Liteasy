import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// JSDOM does not expose Web Locks; serialize reservations as the browser does.
const reservations = new Map<string, Promise<unknown>>();
Object.defineProperty(navigator, "locks", { configurable: true, value: {
  request: (name: string, callback: () => unknown) => {
    const work = (reservations.get(name) ?? Promise.resolve()).catch(() => {}).then(callback);
    reservations.set(name, work);
    return work;
  }
} });

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
