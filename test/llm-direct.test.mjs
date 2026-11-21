// Tests app/llm-direct.js (AI naming straight from the browser, used by the hosted app) against the Python
// provider code it ports (server/llm_providers.py). Run: node --test test/llm-direct.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../app/llm-direct.js";

const py = readFileSync(new URL("../server/llm_providers.py", import.meta.url), "utf8");

test("same prompt and providers as server/llm_providers.py", () => {
  assert.equal(D.NAMING_PROMPT, py.match(/NAMING_PROMPT = """([\s\S]*?)"""/)[1]);
  for (const [id, p] of Object.entries(D.PROVIDERS)) {
    const row = py.slice(py.indexOf("PROVIDERS = {")).match(new RegExp(`"${id}": \\{([\\s\\S]*?)\\}`))[1];
    assert.match(row, new RegExp(`"base_url": "${p.base_url}"`), id);
    assert.match(row, new RegExp(`"model": "${p.model}"`), id);
  }
});

function memStorage() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; }
const sse = (events, type = "text/event-stream") => new Response(events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join(""), { headers: { "Content-Type": type } });

test("settings: key kept in storage, never in status", async () => {
  const llm = D.directLLM(memStorage(), () => { throw new Error("no network"); });
  let s = await llm.status();
  assert.equal(s.provider, "openrouter"); assert.equal(s.configured, false);
  s = await llm.saveSettings({ provider: "anthropic", api_key: " sk-x ", model: "claude-haiku-5-5" });
  assert.equal(s.ok, true); assert.equal(s.configured, true); assert.equal(s.has_key, true);
  assert.ok(!JSON.stringify(s).includes("sk-x"));
  s = await llm.saveSettings({ provider: "anthropic", clear_key: true });
  assert.equal(s.has_key, false);
  assert.equal((await llm.saveSettings({ provider: "custom", base_url: "ftp://x" })).ok, false);
  s = await llm.saveSettings({ provider: "custom", base_url: "http://localhost:1234/v1/chat/completions/" });
  assert.equal(s.base_url, "http://localhost:1234/v1"); assert.equal(s.configured, true);
});

test("OpenRouter: streamed answer, headers and payload", async () => {
  let seen;
  const fetchFn = async (url, opt) => {
    seen = { url, opt, payload: JSON.parse(opt.body) };
    return sse([{ model: "m1", choices: [{ delta: { reasoning: "hmm" } }] }, { choices: [{ delta: { content: '```json\n{"object":"robot",' } }] },
      { choices: [{ delta: { content: '"parts":[{"id":1,"name":"head"}]}\n```' }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 7 } }, "[DONE]"]);
  };
  const st = memStorage(), llm = D.directLLM(st, fetchFn);
  await llm.saveSettings({ provider: "openrouter", api_key: "k1", model: "google/gemini-2.5-flash" });
  const stages = [];
  const r = await llm.nameParts({ images: ["data:image/jpeg;base64,AAAA"], captions: ["front"], stats: { n: 1 }, hint: "a robot" }, (m) => stages.push(m.stage), new AbortController().signal);
  assert.equal(r.ok, true, r.error); assert.equal(r.result.parts[0].name, "head"); assert.equal(r.model, "m1"); assert.equal(r.usage.completion_tokens, 7);
  assert.equal(seen.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seen.opt.headers.Authorization, "Bearer k1"); assert.equal(seen.opt.headers["X-Title"], "Mesh Splitter");
  assert.equal(seen.payload.model, "google/gemini-2.5-flash"); assert.deepEqual(seen.payload.response_format, { type: "json_object" });
  assert.equal(seen.payload.messages[1].content[2].image_url.url, "data:image/jpeg;base64,AAAA");
  assert.deepEqual([...new Set(stages)], ["sending", "waiting", "thinking", "writing"]);
});

test("Anthropic: browser-access header, image blocks, streamed events", async () => {
  let seen;
  const fetchFn = async (url, opt) => {
    seen = { url, opt, payload: JSON.parse(opt.body) };
    return sse([{ type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 9 } } },
      { type: "content_block_delta", delta: { type: "text_delta", text: '{"parts":[]}' } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }]);
  };
  const llm = D.directLLM(memStorage(), fetchFn);
  await llm.saveSettings({ provider: "anthropic", api_key: "ak", model: "claude-opus-5-5" });
  const r = await llm.nameParts({ images: ["data:image/png;base64,QUJD"] }, () => {}, new AbortController().signal);
  assert.equal(r.ok, true, r.error); assert.deepEqual(r.usage, { prompt_tokens: 9, completion_tokens: 3 });
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen.opt.headers["anthropic-dangerous-direct-browser-access"], "true"); assert.equal(seen.opt.headers["x-api-key"], "ak");
  assert.deepEqual(seen.payload.messages[0].content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
});

test("errors: HTTP error, unreachable, cancel, non-JSON answer", async () => {
  const st = memStorage();
  const run = async (fetchFn, ac = new AbortController()) => {
    const llm = D.directLLM(st, fetchFn);
    await llm.saveSettings({ provider: "openai", api_key: "k", model: "gpt-5-mini" });
    return llm.nameParts({}, () => {}, ac.signal);
  };
  assert.match((await run(async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }))).error, /OpenAI HTTP 401: bad key/);
  assert.match((await run(async () => { throw new TypeError("Failed to fetch"); })).error, /Can't reach OpenAI/);
  const ac = new AbortController();
  const r = await run((url, opt) => new Promise((_, rej) => { opt.signal.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))); ac.abort(); }), ac);
  assert.equal(r.cancelled, true);
  const nj = await run(async () => new Response(JSON.stringify({ choices: [{ message: { content: "no json here" } }] }), { headers: { "Content-Type": "application/json" } }));
  assert.equal(nj.ok, false); assert.equal(nj.error, "Model did not return JSON");
});

test("connection test: key check, model list, vision warning", async () => {
  const llm = D.directLLM(memStorage(), async (url) => {
    if (url.endsWith("/key")) return Response.json({ data: {} });
    return Response.json({ data: [{ id: "a/text", architecture: { input_modalities: ["text"] } }, { id: "b/vision", architecture: { input_modalities: ["text", "image"] } }] });
  });
  await llm.saveSettings({ provider: "openrouter", api_key: "k", model: "a/text" });
  let t = await llm.test();
  assert.equal(t.ok, true); assert.deepEqual(t.models, ["a/text", "b/vision"]); assert.match(t.warning, /does not take pictures/);
  await llm.saveSettings({ provider: "openrouter", model: "b/vision" });
  t = await llm.test(); assert.equal(t.warning, undefined);
  const bad = D.directLLM(memStorage(), async () => new Response("no", { status: 401 }));
  await bad.saveSettings({ provider: "openai", api_key: "k" });
  assert.match((await bad.test()).error, /rejected the API key/);
});
