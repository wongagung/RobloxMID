import fs from "fs";
import path from "path";
import express from "express";
import multer from "multer";

const API_BASE = "https://apis.roblox.com";

function mimeFor(ext) {
  return ({
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac"
  })[ext] || null;
}

function assetMimeFor(assetType, ext) {
  const maps = {
    Image: {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".bmp": "image/bmp", ".tga": "image/tga"
    },
    Decal: {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".bmp": "image/bmp", ".tga": "image/tga"
    },
    Model: {
      ".fbx": "model/fbx", ".gltf": "model/gltf+json", ".glb": "model/gltf-binary", ".rbxm": "model/x-rbxm", ".rbxmx": "model/x-rbxm"
    },
    Animation: {
      ".rbxm": "model/x-rbxm", ".rbxmx": "model/x-rbxm"
    },
    Audio: {
      ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac"
    },
    Video: {
      ".mp4": "video/mp4", ".mov": "video/mov"
    }
  };
  return maps[assetType]?.[ext] || null;
}

function safeDeleteFile(filePath) {
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Roblox] Deleted local file: ${filePath}`);
    }
  } catch (error) {
    console.error(
      `[Roblox] Failed to delete local file ${filePath}:`,
      error?.message || error
    );
  }
}

function createMultipartBody({
  request,
  fileBuffer,
  fileName,
  fileContentType
}) {
  const boundary =
    `----RobloxMIDBoundary${Date.now()}${Math.random()
      .toString(16)
      .slice(2)}`;

  const CRLF = "\r\n";
  const parts = [];

  parts.push(
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="request"${CRLF}` +
      `Content-Type: application/json${CRLF}` +
      CRLF +
      JSON.stringify(request) +
      CRLF
    )
  );

  parts.push(
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="fileContent"; filename="${fileName}"${CRLF}` +
      `Content-Type: ${fileContentType}${CRLF}` +
      CRLF
    )
  );

  parts.push(fileBuffer);

  parts.push(
    Buffer.from(
      CRLF +
      `--${boundary}--${CRLF}`
    )
  );

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function robloxRequest(url, options = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(
      `Roblox API network error: ${error?.message || error}`
    );
  }

  const text = await response.text();

  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const msg =
      data?.message ||
      data?.error ||
      data?.details?.[0]?.message ||
      data?.raw ||
      text ||
      `HTTP ${response.status}`;

    throw new Error(
      `Roblox API: ${msg} (HTTP ${response.status})`
    );
  }

  return data;
}

function normalizeModerationState(state) {
  if (!state) return null;
  const s = String(state).toUpperCase();
  if (s.includes("APPROV")) return "approved";
  if (s.includes("REJECT")) return "rejected";
  return "reviewing";
}

export async function getAssetModerationStatus(assetId, apiKey) {
  const data = await robloxRequest(
    `${API_BASE}/assets/v1/assets/${encodeURIComponent(assetId)}`,
    { method: "GET", headers: { "x-api-key": apiKey } }
  );
  return normalizeModerationState(data?.moderationResult?.moderationState);
}

export async function uploadAudioToRoblox({
  filePath,
  displayName,
  description = "",
  userId,
  apiKey
}) {
  let uploadStarted = false;

  try {
    if (!filePath) {
      throw new Error("filePath wajib diisi.");
    }

    if (!apiKey) {
      throw new Error("Roblox API key tidak ditemukan.");
    }

    if (!userId) {
      throw new Error("Roblox userId tidak ditemukan.");
    }

    if (!displayName) {
      throw new Error("displayName wajib diisi.");
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`File tidak ditemukan: ${filePath}`);
    }

    const stat = fs.statSync(filePath);

    if (!stat.isFile()) {
      throw new Error(`Path bukan file: ${filePath}`);
    }

    if (stat.size <= 0) {
      throw new Error(`File kosong: ${filePath}`);
    }

    if (stat.size > 20 * 1024 * 1024) {
      throw new Error("Roblox audio upload dibatasi 20 MB.");
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = mimeFor(ext);

    if (!mimeType) {
      throw new Error(
        `Format audio tidak didukung: ${ext}. Gunakan .mp3, .ogg, .wav, atau .flac.`
      );
    }

    const fileBuffer = fs.readFileSync(filePath);

    console.log(
      `[Roblox] Preparing upload: ${path.basename(filePath)} (${fileBuffer.length} bytes)`
    );

    const request = {
      assetType: "Audio",
      displayName: String(displayName),
      description: String(description || ""),
      creationContext: {
        creator: {
          userId: String(userId)
        }
      }
    };

    const multipart = createMultipartBody({
      request,
      fileBuffer,
      fileName: `${displayName}${ext}`,
      fileContentType: mimeType
    });

    console.log(
      `[Roblox] Multipart content-type: ${multipart.contentType}`
    );

    console.log(
      `[Roblox] Multipart content-length: ${multipart.body.length}`
    );

    console.log("[Roblox] Sending Create Asset request...");

    uploadStarted = true;

    const created = await robloxRequest(
      `${API_BASE}/assets/v1/assets`,
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": multipart.contentType,
          "Content-Length": String(multipart.body.length)
        },
        body: multipart.body
      }
    );

    console.log(
      "[Roblox] Create Asset response:",
      JSON.stringify(created)
    );

    const operationId =
      created?.operationId ||
      created?.path?.split("/").pop() ||
      null;

    const directAssetId =
      created?.assetId ||
      created?.asset?.assetId ||
      created?.asset?.id ||
      created?.id ||
      null;

    if (!operationId) {
      if (directAssetId) {
        console.log(
          `[Roblox] Upload completed immediately. Asset ID: ${directAssetId}`
        );

        return {
          status: "completed",
          operationId: null,
          assetId: String(directAssetId),
          moderation: normalizeModerationState(created?.moderationResult?.moderationState)
        };
      }

      throw new Error(
        `Roblox tidak mengembalikan operationId maupun assetId. Response: ${JSON.stringify(created)}`
      );
    }

    console.log(
      `[Roblox] Upload operation started: ${operationId}`
    );

    const interval = Math.max(
      1000,
      Number(process.env.ROBLOX_POLL_INTERVAL_MS || 3000)
    );

    const timeout = Math.max(
      interval,
      Number(process.env.ROBLOX_POLL_TIMEOUT_MS || 120000)
    );

    const started = Date.now();

    while (Date.now() - started < timeout) {
      await new Promise(resolve =>
        setTimeout(resolve, interval)
      );

      const op = await robloxRequest(
        `${API_BASE}/assets/v1/operations/${encodeURIComponent(operationId)}`,
        {
          method: "GET",
          headers: {
            "x-api-key": apiKey
          }
        }
      );

      console.log(
        `[Roblox] Operation status: ${JSON.stringify(op)}`
      );

      if (!op?.done) {
        continue;
      }

      if (op?.error) {
        const errorMessage =
          op.error?.message ||
          op.error?.details?.[0]?.message ||
          JSON.stringify(op.error);

        throw new Error(
          `Roblox asset processing failed: ${errorMessage}`
        );
      }

      const assetId =
        op?.response?.assetId ||
        op?.response?.asset?.assetId ||
        op?.response?.asset?.id ||
        op?.response?.id ||
        null;

      if (!assetId) {
        throw new Error(
          `Roblox operation selesai tetapi assetId tidak ditemukan. Response: ${JSON.stringify(op)}`
        );
      }

      console.log(
        `[Roblox] Upload completed successfully. Asset ID: ${assetId}`
      );

      return {
        status: "completed",
        operationId,
        assetId: String(assetId),
        moderation: normalizeModerationState(op?.response?.moderationResult?.moderationState)
      };
    }

    console.warn(
      `[Roblox] Upload masih processing setelah ${timeout}ms. Operation ID: ${operationId}`
    );

    return {
      status: "processing",
      operationId
    };
  } catch (error) {
    console.error(
      `[Roblox] Upload failed: ${error?.message || error}`
    );

    if (uploadStarted) {
      safeDeleteFile(filePath);
    }

    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal Asset Hub uploader.
// Registered through Express' listen hook so the existing Music Lab routes
// remain untouched. The endpoint accepts exactly one file per HTTP request;
// the Asset Hub frontend handles multi-upload with a controlled queue.
const ASSET_MAX_BYTES = Number(process.env.ASSET_HUB_MAX_MB || 20) * 1024 * 1024;
const ASSET_UPLOAD_DIR = path.resolve(
  process.env.ASSET_HUB_UPLOAD_DIR || path.join(process.cwd(), "uploads")
);
fs.mkdirSync(ASSET_UPLOAD_DIR, { recursive: true });

const assetStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, ASSET_UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    cb(null, `asset-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
  }
});

