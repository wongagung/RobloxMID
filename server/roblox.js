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
      data = {
        raw: text
      };
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

    // Roblox Assets API membatasi upload create asset sampai 20 MB.
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

    console.log(
      `[Roblox] Preparing upload: ${path.basename(filePath)} (${stat.size} bytes)`
    );

    const bytes = fs.readFileSync(filePath);

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

    /*
     * Roblox Create Asset API menerima multipart/form-data:
     *
     * request     -> JSON metadata
     * fileContent -> binary asset
     *
     * Jangan set Content-Type secara manual.
     * fetch akan membuat multipart boundary secara otomatis.
     */
    const form = new FormData();

    const requestBlob = new Blob(
      [JSON.stringify(request)],
      {
        type: "application/json"
      }
    );

    const fileBlob = new Blob(
      [bytes],
      {
        type: mimeType
      }
    );

    form.append("request", requestBlob);
    form.append(
      "fileContent",
      fileBlob,
      `${displayName}${ext}`
    );

    console.log("[Roblox] Sending Create Asset request...");

    uploadStarted = true;

    const created = await robloxRequest(
      `${API_BASE}/assets/v1/assets`,
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey
        },
        body: form
      }
    );

    console.log(
      "[Roblox] Create Asset response:",
      JSON.stringify(created)
    );

    /*
     * Roblox biasanya mengembalikan:
     * {
     *   "path": "operations/xxxx"
     * }
     *
     * Ambil operationId dari response.
     */
    const operationId =
      created?.operationId ||
      created?.path?.split("/").pop() ||
      null;

    /*
     * Pada beberapa response, asset bisa langsung tersedia.
     */
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
          assetId: String(directAssetId)
        };
      }

      throw new Error(
        `Roblox tidak mengembalikan operationId maupun assetId. Response: ${JSON.stringify(
          created
        )}`
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
      await new Promise((resolve) =>
        setTimeout(resolve, interval)
      );

      let op;

      try {
        /*
         * PENTING:
         * Endpoint operation untuk Assets API adalah:
         *
         * /assets/v1/operations/{operationId}
         *
         * bukan /cloud/v2/operations/{operationId}
         */
        op = await robloxRequest(
          `${API_BASE}/assets/v1/operations/${encodeURIComponent(
            operationId
          )}`,
          {
            method: "GET",
            headers: {
              "x-api-key": apiKey
            }
          }
        );
      } catch (error) {
        throw new Error(
          `Gagal mengecek status upload Roblox (${operationId}): ${
            error?.message || error
          }`
        );
      }

      console.log(
        `[Roblox] Operation status: ${JSON.stringify(op)}`
      );

      if (!op?.done) {
        continue;
      }

      /*
       * Kalau Roblox menyatakan operation gagal.
       */
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
          `Roblox operation selesai tetapi assetId tidak ditemukan. Response: ${JSON.stringify(
            op
          )}`
        );
      }

      console.log(
        `[Roblox] Upload completed successfully. Asset ID: ${assetId}`
      );

      return {
        status: "completed",
        operationId,
        assetId: String(assetId)
      };
    }

    /*
     * Jangan menganggap timeout sebagai upload gagal.
     * Operation Roblox masih bisa sedang berjalan.
     */
    console.warn(
      `[Roblox] Upload masih processing setelah ${timeout}ms. Operation ID: ${operationId}`
    );

    return {
      status: "processing",
      operationId
    };
  } catch (error) {
    const message = error?.message || String(error);

    console.error(
      `[Roblox] Upload failed: ${message}`
    );

    /*
     * Hapus file lokal hanya ketika proses upload benar-benar
     * mengalami error.
     *
     * Jangan hapus ketika status = "processing", karena Roblox
     * masih mungkin menyelesaikan operation tersebut.
     */
    if (uploadStarted) {
      safeDeleteFile(filePath);
    }

    throw error;
  }
}