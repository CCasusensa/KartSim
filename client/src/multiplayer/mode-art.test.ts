import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadMultiplayerModeImage } from "./mode-art";
import { localizedPngPath } from "../resources/localized-png";

test("localized mode cards load from the resource archive while Chinese retains the original file", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const locale of ["zh-CN", "en", "ko"] as const) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
      for (const file of ["ordinary-race.png", "grip-mode.png", "ghost-mode.png", "blocking-mode.png", "giant-mode.png",
        "rp-race-neutral-01.png", "rp-race-neutral-02.png", "rp-race-neutral-03.png", "rp-race-neutral-04.png"]) {
        const calls: string[] = [];
        const path = localizedPngPath(`ui/multiplayer/${file}`, locale);
        const bytes = locale === "zh-CN" ? Uint8Array.of(1) : readFileSync(new URL(`../../assets/locale-ui/race/${locale}/ui/multiplayer/${file}`, import.meta.url));
        const library = { canonicalCandidates: (candidate: string) => locale !== "zh-CN" && candidate === path
          ? [{ bytes: async () => bytes }] : [] };
        const response = await loadMultiplayerModeImage(library, file, async url => {
          calls.push(url); return { ok: true, arrayBuffer: async () => bytes.slice().buffer };
        });
        assert.equal(response.ok, true);
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(bytes));
        assert.deepEqual(calls, locale === "zh-CN" ? [`/ui/multiplayer/${file}`] : []);
      }
    }
  } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
