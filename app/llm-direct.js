// AI part naming straight from the browser, for the hosted app (no local server, no plugin).
// A port of server/llm_providers.py: same providers, prompt, request, streaming, limits and error texts.
// Settings and keys are kept in this browser's localStorage and sent only to the provider the user picked.

export const PROVIDERS = {
  openrouter: { label: "OpenRouter", api: "openai", base_url: "https://openrouter.ai/api/v1", needs_key: true, model: "deepseek/deepseek-v4.1-flash" },
  openai: { label: "OpenAI", api: "openai", base_url: "https://api.openai.com/v1", needs_key: true, model: "gpt-5-mini" },
  anthropic: { label: "Anthropic Claude", api: "anthropic", base_url: "https://api.anthropic.com/v1", needs_key: true, model: "claude-opus-5-5" },
  custom: { label: "Custom or local", api: "openai", base_url: "http://localhost:1234/v1", needs_key: false, model: "" },
};
const DEFAULT_PROVIDER = "openrouter";
const MAX_IMAGES = 6;
const LIMITS = { cloud: { first_byte: 90, total: 300 }, local: { first_byte: 300, total: 900 } }; // seconds
const STORE_KEY = "meshsplit:ai";

// Same system prompt as server/llm_providers.py NAMING_PROMPT (test/llm-direct.test.mjs checks they match).
export const NAMING_PROMPT = `You review a 3D mesh that a user split into parts for multi-color / multi-piece 3D printing (FDM).
You get rendered views (each part drawn in its own color, labeled #id) and per-part stats as JSON.
Tasks:
1. Name each part with a short, specific noun phrase (e.g. "left boot", "broom head", "helmet visor"). Use the object's context.
2. Flag obvious segmentation problems: a part that bleeds into a neighbor, one real feature split across parts, stray fragments/islands,
   tiny slivers, faces left Unassigned, or a cut through a thin feature that will be hard to print or glue.
Only flag what the images or stats support. Say which part ids are involved and a concrete fix using the app's tools
(add a seed to part #n and re-segment, Fill, Brush, Merge, Smooth, Auto split active part).
Reply with JSON only, no prose, matching:
{"object": "what the whole model is", "parts": [{"id": 1, "name": "...", "confidence": 0.0-1.0}],
 "issues": [{"severity": "high|medium|low", "parts": [1, 2], "problem": "...", "fix": "..."}], "summary": "one sentence"}`;

// ---------------------------------------------------------------- settings

export function cleanBaseUrl(url) {
  url = String(url ?? "").trim().replace(/\/+$/, "").replace(/\/(chat\/completions|completions|messages|models)$/, "");
  return /^https?:\/\/[^/\s]+/i.test(url) ? url : "";
}

function loadStore(storage) {
  try { const d = JSON.parse(storage.getItem(STORE_KEY) || "{}"); return d && typeof d === "object" ? d : {}; } catch { return {}; }
}
function saveStore(storage, store) { storage.setItem(STORE_KEY, JSON.stringify(store)); }

export function resolve(store) {
  const pid = PROVIDERS[store?.provider] ? store.provider : DEFAULT_PROVIDER, spec = PROVIDERS[pid];
  const saved = store?.providers?.[pid] || {};
  const base = pid === "custom" ? cleanBaseUrl(saved.base_url) : spec.base_url;
  return { provider: pid, label: spec.label, api: spec.api, base_url: base || spec.base_url,
    model: String(saved.model || spec.model).trim(), api_key: String(saved.api_key || "").trim(), key_source: saved.api_key ? "saved" : null };
}

export function status(store) {
  const cfg = resolve(store), spec = PROVIDERS[cfg.provider];
  return { configured: !!cfg.api_key || !spec.needs_key, provider: cfg.provider, label: cfg.label, base_url: cfg.base_url,
    model: cfg.model, has_key: !!cfg.api_key, source: cfg.key_source, needs_key: spec.needs_key, in_browser: true,
    providers: Object.entries(PROVIDERS).map(([id, d]) => ({ id, label: d.label, needs_key: d.needs_key, model: d.model, base_url: d.base_url })) };
}

