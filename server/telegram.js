import TelegramBot from "node-telegram-bot-api";

export async function sendAudioToTelegram(filePath, fileName, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("Telegram credentials belum diatur.");

  const bot = new TelegramBot(token, { polling: false });
  return bot.sendAudio(chatId, filePath, {
    caption: options.caption || fileName,
    title: fileName
  });
}