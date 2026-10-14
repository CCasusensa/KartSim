import assert from "node:assert/strict";
import test from "node:test";

import { ContainerMismatchError, ContainerStore, DownloadPausedError, containerMismatch, type ContainerProgress,
  type DirectoryHandle } from "./container-store";

const MiB = 1024 * 1024;

type MemoryDirectory = DirectoryHandle & { files: Map<string, Uint8Array>; directories: Map<string, MemoryDirectory> };

/** A Map-backed OPFS directory. */
function memoryDirectory(): MemoryDirectory {
  const files = new Map<string, Uint8Array>();
  const directories = new Map<string, MemoryDirectory>();
  const directory = {
    files,
    directories,
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      if (!directories.has(name) && !options?.create) throw new DOMException("missing", "NotFoundError");
      if (!directories.has(name)) directories.set(name, memoryDirectory());
      return directories.get(name)!;
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) throw new DOMException("missing", "NotFoundError");
      if (!files.has(name)) files.set(name, new Uint8Array());
      return {
        getFile: async () => new Blob([files.get(name)! as Uint8Array<ArrayBuffer>]),
        // Like OPFS: writes go to a copy (the existing data with keepExistingData) committed on close.
        createWritable: async (options?: { keepExistingData?: boolean }) => {
          let copy = options?.keepExistingData ? files.get(name)!.slice() : new Uint8Array();
          let position = 0;
          return {
            write: async (chunk: Uint8Array) => {
              const end = position + chunk.length;
              if (end > copy.length) { const grown = new Uint8Array(end); grown.set(copy); copy = grown; }
              copy.set(chunk, position);
              position = end;
            },
            seek: async (offset: number) => { position = offset; },
            close: async () => { files.set(name, copy); },
            abort: async () => {},
          };
        },
      };
    },
    async removeEntry(name: string) { files.delete(name); directories.delete(name); },
    async *keys() { yield* files.keys(); yield* directories.keys(); },
  };
  return directory;
}

/** An OPFS root whose revision directory is `directory`. */
const revisionRoot = (directory: MemoryDirectory) => ({ getDirectoryHandle: async () => directory }) as never;

function content(size: number, seed: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, index) => (index * 31 + seed) & 255);
}

/**
 * Serves the containers like a static server; `ranges: false` ignores Range
 * like python http.server. Bodies stream in 64 KiB chunks, each after
 * `gate` (a pause test holds the stream).
 */
function server(containers: Record<string, Uint8Array>,
  options: { ranges?: boolean; total?: number; gate?: () => Promise<void> } = {}) {
  const requests: string[] = [];
  const urls: string[] = [];
  const body = (bytes: Uint8Array, signal?: AbortSignal | null) => {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        await options.gate?.();
        if (signal?.aborted) return controller.error(new DOMException("aborted", "AbortError"));
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, offset += 65536));
      },
    });
  };
  const fetcher = async (url: string, init?: RequestInit) => {
    urls.push(url);
    const path = url.split("?")[0]!;
    const name = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
    const bytes = containers[name]!;
    const range = new Headers(init?.headers).get("range");
    requests.push(range ? `${name} ${range}` : name);
    const match = /^bytes=(\d+)-(\d*)$/.exec(range ?? "");
    if (!match || options.ranges === false) return new Response(body(bytes, init?.signal),
      { headers: { "content-length": String(bytes.length) } });
    const start = Number(match[1]);
    const end = Math.min(bytes.length - 1, match[2] ? Number(match[2]) : Infinity);
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
      "content-range": `bytes ${start}-${end}/${options.total ?? bytes.length}` } });
  };
  return { requests, urls, fetcher };
}

/**
 * `sizes` are manifest sizes that differ from the served containers (another
 * version on the server); `visit.directory` is the OPFS of an earlier visit,
 * `visit.sha256` the manifest hashes (empty by default).
 */
