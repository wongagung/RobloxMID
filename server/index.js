import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { uploadAudioToRoblox } from "./roblox.js";
import { sendAudioToTelegram } from "./telegram.js";

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
const allowed = new Set([".mp3", ".wav", ".ogg", ".flac"]);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.has(ext));
  }
});

app.use(express.json());
app.use(express.static(path.join(root, "public")));

function readHistory() {
  try { return JSON.parse(fs.readFileSync(historyFile, "utf8")); }
  catch { return []; }
}

function writeHistory(items) {
  fs.writeFileSync(historyFile, JSON.stringify(items.slice(0, 100), null, 2));
}

app.get("/api/config", (_, res) => {
  res.json({
    maxFileSizeMb: MAX_MB,
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

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!allowed.has(ext)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Format harus MP3, WAV, OGG, atau FLAC." });
  }

  const id = crypto.randomUUID();
  const record = {
    id,
    name: req.body.name?.trim() || path.basename(req.file.originalname, ext),
    originalName: req.file.originalname,
    size: req.file.size,
    createdAt: new Date().toISOString(),
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
      writeHistory(h);
    }
  });
});

app.get("/api/history/:id", (req, res) => {
  const item = readHistory().find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Item tidak ditemukan." });
  res.json(item);
});

async function processAudio(record, filePath) {
  const history = readHistory();
  const item = history.find(x => x.id === record.id);
  if (!item) return;

  // Telegram is attempted independently from Roblox.
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      item.telegram.status = "uploading";
      writeHistory(history);
      const result = await sendAudioToTelegram(filePath, record.originalName, {
        caption: `🎵 Roblox Music\n\n${record.name}\n${record.originalName}`
      });
      item.telegram = { status: "sent", messageId: result.message_id };
    } catch (e) {
      item.telegram = { status: "failed", error: e.message };
    }
    writeHistory(history);
  } else {
    item.telegram = { status: "skipped", error: "Telegram belum dikonfigurasi." };
    writeHistory(history);
  }

  if (process.env.ROBLOX_API_KEY && process.env.ROBLOX_USER_ID) {
    try {
      item.roblox.status = "uploading";
      writeHistory(history);

      const result = await uploadAudioToRoblox({
        filePath,
        displayName: record.name,
        description: `Uploaded with Roblox Music Uploader — ${record.originalName}`,
        userId: process.env.ROBLOX_USER_ID,
        apiKey: process.env.ROBLOX_API_KEY
      });

      item.roblox = {
        status: result.status,
        assetId: result.assetId || null,
        operationId: result.operationId || null,
        error: result.error || null
      };
    } catch (e) {
      item.roblox = { status: "failed", error: e.message };
    }
    writeHistory(history);
  } else {
    item.roblox = { status: "skipped", error: "Roblox Open Cloud belum dikonfigurasi." };
    writeHistory(history);
  }

  // Keep uploaded files only temporarily.
  try { fs.unlinkSync(filePath); } catch {}
}

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? `File terlalu besar. Maksimal ${MAX_MB} MB.` : err.message });
  }
  if (err) return res.status(500).json({ error: err.message });
  next();
});

app.listen(PORT, () => {
  console.log(`Roblox Music Uploader running on http://0.0.0.0:${PORT}`);
});