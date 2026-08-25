import fs from "fs";
import path from "path";

const API_BASE = "https://apis.roblox.com";

function mimeFor(ext) {
  return ({
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac"
  })[ext] || null;
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
