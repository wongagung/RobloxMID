import crypto from "node:crypto";
import express from "express";

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
