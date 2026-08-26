import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { uploadAudioToRoblox, getAssetModerationStatus } from "./roblox.js";
import { sendAudioToTelegram } from "./telegram.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const uploadsDir = path.join(root, "uploads");
const dataDir = path.join(root, "data");
const historyFile = path.join(dataDir, "history.json");

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(historyFile)) fs.writeFileSync(historyFile, "[]");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const MAX_MB = Number(process.env.MAX_FILE_SIZE_MB || 20);
const CLEANUP_MINUTES = Number(process.env.UPLOAD_RETENTION_MINUTES || 60);
const supported = new Set([".mp3", ".wav", ".ogg", ".flac"]);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    // Accept audio/* and unknown extensions here. FFmpeg will validate/convert it.
    // This prevents the browser/server from rejecting convertible formats such as M4A, AAC, OPUS and WEBM.
    const mime = String(file.mimetype || "").toLowerCase();
    const ext = path.extname(file.originalname).toLowerCase();
    if (mime.startsWith("audio/") || mime === "video/webm" || supported.has(ext)) return cb(null, true);
    return cb(new Error("File harus berupa file audio yang dapat dibaca FFmpeg."));
  }
});

app.use(express.json());

// ── Simple password auth ─────────────────────────────────────────────────────
const APP_PASSWORD = process.env.APP_PASSWORD || "";

if (APP_PASSWORD) {
  app.get("/login", (_, res) => {
    res.send(`<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Login — Roblox Music Lab</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;
         background:#0d0d12;font-family:system-ui,sans-serif;color:#e2e8f0}
    .card{background:#16161f;border:1.5px solid #2a2a3a;border-radius:16px;
          padding:40px 36px;width:100%;max-width:360px;display:flex;
          flex-direction:column;gap:20px;box-shadow:0 8px 40px rgba(0,0,0,.4)}
    .brand{font-size:22px;font-weight:800;letter-spacing:-.5px;text-align:center}
    .brand em{color:#818cf8}
    p{font-size:13px;color:#6b7280;text-align:center}
    input{width:100%;padding:11px 14px;border:1.5px solid #2a2a3a;border-radius:8px;
          background:#0d0d12;color:#e2e8f0;font-size:14px;outline:none;
          transition:border-color .18s}
    input:focus{border-color:#818cf8}
    button{width:100%;padding:12px;border:none;border-radius:8px;
           background:#6366f1;color:#fff;font-size:14px;font-weight:700;
           cursor:pointer;transition:opacity .18s}
    button:hover{opacity:.85}
    .err{color:#f87171;font-size:12px;text-align:center;display:none}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">♫ ROBLOX MUSIC <em>LAB</em></div>
    <p>Masukkan password untuk mengakses</p>
    <input type="password" id="pw" placeholder="Password" autofocus>
    <button onclick="login()">Masuk →</button>
    <div class="err" id="err">Password salah.</div>
  </div>
  <script>
    document.getElementById('pw').addEventListener('keydown', e => { if(e.key==='Enter') login(); });
    async function login() {
      const pw = document.getElementById('pw').value;
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      if (r.ok) { location.href = '/'; }
      else { document.getElementById('err').style.display='block'; }
    }
  </script>
</body>
</html>`);
  });

  app.post("/api/auth", (req, res) => {
    const { password } = req.body || {};
    if (!password || !crypto.timingSafeEqual(
      Buffer.from(password),
      Buffer.from(APP_PASSWORD)
    )) {
      return res.status(401).json({ error: "Password salah." });
    }
    const ts = Date.now().toString();
    const sig = crypto.createHmac("sha256", APP_PASSWORD).update(ts).digest("hex");
    const token = `${ts}.${sig}`;
    res.cookie("_auth", token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ ok: true });
  });

  app.post("/api/logout", (_, res) => {
    res.clearCookie("_auth");
    res.json({ ok: true });
  });

  function parseAuthCookie(cookieHeader) {
    if (!cookieHeader) return false;
    const match = cookieHeader.match(/(?:^|;\s*)_auth=([^;]+)/);
    if (!match) return false;
    const token = decodeURIComponent(match[1]);
    const dot = token.lastIndexOf(".");
    if (dot < 0) return false;
    const ts = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac("sha256", APP_PASSWORD).update(ts).digest("hex");
    try {
      return sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
    } catch { return false; }
  }

  app.use((req, res, next) => {
    if (req.path === "/login" || req.path === "/api/auth") return next();
    if (parseAuthCookie(req.headers.cookie)) return next();
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Unauthorized. Login diperlukan." });
    }
    res.redirect("/login");
  });
}
// ────────────────────────────────────────────────────────────────────────────