const assetUpload = multer({
  storage: assetStorage,
  limits: { fileSize: ASSET_MAX_BYTES }
});

function readAssetHubAccount() {
  const accountsFile = path.join(process.cwd(), "data", "roblox-accounts.json");
  try {
    const data = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
    const account = data.accounts?.find(a => a.id === data.active);
    if (account?.apiKey && account?.userId) return account;
  } catch {}

  const apiKey = process.env.ROBLOX_API_KEY;
  const userId = process.env.ROBLOX_USER_ID;
  if (apiKey && userId) return { id: "env", label: "Default (.env)", apiKey, userId };
  return null;
}

function clampDisplayName(value, fallback) {
  let name = String(value || fallback || "Asset").trim().slice(0, 50).trim();
  if (name.length < 3) name = `${name} Asset`.slice(0, 50);
  return name;
}

export async function uploadAssetToRoblox({
  filePath,
  assetType,
  displayName,
  description = "",
  userId,
  groupId,
  apiKey
}) {
  const allowedTypes = new Set(["Image", "Decal", "Model", "Animation", "Audio", "Video"]);
  if (!allowedTypes.has(assetType)) {
    throw new Error(`Asset type tidak didukung: ${assetType}`);
  }
  if (!apiKey) throw new Error("Roblox API key tidak ditemukan.");
  if (!filePath || !fs.existsSync(filePath)) throw new Error("File upload tidak ditemukan.");

  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("File upload kosong atau tidak valid.");
  if (stat.size > ASSET_MAX_BYTES) throw new Error(`File terlalu besar. Batas Asset Hub ${Math.round(ASSET_MAX_BYTES / 1024 / 1024)} MB.`);

  if (assetType === "Mesh") {
    throw new Error("Mesh biasa tidak dapat diupload langsung melalui Create Asset API. Gunakan Model atau Roblox Asset Delivery mesh.");
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = assetMimeFor(assetType, ext);
  if (!mimeType) throw new Error(`Format ${assetType} tidak sesuai: ${ext || "tanpa ekstensi"}.`);

  const creator = groupId
    ? { groupId: String(groupId) }
    : { userId: String(userId || "") };

  if (!creator.userId && !creator.groupId) {
    throw new Error("Creator userId/groupId tidak ditemukan.");
  }

  const request = {
    assetType,
    displayName: clampDisplayName(displayName, path.basename(filePath, ext)),
    description: String(description || "").slice(0, 1000),
    creationContext: { creator }
  };

  const buffer = fs.readFileSync(filePath);
  const multipart = createMultipartBody({
    request,
    fileBuffer: buffer,
    fileName: path.basename(filePath),
    fileContentType: mimeType
  });

  const created = await robloxRequest(`${API_BASE}/assets/v1/assets`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": multipart.contentType,
      "Content-Length": String(multipart.body.length)
    },
    body: multipart.body
  });

  const operationId = created?.operationId || created?.path?.split("/").pop() || null;
  const directAssetId = created?.assetId || created?.asset?.assetId || created?.asset?.id || created?.id || null;

  if (directAssetId && !operationId) {
    let moderation = null;
    try { moderation = await getAssetModerationStatus(String(directAssetId), apiKey); } catch {}
    return {
      status: "completed",
      operationId: null,
      assetId: String(directAssetId),
      displayName: request.displayName,
      assetType,
      moderation
    };
  }

  if (!operationId) {
    throw new Error(`Roblox tidak mengembalikan operationId/assetId. Response: ${JSON.stringify(created)}`);
  }

  const interval = Math.max(1000, Number(process.env.ASSET_HUB_POLL_INTERVAL_MS || 2500));
  const timeout = Math.max(interval, Number(process.env.ASSET_HUB_POLL_TIMEOUT_MS || 120000));
  const started = Date.now();

  while (Date.now() - started < timeout) {
    await new Promise(resolve => setTimeout(resolve, interval));
    const op = await robloxRequest(
      `${API_BASE}/assets/v1/operations/${encodeURIComponent(operationId)}`,
      { method: "GET", headers: { "x-api-key": apiKey } }
    );

    if (!op?.done) continue;
    if (op?.error) {
      throw new Error(
        op.error?.message ||
        op.error?.details?.[0]?.message ||
        `Asset processing failed: ${JSON.stringify(op.error)}`
      );
    }

    const assetId = op?.response?.assetId || op?.response?.asset?.assetId || op?.response?.asset?.id || op?.response?.id || null;
    if (!assetId) throw new Error(`Operation selesai tetapi assetId tidak ditemukan. Response: ${JSON.stringify(op)}`);

    let moderation = null;
    try { moderation = await getAssetModerationStatus(String(assetId), apiKey); } catch {}

    return {
      status: "completed",
      operationId,
      assetId: String(assetId),
      displayName: request.displayName,
      assetType,
      moderation
    };
  }

  return {
    status: "processing",
    operationId,
    displayName: request.displayName,
    assetType
  };
}

