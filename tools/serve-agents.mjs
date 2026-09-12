/* Serve the site and api/agent.js locally, the way Vercel would, so a tunnel
   can expose the agents for on-chain tests before the real deployment exists. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const ROOT = new URL("..", import.meta.url).pathname;
const mod = await import(new URL("../api/agent.js", import.meta.url));
const PORT = Number(process.env.PORT || 8797);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".py": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };
createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/agent") {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const shim = { setHeader: (k, v) => res.setHeader(k, v), status(c) { res.statusCode = c; return shim; }, end: (s) => res.end(s) };
    try { await mod.default({ method: req.method, url: req.url, body: raw }, shim); }
    catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message || e) })); }
    return;
  }
  let p = normalize(decodeURIComponent(url.pathname)); if (p === "/") p = "/index.html";
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(PORT, () => console.log(`passport on http://localhost:${PORT}  ·  agents at /api/agent?persona=honest|liar|coy|polyglot|hijacker|embellisher`));