app.use(express.static(path.join(root, "public")));


function clampAssetName(name) {
  let n = String(name || "").trim();
  if (n.length > 50) n = n.slice(0, 50).trim();
  if (n.length < 3) n = (n + " Track").slice(0, 50);
  return n;
}

function readHistory() {
  try { return JSON.parse(fs.readFileSync(historyFile, "utf8")); }
  catch { return []; }
}

function writeHistory(items) {
  fs.writeFileSync(historyFile, JSON.stringify(items.slice(0, 100), null, 2));
}

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
    console.log(`Deleted temporary file: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(`Failed to delete temporary file: ${filePath}`, error);
    }
  }
}

async function convertToRobloxMp3(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (supported.has(ext)) return { filePath: inputPath, converted: false };

  const outputPath = path.join(uploadsDir, `${path.basename(inputPath, ext)}-converted.mp3`);
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", inputPath,
    "-vn",
    "-ac", "2",
    "-ar", "44100",
    "-b:a", "192k",
    outputPath
  ], { maxBuffer: 1024 * 1024 * 4 });

  const stat = fs.statSync(outputPath);
  if (!stat.size) throw new Error("FFmpeg menghasilkan file audio kosong.");
  if (stat.size > MAX_MB * 1024 * 1024) {
    safeUnlink(outputPath);
    throw new Error(`Hasil konversi terlalu besar. Maksimal ${MAX_MB} MB.`);
  }

  return { filePath: outputPath, converted: true };
}

function cleanupOldUploads() {
  const cutoff = Date.now() - CLEANUP_MINUTES * 60 * 1000;
  for (const name of fs.readdirSync(uploadsDir)) {
    const filePath = path.join(uploadsDir, name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.mtimeMs < cutoff) safeUnlink(filePath);
    } catch {}
  }
}

cleanupOldUploads();
setInterval(cleanupOldUploads, 15 * 60 * 1000).unref();

app.get("/api/config", async (_, res) => {
  res.json({
    maxFileSizeMb: MAX_MB,
    cleanupMinutes: CLEANUP_MINUTES,
    supportedFormats: ["MP3", "WAV", "OGG", "FLAC"],
    autoConvert: true,
    ytdlpAvailable: await execFileAsync("yt-dlp", ["--version"], { timeout: 5000 }).then(() => true).catch(() => false),
    robloxConfigured: Boolean(process.env.ROBLOX_API_KEY && process.env.ROBLOX_USER_ID),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
  });
});

app.get("/api/history", (_, res) => {
  res.json(readHistory());
});

app.post("/api/upload", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "File audio tidak valid atau belum dipilih." });
  }

  const originalExt = path.extname(req.file.originalname).toLowerCase();
  const id = crypto.randomUUID();
  const record = {
    id,
    name: clampAssetName(req.body.name?.trim() || path.basename(req.file.originalname, originalExt)),
    originalName: req.file.originalname,
    size: req.file.size,
    createdAt: new Date().toISOString(),
    conversion: { status: supported.has(originalExt) ? "not_needed" : "pending" },
    roblox: { status: "pending" },
    telegram: { status: "pending" }
  };

  const history = readHistory();
  history.unshift(record);
  writeHistory(history);

  res.status(202).json({ id, message: "Upload diterima. Proses berjalan di background." });

  processAudio(record, req.file.path).catch(async (err) => {
    console.error("Background processing error:", err);
    const h = readHistory();
    const item = h.find(x => x.id === id);
    if (item) {
      item.error = err.message;
      item.roblox.status = item.roblox.status === "pending" ? "failed" : item.roblox.status;
      item.telegram.status = item.telegram.status === "pending" ? "failed" : item.telegram.status;
      if (item.conversion?.status === "pending") item.conversion.status = "failed";
      writeHistory(h);
    }
    safeUnlink(req.file.path);
  });
});

async function pollModeration(recordId, assetId) {
  const apiKey = process.env.ROBLOX_API_KEY;
  if (!apiKey) return;
  const intervalMs = Math.max(5000, Number(process.env.ROBLOX_MODERATION_POLL_MS || 30000));
  const maxAttempts = Math.max(1, Number(process.env.ROBLOX_MODERATION_MAX_ATTEMPTS || 20));

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    let state;
    try {
      state = await getAssetModerationStatus(assetId, apiKey);
    } catch (e) {
      console.error(`[Moderation] Poll failed for asset ${assetId}:`, e.message);
      return;
    }
    const history = readHistory();
    const item = history.find(x => x.id === recordId);
    if (!item) return;
    item.roblox.moderation = state || item.roblox.moderation;
    writeHistory(history);
    if (state === "approved" || state === "rejected") return;
  }
}

app.post("/api/roblox/moderation/:id/refresh", async (req, res) => {
  const history = readHistory();
  const item = history.find(x => x.id === req.params.id);
  if (!item?.roblox?.assetId) return res.status(404).json({ error: "Asset tidak ditemukan." });
  if (!process.env.ROBLOX_API_KEY) return res.status(400).json({ error: "Roblox API key belum dikonfigurasi." });
  try {
    const state = await getAssetModerationStatus(item.roblox.assetId, process.env.ROBLOX_API_KEY);
    item.roblox.moderation = state || item.roblox.moderation;
    writeHistory(history);
    res.json({ moderation: item.roblox.moderation });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/history/:id", (req, res) => {
  const item = readHistory().find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Item tidak ditemukan." });
  res.json(item);
});

async function processAudio(record, originalFilePath) {
  let workingFilePath = originalFilePath;
  let convertedFilePath = null;
  try {
    let history = readHistory();
    let item = history.find(x => x.id === record.id);
    if (!item) return;

    const originalExt = path.extname(record.originalName).toLowerCase();
    if (!supported.has(originalExt)) {
      item.conversion = { status: "converting", from: originalExt || "unknown", to: "mp3" };
      writeHistory(history);
      const converted = await convertToRobloxMp3(originalFilePath);
      workingFilePath = converted.filePath;
      convertedFilePath = converted.filePath;
      history = readHistory();
      item = history.find(x => x.id === record.id);
      if (!item) return;
      item.conversion = { status: "completed", from: originalExt || "unknown", to: "mp3" };
      writeHistory(history);
    }

    // Telegram is the persistent storage copy. It is sent before the local files are removed.
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        history = readHistory();
        item = history.find(x => x.id === record.id);
        item.telegram.status = "uploading";
        writeHistory(history);
        const telegramName = path.basename(workingFilePath).endsWith(".mp3") && !supported.has(originalExt)
          ? `${path.basename(record.originalName, originalExt)}.mp3`
          : record.originalName;
        const result = await sendAudioToTelegram(workingFilePath, telegramName, {
          caption: `🎵 Roblox Music\n\n${record.name}\nOriginal: ${record.originalName}${!supported.has(originalExt) ? "\nConverted: MP3" : ""}`
        });
        history = readHistory();
        item = history.find(x => x.id === record.id);
        item.telegram = {
          status: "sent",
          messageId: result.message_id,
          fileId: result.audio?.file_id || null
        };
        writeHistory(history);
      } catch (e) {
        history = readHistory();
        item = history.find(x => x.id === record.id);
        item.telegram = { status: "failed", error: e.message };
        writeHistory(history);
      }
    } else {
      history = readHistory();
      item = history.find(x => x.id === record.id);
      item.telegram = { status: "skipped", error: "Telegram belum dikonfigurasi." };
      writeHistory(history);
    }

    if (process.env.ROBLOX_API_KEY && process.env.ROBLOX_USER_ID) {
      try {
        history = readHistory();
        item = history.find(x => x.id === record.id);
        item.roblox.status = "uploading";
        writeHistory(history);

        const result = await uploadAudioToRoblox({
          filePath: workingFilePath,
          displayName: record.name,
          description: `Uploaded with Roblox Music Uploader — ${record.originalName}`,
          userId: process.env.ROBLOX_USER_ID,
          apiKey: process.env.ROBLOX_API_KEY
        });

        history = readHistory();
        item = history.find(x => x.id === record.id);
        item.roblox = {
          status: result.status,
          assetId: result.assetId || null,
          operationId: result.operationId || null,
          moderation: result.moderation || (result.assetId ? "reviewing" : null),
          error: result.error || null
        };
        writeHistory(history);

        // Asset creation succeeding doesn't mean Roblox's content moderation
        // has finished — that can take a bit longer, so poll it separately.
        if (result.assetId && item.roblox.moderation !== "approved" && item.roblox.moderation !== "rejected") {
          pollModeration(record.id, result.assetId).catch(e =>
            console.error("Moderation poll error:", e.message)
          );
        }
      } catch (e) {
        history = readHistory();
        item = history.find(x => x.id === record.id);
        item.roblox = { status: "failed", error: e.message };
        writeHistory(history);
      }
    } else {
      history = readHistory();
      item = history.find(x => x.id === record.id);
      item.roblox = { status: "skipped", error: "Roblox Open Cloud belum dikonfigurasi." };
      writeHistory(history);
    }
  } finally {
    // Local storage is temporary only. Telegram is the persistent copy.
    safeUnlink(originalFilePath);
    if (convertedFilePath && convertedFilePath !== originalFilePath) safeUnlink(convertedFilePath);
  }
}

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? `File terlalu besar. Maksimal ${MAX_MB} MB.` : err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

app.listen(PORT, () => {
  console.log(`Roblox Music Uploader running on http://0.0.0.0:${PORT}`);
});

