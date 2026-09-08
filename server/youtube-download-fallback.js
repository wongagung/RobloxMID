import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(process.cwd());
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(ROOT, "uploads"));
const COOKIES_PATH = path.join(ROOT, "cookies.txt");
const PAGE_SIZE_MAX = 50;
const DEFAULT_PAGE_SIZE = 50;
const YTDLP_TIMEOUT = Number(process.env.YTDLP_DOWNLOAD_TIMEOUT_MS || 10 * 60 * 1000);
const YTDLP_INFO_TIMEOUT = Number(process.env.YTDLP_INFO_TIMEOUT_MS || 45_000);
const MAX_BYTES = Number(process.env.MAX_FILE_SIZE_MB || 20) * 1024 * 1024;

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

function cookiesArgs() {
  try {
    return fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size
      ? ["--cookies", COOKIES_PATH]
      : [];
  } catch { return []; }
}

function baseFlags({ playlist = false } = {}) {
  return [
    "--js-runtimes", `node:${process.execPath}`,
    "--remote-components", "ejs:github",
    playlist ? "--yes-playlist" : "--no-playlist",
    "--no-warnings",
    "--ignore-errors",
    "--retries", "3",
    "--fragment-retries", "3",
    "--extractor-retries", "3",
    "--socket-timeout", "30",
    ...cookiesArgs(),
  ];
}

function normalizeEntryUrl(info, sourceUrl) {
  const host = (() => { try { return new URL(sourceUrl).hostname.toLowerCase(); } catch { return ""; } })();
  const id = String(info?.id || "").trim();
  if (id && (host.includes("youtube.com") || host.includes("youtu.be") || String(info?.ie_key || "").toLowerCase() === "youtube")) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }
  return info?.webpage_url || info?.original_url || info?.url || sourceUrl;
}

function classify(error) {
  const s = String(error?.stderr || error?.message || error || "");
  const l = s.toLowerCase();
  if (l.includes("sign in") || l.includes("captcha") || l.includes("not a bot") || l.includes("cookies") || l.includes("login required")) {
    return { code: "AUTH_REQUIRED", message: "YouTube meminta login/verifikasi. Upload cookies.txt terbaru lalu coba lagi." };
  }
  if (l.includes("private video") || l.includes("video is private")) return { code: "PRIVATE", message: "Video tersebut bersifat private." };
  if (l.includes("video unavailable") || l.includes("content isn't available") || l.includes("content isn’t available")) return { code: "UNAVAILABLE", message: "Video tidak tersedia atau dibatasi oleh YouTube." };
  if (l.includes("http error 403") || l.includes("403: forbidden")) return { code: "HTTP_403", message: "YouTube menolak stream audio (HTTP 403)." };
  if (l.includes("http error 429") || l.includes("too many requests")) return { code: "HTTP_429", message: "YouTube membatasi request server. Coba lagi beberapa saat lagi." };
  if (l.includes("unsupported url") || l.includes("no suitable extractor")) return { code: "UNSUPPORTED_URL", message: "URL tidak didukung oleh yt-dlp." };
  return { code: "DOWNLOAD_FAILED", message: "Gagal mendownload audio dari URL tersebut." };
}

async function ensureYtDlp() {
  try { await execFileAsync("yt-dlp", ["--version"], { timeout: 5000 }); }
  catch { const e = new Error("yt-dlp tidak tersedia di server."); e.code = "YTDLP_MISSING"; throw e; }
}

