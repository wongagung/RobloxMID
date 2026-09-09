import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = {
  telegram: path.join(root, "server/telegram.js"),
  index: path.join(root, "server/index.js"),
  app: path.join(root, "public/app.js")
};

function read(file) {
  return fs.readFileSync(file, "utf8");
}
function write(file, value) {
  fs.writeFileSync(file, value, "utf8");
}
function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Anchor not found: ${label}`);
  return source.replace(needle, replacement);
}

let telegram = read(files.telegram);
if (!telegram.includes("ROBLOXMID_TELEGRAM_ARCHIVE_V1")) {
  const anchor = 'export const TELEGRAM_SAFE_UPLOAD_BYTES = TELEGRAM_SAFE_BYTES;';
  const block = `

export async function downloadTelegramFile(fileId, outputPath) { // ROBLOXMID_TELEGRAM_ARCHIVE_V1
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram credentials belum diatur.");
  if (!fileId) throw new Error("Telegram file_id tidak ditemukan untuk retry.");
  if (!outputPath) throw new Error("Output path wajib diisi.");

  const bot = new TelegramBot(token, { polling: false });
  const url = await bot.getFileLink(String(fileId));
  const response = await fetch(url);
  if (!response.ok) throw new Error(\`Gagal mengambil arsip Telegram (HTTP \${response.status}).\`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Arsip Telegram kosong.");
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}
`;
  telegram = replaceOnce(telegram, anchor, block + "\n" + anchor, "telegram archive export");
  write(files.telegram, telegram);
}

let index = read(files.index);
if (!index.includes("ROBLOXMID_RETRY_FROM_TELEGRAM_V1")) {
  index = replaceOnce(
    index,
    'import { sendAudioToTelegram } from "./telegram.js";',
    'import { sendAudioToTelegram, downloadTelegramFile } from "./telegram.js";',
    "telegram import"
  );

  const retryRoute = `
// Retry Roblox upload from the Telegram archive; the original URL is never downloaded again.
app.post("/api/history/:id/retry-roblox", async (req, res) => { // ROBLOXMID_RETRY_FROM_TELEGRAM_V1
  const history = readHistory();
  const item = history.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Item tidak ditemukan." });
  if (item.roblox?.moderation !== "rejected") {
    return res.status(409).json({ error: "Retry Roblox hanya tersedia untuk asset yang ditolak moderasi." });
  }
  const archiveId = item.telegram?.fileId;
  if (!archiveId) return res.status(409).json({ error: "Arsip Telegram untuk retry tidak tersedia." });
  const account = getActiveAccount();
  if (!account?.apiKey || !account?.userId) return res.status(503).json({ error: "Roblox belum dikonfigurasi." });
  if (!process.env.TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: "Telegram archive belum dikonfigurasi." });

  const retryPath = path.join(uploadsDir, \`retry-\${crypto.randomUUID()}.mp3\`);
  let optimizedPath = null;
  const retryCount = Number(item.roblox?.retryCount || 0) + 1;
  const retriedAt = new Date().toISOString();

  try {
    item.roblox = {
      ...item.roblox,
      status: "retrying",
      moderation: "reviewing",
      error: null,
      name: null,
      assetId: null,
      operationId: null,
      retryCount,
      retriedAt
    };
    writeHistory(history);

    await downloadTelegramFile(archiveId, retryPath);
    optimizedPath = await optimizeForRoblox(retryPath, { autoVary: process.env.AUTO_VARY !== "false" });

    const result = await uploadAudioToRoblox({
      filePath: optimizedPath,
      displayName: item.name || item.originalName || "Audio",
      description: "Uploaded with Roblox Music Uploader",
      userId: account.userId,
      apiKey: account.apiKey
    });

    const latest = readHistory();
    const latestItem = latest.find(x => x.id === item.id);
    if (!latestItem) return res.status(404).json({ error: "History item menghilang saat retry." });

    latestItem.roblox = {
      status: result.status,
      name: result.robloxName || null,
      assetId: result.assetId || null,
      operationId: result.operationId || null,
      moderation: result.moderation || (result.assetId ? "reviewing" : null),
      error: result.error || null,
      retryCount,
      retriedAt
    };
    writeHistory(latest);

    if (result.assetId) {
      pollModeration(item.id, result.assetId).catch(e => console.error("Retry moderation poll error:", e.message));
    }
    return res.status(202).json({ ok: true, id: item.id, status: result.status });
  } catch (error) {
    const latest = readHistory();
    const latestItem = latest.find(x => x.id === item.id);
    if (latestItem) {
      latestItem.roblox = {
        ...latestItem.roblox,
        status: "failed",
        moderation: "rejected",
        error: error?.message || "Retry Roblox gagal.",
        retryCount,
        retriedAt
      };
      writeHistory(latest);
    }
    return res.status(502).json({ error: error?.message || "Retry Roblox gagal." });
  } finally {
    if (optimizedPath) safeUnlink(optimizedPath);
    safeUnlink(retryPath);
  }
});

`;
  index = replaceOnce(index, 'app.get("/api/history/:id", (req, res) => {', retryRoute + 'app.get("/api/history/:id", (req, res) => {', "retry route anchor");

  index = replaceOnce(
    index,
    'if (!process.env.ROBLOX_API_KEY) return res.status(400).json({ error: "Roblox API key belum dikonfigurasi." });\n  try {\n    const state = await getAssetModerationStatus(item.roblox.assetId, process.env.ROBLOX_API_KEY);',
    'const account = getActiveAccount();\n  if (!account?.apiKey) return res.status(400).json({ error: "Roblox API key belum dikonfigurasi." });\n  try {\n    const state = await getAssetModerationStatus(item.roblox.assetId, account.apiKey);',
    "moderation refresh active account"
  );

  index = replaceOnce(
    index,
    'roblox: { status: "pending" },',
    'roblox: { status: "pending", name: null },',
    "history pending roblox name"
  );

  index = replaceOnce(
    index,
    '          assetId: result.assetId || null,\n          operationId: result.operationId || null,\n          moderation: result.moderation || (result.assetId ? "reviewing" : null),',
    '          name: result.robloxName || null,\n          assetId: result.assetId || null,\n          operationId: result.operationId || null,\n          moderation: result.moderation || (result.assetId ? "reviewing" : null),',
    "history roblox result name"
  );

  index = replaceOnce(
    index,
    '          description: `Uploaded with Roblox Music Uploader — ${record.originalName}`,',
    '          description: "Uploaded with Roblox Music Uploader",',
    "roblox description privacy"
  );

  write(files.index, index);
}

let app = read(files.app);
if (!app.includes("ROBLOXMID_URL_LIFECYCLE_V1")) {
  app = replaceOnce(
    app,
    'let _downloadQueue = []; // { id, title, file, thumbnail, status: \'waiting\'|\'ready\'|\'uploading\'|\'done\'|\'error\' }',
    'let _downloadQueue = []; // { id, title, file, thumbnail, status, historyId } // ROBLOXMID_URL_LIFECYCLE_V1',
    "queue lifecycle marker"
  );

  app = replaceOnce(
    app,
    'const statusIcon = {\n      waiting:   "⏳",\n      ready:     "✏️",\n      uploading: "⬆️",\n      done:      "✓",\n      error:     "✗",\n    }[item.status] || "⏳";',
    'const statusIcon = { waiting: "⏳", ready: "✏️", uploading: "⬆️", done: "✓", rejected: "✕", error: "✗" }[item.status] || "⏳";',
    "queue status icon"
  );

  app = replaceOnce(
    app,
    '            item.status === "uploading" ? "Mengupload ke Roblox..." :\n            item.status === "done"      ? "✓ Selesai diupload" :\n            item.status === "error"     ? "✗ Gagal" : ""',
    '            item.status === "uploading" ? "Mengupload ke Roblox..." :\n            item.status === "done"      ? "✓ Selesai Upload" :\n            item.status === "rejected"  ? "✕ Ditolak moderasi" :\n            item.status === "error"     ? "✗ Gagal" : ""',
    "queue status label"
  );

  app = replaceOnce(
    app,
    '${item.status === "error" ? `<button class="ghost-btn queue-retry-btn" data-qi="${i}">↺ Retry</button>` : ""}',
    '${item.status === "error" ? `<button class="ghost-btn queue-retry-btn" data-qi="${i}">↺ Retry Download</button>` : ""}\n          ${item.status === "rejected" && item.historyId ? `<button class="ghost-btn queue-retry-roblox-btn" data-qi="${i}">↺ Retry Roblox</button>` : ""}',
    "queue retry actions"
  );

  app = replaceOnce(
    app,
    '  queueList.querySelectorAll(".queue-retry-btn").forEach(btn => {',
    `  queueList.querySelectorAll(".queue-retry-roblox-btn").forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.qi);
      const item = _downloadQueue[idx];
      if (!item?.historyId) return;
      item.status = "uploading";
      renderQueue();
      try {
        await api(\`/api/history/\${encodeURIComponent(item.historyId)}/retry-roblox\`, { method: "POST" });
        for (let attempt = 0; attempt < 180; attempt++) {
          const h = await api(\`/api/history/\${encodeURIComponent(item.historyId)}\`);
          if (h.roblox?.status === "failed") { item.status = "error"; renderQueue(); return; }
          if (h.roblox?.moderation === "rejected") { item.status = "rejected"; renderQueue(); return; }
          if (h.roblox?.moderation === "approved") { item.status = "done"; renderQueue(); return; }
          if (h.roblox?.status === "completed" && h.roblox?.moderation !== "rejected") { item.status = "done"; renderQueue(); return; }
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (e) {
        item.status = "rejected";
        renderQueue();
        toast(e.message, "error");
      }
    };
  });

  queueList.querySelectorAll(".queue-retry-btn").forEach(btn => {`,
    "queue Roblox retry handler"
  );

  app = replaceOnce(
    app,
    `      if (uploadBtn && !uploadBtn.disabled) {
        uploadBtn.click();
        item.status = "done";
        setTimeout(renderQueue, 3000);
      } else {
        item.status = "error";
        renderQueue();
      }`,
    `      if (uploadBtn && !uploadBtn.disabled) {
        window.MusicLabUploadLastId = null;
        uploadBtn.click();
        const startedAt = Date.now();
        while (!window.MusicLabUploadLastId && Date.now() - startedAt < 15000) {
          await new Promise(r => setTimeout(r, 150));
        }
        const historyId = window.MusicLabUploadLastId;
        if (!historyId) { item.status = "error"; renderQueue(); return; }
        item.historyId = historyId;
        item.status = "uploading";
        renderQueue();
        for (let attempt = 0; attempt < 180; attempt++) {
          try {
            const h = await api(\`/api/history/\${encodeURIComponent(historyId)}\`);
            if (h.roblox?.status === "failed") { item.status = "error"; renderQueue(); return; }
            if (h.roblox?.moderation === "rejected") { item.status = "rejected"; renderQueue(); return; }
            if (h.roblox?.moderation === "approved") { item.status = "done"; renderQueue(); return; }
            if (h.roblox?.status === "completed") { item.status = "done"; renderQueue(); return; }
          } catch {}
          await new Promise(r => setTimeout(r, 1000));
        }
        item.status = "uploading";
        renderQueue();
      } else {
        item.status = "error";
        renderQueue();
      }`,
    "queue upload lifecycle"
  );

  app = replaceOnce(
    app,
    '      const result = JSON.parse(xhr.responseText);\n      toast("Upload diterima. Processing berjalan.", "success");',
    '      const result = JSON.parse(xhr.responseText);\n      window.MusicLabUploadLastId = result.id || null;\n      toast("Upload diterima. Processing berjalan.", "success");',
    "upload id bridge"
  );

  app = replaceOnce(
    app,
    '          ${moderation === "reviewing" ? `<button onclick="recheckModeration(\'${item.id}\')">Recheck</button>` : ""}',
    '          ${moderation === "reviewing" ? `<button onclick="recheckModeration(\'${item.id}\')">Recheck</button>` : ""}\n          ${moderation === "rejected" && item.telegram?.fileId ? `<button onclick="retryRobloxUpload(\'${item.id}\')">↺ Retry Roblox</button>` : ""}',
    "history retry action"
  );

  app = replaceOnce(
    app,
    '        <span>${escapeHtml(item.originalName)} · ${formatSize(item.size)} · ${formatDateTime(item.createdAt)}</span>',
    '        <span>${escapeHtml(item.originalName)} · ${formatSize(item.size)} · ${formatDateTime(item.createdAt)}</span>\n        ${item.roblox?.name ? `<span class="roblox-name-label">🎮 Roblox: <b>${escapeHtml(item.roblox.name)}</b></span>` : ""}',
    "history Roblox name"
  );

  app = replaceOnce(
    app,
    'window.recheckModeration = async id => {',
    `window.retryRobloxUpload = async id => {
  try {
    await api(\`/api/history/\${encodeURIComponent(id)}/retry-roblox\`, { method: "POST" });
    toast("Retry Roblox dimulai.", "success");
    refresh();
    setTimeout(refresh, 3000);
    setTimeout(refresh, 10000);
    setTimeout(refresh, 20000);
  } catch (e) { toast(e.message, "error"); }
};
window.recheckModeration = async id => {`,
    "history retry function"
  );

  app = replaceOnce(
    app,
    `function toast(msg, type="") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = \`toast show \${type}\`;
  setTimeout(() => el.className = "toast", 3200);
}`,
    `function toast(msg, type="") {
  if (window.MusicLabNotify) return window.MusicLabNotify(msg, type === "error" ? "error" : "success");
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = \`toast show \${type}\`;
  setTimeout(() => el.className = "toast", 3200);
}`,
    "canonical toast bridge"
  );

  write(files.app, app);
}

console.log("URL lifecycle implementation applied successfully.");
