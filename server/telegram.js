import fs from "fs";
import os from "os";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const TELEGRAM_SAFE_BYTES = 48 * 1024 * 1024;

function safeUnlink(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch {}
}

async function mediaDurationSeconds(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath
    ], { timeout: 10000 });
    const duration = Number.parseFloat(String(stdout).trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

function bitrateForTelegram(durationSeconds) {
  if (!durationSeconds) return 96;
  const targetBits = TELEGRAM_SAFE_BYTES * 8 * 0.90;
  return Math.max(32, Math.min(192, Math.floor(targetBits / durationSeconds / 1000)));
}

async function prepareTelegramFile(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size <= TELEGRAM_SAFE_BYTES) return { filePath, temporary: false };

  const duration = await mediaDurationSeconds(filePath);
  const tempPath = path.join(os.tmpdir(), `robloxmid-telegram-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`);
  const bitrate = bitrateForTelegram(duration);

  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", filePath,
    "-vn", "-ac", "2", "-ar", "44100",
    "-b:a", `${bitrate}k`,
    "-map_metadata", "-1",
    tempPath
  ], { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });

  let preparedStat = fs.statSync(tempPath);
  if (preparedStat.size > TELEGRAM_SAFE_BYTES) {
    const fallbackPath = path.join(os.tmpdir(), `robloxmid-telegram-${Date.now()}-${Math.random().toString(16).slice(2)}-fallback.mp3`);
    try {
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", filePath,
        "-vn", "-ac", "1", "-ar", "32000",
        "-b:a", "32k",
        "-map_metadata", "-1",
        fallbackPath
      ], { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
      safeUnlink(tempPath);
      preparedStat = fs.statSync(fallbackPath);
      if (preparedStat.size <= TELEGRAM_SAFE_BYTES) return { filePath: fallbackPath, temporary: true };
      safeUnlink(fallbackPath);
    } catch (error) {
      safeUnlink(fallbackPath);
      safeUnlink(tempPath);
      throw error;
    }
    safeUnlink(tempPath);
    throw new Error("Audio terlalu besar untuk dikirim ke Telegram setelah kompresi otomatis.");
  }

  return { filePath: tempPath, temporary: true };
}

export async function sendAudioToTelegram(filePath, fileName, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("Telegram credentials belum diatur.");

  const bot = new TelegramBot(token, { polling: false });
  let prepared = null;
  try {
    prepared = await prepareTelegramFile(filePath);
    return await bot.sendAudio(chatId, prepared.filePath, {
      caption: options.caption || fileName,
      title: fileName
    });
  } finally {
    if (prepared?.temporary) safeUnlink(prepared.filePath);
  }
}



export async function downloadTelegramFile(fileId, outputPath) { // ROBLOXMID_TELEGRAM_ARCHIVE_V1
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram credentials belum diatur.");
  if (!fileId) throw new Error("Telegram file_id tidak ditemukan untuk retry.");
  if (!outputPath) throw new Error("Output path wajib diisi.");

  const bot = new TelegramBot(token, { polling: false });
  const url = await bot.getFileLink(String(fileId));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gagal mengambil arsip Telegram (HTTP ${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Arsip Telegram kosong.");
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

export const TELEGRAM_SAFE_UPLOAD_BYTES = TELEGRAM_SAFE_BYTES;