async function runDownload(url, outputTemplate, onProgress) {
  await ensureYtDlp();
  const profiles = [
    [],
    ["--extractor-args", "youtube:player_client=tv,web_safari"],
    ["--extractor-args", "youtube:player_client=web_embedded"],
    ["--extractor-args", "youtube:player_client=mweb,default"],
  ];
  let lastError = null;

  for (const profile of profiles) {
    try {
      await new Promise((resolve, reject) => {
        const args = [
          ...baseFlags(),
          ...profile,
          "-f", "bestaudio/best",
          "-x",
          "--audio-format", "mp3",
          "--audio-quality", "192K",
          "--max-filesize", `${Math.max(1, Math.floor(MAX_BYTES / 1024 / 1024))}M`,
          "--newline",
          "--progress",
          "-o", outputTemplate,
          url,
        ];
        const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
        let stderr = "";
        const started = Date.now();
        let settled = false;
        const finish = error => { if (settled) return; settled = true; error ? reject(error) : resolve(); };
        proc.stdout.on("data", chunk => {
          for (const line of chunk.toString().split("\n")) {
            const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
            if (m && onProgress) onProgress(Number(m[1]));
          }
        });
        proc.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
        proc.on("error", finish);
        proc.on("close", code => code === 0 ? finish() : finish(Object.assign(new Error(stderr || `yt-dlp exit ${code}`), { stderr })));
        const timer = setInterval(() => {
          if (Date.now() - started > YTDLP_TIMEOUT) {
            proc.kill("SIGTERM");
            setTimeout(() => proc.kill("SIGKILL"), 4000).unref();
            const e = Object.assign(new Error("Download timeout."), { code: "TIMEOUT", stderr });
            finish(e);
          }
        }, 1000);
        timer.unref();
        proc.once("close", () => clearInterval(timer));
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("yt-dlp gagal.");
}

function findOutput(prefix) {
  try {
    return fs.readdirSync(UPLOADS_DIR)
      .filter(name => name.startsWith(prefix))
      .map(name => path.join(UPLOADS_DIR, name))
      .filter(p => { try { return fs.statSync(p).isFile(); } catch { return false; } })
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch { return null; }
}

function safeUnlink(file) { try { if (file) fs.unlinkSync(file); } catch {} }

async function playlistPage(url, page, pageSize, maxItems) {
  await ensureYtDlp();
  const start = (page - 1) * pageSize + 1;
  if (maxItems > 0 && start > maxItems) return { items: [], hasNext: false, page, pageSize, maxItems, playlistTitle: null };
  const wantedEnd = maxItems > 0 ? Math.min(maxItems, start + pageSize - 1) : start + pageSize - 1;
  const probeEnd = maxItems > 0 && wantedEnd >= maxItems ? wantedEnd : wantedEnd + 1;
  const args = [
    ...baseFlags({ playlist: true }),
    "--flat-playlist",
    "--playlist-start", String(start),
    "--playlist-end", String(probeEnd),
    "--dump-json",
    url,
  ];
  const { stdout } = await execFileAsync("yt-dlp", args, { timeout: 90_000, maxBuffer: 30 * 1024 * 1024 });
  const rawItems = String(stdout || "").split("\n").filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const items = rawItems.slice(0, pageSize).map(info => ({
    id: String(info.id || crypto.createHash("sha1").update(JSON.stringify(info)).digest("hex").slice(0, 16)),
    title: String(info.title || info.fulltitle || "Unknown").slice(0, 100),
    duration: Number(info.duration || 0),
    duration_string: info.duration_string || "",
    thumbnail: info.thumbnail || null,
    uploader: info.uploader || info.channel || "",
    webpage_url: normalizeEntryUrl(info, url),
    playlist_title: info.playlist_title || info.playlist || null,
  }));
  const playlistTitle = rawItems.find(x => x.playlist_title || x.playlist)?.playlist_title || rawItems.find(x => x.playlist_title || x.playlist)?.playlist || null;
  const hasExtraProbeItem = rawItems.length > items.length;
  const hasNext = Boolean(items.length) && hasExtraProbeItem && (maxItems === 0 || wantedEnd < maxItems);
  return { items, hasNext, page, pageSize, maxItems, playlistTitle };
}

export function mountYtDownloadFallback(router) {
  router.post("/api/playlist-info", async (req, res) => {
    const url = String(req.body?.url || "").trim();
    if (!isHttpUrl(url)) return res.status(400).json({ error: "Hanya URL http/https yang didukung." });
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(10, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));
    const rawMax = Number(req.query.maxItems ?? 100);
    const maxItems = rawMax === 0 ? 0 : ([100, 500].includes(rawMax) ? rawMax : 100);
    try {
      const result = await playlistPage(url, page, pageSize, maxItems);
      if (!result.items.length) return res.status(404).json({ error: "Tidak ada track ditemukan di playlist ini." });
      const isPlaylist = Boolean(result.playlistTitle) || result.hasNext || page > 1;
      if (!isPlaylist && result.items.length === 1) {
        return res.json({ isPlaylist: false, playlistTitle: null, total: 1, limited: false, items: result.items });
      }
      res.json({ ...result, isPlaylist: true, total: result.items.length, totalLoaded: result.items.length, limited: false });
    } catch (error) {
      const c = classify(error);
      res.status(c.code === "AUTH_REQUIRED" ? 403 : 502).json({ error: c.message, code: c.code });
    }
  });

  router.get("/api/fetch-url-stream", async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!isHttpUrl(url)) return res.status(400).end();
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    let closed = false;
    req.on("close", () => { closed = true; });
    const send = (event, data) => { if (!closed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const prefix = `${Date.now()}-${crypto.randomUUID()}`;
    const template = path.join(UPLOADS_DIR, `${prefix}.%(ext)s`);
    let output = null;
    try {
      let title = "Track";
      try {
        const u = new URL(url);
        const base = path.basename(u.pathname);
        title = path.basename(base, path.extname(base)).replace(/[-_]+/g, " ").slice(0, 50) || title;
      } catch {}
      send("progress", { step: "info", message: "Menyiapkan download...", percent: 0 });
      await runDownload(url, template, percent => send("progress", { step: "download", message: `Mendownload audio... ${Math.round(percent)}%`, percent: Math.round(percent) }));
      output = findOutput(prefix);
      if (!output || !fs.existsSync(output)) throw new Error("File output tidak ditemukan.");
      const stat = fs.statSync(output);
      if (!stat.size) throw new Error("File hasil download kosong.");
      if (stat.size > MAX_BYTES) { const e = new Error(`File terlalu besar. Maksimal ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`); e.code = "TOO_LARGE"; throw e; }
      if (closed) return safeUnlink(output);
      send("progress", { step: "done", message: "✓ Download selesai — memuat ke editor...", percent: 100 });
      const data = fs.readFileSync(output).toString("base64");
      safeUnlink(output); output = null;
      send("file", { title, data, mimeType: "audio/mpeg" });
      res.end();
    } catch (error) {
      safeUnlink(output);
      const c = error?.code === "TOO_LARGE" ? { code: error.code, message: error.message } : classify(error);
      send("error", { message: c.message, code: c.code, cookiesExpired: c.code === "AUTH_REQUIRED" });
      if (!res.writableEnded) res.end();
    }
  });
}