// ─── URL SOURCE (yt-dlp) ────────────────────────────────────────────────────
app.post("/api/fetch-url", express.json(), async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL tidak valid." });
  }

  // Basic sanity — must be http/https
  let parsed;
  try { parsed = new URL(url); } catch {
    return res.status(400).json({ error: "URL tidak dapat diparse." });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ error: "Hanya URL http/https yang didukung." });
  }

  // Check yt-dlp is available
  try {
    await execFileAsync("yt-dlp", ["--version"], { timeout: 5000 });
  } catch {
    return res.status(503).json({ error: "yt-dlp tidak tersedia di server. Install dengan: pip install yt-dlp" });
  }

  const tmpId = `${Date.now()}-${crypto.randomUUID()}`;
  const outputTemplate = path.join(uploadsDir, `${tmpId}.%(ext)s`);

  try {
    // Base yt-dlp flags — tell it Node.js is available as JS runtime,
    // and use cookies-from-browser fallback via po_token workaround.
    // --extractor-args bypasses bot detection on YouTube without needing
    // a real browser cookie export.
    const nodePath = process.execPath;
    const cookiesPath = path.join(root, "cookies.txt");
    const hasCookies = fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0;
    const ytFlags = [
      "--js-runtimes", `node:${nodePath}`,
      "--no-playlist",
      ...(hasCookies ? ["--cookies", cookiesPath] : []),
    ];

    // First: get metadata (title)
    const { stdout: infoRaw } = await execFileAsync("yt-dlp",
      [...ytFlags, "--dump-json", url],
      { timeout: 30000 }
    );
    const info = JSON.parse(infoRaw.trim().split("\n")[0]);
    const title = (info.title || info.fulltitle || "Track").slice(0, 50).trim() || "Track";
    const duration = info.duration || 0;

    if (duration > 1800) { // 30 min hard cap
      return res.status(400).json({ error: "Audio terlalu panjang. Maksimal 30 menit." });
    }

    // Download audio only, best quality, convert to mp3
    await execFileAsync("yt-dlp", [
      ...ytFlags,
      "-f", "bestaudio/best",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "192K",
      "--max-filesize", `${MAX_MB}m`,
      "-o", outputTemplate,
      url
    ], { timeout: 300000 }); // 5 min

    // Find the downloaded file
    const files = fs.readdirSync(uploadsDir)
      .filter(f => f.startsWith(tmpId))
      .map(f => path.join(uploadsDir, f));

    if (!files.length) throw new Error("yt-dlp tidak menghasilkan file output.");
    const downloadedPath = files[0];

    const stat = fs.statSync(downloadedPath);
    if (stat.size > MAX_MB * 1024 * 1024) {
      safeUnlink(downloadedPath);
      return res.status(400).json({ error: `File terlalu besar setelah download. Maksimal ${MAX_MB} MB.` });
    }

    // Stream file back to client
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(title)}.mp3"`);
    res.setHeader("X-Track-Title", encodeURIComponent(title));
    res.setHeader("Content-Length", stat.size);

    const stream = fs.createReadStream(downloadedPath);
    stream.pipe(res);
    stream.on("close", () => safeUnlink(downloadedPath));
    stream.on("error", () => { safeUnlink(downloadedPath); });
  } catch (err) {
    // Clean up any partial files
    try {
      fs.readdirSync(uploadsDir)
        .filter(f => f.startsWith(tmpId))
        .forEach(f => safeUnlink(path.join(uploadsDir, f)));
    } catch {}

    const msg = err.message || "";
    if (msg.includes("max-filesize")) return res.status(400).json({ error: `File terlalu besar. Maksimal ${MAX_MB} MB.` });
    if (msg.includes("Unsupported URL") || msg.includes("Unable to extract")) {
      return res.status(400).json({ error: "URL tidak didukung atau tidak dapat diekstrak audio-nya." });
    }
    console.error("[fetch-url] Error:", msg);
    res.status(502).json({ error: "Gagal mendownload audio. Pastikan URL valid dan dapat diakses." });
  }
});
