import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("./lib/ens-profile.js", () => ({
  lookupEnsName: vi.fn(async () => null),
  lookupEnsAvatar: vi.fn(async () => null),
}));

// jsdom does not implement window.matchMedia — provide a stub
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
