import { Readable } from "stream";

const API_BASE = "https://apis.roblox.com";

function validAssetId(value) {
  const id = String(value || "").trim();
  return /^\d+$/.test(id) ? id : null;
}

function upstreamHeaders(req) {
  const headers = {};
  for (const name of ["range", "if-range", "if-none-match", "if-modified-since", "accept", "accept-encoding"]) {
    const value = req.headers[name];
    if (value) headers[name] = value;
  }
  return headers;
}

function forwardResponseHeaders(upstream, res) {
  const allowed = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
    "cache-control",
    "expires",
  ];

  for (const name of allowed) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }

  if (!res.getHeader("content-type")) {
    res.setHeader("content-type", "audio/mpeg");
  }

  res.setHeader("content-disposition", "inline");
  res.setHeader("x-roblox-audio-proxy", "open-cloud");
  res.setHeader("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified");
}

export async function proxyRobloxAudio(req, res, apiKey) {
  const assetId = validAssetId(req.params.assetId || req.query.id);
  if (!assetId) return res.status(400).json({ error: "Asset ID tidak valid." });
  if (!apiKey) return res.status(503).json({ error: "ROBLOX_API_KEY belum dikonfigurasi." });

  const url = `${API_BASE}/asset-delivery-api/v1/assetId/${encodeURIComponent(assetId)}`;

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        ...upstreamHeaders(req),
      },
      redirect: "follow",
    });

    forwardResponseHeaders(upstream, res);

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      let message = text || `Roblox Open Cloud HTTP ${upstream.status}`;
      try {
        const data = text ? JSON.parse(text) : null;
        message = data?.message || data?.error || data?.details?.[0]?.message || message;
      } catch {}
      return res.status(upstream.status).json({ error: message, assetId, status: upstream.status });
    }

    res.status(upstream.status);
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    console.error(`[Roblox Audio Proxy] ${assetId}:`, error);
    if (!res.headersSent) {
      return res.status(502).json({ error: error?.message || "Gagal mengambil audio dari Roblox Open Cloud." });
    }
    res.destroy(error);
  }
}

export async function checkRobloxAudio(assetId, apiKey) {
  const id = validAssetId(assetId);
  if (!id) return { ok: false, status: 400, error: "Asset ID tidak valid." };
  if (!apiKey) return { ok: false, status: 503, error: "ROBLOX_API_KEY belum dikonfigurasi." };

  const url = `${API_BASE}/asset-delivery-api/v1/assetId/${encodeURIComponent(id)}`;
  const upstream = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": apiKey, Range: "bytes=0-0" },
    redirect: "follow",
  });

  return {
    ok: upstream.ok,
    assetId: id,
    status: upstream.status,
    contentType: upstream.headers.get("content-type"),
    contentLength: upstream.headers.get("content-length"),
    contentRange: upstream.headers.get("content-range"),
    acceptRanges: upstream.headers.get("accept-ranges"),
    url,
  };
}
