import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { uploadAudioToRoblox, getAssetModerationStatus } from "./roblox.js";
import { sendAudioToTelegram } from "./telegram.js";

const execFileAsync = promisify(execFile);

// ── Multi-account Roblox manager ─────────────────────────────────────────────
function readAccounts() {
  const accountsFile = path.join(dataDir, "roblox-accounts.json");
  try { return JSON.parse(fs.readFileSync(accountsFile, "utf8")); }
  catch { return { active: null, accounts: [] }; }
}

function writeAccounts(data) {
  const accountsFile = path.join(dataDir, "roblox-accounts.json");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(accountsFile, JSON.stringify(data, null, 2));
}

function getActiveAccount() {
  const data = readAccounts();
  const active = data.accounts.find(a => a.id === data.active);
  if (active) return active;
  // Fallback to env vars if no account selected
  const apiKey = process.env.ROBLOX_API_KEY;
  const userId = process.env.ROBLOX_USER_ID;
  if (apiKey && userId) return { id: "env", label: "Default (.env)", apiKey, userId };
  return null;
}
// ─────────────────────────────────────────────────────────────────────────────
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

app.set("trust proxy", true);
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
    const ip = req.ip || req.socket?.remoteAddress || "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("::ffff:172.") || ip.startsWith("172.")) return next();
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

// ── Roblox optimization: mono 44100Hz 128kbps + micro-variation ──────────────
async function optimizeForRoblox(inputPath, { autoVary = true } = {}) {
  const tmpId = crypto.randomUUID();
  const outputPath = path.join(uploadsDir, `${tmpId}-roblox.mp3`);

  // Micro-variation params — random but subtle enough to be inaudible
  const pitchCents = autoVary ? (Math.random() * 60 - 30) : 0;   // ±30 cents (~0.3 semitone)
  const tempoRate  = autoVary ? (1 + (Math.random() * 0.01 - 0.005)) : 1; // ±0.5%
  const noiseVol   = autoVary ? (Math.random() * 0.0008).toFixed(6) : "0"; // tiny noise floor

  // Build ffmpeg filter chain
  const filters = [];
  if (autoVary) {
    // asetrate shifts pitch, atempo corrects duration
    const rateRatio = (1 + pitchCents / 1200).toFixed(6);
    const tempoComp = (1 / (1 + pitchCents / 1200)).toFixed(6);
    filters.push(`asetrate=44100*${rateRatio}`);
    filters.push(`atempo=${tempoComp}`);
    filters.push(`atempo=${tempoRate.toFixed(6)}`);
  }
  // Always: mono downmix + resample to 44100Hz
  filters.push("pan=mono|c0=0.5*c0+0.5*c1");
  filters.push("aresample=44100");
  const filterStr = filters.join(",");

  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", inputPath,
    "-vn",
    "-af", filterStr,
    "-ac", "1",          // mono
    "-ar", "44100",      // 44.1kHz
    "-b:a", "128k",      // 128kbps — sweet spot for Roblox
    "-map_metadata", "-1", // strip all metadata
    outputPath
  ], { maxBuffer: 1024 * 1024 * 32, timeout: 120000 });

  const stat = fs.statSync(outputPath);
  if (!stat.size) throw new Error("FFmpeg menghasilkan file kosong.");
  return outputPath;
}
// ─────────────────────────────────────────────────────────────────────────────

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
  let ytdlpVersion = null;
  try {
    const { stdout } = await execFileAsync("yt-dlp", ["--version"], { timeout: 5000 });
    ytdlpVersion = stdout.trim();
  } catch {}
  res.json({
    maxFileSizeMb: MAX_MB,
    cleanupMinutes: CLEANUP_MINUTES,
    supportedFormats: ["MP3", "WAV", "OGG", "FLAC"],
    autoConvert: true,
    ytdlpAvailable: Boolean(ytdlpVersion),
    ytdlpVersion,
    autoVary: process.env.AUTO_VARY !== "false",
    robloxOptimize: true, // always mono 44100Hz 128kbps
    robloxConfigured: Boolean(getActiveAccount()),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
  });
});