export function update(store, patch) {
  store = { ...(store || {}) }; patch = patch || {};
  const pid = patch.provider;
  if (!PROVIDERS[pid]) throw new Error(`unknown provider: ${pid}`);
  const providers = { ...(store.providers || {}) }, cur = { ...(providers[pid] || {}) };
  if ("model" in patch) cur.model = String(patch.model || "").trim().slice(0, 200);
  if (pid === "custom" && "base_url" in patch) {
    const url = cleanBaseUrl(patch.base_url);
    if (patch.base_url && !url) throw new Error("Base URL must start with http:// or https://");
    cur.base_url = url;
  }
  if (patch.clear_key) delete cur.api_key;
  else if (String(patch.api_key || "").trim()) cur.api_key = String(patch.api_key).trim();
  providers[pid] = cur; store.provider = pid; store.providers = providers;
  return store;
}

// ---------------------------------------------------------------- request

export function extractJson(text) {
  text = String(text ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) text = m[1].trim();
  try { return JSON.parse(text); }
  catch (e) { const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1)); throw e; }
}

function userParts(body) {
  const images = (body.images || []).filter((i) => typeof i === "string" && i.startsWith("data:image/")).slice(0, MAX_IMAGES);
  const captions = body.captions || [];
  const out = [["text", "Part stats:\n" + JSON.stringify(body.stats || {})]];
  images.forEach((img, i) => { if (i < captions.length) out.push(["text", String(captions[i]).slice(0, 200)]); out.push(["image", img]); });
  const hint = String(body.hint || "").trim();
  if (hint) out.push(["text", "User note: " + hint.slice(0, 500)]);
  return out;
}

export function buildRequest(cfg, body) {
  const model = String(body.model || cfg.model || "").trim();
  const headers = { "Content-Type": "application/json" };
  if (cfg.api === "anthropic") {
    // The Anthropic API only answers a browser page (CORS) with this header; the key is the user's own.
    Object.assign(headers, { "x-api-key": cfg.api_key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
    const content = [];
    for (const [k, v] of userParts(body)) {
      if (k === "text") { content.push({ type: "text", text: v }); continue; }
      const m = v.match(/^data:(image\/[\w.+-]+);base64,([\s\S]*)$/);
      if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    }
    const payload = { model, max_tokens: 16000, system: NAMING_PROMPT, messages: [{ role: "user", content }], output_config: { effort: "low" }, stream: true };
    if (/^claude-(opus-5|sonnet-5-5|fable-5)/.test(model)) { headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; payload.fallbacks = "default"; }
    return [cfg.base_url + "/messages", headers, payload];
  }
  if (cfg.api_key) headers.Authorization = `Bearer ${cfg.api_key}`;
  const content = userParts(body).map(([k, v]) => (k === "text" ? { type: "text", text: v } : { type: "image_url", image_url: { url: v } }));
  const payload = { messages: [{ role: "system", content: NAMING_PROMPT }, { role: "user", content }], stream: true };
  if (model) payload.model = model;
  if (cfg.provider === "openrouter" || cfg.provider === "openai") { payload.response_format = { type: "json_object" }; payload.stream_options = { include_usage: true }; }
  if (cfg.provider === "openrouter") { payload.temperature = 0.2; headers["X-Title"] = "Mesh Splitter"; }
  return [cfg.base_url + "/chat/completions", headers, payload];
}

function errorDetail(raw) {
  try { const j = JSON.parse(raw), e = j?.error; return (e && typeof e === "object" ? e.message : e) || raw; } catch { return raw; }
}
const providerName = (cfg) => (cfg.provider === "custom" ? cfg.base_url : cfg.label);
const mins = (s) => (s >= 120 ? `${Math.floor(s / 60)} min` : `${s} s`);
const limits = (cfg) => LIMITS[cfg.provider === "custom" ? "local" : "cloud"];
// A failed fetch from a page says only "Failed to fetch": name the usual causes.
function unreachable(cfg) {
  return cfg.provider === "custom"
    ? `Can't reach ${cfg.base_url}. Is your model app (LM Studio, Ollama, ...) running, with CORS enabled for this page?`
    : `Can't reach ${cfg.label}. Check your connection, or an ad or privacy blocker.`;
}

// Collects a streamed reply (OpenAI-style chunks or Anthropic Messages events).
class Stream {
  constructor(cfg, progress) { Object.assign(this, { cfg, progress, text: [], reasoning: 0, chars: 0, model: null, usage: null, stop: null, inTokens: null }); }
  tick(stage) { this.progress(stage, { chars: this.chars, reasoning: this.reasoning }); }
  event(d) {
    if (!d || typeof d !== "object") return;
    if (d.error || d.type === "error") { const e = d.error || d; throw new Error(String(typeof e === "object" ? e.message : e).slice(0, 400)); }
    if (this.cfg.api === "anthropic") {
      if (d.type === "message_start") { this.model = d.message?.model; this.inTokens = d.message?.usage?.input_tokens; }
      else if (d.type === "content_block_delta") {
        const dl = d.delta || {};
        if (dl.type === "text_delta") { this.text.push(dl.text || ""); this.chars += (dl.text || "").length; this.tick("writing"); }
        else if (dl.type === "thinking_delta") { this.reasoning += (dl.thinking || "").length; this.tick("thinking"); }
      } else if (d.type === "message_delta") {
        this.stop = d.delta?.stop_reason || this.stop;
        this.usage = { prompt_tokens: this.inTokens, completion_tokens: d.usage?.output_tokens };
      }
      return;
    }
    this.model = d.model || this.model;
    if (d.usage) this.usage = d.usage;
    for (const ch of d.choices || []) {
      const dl = ch.delta || {}, r = dl.reasoning || dl.reasoning_content || "";
      if (r) { this.reasoning += r.length; this.tick("thinking"); }
      if (dl.content) { this.text.push(dl.content); this.chars += dl.content.length; this.tick("writing"); }
      if (ch.finish_reason) this.stop = ch.finish_reason;
    }
  }
}

const TIMEOUT = Symbol("timeout");
// Reads server-sent events. idle(ms) / deadline guard against a stalled or endless stream.
async function readStream(res, st, startedMs, lim, signal) {
  const rd = res.body.getReader(), dec = new TextDecoder();
  let buf = "", data = [], done = false;
  const handle = (line) => {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    else if (!line && data.length) {
      const raw = data.join("\n"); data = [];
      if (raw.trim() === "[DONE]") { done = true; return; }
      try { st.event(JSON.parse(raw)); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
    }
  };
  while (!done) {
    const left = startedMs + lim.total * 1000 - Date.now();
    if (left <= 0) { rd.cancel().catch(() => {}); throw Object.assign(new Error("total"), { [TIMEOUT]: "total" }); }
    let timer;
    const wait = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("idle"), { [TIMEOUT]: "idle" })), Math.min(left, lim.first_byte * 1000)); });
    let r;
    try { r = await Promise.race([rd.read(), wait]); } catch (e) { rd.cancel().catch(() => {}); throw e; } finally { clearTimeout(timer); }
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i;
    while (!done && (i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i).replace(/\r$/, "")); buf = buf.slice(i + 1); }
  }
  if (!done) { if (buf) handle(buf.replace(/\r$/, "")); handle(""); }
}

