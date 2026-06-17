// api/scrape.js — Vercel Serverless Function
// Runs on Node.js (server-side), no CORS issue

const https = require("https");
const http  = require("http");
const { URL } = require("url");
const path  = require("path");
const zlib  = require("zlib");

// ── fetch dengan redirect follow ──────────────────────────────
function fetchUrl(rawUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects"));
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return reject(new Error("URL tidak valid")); }

    const lib = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WebScraper/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
      },
    };

    const req = lib.request(options, (res) => {
      // redirect
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = new URL(res.headers.location, rawUrl).href;
        return fetchUrl(next, redirects + 1).then(resolve).catch(reject);
      }

      const chunks = [];
      const encoding = res.headers["content-encoding"] || "";
      let stream = res;

      if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());

      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
        });
      });
      stream.on("error", reject);
    });

    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    req.on("error", reject);
    req.end();
  });
}

// ── resolve URL relatif ────────────────────────────────────────
function resolveUrl(base, rel) {
  try { return new URL(rel, base).href; } catch { return null; }
}

// ── ekstensi file ──────────────────────────────────────────────
function getExt(url, ct = "") {
  try {
    const p = new URL(url).pathname;
    const e = p.split(".").pop().split("?")[0].toLowerCase().replace(/[^a-z0-9]/, "");
    if (e && e.length <= 5) return "." + e;
  } catch {}
  if (ct.includes("css")) return ".css";
  if (ct.includes("javascript")) return ".js";
  if (ct.includes("png")) return ".png";
  if (ct.includes("jpeg")) return ".jpg";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("svg")) return ".svg";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("woff2")) return ".woff2";
  if (ct.includes("woff")) return ".woff";
  if (ct.includes("ttf")) return ".ttf";
  return ".bin";
}

// ── folder berdasar content-type ───────────────────────────────
function getFolder(ct, ext) {
  if (ct.includes("css") || ext === ".css") return "assets/css";
  if (ct.includes("javascript") || ext === ".js") return "assets/js";
  if (ct.includes("image") || [".jpg",".jpeg",".png",".gif",".svg",".webp",".ico"].includes(ext)) return "assets/img";
  if ([".woff",".woff2",".ttf",".otf",".eot"].includes(ext)) return "assets/fonts";
  return "assets/misc";
}