function store(containers: Record<string, Uint8Array>,
  serverOptions: { ranges?: boolean; total?: number; gate?: () => Promise<void> } = {},
  sizes: Record<string, number> = {},
  visit: { directory?: MemoryDirectory; sha256?: Record<string, string>; keptBlockBytes?: number } = {}) {
  const directory = visit.directory ?? memoryDirectory();
  const { requests, urls, fetcher } = server(containers, serverOptions);
  const progress: ContainerProgress[] = [];
  const instance = new ContainerStore({
    manifest: { version: "p3553", revision: "r1", files: Object.entries(containers).map(([name, bytes]) =>
      ({ name, size: sizes[name] ?? bytes.length, mtimeMs: 0, sha256: visit.sha256?.[name] ?? "" })) } as never,
    storage: { getDirectory: async () => revisionRoot(directory), estimate: async () => ({ quota: 1e12, usage: 0 }) },
    fetcher: fetcher as never,
    onProgress: event => progress.push(event),
    ...(visit.keptBlockBytes === undefined ? {} : { keptBlockBytes: visit.keptBlockBytes }),
  });
  return { store: instance, directory, requests, urls, progress };
}

/** The kept-block files of a revision directory. */
const keptRuns = (directory: MemoryDirectory) => directory.directories.get("blocks")?.files.keys() ?? [];

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
  await containers.keptBlocksSettled();
  assert.equal(directory.files.size, 0);
  assert.deepEqual([...await containers.cachedNames()], []);
  assert.deepEqual([...keptRuns(directory)].map(name => name.replace(/\.[\da-z]+$/, "")), ["big.rho.-.3-3"],
    "the block is kept in OPFS for the next visit");
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

test("a Content-Range for another container size says the server's copy is another version", async () => {
  const big = content(2 * MiB, 5);
  const { store: containers, requests, directory } = store({ "big.rho": big }, { total: 123 });
  const error = await containers.readRange("big.rho", 0, 10).catch((thrown: unknown) => thrown);
  assert.ok(error instanceof ContainerMismatchError);
  assert.deepEqual([error.file, error.expectedBytes, error.servedBytes], ["big.rho", 2 * MiB, 123]);
  assert.match(error.message, /big\.rho 与资源清单版本不一致：清单 2097152 字节，服务器 123 字节/);
  // Asking again cannot help: one request, nothing cached.
  assert.equal(requests.length, 1);
  assert.equal(directory.files.has("big.rho"), false);
  // Found behind the errors that wrap it (赛道…加载失败).
  assert.equal(containerMismatch(new Error("赛道加载失败", { cause: error })), error);
  assert.equal(containerMismatch(new Error("x")), undefined);
});

test("a whole download of another container size fails before writing", async () => {
  const small = content(1000, 3);
  const { store: containers, directory } = store({ "small.rho": small }, {}, { "small.rho": 900 });
  await assert.rejects(() => containers.ensure("small.rho"),
    (error: unknown) => error instanceof ContainerMismatchError && error.servedBytes === 1000);
  assert.equal(directory.files.get("small.rho")?.length ?? 0, 0);
});

