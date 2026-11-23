// The only way the app writes markup: setHTML(el, html`...`). Every ${} in html`` is escaped, unless it is itself
// html`` (or trusted(), for the app's own constants), so text from a .split.json, a mesh file or an AI provider
// can't become markup (#98). test/html.test.mjs fails on innerHTML or insertAdjacentHTML anywhere else in app/.
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
class Html { constructor(s) { this.s = s; } toString() { return this.s; } }
const part = (v) => v instanceof Html ? v.s : Array.isArray(v) ? v.map(part).join("") : String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
export const html = (strings, ...vals) => new Html(strings.reduce((out, s, i) => out + part(vals[i - 1]) + s));
export const trusted = (s) => new Html(s);
export function setHTML(el, h, where) {
  if (!(h instanceof Html)) throw new TypeError("setHTML takes html`...` from app/html.js");
  if (where) el.insertAdjacentHTML(where, h.s);
  else el.innerHTML = h.s;
}