// One naming request. Same answer shape as the local server: {ok, model, usage, result, seconds} or {ok:false, error}.
export async function call(cfg, body, onProgress = () => {}, signal = new AbortController().signal, fetchFn = fetch) {
  const spec = PROVIDERS[cfg.provider], name = providerName(cfg), lim = limits(cfg);
  const cancelled = { ok: false, cancelled: true, error: "Cancelled" };
  if (spec.needs_key && !cfg.api_key) return { ok: false, error: `No ${cfg.label} API key. Add one in AI settings.` };
  if (cfg.api === "openai" && cfg.provider !== "custom" && !String(body.model || cfg.model).trim()) return { ok: false, error: "Pick a model first." };
  const [url, headers, payload] = buildRequest(cfg, body), data = JSON.stringify(payload);
  const start = Date.now(), st = new Stream(cfg, (stage, info) => onProgress({ stage, ...info }));
  const hint = cfg.provider === "custom" ? " Is your model app (LM Studio, Ollama, ...) running?" : "";
  const ac = new AbortController(); signal.addEventListener("abort", () => ac.abort());
  let text, usage, model, firstByte = setTimeout(() => ac.abort(TIMEOUT), lim.first_byte * 1000);
  try {
    onProgress({ stage: "sending", bytes: data.length });
    const res = await fetchFn(url, { method: "POST", headers, body: data, signal: ac.signal });
    clearTimeout(firstByte);
    onProgress({ stage: "waiting" });
    if (!res.ok) return { ok: false, error: `${name} HTTP ${res.status}: ${String(errorDetail(await res.text())).slice(0, 400)}` };
    if ((res.headers.get("Content-Type") || "").includes("text/event-stream")) {
      await readStream(res, st, start, lim, ac.signal);
      text = st.text.join("");
      if (!text && st.stop == null) return { ok: false, error: `${name} closed the connection before answering. Try again.` };
      if (st.stop === "refusal") return { ok: false, error: `${name}: The model declined this request` };
      ({ usage, model } = st);
    } else {
      const resp = await res.json();
      if (resp?.error) return { ok: false, error: String(typeof resp.error === "object" ? resp.error.message : resp.error).slice(0, 400) };
      if (cfg.api === "anthropic") {
        if (resp.stop_reason === "refusal") throw new Error("The model declined this request");
        text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
        usage = { prompt_tokens: resp.usage?.input_tokens, completion_tokens: resp.usage?.output_tokens };
      } else {
        text = resp?.choices?.[0]?.message?.content ?? null;
        if (text == null) throw new Error("Unexpected response");
        usage = resp.usage;
      }
      model = resp.model;
    }
  } catch (e) {
    clearTimeout(firstByte);
    if (signal.aborted) return cancelled;
    if (e?.[TIMEOUT] === "total") return { ok: false, error: `Stopped after ${mins(lim.total)}: ${name} was still answering. Try again, or pick a faster model.` };
    if (e?.[TIMEOUT] === "idle" && (st.chars || st.reasoning)) return { ok: false, error: `${name} stopped sending for ${mins(lim.first_byte)} mid-answer. Try again.` };
    if (e?.[TIMEOUT] || ac.signal.reason === TIMEOUT) return { ok: false, error: `No answer from ${name} in ${mins(lim.first_byte)}. Try again, or pick another model.${hint}` };
    if (e instanceof TypeError) return { ok: false, error: unreachable(cfg) };
    if (e instanceof SyntaxError) return { ok: false, error: `${name} did not return JSON` };
    return { ok: false, error: `${name}: ${e.message}` };
  }
  if (st.stop === "length" || st.stop === "max_tokens") return { ok: false, error: `${name}: the answer was cut off (too long). Try again.`, raw: text.slice(0, 2000) };
  let result;
  try { result = extractJson(text); } catch { return { ok: false, error: "Model did not return JSON", raw: String(text).slice(0, 2000) }; }
  return { ok: true, model: model || payload.model || "local model", usage, result, seconds: Math.round((Date.now() - start) / 100) / 10 };
}