// ── Roblox account management ────────────────────────────────────────────────
app.get("/api/roblox-accounts", (_, res) => {
  const data = readAccounts();
  // Mask API keys — only show last 6 chars
  const safe = data.accounts.map(a => ({
    ...a,
    apiKey: a.apiKey ? "••••••" + a.apiKey.slice(-6) : "",
  }));
  const activeAccount = getActiveAccount();
  res.json({
    active: data.active,
    accounts: safe,
    hasEnvFallback: Boolean(process.env.ROBLOX_API_KEY && process.env.ROBLOX_USER_ID),
    activeLabel: activeAccount?.label || "Tidak ada akun aktif",
  });
});

app.post("/api/roblox-accounts", express.json(), (req, res) => {
  const { label, apiKey, userId } = req.body || {};
  if (!label || !apiKey || !userId) {
    return res.status(400).json({ error: "Label, API Key, dan User ID wajib diisi." });
  }
  if (apiKey.length < 10) return res.status(400).json({ error: "API Key tidak valid." });
  if (!/^\d+$/.test(userId)) return res.status(400).json({ error: "User ID harus berupa angka." });

  const data = readAccounts();
  const id = crypto.randomUUID();
  data.accounts.push({ id, label: label.trim(), apiKey: apiKey.trim(), userId: userId.trim() });
  if (!data.active) data.active = id; // auto-select first account
  writeAccounts(data);
  res.json({ ok: true, id });
});

app.patch("/api/roblox-accounts/:id/activate", (req, res) => {
  const data = readAccounts();
  const acc = data.accounts.find(a => a.id === req.params.id);
  if (!acc && req.params.id !== "env") return res.status(404).json({ error: "Akun tidak ditemukan." });
  data.active = req.params.id === "env" ? null : req.params.id;
  writeAccounts(data);
  res.json({ ok: true });
});

app.delete("/api/roblox-accounts/:id", (req, res) => {
  const data = readAccounts();
  const idx = data.accounts.findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Akun tidak ditemukan." });
  data.accounts.splice(idx, 1);
  if (data.active === req.params.id) {
    data.active = data.accounts[0]?.id || null;
  }
  writeAccounts(data);
  res.json({ ok: true });
});
// ─────────────────────────────────────────────────────────────────────────────

// ── Toggle auto-vary ─────────────────────────────────────────────────────────
app.post("/api/toggle-auto-vary", express.json(), (req, res) => {
  const current = process.env.AUTO_VARY !== "false";
  const next = !current;
  process.env.AUTO_VARY = next ? "true" : "false";
  res.json({ autoVary: next });
});
// ─────────────────────────────────────────────────────────────────────────────

// ── Update yt-dlp ─────────────────────────────────────────────────────────────
let ytdlpUpdateRunning = false;

app.get("/api/update-ytdlp", async (req, res) => {
  if (ytdlpUpdateRunning) {
    return res.status(409).json({ error: "Update sedang berjalan." });
  }
  ytdlpUpdateRunning = true;

  // SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // Get current version
    const { stdout: before } = await execFileAsync("yt-dlp", ["--version"], { timeout: 5000 });
    send("progress", { message: `Versi saat ini: ${before.trim()}` });

    // Run pip install -U yt-dlp
    send("progress", { message: "Mengupdate yt-dlp via pip..." });

    await new Promise((resolve, reject) => {
      const proc = spawn("pip3", [
        "install", "--break-system-packages", "--upgrade",
        "--root-user-action=ignore", "yt-dlp"
      ]);
      let out = "";
      proc.stdout.on("data", c => {
        out += c.toString();
        const lines = out.split("\n");
        const last = lines.filter(l => l.trim()).pop() || "";
        if (last) send("progress", { message: last.slice(0, 120) });
        out = lines[lines.length - 1];
      });
      proc.stderr.on("data", c => {
        const line = c.toString().trim();
        // skip pip warnings — they are not errors
        if (line && !line.startsWith("WARNING") && !line.startsWith("DEPRECATION")) {
          send("progress", { message: line.slice(0, 120) });
        }
      });
      // pip exits 0 on success AND on "already up to date" — both are fine
      proc.on("close", code => {
        if (code === 0 || code === 1) resolve(); // code 1 = warnings only
        else reject(new Error("pip exit " + code));
      });
    });

    // Get new version
    const { stdout: after } = await execFileAsync("yt-dlp", ["--version"], { timeout: 5000 });
    const newVer = after.trim();
    const oldVer = before.trim();
    const updated = newVer !== oldVer;

    send("done", {
      message: updated
        ? `Update berhasil! ${oldVer} → ${newVer}`
        : `Sudah versi terbaru: ${newVer}`,
      oldVersion: oldVer,
      newVersion: newVer,
      updated,
    });
  } catch (err) {
    send("error", { message: "Gagal update: " + (err.message || "unknown error") });
  }

  ytdlpUpdateRunning = false;
  res.end();
});
// ─────────────────────────────────────────────────────────────────────────────

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
  const _uploadAcc = getActiveAccount();
  const apiKey = _uploadAcc?.apiKey;
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

