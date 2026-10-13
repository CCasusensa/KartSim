import assert from "node:assert/strict";
import test from "node:test";

import { isPrefetchStore, prefetchStartupReads, STARTUP_READS, type StartupReadList } from "./startup-reads";

test("the startup read list fetches its tier for its own revision only", async () => {
  const reads: StartupReadList = { version: "p3553", revision: "r1",
    early: { "gui_font.rho": [[0, 10]] }, late: { "stage_mainMenu.rho": [[5, 9]] },
    race: { "effect.rho": [[0, 4]] } };
  const asked: unknown[] = [];
  const store = (revision: string) => ({ manifest: { version: "p3553", revision },
    async prefetch(ranges: unknown) { asked.push(ranges); } });
  assert.ok(isPrefetchStore(store("r1")));
  assert.equal(isPrefetchStore({ manifest: { version: "p3553" } }), false);
  await prefetchStartupReads(store("r1"), "early", reads);
  await prefetchStartupReads(store("r1"), "late", reads);
  await prefetchStartupReads(store("r1"), "race", reads);
  await prefetchStartupReads(store("r2"), "early", reads);
  await prefetchStartupReads(store("r1"), "race", { ...reads, race: undefined } as never);
  assert.deepEqual(asked, [reads.early, reads.late, reads.race]);
  // A failing prefetch leaves the reads to fetch on their own.
  await prefetchStartupReads({ ...store("r1"), prefetch: async () => { throw new Error("offline"); } }, "early", reads);
});

test("the shipped list holds ordered, in-range byte ranges", () => {
  assert.equal(STARTUP_READS.version, "p3553");
  for (const tier of ["early", "late", "race"] as const) {
    for (const [name, ranges] of Object.entries(STARTUP_READS[tier])) {
      let previous = -1;
      for (const [start, end] of ranges) {
        assert.ok(start > previous && end > start, `${tier} ${name}`);
        previous = end;
      }
    }
  }
  assert.ok(Object.keys(STARTUP_READS.early).includes("gui_font.rho"));
});