// Connection test: reaches the provider, checks the key and the model. Sends no model data.
export async function check(cfg, fetchFn = fetch) {
  const name = providerName(cfg), spec = PROVIDERS[cfg.provider];
  if (spec.needs_key && !cfg.api_key) return { ok: false, error: `Paste your ${cfg.label} API key first.`, models: [] };
  const headers = cfg.api === "anthropic"
    ? { "x-api-key": cfg.api_key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
    : cfg.api_key ? { Authorization: `Bearer ${cfg.api_key}` } : {};
  const get = async (path) => {
    const res = await fetchFn(cfg.base_url + path, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw Object.assign(new Error("http"), { status: res.status, body: await res.text().catch(() => "") });
    return res.json();
  };
  let data;
  try {
    if (cfg.provider === "openrouter") await get("/key"); // the model list is public there; this checks the key
    data = await get("/models");
    data = Array.isArray(data?.data) ? data.data : [];
  } catch (e) {
    if (e.status === 401 || e.status === 403) return { ok: false, error: `${name} rejected the API key (HTTP ${e.status}). Check it and save again.`, models: [] };
    if (e.status) return { ok: false, error: `${name} HTTP ${e.status}: ${String(errorDetail(e.body)).slice(0, 300)}`, models: [] };
    return { ok: false, error: unreachable(cfg), models: [] };
  }
  const models = [...new Set(data.filter((m) => m && m.id).map((m) => String(m.id)))].sort().slice(0, 500);
  const vision = new Set(data.filter((m) => (m?.architecture?.input_modalities || []).includes("image")).map((m) => String(m.id)));
  const out = { ok: true, models };
  if (cfg.model && models.length && !models.includes(cfg.model)) out.warning = `${name} does not list the model ${cfg.model}. Check the spelling.`;
  else if (cfg.model && vision.size && !vision.has(cfg.model)) out.warning = `${cfg.model} does not take pictures. Pick a vision model.`;
  return out;
}

// The page's interface, same calls and answers as the local server's /api/llm/* endpoints.
export function directLLM(storage = localStorage, fetchFn = (...a) => fetch(...a)) {
  return {
    status: async () => status(loadStore(storage)),
    saveSettings: async (patch) => {
      try { const s = update(loadStore(storage), patch); saveStore(storage, s); return { ok: true, ...status(s) }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    test: () => check(resolve(loadStore(storage)), fetchFn),
    nameParts: (body, onProgress, signal) => call(resolve(loadStore(storage)), body, onProgress, signal, fetchFn),
  };
}
