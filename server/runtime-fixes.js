import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";

// Express does not provide res.cookie()/res.clearCookie() by itself.
// Keep the existing password-auth flow dependency-free.
if (typeof express.response.cookie !== "function") {
  express.response.cookie = function cookie(name, value, options = {}) {
    const parts = [`${name}=${encodeURIComponent(String(value))}`];
    if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge / 1000))}`);
    if (options.httpOnly) parts.push("HttpOnly");
    if (options.secure) parts.push("Secure");
    if (options.sameSite) {
      const sameSite = String(options.sameSite).toLowerCase();
      parts.push(`SameSite=${sameSite === "strict" ? "Strict" : sameSite === "none" ? "None" : "Lax"}`);
    }
    if (options.path) parts.push(`Path=${options.path}`);
    const existing = this.getHeader("Set-Cookie");
    const next = Array.isArray(existing) ? existing.concat(parts.join("; ")) : existing ? [existing, parts.join("; ")] : [parts.join("; ")];
    this.setHeader("Set-Cookie", next);
    return this;
  };
}

if (typeof express.response.clearCookie !== "function") {
  express.response.clearCookie = function clearCookie(name, options = {}) {
    return this.cookie(name, "", { ...options, maxAge: 0 });
  };
}

// crypto.timingSafeEqual throws on unequal buffer lengths. The login endpoint
// compares arbitrary user input with APP_PASSWORD, so normalize safely first.
const originalTimingSafeEqual = crypto.timingSafeEqual.bind(crypto);
crypto.timingSafeEqual = (a, b) => {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) return originalTimingSafeEqual(a, b);
  if (a.length !== b.length) return false;
  return originalTimingSafeEqual(a, b);
};

// Inject the WaveDeck cross-site navigation into the existing Roblox Music Lab
// page at serve time, keeping the uploader HTML source untouched.
const originalStatic = express.static.bind(express);
express.static = function patchedStatic(root, options) {
  const middleware = originalStatic(root, options);
  const indexPath = path.join(root, "index.html");

  return (req, res, next) => {
    const wantsIndex = req.method === "GET" && (req.path === "/" || req.path === "/index.html");
    if (!wantsIndex) return middleware(req, res, next);

    try {
      let html = fs.readFileSync(indexPath, "utf8");
      if (!html.includes('href="/ecosystem.css"')) {
        html = html.replace("<link rel=\"stylesheet\" href=\"/style.css\">", "<link rel=\"stylesheet\" href=\"/style.css\"><link rel=\"stylesheet\" href=\"/ecosystem.css\">");
      }
      if (!html.includes("ecosystem-player-link")) {
        html = html.replace(
          '<div class="top-actions">',
          '<div class="top-actions"><a class="ecosystem-player-link" href="https://asetplayer.duckdns.org/" title="Open WaveDeck Audio Player"><span class="ecosystem-icon">▶</span><span>Open WaveDeck</span></a>'
        );
      }
      if (!html.includes("ecosystem-banner")) {
        html = html.replace(
          '        <p class="hero-copy">Upload once. Preview instantly. Send a copy to Telegram and publish to Roblox Open Cloud from one clean workspace.</p>\n',
          '        <p class="hero-copy">Upload once. Preview instantly. Send a copy to Telegram and publish to Roblox Open Cloud from one clean workspace.</p>\n        <div class="ecosystem-banner"><div class="ecosystem-banner-copy"><strong>Finished uploading?</strong><span>Open WaveDeck to listen to your Roblox audio asset.</span></div><a class="primary-btn" href="https://asetplayer.duckdns.org/" style="text-decoration:none;display:inline-flex;align-items:center;gap:8px">Open player <span>→</span></a></div>\n'
        );
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Length", Buffer.byteLength(html));
      return res.end(html);
    } catch {
      return middleware(req, res, next);
    }
  };
};
