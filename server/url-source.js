import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const HTTP_TIMEOUT_MS = Number(process.env.URL_FETCH_TIMEOUT_MS || 120000);
const YTDLP_INFO_TIMEOUT_MS = Number(process.env.YTDLP_INFO_TIMEOUT_MS || 45000);
const YTDLP_DOWNLOAD_TIMEOUT_MS = Number(process.env.YTDLP_DOWNLOAD_TIMEOUT_MS || 10 * 60 * 1000);
const MAX_DURATION_SECONDS = Number(process.env.URL_MAX_DURATION_SECONDS || 1800);
const MAX_BYTES = Number(process.env.MAX_FILE_SIZE_MB || 20) * 1024 * 1024;
const RETRIES = Math.max(0, Number(process.env.URL_FETCH_RETRIES || 2));
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads"));
const ROOT = path.resolve(process.cwd());
const COOKIES_PATH = path.join(ROOT, "cookies.txt");
const DIRECT_MEDIA_EXTS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus", ".webm"]);

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function cleanFilename(value, fallback = "track.mp3") {
  const raw = String(value || "").trim();
  const safe = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return safe || fallback;
}

function isDirectMediaUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return [...DIRECT_MEDIA_EXTS].some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

function getCookiesArgs() {
  try {
    if (fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 0) {
      return ["--cookies", COOKIES_PATH];
    }
  } catch {}
  return [];
}

function baseYtDlpFlags() {
  return [
    "--js-runtimes", `node:${process.execPath}`,
    "--remote-components", "ejs:github",
    "--no-playlist",
    "--no-warnings",
    "--retries", String(Math.max(1, RETRIES + 1)),
    "--fragment-retries", String(Math.max(1, RETRIES + 1)),
    "--socket-timeout", "30",
    "--extractor-retries", String(Math.max(1, RETRIES + 1)),
    ...getCookiesArgs(),
  ];
}

function classifyYtError(message) {
  const msg = String(message || "");
  const lower = msg.toLowerCase();
  const auth = lower.includes("sign in") || lower.includes("login") || lower.includes("cookies") || lower.includes("confirm you’re not a bot") || lower.includes("confirm you're not a bot") || lower.includes("captcha");
  if (auth) return { code: "AUTH_REQUIRED", message: "Sumber meminta login/verifikasi. Upload cookies.txt terbaru jika sumber mendukung cookies." };
  if (lower.includes("unsupported url") || lower.includes("no suitable extractor")) return { code: "UNSUPPORTED_URL", message: "URL tidak didukung oleh yt-dlp atau bukan direct media." };
  if (lower.includes("private video") || lower.includes("this video is private")) return { code: "PRIVATE", message: "Konten bersifat private dan tidak bisa diakses server." };
  if (lower.includes("video unavailable") || lower.includes("content isn’t available") || lower.includes("content isn't available")) return { code: "UNAVAILABLE", message: "Konten tidak tersedia atau dibatasi oleh sumber." };
  if (lower.includes("http error 403") || lower.includes("403: forbidden")) return { code: "HTTP_403", message: "Server sumber menolak akses (HTTP 403)." };
  if (lower.includes("http error 404") || lower.includes("404: not found")) return { code: "HTTP_404", message: "File/URL tidak ditemukan (HTTP 404)." };
  return { code: "DOWNLOAD_FAILED", message: "Gagal mengambil audio dari URL." };
}