test("container URLs name the manifest's version, so caches never answer with an older build", async () => {
  const big = content(2 * MiB, 9);
  const { urls, fetcher } = server({ "big.rho": big });
  const directory = memoryDirectory();
  const containers = new ContainerStore({
    manifest: { version: "p3553", revision: "r1",
      files: [{ name: "big.rho", size: big.length, mtimeMs: 0, sha256: "0123456789abcdef".repeat(4) }] },
    storage: { getDirectory: async () => revisionRoot(directory), estimate: async () => ({ quota: 1e12, usage: 0 }) },
    fetcher: fetcher as never,
  });
  await read(containers, "big.rho", 0, 10);
  await containers.ensure("big.rho");
  assert.deepEqual(urls, ["/p3553/big.rho?v=0123456789abcdef", "/p3553/big.rho?v=0123456789abcdef"]);
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

test("a failed whole download ends with one failed progress, marked background when only background waited", async () => {
  const directory = memoryDirectory();
  const progress: ContainerProgress[] = [];
  const containers = new ContainerStore({
    manifest: { version: "p3553", revision: "r1", files: ["a.rho", "b.rho"].map(name =>
      ({ name, size: 2 * MiB, mtimeMs: 0, sha256: "" })) } as never,
    storage: { getDirectory: async () => revisionRoot(directory), estimate: async () => ({ quota: 1e12, usage: 0 }) },
    fetcher: (async () => new Response(null, { status: 503 })) as never,
    onProgress: event => progress.push(event),
  });
  const results = await Promise.allSettled([containers.ensure("a.rho"), containers.ensure("a.rho")]);
  assert.ok(results.every(result => result.status === "rejected"));
  await assert.rejects(containers.ensure("b.rho", { background: true }), /HTTP 503/);
  assert.deepEqual(progress.filter(event => event.phase === "failed").map(event => [event.file, event.background]),
    [["a.rho", undefined], ["b.rho", true]]);
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

test("a paused background download keeps its bytes and resumes after them", async () => {
  const big = content(3 * MiB, 12);
  let release: (() => void) | undefined;
  let chunks = 0;
  const { store: containers, requests, directory, progress } = store({ "big.rho": big }, {
    // The fourth chunk waits until the test lets it go.
    gate: () => ++chunks === 4 ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve(),
  });
  const background = containers.ensure("big.rho", { background: true });
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  containers.pauseBackground();
  release();
  await assert.rejects(background, DownloadPausedError);
  const kept = directory.files.get("big.rho")!;
  assert.equal(kept.length, 3 * 65536, "what arrived stays");
  assert.deepEqual(kept, big.slice(0, kept.length));
  assert.deepEqual([...await containers.cachedNames()], [], "a shorter copy is not cached");
  // A read meanwhile goes by range; the next download resumes.
  assert.deepEqual(await read(containers, "big.rho", MiB, MiB + 5), big.slice(MiB, MiB + 5));
  const blob = await containers.ensure("big.rho", { background: true });
  assert.equal(requests.at(-1), `big.rho bytes=${3 * 65536}-`);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), big);
  assert.equal(progress.filter(event => event.phase === "downloading").at(-1)!.loadedBytes, big.length);
});

test("a foreground download is not paused; a server without Range restarts a paused one", async () => {
  const big = content(2 * MiB, 13);
  const { store: containers, requests, directory } = store({ "big.rho": big }, { ranges: false });
  directory.files.set("big.rho", big.slice(0, 1000)); // a copy a pause left
  directory.files.set("big.rho.sha256", new Uint8Array()); // of this version (the test manifest's empty hash)
  const foreground = containers.ensure("big.rho");
  containers.pauseBackground();
  assert.deepEqual(new Uint8Array(await (await foreground).arrayBuffer()), big);
  assert.deepEqual(requests, ["big.rho bytes=1000-"], "asked to resume, got the whole file");
});

test("a container replaced under the same revision downloads again instead of resuming or trusting its length", async () => {
  const fresh = content(2 * MiB, 21);
  const { store: containers, requests, directory } = store({ "big.rho": fresh });
  const marker = (text: string) => new TextEncoder().encode(text);
  // An older build, shorter: not a paused download of this one.
  directory.files.set("big.rho", content(MiB, 5));
  directory.files.set("big.rho.sha256", marker("old"));
  assert.deepEqual([...await containers.cachedNames()], []);
  const blob = await containers.ensure("big.rho");
  assert.deepEqual(requests, ["big.rho"], "downloaded whole, not resumed after the old bytes");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), fresh);
  assert.equal(new TextDecoder().decode(directory.files.get("big.rho.sha256")), "", "marked with the manifest hash");
  // The same length as the manifest but another version: not trusted.
  const other = store({ "big.rho": fresh });
  other.directory.files.set("big.rho", content(2 * MiB, 9));
  other.directory.files.set("big.rho.sha256", marker("old"));
  assert.deepEqual([...await other.store.cachedNames()], []);
  assert.deepEqual(new Uint8Array(await (await other.store.ensure("big.rho")).arrayBuffer()), fresh);
  // A copy cached before markers existed still counts by its length.
  const legacy = store({ "big.rho": fresh });
  legacy.directory.files.set("big.rho", fresh.slice());
  assert.deepEqual([...await legacy.store.cachedNames()], ["big.rho"]);
  assert.equal(await legacy.store.remove("big.rho"), true);
  assert.equal(legacy.directory.files.size, 0);
});