// ── Export history as CSV ─────────────────────────────────────────────────────
app.get("/api/history/export/csv", (_, res) => {
  const history = readHistory();
  const rows = [
    ["Name", "Asset ID", "Status", "Roblox URL", "Original File", "Uploaded At"].join(","),
    ...history.map(item => {
      const assetId = item.roblox?.assetId || "";
      const status  = item.roblox?.moderation || item.roblox?.status || "";
      const url     = assetId ? `https://create.roblox.com/store/asset/${assetId}` : "";
      const name    = `"${(item.name || "").replace(/"/g, '""')}"`;
      const orig    = `"${(item.originalName || "").replace(/"/g, '""')}"`;
      const date    = item.uploadedAt ? new Date(item.uploadedAt).toISOString() : "";
      return [name, assetId, status, url, orig, date].join(",");
    })
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="roblox-assets-${Date.now()}.csv"`);
  res.send("﻿" + rows); // BOM for Excel UTF-8 compatibility
});
// ─────────────────────────────────────────────────────────────────────────────

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

    if (getActiveAccount()) {
      try {
        history = readHistory();
        item = history.find(x => x.id === record.id);
        item.roblox.status = "uploading";
        writeHistory(history);

        // Optimize for Roblox: mono 44100Hz 128kbps + micro-variation
        const autoVary = process.env.AUTO_VARY !== "false"; // default on
        let optimizedPath = null;
        try {
          optimizedPath = await optimizeForRoblox(workingFilePath, { autoVary });
        } catch (e) {
          console.warn("[optimize] Gagal optimasi, pakai file original:", e.message);
        }
        const uploadPath = optimizedPath || workingFilePath;

        const _acc = getActiveAccount();
        if (!_acc?.apiKey || !_acc?.userId) throw new Error("Roblox API key belum dikonfigurasi.");

        const result = await uploadAudioToRoblox({
          filePath: uploadPath,
          displayName: record.name,
          description: `Uploaded with Roblox Music Uploader — ${record.originalName}`,
          userId: _acc.userId,
          apiKey: _acc.apiKey
        });

        // Cleanup optimized temp file
        if (optimizedPath) safeUnlink(optimizedPath);

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
// ── Upload cookies.txt ──────────────────────────────────────────────────────
const cookiesUpload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, root),
    filename: (_, __, cb) => cb(null, "cookies.txt"),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.originalname.endsWith(".txt") || file.mimetype === "text/plain") cb(null, true);
    else cb(new Error("Hanya file .txt yang diterima"));
  },
});

app.post("/api/upload-cookies", cookiesUpload.single("cookies"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File tidak ditemukan." });
  res.json({ ok: true, message: "cookies.txt berhasil diupload." });
});

app.get("/api/cookies-status", (_, res) => {
  const cookiesPath = path.join(root, "cookies.txt");
  const exists = fs.existsSync(cookiesPath);
  const size = exists ? fs.statSync(cookiesPath).size : 0;
  const mtime = exists ? fs.statSync(cookiesPath).mtime : null;
  res.json({ exists, size, mtime });
});
// ────────────────────────────────────────────────────────────────────────────

// ── URL metadata preview ─────────────────────────────────────────────────────
app.post("/api/url-info", express.json(), async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string") return res.status(400).json({ error: "URL tidak valid." });

  let parsed;
  try { parsed = new URL(url); } catch {
    return res.status(400).json({ error: "URL tidak dapat diparse." });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ error: "Hanya URL http/https yang didukung." });
  }

  const nodePath = process.execPath;
  const cookiesPath = path.join(root, "cookies.txt");
  const hasCookies = fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0;
  const flags = [
    "--js-runtimes", `node:${nodePath}`,
    "--remote-components", "ejs:github",
    "--no-playlist",
    "--dump-json",
    ...(hasCookies ? ["--cookies", cookiesPath] : []),
    url,
  ];

  try {
    const { stdout } = await execFileAsync("yt-dlp", flags, { timeout: 30000 });
    const info = JSON.parse(stdout.trim().split("\n")[0]);
    res.json({
      title: (info.title || info.fulltitle || "Unknown").slice(0, 100),
      duration: info.duration || 0,
      duration_string: info.duration_string || "",
      thumbnail: info.thumbnail || null,
      uploader: info.uploader || info.channel || "",
      webpage_url: info.webpage_url || url,
    });
  } catch (err) {
    const msg = err.message || "";
    if (msg.includes("Sign in") || msg.includes("bot")) {
      return res.status(403).json({ error: "YouTube meminta login. Upload cookies.txt terbaru." });
    }
    res.status(502).json({ error: "Gagal mengambil info. Pastikan URL valid." });
  }
});
// ────────────────────────────────────────────────────────────────────────────

// ── Playlist info ────────────────────────────────────────────────────────────
const PLAYLIST_LIMIT = 50;

app.post("/api/playlist-info", express.json(), async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string") return res.status(400).json({ error: "URL tidak valid." });

  let parsed;
  try { parsed = new URL(url); } catch {
    return res.status(400).json({ error: "URL tidak dapat diparse." });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ error: "Hanya URL http/https yang didukung." });
  }

  const nodePath = process.execPath;
  const cookiesPath = path.join(root, "cookies.txt");
  const hasCookies = fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0;

  const flags = [
    "--js-runtimes", `node:${nodePath}`,
    "--remote-components", "ejs:github",
    "--flat-playlist",           // don't recurse into sub-playlists
    "--playlist-end", String(PLAYLIST_LIMIT),
    "--dump-json",
    ...(hasCookies ? ["--cookies", cookiesPath] : []),
    url,
  ];

  try {
    const { stdout } = await execFileAsync("yt-dlp", flags, { timeout: 60000 });
    const lines = stdout.trim().split("\n").filter(Boolean);

    // If only one line and no playlist_id → it's a single video, not playlist
    const items = lines.map(line => {
      try {
        const info = JSON.parse(line);
        return {
          id: info.id,
          title: (info.title || info.fulltitle || "Unknown").slice(0, 100),
          duration: info.duration || 0,
          duration_string: info.duration_string || "",
          thumbnail: info.thumbnail || null,
          uploader: info.uploader || info.channel || "",
          webpage_url: info.webpage_url || info.url || url,
          playlist_title: info.playlist_title || info.playlist || null,
        };
      } catch { return null; }
    }).filter(Boolean);

    if (!items.length) {
      return res.status(404).json({ error: "Tidak ada track ditemukan di playlist ini." });
    }

    const isPlaylist = items.length > 1 || items[0]?.playlist_title;
    res.json({
      isPlaylist,
      playlistTitle: items[0]?.playlist_title || null,
      total: items.length,
      limited: items.length >= PLAYLIST_LIMIT,
      items,
    });
  } catch (err) {
    const msg = err.message || "";
    if (msg.includes("Sign in") || msg.includes("bot")) {
      return res.status(403).json({ error: "YouTube meminta login. Upload cookies.txt terbaru." });
    }
    res.status(502).json({ error: "Gagal mengambil info playlist. Pastikan URL valid." });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// ── SSE streaming download ───────────────────────────────────────────────────
app.get("/api/fetch-url-stream", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).end();

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const nodePath = process.execPath;
  const cookiesPath = path.join(root, "cookies.txt");
  const hasCookies = fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0;
  const ytFlags = [
    "--js-runtimes", `node:${nodePath}`,
    "--remote-components", "ejs:github",
    "--no-playlist",
    ...(hasCookies ? ["--cookies", cookiesPath] : []),
  ];

  const tmpId = `${Date.now()}-${crypto.randomUUID()}`;
  const outputTemplate = path.join(uploadsDir, `${tmpId}.%(ext)s`);

  // Step 1: get metadata
  send("progress", { step: "info", message: "Mengambil informasi track..." });

  let title = "Track";
  try {
    const { stdout: infoRaw } = await execFileAsync("yt-dlp",
      [...ytFlags, "--dump-json", url],
      { timeout: 30000 }
    );
    const info = JSON.parse(infoRaw.trim().split("\n")[0]);
    title = (info.title || info.fulltitle || "Track").slice(0, 50).trim() || "Track";
    const duration = info.duration || 0;
    if (duration > 1800) {
      send("error", { message: "Audio terlalu panjang. Maksimal 30 menit." });
      return res.end();
    }
    send("progress", { step: "meta", message: `Ditemukan: ${title}`, title });
  } catch (err) {
    const msg = err.message || "";
    const isBotBlock = msg.includes("Sign in") || msg.includes("bot") || msg.includes("cookies");
    send("error", {
      message: isBotBlock
        ? "YouTube meminta login. Upload cookies.txt terbaru."
        : "Gagal mengambil info track.",
      cookiesExpired: isBotBlock,
    });
    return res.end();
  }

  // Step 2: download with real-time progress
  send("progress", { step: "download", message: "Mendownload audio...", percent: 0 });

  await new Promise((resolve, reject) => {
    const args = [
      ...ytFlags,
      "-f", "bestaudio/best",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "192K",
      "--max-filesize", `${MAX_MB}m`,
      "--newline",           // one progress line per line
      "--progress",
      "-o", outputTemplate,
      url,
    ];

    const proc = spawn("yt-dlp", args);
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        // Parse yt-dlp progress: [download]  42.3% of 5.23MiB at 1.20MiB/s ETA 00:03
        const m = line.match(/\[download\]\s+(\d+\.?\d*)%/);
        if (m) {
          const percent = parseFloat(m[1]);
          send("progress", {
            step: "download",
            message: `Mendownload audio... ${Math.round(percent)}%`,
            percent,
          });
        }
        // ffmpeg conversion
        if (line.includes("[ExtractAudio]") || line.includes("[ffmpeg]")) {
          send("progress", { step: "convert", message: "Mengkonversi ke MP3...", percent: 100 });
        }
      }
    });

    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr));
    });

    req.on("close", () => proc.kill());
  }).catch(async (err) => {
    const msg = err.message || "";
    const isBotBlock = msg.includes("Sign in") || msg.includes("bot") || msg.includes("cookies");
    // cleanup
    try {
      fs.readdirSync(uploadsDir)
        .filter(f => f.startsWith(tmpId))
        .forEach(f => safeUnlink(path.join(uploadsDir, f)));
    } catch {}
    send("error", {
      message: isBotBlock
        ? "YouTube meminta login. Upload cookies.txt terbaru."
        : "Gagal mendownload audio.",
      cookiesExpired: isBotBlock,
    });
    res.end();
    return "handled";
  }).then(async (result) => {
    if (result === "handled") return;

    // Step 3: find file and stream
    send("progress", { step: "done", message: "Selesai! Memuat ke editor...", percent: 100 });

    const files = fs.readdirSync(uploadsDir)
      .filter(f => f.startsWith(tmpId))
      .map(f => path.join(uploadsDir, f));

    if (!files.length) {
      send("error", { message: "File output tidak ditemukan." });
      return res.end();
    }

    const downloadedPath = files[0];
    const stat = fs.statSync(downloadedPath);

    if (stat.size > MAX_MB * 1024 * 1024) {
      safeUnlink(downloadedPath);
      send("error", { message: `File terlalu besar. Maksimal ${MAX_MB} MB.` });
      return res.end();
    }

    // Send file as base64 over SSE
    const audioData = fs.readFileSync(downloadedPath).toString("base64");
    safeUnlink(downloadedPath);
    send("file", { title, data: audioData, mimeType: "audio/mpeg" });
    res.end();
  });
});
// ────────────────────────────────────────────────────────────────────────────

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
      "--remote-components", "ejs:github",
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
