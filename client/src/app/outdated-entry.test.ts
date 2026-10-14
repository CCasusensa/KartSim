import assert from "node:assert/strict";
import test from "node:test";

import { reloadIfOutdatedEntry } from "./boot-support";

/** Runs the startup check against a server page naming `serverScript`; returns the reloads. */
async function check(serverScript: string, options: { marker?: boolean; nowMs?: number; html?: boolean } = {}) {
  const reloads: string[] = [];
  const fetches: unknown[] = [];
  const marker = new Set<string>(options.marker ? ["kart-frontend-reload:http://localhost:8780/assets/new.js"] : []);
  const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch,
    DOMParser: globalThis.DOMParser, sessionStorage: globalThis.sessionStorage, now: performance.now };
  Object.assign(globalThis, {
    window: { location: { href: "http://localhost:8780/", reload() { reloads.push("reload"); } } },
    document: { querySelector: () => ({ src: "http://localhost:8780/assets/old.js" }) },
    fetch: async (url: URL, init: RequestInit) => {
      fetches.push([url.pathname, init.cache]);
      return { ok: true, url: "http://localhost:8780/",
        headers: { get: () => options.html === false ? "application/json" : "text/html" },
        text: async () => serverScript };
    },
    DOMParser: class {
      parseFromString(text: string) {
        return { querySelector: () => ({ getAttribute: () => text }) };
      }
    },
    sessionStorage: {
      getItem: (key: string) => marker.has(key) ? "1" : null,
      setItem: (key: string) => { marker.add(key); },
    },
  });
  performance.now = () => options.nowMs ?? 500;
  try {
    const reloaded = await reloadIfOutdatedEntry();
    return { reloaded, reloads, fetches, marker };
  } finally {
    performance.now = saved.now;
    Object.assign(globalThis, saved);
  }
}

test("a page from a stale cache reloads into the server's build while the game loads", async () => {
  const stale = await check("/assets/new.js");
  assert.equal(stale.reloaded, true);
  assert.deepEqual(stale.reloads, ["reload"]);
  assert.deepEqual(stale.fetches, [["/", "no-store"]]);
  assert.ok(stale.marker.has("kart-frontend-reload:http://localhost:8780/assets/new.js"));

  assert.equal((await check("/assets/old.js")).reloaded, false, "current page");
  assert.equal((await check("/assets/new.js", { marker: true })).reloaded, false, "once per new build");
  assert.equal((await check("/assets/new.js", { nowMs: 5_000 })).reloaded, false, "too late: the watcher's turn");
  assert.equal((await check("/assets/new.js", { html: false })).reloaded, false, "not the page");
});