test("blocks kept in OPFS answer the next visit without requests", async () => {
  const big = content(4 * MiB, 21);
  const startup = { "big.rho": [[0, 50_000], [2 * MiB, 2 * MiB + 10]] as [number, number][] };
  const first = store({ "big.rho": big });
  await first.store.prefetch(startup);
  await read(first.store, "big.rho", 3 * MiB, 3 * MiB + 100);
  await first.store.keptBlocksSettled();
  assert.equal(first.requests.length, 3);

  const next = store({ "big.rho": big }, {}, {}, { directory: first.directory });
  await next.store.prefetch(startup);
  assert.deepEqual(await read(next.store, "big.rho", 40_000, 50_000), big.slice(40_000, 50_000));
  assert.deepEqual(await read(next.store, "big.rho", 2 * MiB, 2 * MiB + 10), big.slice(2 * MiB, 2 * MiB + 10));
  assert.deepEqual(await read(next.store, "big.rho", 3 * MiB, 3 * MiB + 100), big.slice(3 * MiB, 3 * MiB + 100));
  assert.deepEqual(next.requests, []);
  assert.equal(next.progress.some(event => event.phase === "partial"), false, "nothing to download");
  // Blocks not kept still come by range.
  assert.deepEqual(await read(next.store, "big.rho", MiB, MiB + 10), big.slice(MiB, MiB + 10));
  assert.deepEqual(next.requests, ["big.rho bytes=1048576-1081343"]);
});

test("a container of another version is read by range again and its old blocks go", async () => {
  const old = content(4 * MiB, 1);
  const fresh = content(4 * MiB, 2);
  const first = store({ "big.rho": old }, {}, {}, { sha256: { "big.rho": "a".repeat(64) } });
  await read(first.store, "big.rho", 0, 100);
  await first.store.keptBlocksSettled();

  const next = store({ "big.rho": fresh }, {}, {}, { directory: first.directory, sha256: { "big.rho": "b".repeat(64) } });
  assert.deepEqual(await read(next.store, "big.rho", 0, 100), fresh.slice(0, 100));
  assert.deepEqual(next.requests, ["big.rho bytes=0-32767"]);
  await next.store.keptBlocksSettled();
  assert.deepEqual([...keptRuns(first.directory)].map(name => name.split(".").slice(2, 4).join(".")),
    [`${"b".repeat(16)}.0-0`]);
});

test("a container downloaded whole drops its kept blocks", async () => {
  const big = content(4 * MiB, 4);
  const other = content(2 * MiB, 5);
  const first = store({ "big.rho": big, "other.rho": other });
  await read(first.store, "big.rho", 0, 100);
  await read(first.store, "big.rho", 2 * MiB, 2 * MiB + 100);
  await first.store.keptBlocksSettled();
  assert.equal([...keptRuns(first.directory)].length, 2);
  await first.store.ensure("big.rho");
  await first.store.keptBlocksSettled();
  assert.deepEqual([...keptRuns(first.directory)], []);

  // Kept blocks of a container another visit downloaded whole go once the next visit lists them.
  await read(first.store, "other.rho", 0, 100);
  await first.store.keptBlocksSettled();
  first.directory.files.set("other.rho", other.slice());
  const next = store({ "big.rho": big, "other.rho": other }, {}, {}, { directory: first.directory });
  await read(next.store, "big.rho", 0, 100);
  assert.deepEqual(await read(next.store, "other.rho", 0, 100), other.slice(0, 100));
  await next.store.keptBlocksSettled();
  assert.deepEqual(next.requests, []);
  assert.deepEqual([...keptRuns(first.directory)], []);
});