async function getYtInfo(url) {
  const { stdout } = await execFileAsync("yt-dlp", [
    ...baseYtDlpFlags(),
    "--dump-single-json",
    "--skip-download",
    url,
  ], {
    timeout: YTDLP_INFO_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  const info = JSON.parse(String(stdout || "").trim());
  return info;
}

async function ensureYtDlp() {
  try {
    const { stdout } = await execFileAsync("yt-dlp", ["--version"], { timeout: 5000 });
    return String(stdout || "").trim();
  } catch {
    const error = new Error("yt-dlp tidak tersedia di server. Install dengan: pip install -U yt-dlp");
    error.code = "YTDLP_MISSING";
    throw error;
  }
}

async function downloadDirectMedia(url, outputPath, onProgress) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    let response;
    let lastError;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        response = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "User-Agent": process.env.URL_FETCH_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
            "Accept": "audio/*,video/*,application/octet-stream;q=0.9,*/*;q=0.8",
          },
        });
        if (response.ok) break;
        lastError = new Error(`HTTP ${response.status}`);
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt >= RETRIES) throw lastError;
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      } catch (error) {
        lastError = error;
        if (attempt >= RETRIES) throw error;
      }
    }

    if (!response?.ok) throw lastError || new Error("HTTP request gagal");

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_BYTES) {
      const error = new Error(`File terlalu besar. Maksimal ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
      error.code = "TOO_LARGE";
      throw error;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html") || contentType.includes("application/json")) {
      const error = new Error(`URL tidak mengembalikan file audio (Content-Type: ${contentType || "unknown"}).`);
      error.code = "NOT_MEDIA";
      throw error;
    }

    const total = declaredLength || 0;
    let received = 0;
    const file = fs.createWriteStream(outputPath, { flags: "wx" });

    try {
      if (!response.body) throw new Error("Response tidak memiliki body.");
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BYTES) {
          const error = new Error(`File terlalu besar. Maksimal ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
          error.code = "TOO_LARGE";
          throw error;
        }
        if (!file.write(Buffer.from(value))) {
          await new Promise((resolve, reject) => {
            file.once("drain", resolve);
            file.once("error", reject);
          });
        }
        if (total > 0 && typeof onProgress === "function") onProgress(Math.min(100, received / total * 100));
      }
      await new Promise((resolve, reject) => {
        file.end(error => error ? reject(error) : resolve());
      });
    } catch (error) {
      file.destroy();
      throw error;
    }

    if (!received) throw new Error("Server mengirim file kosong.");
    return { contentType: contentType || "application/octet-stream", bytes: received };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadWithYtDlp(url, outputTemplate, onProgress) {
  await ensureYtDlp();
  const args = [
    ...baseYtDlpFlags(),
    "-f", "bestaudio/best",
    "--audio-multistreams",
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "192K",
    "--max-filesize", `${Math.max(1, Math.floor(MAX_BYTES / 1024 / 1024))}M`,
    "--newline",
    "--progress",
    "-o", outputTemplate,
    url,
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdoutTail = "";
    const startedAt = Date.now();
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve();
    };

    proc.stdout.on("data", chunk => {
      const text = chunk.toString();
      stdoutTail = (stdoutTail + text).slice(-12000);
      for (const line of text.split("\n")) {
        const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (m && typeof onProgress === "function") onProgress(Number(m[1]));
      }
    });
    proc.stderr.on("data", chunk => { stderr += chunk.toString().slice(-12000); });
    proc.on("error", error => finish(error));
    proc.on("close", code => {
      if (code === 0) return finish();
      const error = new Error(stderr || stdoutTail || `yt-dlp exit code ${code}`);
      error.code = "YTDLP_FAILED";
      finish(error);
    });

    const timeout = setInterval(() => {
      if (Date.now() - startedAt > YTDLP_DOWNLOAD_TIMEOUT_MS) {
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5000).unref();
        const error = new Error("Download timeout.");
        error.code = "TIMEOUT";
        finish(error);
      }
    }, 1000);
    timeout.unref();
    proc.once("close", () => clearInterval(timeout));
  });
}

