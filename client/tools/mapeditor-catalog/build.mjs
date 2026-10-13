#!/usr/bin/env node
/**
 * 生成地图工坊素材栏的目录和缩略图（src/mapeditor/catalog/）：
 *
 *   1. select.mts 从全部官方赛道挑出物件、贴图、天空（Node，约 3 分钟）；
 *   2. 无头 Chrome 打开开发服务器上的 render.html，用游戏装配画缩略图；
 *   3. 写出 catalog.json、sheet-N.webp 和引用雪碧图的 sheets.ts。
 *
 * 用法（先 npm run dev，或 run-full-local.sh 起好的 Vite）：
 *   node tools/mapeditor-catalog/build.mjs --origin http://127.0.0.1:8780 \
 *     [--cdp http://127.0.0.1:9222] [--candidates 已有的 candidates.json]
 * 不给 --cdp 时自己启动无头 Chrome（CHROME 环境变量可指定可执行文件）。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const client = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const origin = args.get("origin") ?? "http://127.0.0.1:8780";
// --out 换个目录、--limit 只画前 N 个：调试缩略图时用
const outDir = path.resolve(args.get("out") ?? path.join(client, "src/mapeditor/catalog"));
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- 1. 挑选

let candidatesFile = args.get("candidates");
if (!candidatesFile) {
  candidatesFile = path.join(mkdtempSync(path.join(tmpdir(), "mapeditor-catalog-")), "candidates.json");
  console.log("挑选素材…");
  const result = spawnSync(process.execPath, ["--import", "./src/physics/node-raw-test-hook.mjs", "--import", "tsx",
    "tools/mapeditor-catalog/select.mts", candidatesFile], { cwd: client, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const candidates = JSON.parse(readFileSync(candidatesFile, "utf8"));

// 同一条赛道的任务放在一起，模型只解一次
const jobs = [
  ...candidates.pieces.map(piece => ({ kind: "piece", track: piece.track, path: piece.path, min: piece.min, max: piece.max, source: piece })),
  ...candidates.surfaces.map(surface => ({ kind: surface.kind, track: surface.track, name: surface.name, source: surface })),
  ...candidates.skies.map(sky => ({ kind: "sky", track: sky.track, source: sky })),
].sort((a, b) => a.track.localeCompare(b.track)).slice(0, Number(args.get("limit") ?? Infinity));

// ---------------------------------------------------------------- 2. 渲染

async function devtools() {
  if (args.get("cdp")) return { endpoint: args.get("cdp"), close() {} };
  const chrome = process.env.CHROME ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome",
    "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
  if (!chrome) throw new Error("找不到 Chrome，用 CHROME=… 指定，或 --cdp 连已有的。");
  const profile = mkdtempSync(path.join(tmpdir(), "mapeditor-chrome-"));
  const child = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--enable-unsafe-swiftshader", "--window-size=400,400", "about:blank"], { stdio: "ignore" });
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise(resolve => setTimeout(resolve, 100));
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  return { endpoint: `http://127.0.0.1:${port}`, close() { child.kill(); rmSync(profile, { recursive: true, force: true }); } };
}

const browser = await devtools();
const target = await (await fetch(`${browser.endpoint}/json/new?${origin}/tools/mapeditor-catalog/render.html`, { method: "PUT" })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
};
const send = (method, params = {}) => new Promise(resolve => {
  const id = ++nextId;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 800));
  return reply.result?.result?.value;
};

console.log(`渲染 ${jobs.length} 张缩略图…`);
for (let i = 0; i < 600; i++) {
  if (await evaluate("typeof window.__catalog === 'object'").catch(() => false)) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
await evaluate("window.__catalog.ready");
await evaluate(`window.__result = undefined; window.__catalog.render(${JSON.stringify(jobs.map(({ source: _source, ...job }) => job))})
  .then(result => { window.__result = result; }, error => { window.__result = { error: String(error) }; }); 0`);
let output;
for (;;) {
  await new Promise(resolve => setTimeout(resolve, 3000));
  output = await evaluate("window.__result");
  if (output) break;
  process.stdout.write(`\r${(await evaluate("window.__catalog.status()")).slice(0, 100).padEnd(100)}`);
}
process.stdout.write("\n");
socket.close();
await fetch(`${browser.endpoint}/json/close/${target.id}`).catch(() => undefined);
browser.close();
if (output.error) throw new Error(output.error);

// ---------------------------------------------------------------- 3. 写出

const THEME_ORDER = ["village", "forest", "desert", "ice", "tomb", "mine", "pirate", "factory", "castle", "china", "beach",
  "northeu", "fairy", "moonhill", "gold", "nymph", "mechanic", "camelot", "olympos", "god", "abyss", "jurassic", "nemo",
  "sword", "korea", "mabi", "maple", "fengshen", "steam", "park", "brodi", "wkc", "world", "xyy", "transFormer"];
const themeRank = theme => { const index = THEME_ORDER.indexOf(theme); return index < 0 ? THEME_ORDER.length : index; };

const pieces = [], textures = [], skies = [];
const failures = [];
jobs.forEach((job, index) => {
  const cell = output.cells[index];
  if (cell.slot < 0) { failures.push(`${job.kind} ${job.track} ${job.name ?? job.path.join(".")}: ${cell.error ?? `空白 ${cell.coverage}`}`); return; }
  const source = job.source;
  if (job.kind === "piece") {
    pieces.push({ id: `${source.track}:${source.path.join(".")}`, category: source.category, theme: source.theme, label: source.label,
      slot: cell.slot, track: source.track, path: source.path, origin: source.origin, min: source.min, max: source.max, uses: source.uses });
  } else if (job.kind === "sky") {
    skies.push({ id: `sky:${source.track}`, theme: source.theme, label: source.title, slot: cell.slot, track: source.track });
  } else {
    textures.push({ id: `${source.kind}:${source.track}:${source.name}`, kind: source.kind, theme: source.theme, slot: cell.slot,
      track: source.track, name: source.name, ...(source.road ? { road: source.road } : {}), ...(source.alpha ? { alpha: source.alpha } : {}),
      uses: source.uses, triangles: source.triangles });
  }
});

// 同主题同名的物件编上号：树 1、树 2…
pieces.sort((a, b) => themeRank(a.theme) - themeRank(b.theme) || a.category.localeCompare(b.category) || b.uses - a.uses);
const sameName = new Map();
for (const piece of pieces) {
  const key = `${piece.theme}|${piece.label}`;
  sameName.set(key, (sameName.get(key) ?? 0) + 1);
}
const numbered = new Map();
for (const piece of pieces) {
  const key = `${piece.theme}|${piece.label}`;
  if (sameName.get(key) > 1) {
    const n = (numbered.get(key) ?? 0) + 1;
    numbered.set(key, n);
    piece.label = `${piece.label} ${n}`;
  }
  delete piece.uses;
}
textures.sort((a, b) => themeRank(a.theme) - themeRank(b.theme) || a.kind.localeCompare(b.kind));
skies.sort((a, b) => themeRank(a.theme) - themeRank(b.theme));

// 主题套装：每个主题的天空、路面、护栏、地面各取第一名
const presets = [];
for (const theme of [...new Set([...pieces, ...skies].map(item => item.theme))].sort((a, b) => themeRank(a) - themeRank(b))) {
  const pick = kind => textures.filter(texture => texture.theme === theme && texture.kind === kind)
    .sort((a, b) => kind === "surface" ? b.triangles - a.triangles : b.uses - a.uses)[0]?.id;
  const sky = skies.find(item => item.theme === theme)?.id;
  const surface = pick("surface"), wall = pick("wall"), ground = pick("ground");
  if (sky && surface) presets.push({ theme, sky, surface, wall, ground });
}
for (const texture of textures) { delete texture.uses; delete texture.triangles; }

for (const name of readdirSync(outDir, { withFileTypes: true }).map(entry => entry.name)) {
  if (/^sheet-\d+\.webp$/.test(name)) unlinkSync(path.join(outDir, name));
}
output.sheets.forEach((url, index) => {
  writeFileSync(path.join(outDir, `sheet-${index}.webp`), Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
});
writeFileSync(path.join(outDir, "sheets.ts"), [
  "// 由 tools/mapeditor-catalog/build.mjs 生成，不要手改。",
  "export const SHEETS: string[] = [",
  ...output.sheets.map((_, index) => `  new URL("./sheet-${index}.webp", import.meta.url).href,`),
  "];",
  "",
].join("\n"));
writeFileSync(path.join(outDir, "catalog.json"), JSON.stringify({ version: 1, cell: 96, columns: 16, rows: 16, pieces, textures, skies, presets }));
console.log(`物件 ${pieces.length}，贴图 ${textures.length}，天空 ${skies.length}，主题套装 ${presets.length}，雪碧图 ${output.sheets.length} 张`);
if (failures.length) console.log(`没画出来的 ${failures.length} 个（已跳过）：\n  ${failures.slice(0, 40).join("\n  ")}`);
