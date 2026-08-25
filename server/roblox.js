import fs from "fs";

const API_BASE = "https://apis.roblox.com";

function mimeFor(ext) {
  return ({
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac"
  })[ext] || "application/octet-stream";
}

async function robloxRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const msg =
      data?.message ||
      data?.error ||
      text ||
      `HTTP ${response.status}`;

    throw new Error(`Roblox API: ${msg}`);
  }

  return data;
}

export async function uploadAudioToRoblox({
  filePath,
  displayName,
  description,
  userId,
  apiKey
}) {
  const stat = fs.statSync(filePath);
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();

  if (stat.size === 0) {
    throw new Error("File audio kosong.");
  }

  if (stat.size > 20 * 1024 * 1024) {
    throw new Error("Roblox audio upload dibatasi 20 MB.");
  }

  const bytes = fs.readFileSync(filePath);

  const request = {
    assetType: "Audio",
    displayName,
    description,
    creationContext: {
      creator: {
        userId: String(userId)
      }
    }
  };

  const form = new FormData();

  // Roblox Create Asset API expects a multipart field named "request".
  form.append("request", JSON.stringify(request));

  // Actual audio content.
  form.append(
    "fileContent",
    new Blob([bytes], {
      type: mimeFor(ext)
    }),
    `${displayName}${ext}`
  );

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

  const operationId =
    created.path?.split("/").pop() ||
    created.operationId ||
    null;

  if (!operationId) {
    return {
      status: "uploaded",
      assetId:
        created.assetId ||
        created.id ||
        created.asset?.assetId ||
        null
    };
  }

  const interval = Number(
    process.env.ROBLOX_POLL_INTERVAL_MS || 3000
  );

  const timeout = Number(
    process.env.ROBLOX_POLL_TIMEOUT_MS || 120000
  );

  const started = Date.now();

  while (Date.now() - started < timeout) {
    await new Promise(resolve =>
      setTimeout(resolve, interval)
    );

    const op = await robloxRequest(
      `${API_BASE}/assets/v1/operations/${operationId}`,
      {
        headers: {
          "x-api-key": apiKey
        }
      }
    );

    if (op.done) {
      if (op.error) {
        throw new Error(
          op.error.message ||
          JSON.stringify(op.error)
        );
      }

      const assetId =
        op.response?.assetId ||
        op.response?.asset?.assetId ||
        op.response?.asset?.id ||
        op.response?.id ||
        null;

      return {
        status: "completed",
        operationId,
        assetId
      };
    }
  }

  return {
    status: "processing",
    operationId
  };
}