function firstMatchingFile(prefix) {
  try {
    return fs.readdirSync(UPLOADS_DIR)
      .filter(name => name.startsWith(prefix))
      .map(name => path.join(UPLOADS_DIR, name))
      .filter(file => {
        try { return fs.statSync(file).isFile(); } catch { return false; }
      })
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch {
    return null;
  }
}

function unlinkQuietly(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch {}
}

export function mountUrlSourceRoutes(router) {
  router.post("/api/url-info", async (req, res) => {
    const { url } = req.body || {};
    if (!isHttpUrl(url)) return res.status(400).json({ error: "Hanya URL http/https yang didukung." });
    try {
      await ensureYtDlp();
      const info = await getYtInfo(url);
      res.json({
        title: String(info.title || info.fulltitle || "Unknown").slice(0, 100),
        duration: Number(info.duration || 0),
        duration_string: info.duration_string || "",
        thumbnail: info.thumbnail || null,
        uploader: info.uploader || info.channel || "",
        webpage_url: info.webpage_url || url,
      });
    } catch (error) {
      const classified = classifyYtError(error?.message);
      res.status(classified.code === "AUTH_REQUIRED" ? 403 : 502).json({ error: classified.message, code: classified.code });
    }
  });

  router.post("/api/playlist-info", async (req, res) => {
    const { url } = req.body || {};
    if (!isHttpUrl(url)) return res.status(400).json({ error: "Hanya URL http/https yang didukung." });
    try {
      await ensureYtDlp();
      const { stdout } = await execFileAsync("yt-dlp", [
        ...baseYtDlpFlags(),
        "--flat-playlist",
        "--playlist-end", "50",
        "--dump-json",
        url,
      ], { timeout: 90000, maxBuffer: 20 * 1024 * 1024 });
      const items = String(stdout || "").split("\n").filter(Boolean).map(line => {
        try {
          const info = JSON.parse(line);
          return {
            id: info.id,
            title: String(info.title || info.fulltitle || "Unknown").slice(0, 100),
            duration: Number(info.duration || 0),
            duration_string: info.duration_string || "",
            thumbnail: info.thumbnail || null,
            uploader: info.uploader || info.channel || "",
            webpage_url: info.webpage_url || info.url || url,
            playlist_title: info.playlist_title || info.playlist || null,
          };
        } catch { return null; }
      }).filter(Boolean);
      if (!items.length) return res.status(404).json({ error: "Tidak ada track ditemukan di URL tersebut." });
      res.json({
        isPlaylist: items.length > 1 || Boolean(items[0]?.playlist_title),
        playlistTitle: items[0]?.playlist_title || null,
        total: items.length,
        limited: items.length >= 50,
        items,
      });
    } catch (error) {
      const classified = classifyYtError(error?.message);
      res.status(classified.code === "AUTH_REQUIRED" ? 403 : 502).json({ error: classified.message, code: classified.code });
    }
  });

  router.post("/api/fetch-url", async (req, res) => {
    const { url } = req.body || {};
    if (!isHttpUrl(url)) return res.status(400).json({ error: "Hanya URL http/https yang didukung." });

    const tmpId = `${Date.now()}-${crypto.randomUUID()}`;
    const basePath = path.join(UPLOADS_DIR, `${tmpId}`);
    let downloadedPath = null;

    try {
      let title = "Track";
      let isDirect = isDirectMediaUrl(url);
      let info = null;

      if (!isDirect) {
        await ensureYtDlp();
        info = await getYtInfo(url);
        title = String(info.title || info.fulltitle || "Track").slice(0, 50).trim() || "Track";
        if (Number(info.duration || 0) > MAX_DURATION_SECONDS) {
          return res.status(400).json({ error: `Audio terlalu panjang. Maksimal ${Math.round(MAX_DURATION_SECONDS / 60)} menit.` });
        }
      } else {
        try {
          const pathname = new URL(url).pathname;
          const name = path.basename(pathname) || "track.mp3";
          title = path.basename(name, path.extname(name)).slice(0, 50) || "Track";
        } catch {}
      }

      if (isDirect) {
        downloadedPath = `${basePath}${path.extname(new URL(url).pathname).toLowerCase() || ".bin"}`;
        await downloadDirectMedia(url, downloadedPath);
      } else {
        downloadedPath = `${basePath}.mp3`;
        await downloadWithYtDlp(url, `${basePath}.%(ext)s`);
        downloadedPath = firstMatchingFile(tmpId);
      }

      if (!downloadedPath || !fs.existsSync(downloadedPath)) throw new Error("File output tidak ditemukan setelah download.");
      const stat = fs.statSync(downloadedPath);
      if (!stat.size) throw new Error("File hasil download kosong.");
      if (stat.size > MAX_BYTES) {
        const error = new Error(`File terlalu besar. Maksimal ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
        error.code = "TOO_LARGE";
        throw error;
      }

      const body = fs.createReadStream(downloadedPath);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(cleanFilename(`${title}.mp3`))}"`);
      res.setHeader("X-Track-Title", encodeURIComponent(title));
      res.setHeader("Content-Length", String(stat.size));
      body.on("close", () => unlinkQuietly(downloadedPath));
      body.on("error", () => unlinkQuietly(downloadedPath));
      body.pipe(res);
      downloadedPath = null;
    } catch (error) {
      unlinkQuietly(downloadedPath);
      const classified = error?.code === "TOO_LARGE" || error?.code === "NOT_MEDIA"
        ? { code: error.code, message: error.message }
        : classifyYtError(error?.message);
      const status = classified.code === "AUTH_REQUIRED" ? 403
        : ["UNSUPPORTED_URL", "NOT_MEDIA", "TOO_LARGE"].includes(classified.code) ? 400 : 502;
      console.error("[fetch-url]", error?.stack || error);
      res.status(status).json({ error: classified.message, code: classified.code });
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
    const send = (event, data) => {
      if (closed || res.writableEnded) return;
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { closed = true; }
    };
    req.on("close", () => { closed = true; });

    const tmpId = `${Date.now()}-${crypto.randomUUID()}`;
    const basePath = path.join(UPLOADS_DIR, tmpId);
    let outputPath = null;

    try {
      send("progress", { step: "info", message: "Mengambil informasi track...", percent: 0 });
      let title = "Track";
      const direct = isDirectMediaUrl(url);

      if (direct) {
        try {
          const pathname = new URL(url).pathname;
          const filename = path.basename(pathname);
          title = path.basename(filename, path.extname(filename)).slice(0, 50) || "Track";
        } catch {}
        send("progress", { step: "meta", message: `Direct media: ${title}`, title });
        send("progress", { step: "download", message: "Mendownload audio...", percent: 0 });
        outputPath = `${basePath}${path.extname(new URL(url).pathname).toLowerCase() || ".bin"}`;
        await downloadDirectMedia(url, outputPath, percent => send("progress", { step: "download", message: `Mendownload audio... ${Math.round(percent)}%`, percent }));
      } else {
        await ensureYtDlp();
        const info = await getYtInfo(url);
        title = String(info.title || info.fulltitle || "Track").slice(0, 50).trim() || "Track";
        const duration = Number(info.duration || 0);
        if (duration > MAX_DURATION_SECONDS) throw Object.assign(new Error(`Audio terlalu panjang. Maksimal ${Math.round(MAX_DURATION_SECONDS / 60)} menit.`), { code: "TOO_LONG" });
        send("progress", { step: "meta", message: `Ditemukan: ${title}`, title });
        send("progress", { step: "download", message: "Mendownload audio...", percent: 0 });
        await downloadWithYtDlp(url, `${basePath}.%(ext)s`, percent => send("progress", { step: "download", message: `Mendownload audio... ${Math.round(percent)}%`, percent }));
        outputPath = firstMatchingFile(tmpId);
      }

      if (!outputPath || !fs.existsSync(outputPath)) throw new Error("File output tidak ditemukan setelah download.");
      const stat = fs.statSync(outputPath);
      if (!stat.size) throw new Error("File hasil download kosong.");
      if (stat.size > MAX_BYTES) throw Object.assign(new Error(`File terlalu besar. Maksimal ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`), { code: "TOO_LARGE" });

      send("progress", { step: "done", message: "Selesai! Memuat ke editor...", percent: 100 });

      // Keep the existing frontend contract, but cap memory use by refusing oversized SSE payloads.
      // The normal /api/fetch-url endpoint is preferred for large files.
      const data = fs.readFileSync(outputPath).toString("base64");
      unlinkQuietly(outputPath);
      outputPath = null;
      send("file", { title, data, mimeType: "audio/mpeg" });
      if (!res.writableEnded) res.end();
    } catch (error) {
      unlinkQuietly(outputPath);
      const classified = error?.code === "TOO_LARGE" || error?.code === "NOT_MEDIA" || error?.code === "TOO_LONG"
        ? { code: error.code, message: error.message }
        : classifyYtError(error?.message);
      send("error", {
        message: classified.message,
        code: classified.code,
        cookiesExpired: classified.code === "AUTH_REQUIRED",
      });
      if (!res.writableEnded) res.end();
    }
  });
}
