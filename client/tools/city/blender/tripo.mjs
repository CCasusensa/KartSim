// Tripo 3D text-to-model client for KartSim assets. The key comes from
// ~/.config/kartsim/tripo.env (TRIPO_API_KEY, TRIPO_BASE_URL), never from
// the repository. Generated GLBs are kept under design/open-world/tripo/
// (git LFS) with a manifest (prompt, task id, options): a generation is
// not reproducible, so the same id is never regenerated.
//
//   node tools/city/blender/tripo.mjs generate <id> "<prompt>" [--option key=value …]
//   node tools/city/blender/tripo.mjs status <task_id>
//   node tools/city/blender/tripo.mjs list
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const TRIPO_DIR = path.join(clientDir, "..", "design", "open-world", "tripo");

export function tripoConfig() {
  const file = path.join(os.homedir(), ".config", "kartsim", "tripo.env");
  if (!existsSync(file)) throw new Error(`Tripo key file ${file} is missing`);
  const env = Object.fromEntries(readFileSync(file, "utf8").split("\n").filter(l => l && !l.startsWith("#")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  if (!env.TRIPO_API_KEY) throw new Error("TRIPO_API_KEY not set");
  return { key: env.TRIPO_API_KEY, base: env.TRIPO_BASE_URL ?? "https://openapi.tripo3d.ai/v3" };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(config, method, route, body) {
  const response = await fetch(`${config.base}${route}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`${route}: HTTP ${response.status} ${text.slice(0, 300)}`); }
  if (!response.ok || json.code !== 0) throw new Error(`${route}: HTTP ${response.status} code ${json.code} ${json.message ?? json.msg ?? text.slice(0, 300)}`);
  return json.data;
}

/** One sidecar <id>.json per asset (concurrent generators never clobber each other); the manifest is their union. */
export function manifest() {
  const out = {};
  if (!existsSync(TRIPO_DIR)) return out;
  for (const name of readdirSync(TRIPO_DIR).sort()) {
    if (!name.endsWith(".json") || name === "manifest.json") continue;
    try { out[name.slice(0, -5)] = JSON.parse(readFileSync(path.join(TRIPO_DIR, name), "utf8")); } catch {}
  }
  return out;
}
function saveEntry(id, entry) { mkdirSync(TRIPO_DIR, { recursive: true }); writeFileSync(path.join(TRIPO_DIR, `${id}.json`), JSON.stringify(entry, null, 1) + "\n"); }

/** Create a text-to-model task and wait for it; returns the task data (with output urls). */
export async function generateModel(config, { prompt, model = "v3.1-20260211", ...options }, { log = () => {}, pollMs = 3000, timeoutMs = 20 * 60e3 } = {}) {
  // The account allows a few concurrent generations: on 429 wait and retry.
  let created;
  for (let attempt = 0; ; attempt++) {
    try { created = await api(config, "POST", "/generation/text-to-model", { prompt, model, ...options }); break; }
    catch (error) {
      if (!/HTTP 429|exceeded the limit/.test(error.message) || attempt >= 40) throw error;
      log(`rate limited, retrying in 30 s (${attempt + 1})`);
      await sleep(30e3);
    }
  }
  const taskId = created.task_id;
  log(`task ${taskId} created`);
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    const task = await api(config, "GET", `/tasks/${taskId}`);
    const line = `${task.status} ${task.progress ?? 0}%`;
    if (line !== last) { log(line); last = line; }
    if (task.status === "success") return task;
    if (["failed", "cancelled", "banned", "expired", "unknown"].includes(task.status)) throw new Error(`task ${taskId} ${task.status}`);
    await sleep(pollMs);
  }
  throw new Error(`task ${taskId} timed out`);
}

/** Generate (or reuse) the GLB for `id`; returns { file, entry }. */
export async function ensureModel(id, prompt, options = {}, { log = () => {}, force = false } = {}) {
  const m = manifest();
  const file = path.join(TRIPO_DIR, `${id}.glb`);
  if (!force && m[id] && existsSync(file) && m[id].prompt === prompt) return { file, entry: m[id], cached: true };
  const config = tripoConfig();
  const task = await generateModel(config, { prompt, ...options }, { log });
  const url = task.output?.model_url ?? task.output?.pbr_model ?? task.output?.model;
  if (!url) throw new Error(`task ${task.task_id}: no model url in ${JSON.stringify(task.output)}`);
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  mkdirSync(TRIPO_DIR, { recursive: true });
  writeFileSync(file, bytes);
  if (task.output?.rendered_image_url ?? task.output?.rendered_image) {
    try { writeFileSync(path.join(TRIPO_DIR, `${id}.webp`), new Uint8Array(await (await fetch(task.output.rendered_image_url ?? task.output.rendered_image)).arrayBuffer())); } catch {}
  }
  const entry = { prompt, options, taskId: task.task_id, bytes: bytes.length, credits: task.credits_consumed, generatedAt: new Date().toISOString() };
  saveEntry(id, entry);
  return { file, entry, cached: false };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "generate") {
    const [id, prompt] = rest;
    const options = {};
    for (let i = 2; i < rest.length; i++) if (rest[i] === "--option") { const [k, v] = rest[++i].split("="); options[k] = /^\d+$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v; }
    const force = rest.includes("--force");
    const result = await ensureModel(id, prompt, options, { log: line => console.log(`[${id}] ${line}`), force });
    console.log(`${result.cached ? "cached" : "downloaded"} ${result.file} (${result.entry.bytes} bytes)`);
    console.log(JSON.stringify(result.entry.output));
  } else if (command === "status") {
    console.log(JSON.stringify(await api(tripoConfig(), "GET", `/tasks/${rest[0]}`), null, 1));
  } else if (command === "list") {
    for (const [id, e] of Object.entries(manifest())) console.log(`${id}: ${e.bytes} bytes, ${e.taskId}, ${e.prompt.slice(0, 80)}`);
  } else {
    console.log("usage: tripo.mjs generate <id> \"<prompt>\" [--option k=v] | status <task_id> | list");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