function installAssetHubRoute() {
  if (express.application.__assetHubListenPatched) return;
  express.application.__assetHubListenPatched = true;

  const originalListen = express.application.listen;
  express.application.listen = function patchedListen(...args) {
    if (!this.__assetHubRouteInstalled) {
      this.__assetHubRouteInstalled = true;

      this.post("/api/assets/upload", assetUpload.single("file"), async (req, res) => {
        let filePath = req.file?.path;
        try {
          const account = readAssetHubAccount();
          if (!account) return res.status(503).json({ error: "Belum ada akun Roblox aktif. Atur API key + User ID di Music Lab." });
          if (!req.file) return res.status(400).json({ error: "File wajib diupload." });

          const assetType = String(req.body?.assetType || "");
          const creatorType = String(req.body?.creatorType || "user").toLowerCase();
          const groupId = creatorType === "group" ? String(req.body?.groupId || "").trim() : "";

          if (creatorType === "group" && !/^\d+$/.test(groupId)) {
            return res.status(400).json({ error: "Group ID wajib berupa angka." });
          }

          const result = await uploadAssetToRoblox({
            filePath,
            assetType,
            displayName: req.body?.displayName,
            description: req.body?.description,
            userId: account.userId,
            groupId,
            apiKey: account.apiKey
          });

          return res.json({
            ...result,
            creatorType,
            creatorId: groupId || String(account.userId),
            assetUrl: result.assetId
              ? `https://create.roblox.com/store/asset/${encodeURIComponent(result.assetId)}`
              : null,
            assetUri: result.assetId ? `rbxassetid://${result.assetId}` : null
          });
        } catch (error) {
          console.error(`[Asset Hub] Upload failed: ${error?.message || error}`);
          return res.status(400).json({ error: error?.message || "Asset upload gagal." });
        } finally {
          if (filePath) safeDeleteFile(filePath);
        }
      });
    }

    return originalListen.apply(this, args);
  };
}

installAssetHubRoute();
