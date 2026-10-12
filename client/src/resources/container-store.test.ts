import assert from "node:assert/strict";
import test from "node:test";

import { ContainerStore, type ContainerProgress, type DirectoryHandle } from "./container-store";

const MiB = 1024 * 1024;

/** A Map-backed OPFS directory. */
function memoryDirectory(): DirectoryHandle & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const directory = {
    files,
    async getDirectoryHandle() { return directory; },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) throw new DOMException("missing", "NotFoundError");
      if (!files.has(name)) files.set(name, new Uint8Array());
      return {
        getFile: async () => new Blob([files.get(name)! as Uint8Array<ArrayBuffer>]),
        createWritable: async () => {
          const chunks: Uint8Array[] = [];
          return {
            write: async (chunk: Uint8Array) => { chunks.push(chunk.slice()); },
            close: async () => {
              const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
              let offset = 0;
              for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
              files.set(name, bytes);
            },
            abort: async () => {},
          };
        },
      };
    },
    async removeEntry(name: string) { files.delete(name); },
    async *keys() { yield* files.keys(); },
  };
  return directory;
}

function content(size: number, seed: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, index) => (index * 31 + seed) & 255);
}

/** Serves the containers like a static server; `ranges: false` ignores Range like python http.server. */
function server(containers: Record<string, Uint8Array>, options: { ranges?: boolean; total?: number } = {}) {
  const requests: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const name = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
    const bytes = containers[name]!;
    const range = new Headers(init?.headers).get("range");
    requests.push(range ? `${name} ${range}` : name);
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    if (!match || options.ranges === false) return new Response(bytes as Uint8Array<ArrayBuffer>);
    const start = Number(match[1]);
    const end = Math.min(bytes.length - 1, Number(match[2]));
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
      "content-range": `bytes ${start}-${end}/${options.total ?? bytes.length}` } });
  };
  return { requests, fetcher };
}

function store(containers: Record<string, Uint8Array>, serverOptions: { ranges?: boolean; total?: number } = {}) {
  const directory = memoryDirectory();
  const { requests, fetcher } = server(containers, serverOptions);
  const progress: ContainerProgress[] = [];
  const instance = new ContainerStore({
    manifest: { version: "p3553", revision: "r1", files: Object.entries(containers).map(([name, bytes]) =>
      ({ name, size: bytes.length, mtimeMs: 0, sha256: "" })) } as never,
    storage: { getDirectory: async () => directory, estimate: async () => ({ quota: 1e12, usage: 0 }) },
    fetcher: fetcher as never,
    onProgress: event => progress.push(event),
  });
  return { store: instance, directory, requests, progress };
}

const read = async (store: ContainerStore, name: string, start: number, end: number) =>
  new Uint8Array(await store.readRange(name, start, end));

test("an uncached large container is read by range and stays uncached", async () => {
  const big = content(4 * MiB, 7);
  const { store: containers, requests, directory, progress } = store({ "big.rho": big });
  assert.deepEqual(await read(containers, "big.rho", 100_000, 100_100), big.slice(100_000, 100_100));
  // The 32 KiB block around the read, once.
  assert.deepEqual(requests, ["big.rho bytes=98304-131071"]);
  assert.deepEqual(await read(containers, "big.rho", 100_050, 110_000), big.slice(100_050, 110_000));
  assert.equal(requests.length, 1, "the cached block answers");
  assert.equal(directory.files.size, 0);
  assert.deepEqual([...await containers.cachedNames()], []);
  const partial = progress.filter(event => event.phase === "partial");
  assert.ok(partial.length > 0);
  assert.equal(partial.at(-1)!.loadedBytes, 32 * 1024);
  assert.equal(partial.some(event => event.phase === "ready" as never), false);
});

test("reads of one moment share requests; distant blocks get their own", async () => {
  const big = content(4 * MiB, 3);
  const { store: containers, requests } = store({ "big.rho": big });
  const blocks = await Promise.all([
    read(containers, "big.rho", 0, 10),
    read(containers, "big.rho", 70_000, 70_010), // two blocks on: merged with the first
    read(containers, "big.rho", 3 * MiB, 3 * MiB + 40_000), // spans two blocks
  ]);
  assert.deepEqual(blocks[0], big.slice(0, 10));
  assert.deepEqual(blocks[1], big.slice(70_000, 70_010));
  assert.deepEqual(blocks[2], big.slice(3 * MiB, 3 * MiB + 40_000));
  assert.deepEqual(requests.sort(), ["big.rho bytes=0-98303", "big.rho bytes=3145728-3211263"]);
});