// ── parse aset dari HTML ───────────────────────────────────────
function extractAssets(html, baseUrl, opts) {
  const assets = new Set();
  const patterns = [];

  if (opts.css) {
    patterns.push(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi);
    patterns.push(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi);
    const cssInlineMatches = html.matchAll(/url\(['"]?([^'")\s]+\.(css|woff2?|ttf|otf))['"]?\)/gi);
    for (const m of cssInlineMatches) { const r = resolveUrl(baseUrl, m[1]); if (r) assets.add(r); }
  }
  if (opts.js) {
    patterns.push(/<script[^>]+src=["']([^"']+)["']/gi);
  }
  if (opts.img) {
    patterns.push(/<img[^>]+src=["']([^"']+)["']/gi);
    patterns.push(/<img[^>]+data-src=["']([^"']+)["']/gi);
    patterns.push(/<source[^>]+srcset=["']([^"']+)["']/gi);
    patterns.push(/<link[^>]+rel=["'](icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/gi);
    const bgMatches = html.matchAll(/url\(['"]?([^'")\s]+\.(png|jpg|jpeg|gif|svg|webp|ico))['"]?\)/gi);
    for (const m of bgMatches) { const r = resolveUrl(baseUrl, m[1]); if (r) assets.add(r); }
  }
  if (opts.font) {
    patterns.push(/<link[^>]+rel=["']preload["'][^>]*as=["']font["'][^>]*href=["']([^"']+)["']/gi);
    const fontMatches = html.matchAll(/url\(['"]?([^'")\s]+\.(woff2?|ttf|otf|eot))['"]?\)/gi);
    for (const m of fontMatches) { const r = resolveUrl(baseUrl, m[1]); if (r) assets.add(r); }
  }

  for (const rx of patterns) {
    for (const m of html.matchAll(rx)) {
      const href = m[2] || m[1];
      if (href && !href.startsWith("data:") && !href.startsWith("javascript:")) {
        const r = resolveUrl(baseUrl, href);
        if (r) assets.add(r);
      }
    }
  }

  return [...assets];
}

// ── tambahan: ambil CSS lalu ekstrak font/image dari dalamnya ──
async function extractFromCss(cssText, cssUrl) {
  const extra = new Set();
  for (const m of cssText.matchAll(/url\(['"]?([^'")\s]+)['"]?\)/gi)) {
    const r = resolveUrl(cssUrl, m[1]);
    if (r && !r.startsWith("data:")) extra.add(r);
  }
  return [...extra];
}

// ══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  // CORS header agar bisa dipanggil dari frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = "";
  for await (const chunk of req) body += chunk;
  const { url, options: opts = {} } = JSON.parse(body || "{}");

  if (!url) return res.status(400).json({ error: "URL diperlukan" });

  const doHtml  = opts.html  !== false;
  const doCss   = opts.css   !== false;
  const doJs    = opts.js    !== false;
  const doImg   = opts.img   !== false;
  const doFont  = opts.font  || false;

  const log = [];
  const assetMap = {};
  // files: { path: string, data: Buffer }[]
  const files = [];
  let ok = 0, fail = 0;

  // 1. Ambil HTML utama
  log.push({ type: "info", msg: `Mengambil HTML: ${url}` });
  let htmlText = "";
  try {
    const r = await fetchUrl(url);
    htmlText = r.buffer.toString("utf-8");
    log.push({ type: "ok", msg: `HTML berhasil (${(r.buffer.length / 1024).toFixed(1)} KB)` });
  } catch (e) {
    log.push({ type: "err", msg: `Gagal ambil HTML: ${e.message}` });
    return res.status(200).json({ success: false, log, error: e.message });
  }

  // 2. Ekstrak aset
  const assetUrls = extractAssets(htmlText, url, { css: doCss, js: doJs, img: doImg, font: doFont });
  log.push({ type: "info", msg: `Ditemukan ${assetUrls.length} aset` });

  // 3. Download aset
  let cssTexts = []; // untuk ekstrak nested asset
  let idx = 0;
  for (const assetUrl of assetUrls) {
    idx++;
    try {
      const r = await fetchUrl(assetUrl);
      const ct = r.headers["content-type"] || "";
      const ext = getExt(assetUrl, ct);
      const folder = getFolder(ct, ext);
      const fname = `${folder}/asset_${idx}${ext}`;
      assetMap[assetUrl] = fname;
      files.push({ path: fname, data: r.buffer.toString("base64"), encoding: "base64" });
      ok++;
      log.push({ type: "ok", msg: `[${ok}] ${path.basename(assetUrl).substring(0,40)} → ${fname}` });
      // simpan CSS untuk nested parsing
      if (ct.includes("css") || ext === ".css") cssTexts.push({ text: r.buffer.toString("utf-8"), url: assetUrl });
    } catch {
      fail++;
      log.push({ type: "warn", msg: `Lewati: ${assetUrl.substring(0,60)}` });
    }
  }

  // 4. Nested aset dari CSS (font, bg-image)
  if (doFont || doImg) {
    for (const { text, url: cssUrl } of cssTexts) {
      const extra = await extractFromCss(text, cssUrl);
      for (const eu of extra) {
        if (assetMap[eu]) continue;
        try {
          const r = await fetchUrl(eu);
          const ct = r.headers["content-type"] || "";
          const ext = getExt(eu, ct);
          const folder = getFolder(ct, ext);
          idx++;
          const fname = `${folder}/nested_${idx}${ext}`;
          assetMap[eu] = fname;
          files.push({ path: fname, data: r.buffer.toString("base64"), encoding: "base64" });
          ok++;
          log.push({ type: "ok", msg: `[nested] ${path.basename(eu).substring(0,40)} → ${fname}` });
        } catch {
          fail++;
        }
      }
    }
  }

  // 5. Patch HTML
  let patchedHtml = htmlText;
  if (doHtml) {
    for (const [orig, local] of Object.entries(assetMap)) {
      const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      patchedHtml = patchedHtml.replace(new RegExp(esc, "g"), local);
      try {
        const rel = new URL(orig).pathname + new URL(orig).search;
        if (rel !== orig) {
          const escRel = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          patchedHtml = patchedHtml.replace(new RegExp(escRel, "g"), local);
        }
      } catch {}
    }
    files.push({ path: "index.html", data: Buffer.from(patchedHtml).toString("base64"), encoding: "base64" });
  }

  // 6. info.txt
  const infoTxt = [
    `Source   : ${url}`,
    `Scraped  : ${new Date().toLocaleString("id-ID")}`,
    `Assets OK: ${ok}`,
    `Assets X : ${fail}`,
    "",
    "Files:",
    "  index.html",
    ...Object.values(assetMap).map((f) => "  " + f),
  ].join("\n");
  files.push({ path: "info.txt", data: Buffer.from(infoTxt).toString("base64"), encoding: "base64" });

  log.push({ type: "ok", msg: `Selesai! ${ok} aset OK, ${fail} gagal.` });

  return res.status(200).json({ success: true, log, stats: { ok, fail, fileCount: files.length }, files });
};
