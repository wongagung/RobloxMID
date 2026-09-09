import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

// Keep authentication dependency-free for the existing Music Lab application.
if (typeof express.response.cookie !== 'function') {
  express.response.cookie = function cookie(name, value, options = {}) {
    const parts = [`${name}=${encodeURIComponent(String(value))}`];
    if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge / 1000))}`);
    if (options.httpOnly) parts.push('HttpOnly');
    if (options.secure) parts.push('Secure');
    if (options.sameSite) {
      const value = String(options.sameSite).toLowerCase();
      parts.push(`SameSite=${value === 'strict' ? 'Strict' : value === 'none' ? 'None' : 'Lax'}`);
    }
    if (options.path) parts.push(`Path=${options.path}`);
    const current = this.getHeader('Set-Cookie');
    const next = Array.isArray(current) ? current.concat(parts.join('; ')) : current ? [current, parts.join('; ')] : [parts.join('; ')];
    this.setHeader('Set-Cookie', next);
    return this;
  };
}

if (typeof express.response.clearCookie !== 'function') {
  express.response.clearCookie = function clearCookie(name, options = {}) {
    return this.cookie(name, '', { ...options, maxAge: 0 });
  };
}

const safeTiming = crypto.timingSafeEqual.bind(crypto);
crypto.timingSafeEqual = (left, right) => {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right)) return safeTiming(left, right);
  if (left.length !== right.length) return false;
  return safeTiming(left, right);
};

// The two products are one ecosystem. Inject navigation into the existing
// Music Lab HTML without opening a second browser tab.
const originalStatic = express.static.bind(express);
express.static = function ecosystemStatic(root, options) {
  const middleware = originalStatic(root, options);
  const indexPath = path.join(root, 'index.html');
  const stylePath = path.join(root, 'ecosystem.css');

  return (req, res, next) => {
    const isHome = req.method === 'GET' && (req.path === '/' || req.path === '/index.html');
    if (!isHome) return middleware(req, res, next);

    try {
      let html = fs.readFileSync(indexPath, 'utf8');
      if (fs.existsSync(stylePath) && !html.includes('/ecosystem.css')) {
        html = html.replace('</head>', '<link rel="stylesheet" href="/ecosystem.css"></head>');
      }
      if (!html.includes('ecosystem-player-link')) {
        html = html.replace(
          '<div class="top-actions">',
          '<div class="top-actions"><a class="ecosystem-player-link" href="https://asetplayer.duckdns.org/" title="Open WaveDeck"> <span class="ecosystem-icon">▶</span><span>Open WaveDeck</span></a>'
        );
      }
      if (!html.includes('ecosystem-banner')) {
        const marker = '<p class="hero-copy">';
        const start = html.indexOf(marker);
        if (start >= 0) {
          const end = html.indexOf('</p>', start);
          if (end >= 0) {
            const insertAt = end + 4;
            html = html.slice(0, insertAt) + '\n<div class="ecosystem-banner"><div class="ecosystem-banner-copy"><strong>Done uploading?</strong><span>Listen to the new Roblox audio in WaveDeck.</span></div><a class="primary-btn" href="https://asetplayer.duckdns.org/" style="text-decoration:none">Open WaveDeck <span>→</span></a></div>' + html.slice(insertAt);
          }
        }
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', Buffer.byteLength(html));
      return res.end(html);
    } catch {
      return middleware(req, res, next);
    }
  };
};
