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

app.get("/api/config", (_, res) => {
  res.json({
    maxFileSizeMb: MAX_MB,
    cleanupMinutes: CLEANUP_MINUTES,
    supportedFormats: ["MP3", "WAV", "OGG", "FLAC"],
    autoConvert: true,
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