test("small containers, reads of half a container and cached ones download whole", async () => {
  const small = content(200_000, 1);
  const big = content(2 * MiB, 2);
  const { store: containers, requests, directory } = store({ "small.rho": small, "big.rho": big });
  assert.deepEqual(await read(containers, "small.rho", 10, 20), small.slice(10, 20));
  assert.deepEqual(await read(containers, "big.rho", 0, MiB + 1), big.slice(0, MiB + 1));
  assert.deepEqual(requests, ["small.rho", "big.rho"]);
  assert.ok(directory.files.has("small.rho") && directory.files.has("big.rho"));
  assert.deepEqual(await read(containers, "big.rho", 5, 9), big.slice(5, 9));
  assert.equal(requests.length, 2, "a cached container is read from OPFS");
});

test("a server that ignores Range turns range reads off: containers download whole", async () => {
  const big = content(3 * MiB, 9);
  const other = content(3 * MiB, 4);
  const { store: containers, requests } = store({ "big.rho": big, "other.rho": other }, { ranges: false });
  assert.deepEqual(await read(containers, "big.rho", 500, 600), big.slice(500, 600));
  assert.deepEqual(requests, ["big.rho bytes=0-32767", "big.rho"]);
  assert.deepEqual(await read(containers, "other.rho", 10, 20), other.slice(10, 20));
  assert.deepEqual(requests.slice(2), ["other.rho"]);
});

test("a mismatched Content-Range is an error and nothing is cached", async () => {
  const big = content(2 * MiB, 5);
  const { store: containers } = store({ "big.rho": big }, { total: 123 });
  await assert.rejects(() => containers.readRange("big.rho", 0, 10), /分段读取范围不符/);
});

test("prefetched ranges answer later reads without requests", async () => {
  const big = content(4 * MiB, 6);
  const small = content(1000, 8);
  const { store: containers, requests } = store({ "big.rho": big, "small.rho": small, "gone.rho": small });
  await containers.prefetch({ "big.rho": [[0, 50_000], [2 * MiB, 2 * MiB + 10]], "small.rho": [[0, 10]],
    "missing.rho": [[0, 10]] });
  assert.deepEqual(requests.sort(), ["big.rho bytes=0-65535", "big.rho bytes=2097152-2129919", "small.rho"]);
  assert.deepEqual(await read(containers, "big.rho", 40_000, 50_000), big.slice(40_000, 50_000));
  assert.deepEqual(await read(containers, "big.rho", 2 * MiB, 2 * MiB + 10), big.slice(2 * MiB, 2 * MiB + 10));
  assert.deepEqual(await read(containers, "small.rho", 0, 10), small.slice(0, 10));
  assert.equal(requests.length, 3);
});

test("background downloads say so until a foreground caller wants the container", async () => {
  const big = content(2 * MiB, 2);
  const { store: containers, progress } = store({ "a.rho": big, "b.rho": big });
  await containers.ensure("a.rho", { background: true });
  assert.ok(progress.filter(event => event.file === "a.rho").every(event => event.background === true));
  const background = containers.ensure("b.rho", { background: true });
  const foreground = containers.ensure("b.rho");
  await Promise.all([background, foreground]);
  assert.equal(progress.filter(event => event.file === "b.rho").at(-1)!.background, undefined);
});

test("a container that finished downloading is read from OPFS, not by range", async () => {
  const big = content(4 * MiB, 11);
  const { store: containers, requests } = store({ "big.rho": big });
  await read(containers, "big.rho", 0, 10);
  await containers.ensure("big.rho");
  const before = requests.length;
  assert.deepEqual(await read(containers, "big.rho", MiB, MiB + 10), big.slice(MiB, MiB + 10));
  assert.equal(requests.length, before);
  assert.equal(await containers.remove("big.rho"), true);
  assert.deepEqual(await read(containers, "big.rho", MiB, MiB + 10), big.slice(MiB, MiB + 10));
  assert.equal(requests.at(-1), "big.rho bytes=1048576-1081343", "removed: by range again");
});