test("beyond the kept-block limit the oldest written runs go", async () => {
  const big = content(4 * MiB, 6);
  const { store: containers, directory } = store({ "big.rho": big }, {}, {}, { keptBlockBytes: 100 * 1024 });
  for (const block of [0, 10, 20, 30]) {
    await read(containers, "big.rho", block * 32 * 1024, block * 32 * 1024 + 10);
    await containers.keptBlocksSettled();
  }
  assert.deepEqual([...keptRuns(directory)].map(name => name.split(".")[3]).sort(), ["20-20", "30-30"]);
});

test("a kept run cut short is fetched again", async () => {
  const big = content(4 * MiB, 8);
  const directory = memoryDirectory();
  const blocks = await directory.getDirectoryHandle("blocks", { create: true }) as MemoryDirectory;
  blocks.files.set("big.rho.-.0-0.1", big.slice(0, 10));
  blocks.files.set("big.rho.-.notarun", new Uint8Array(3));
  const { store: containers, requests } = store({ "big.rho": big }, {}, {}, { directory });
  assert.deepEqual(await read(containers, "big.rho", 0, 100), big.slice(0, 100));
  assert.deepEqual(requests, ["big.rho bytes=0-32767"]);
  await containers.keptBlocksSettled();
  assert.deepEqual([...blocks.files.keys()].map(name => name.replace(/\.[\da-z]+$/, "")), ["big.rho.-.0-0"]);
  assert.equal(blocks.files.values().next().value!.length, 32 * 1024);
});

test("beyond the limit, blocks this visit has not read go before the startup's", async () => {
  const all = { "startup.rho": content(4 * MiB, 1), "track.rho": content(4 * MiB, 2), "other.rho": content(4 * MiB, 3) };
  const first = store(all);
  await read(first.store, "startup.rho", 0, 10); // written first: the oldest run
  await first.store.keptBlocksSettled();
  await read(first.store, "track.rho", 0, 10);
  await first.store.keptBlocksSettled();

  const next = store(all, {}, {}, { directory: first.directory, keptBlockBytes: 90 * 1024 });
  await read(next.store, "startup.rho", 0, 10);
  await read(next.store, "other.rho", 0, 10); // a third run of 32 KiB: over the limit
  await next.store.keptBlocksSettled();
  assert.deepEqual(next.requests, ["other.rho bytes=0-32767"]);
  assert.deepEqual([...keptRuns(first.directory)].map(name => name.split(".")[0]).sort(), ["other", "startup"]);
});

test("a whole download short of space frees the kept blocks first", async () => {
  const containers = { "big.rho": content(4 * MiB, 4), "whole.rho": content(2 * MiB, 5) };
  const directory = memoryDirectory();
  const used = (folder: MemoryDirectory): number => [...folder.files.values()].reduce((sum, bytes) => sum + bytes.length, 0) +
    [...folder.directories.values()].reduce((sum, child) => sum + used(child), 0);
  const { fetcher } = server(containers);
  const instance = new ContainerStore({
    manifest: { version: "p3553", revision: "r1", files: Object.entries(containers).map(([name, bytes]) =>
      ({ name, size: bytes.length, mtimeMs: 0, sha256: "" })) } as never,
    storage: { getDirectory: async () => revisionRoot(directory),
      estimate: async () => ({ quota: 2 * MiB + 16 * 1024, usage: used(directory) }) },
    fetcher: fetcher as never,
  });
  await read(instance, "big.rho", 0, 10);
  await instance.keptBlocksSettled();
  assert.equal([...keptRuns(directory)].length, 1);
  await instance.ensure("whole.rho");
  assert.deepEqual([...keptRuns(directory)], []);
  assert.equal(directory.files.get("whole.rho")?.length, 2 * MiB);
});
