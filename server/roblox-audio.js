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
  headers["Accept-Encoding"] = "identity";
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

  if (!res.getHeader("content-type") || String(res.getHeader("content-type")).includes("application/json")) {
    res.setHeader("content-type", "audio/mpeg");
  }

  res.setHeader("content-disposition", "inline");
  res.setHeader("x-roblox-audio-proxy", "open-cloud");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified");
}

async function resolveAssetLocation(assetId, apiKey, req) {
  const url = `${API_BASE}/asset-delivery-api/v1/assetId/${encodeURIComponent(assetId)}`;
  const upstream = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
    redirect: "follow",
  });

  const text = await upstream.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!upstream.ok) {
    const message = data?.message || data?.error || data?.details?.[0]?.message || text || `Roblox Open Cloud HTTP ${upstream.status}`;
    const error = new Error(message);
    error.status = upstream.status;
    error.upstreamUrl = url;
    throw error;
  }

  const location = typeof data?.location === "string" ? data.location.trim() : "";
  if (!location) {
    const error = new Error("Roblox Open Cloud tidak mengembalikan location audio.");
    error.status = 502;
    error.response = data;
    throw error;
  }

  return fetch(location, {
    method: req.method === "HEAD" ? "HEAD" : "GET",
    headers: upstreamHeaders(req),
    redirect: "follow",
  });
}

export async function proxyRobloxAudio(req, res, apiKey) {
  const assetId = validAssetId(req.params.assetId || req.query.id);
  if (!assetId) return res.status(400).json({ error: "Asset ID tidak valid." });
  if (!apiKey) return res.status(503).json({ error: "ROBLOX_API_KEY belum dikonfigurasi." });

  try {
    const upstream = await resolveAssetLocation(assetId, apiKey, req);

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      let message = text || `Roblox content delivery HTTP ${upstream.status}`;
      try {
        const data = text ? JSON.parse(text) : null;
        message = data?.message || data?.error || data?.details?.[0]?.message || message;
      } catch {}
      return res.status(upstream.status).json({ error: message, assetId, status: upstream.status });
    }

    forwardResponseHeaders(upstream, res);
    res.status(upstream.status);
    if (req.method === "HEAD" || !upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    console.error(`[Roblox Audio Proxy] ${assetId}:`, error);
    if (!res.headersSent) {
      return res.status(error?.status || 502).json({
        error: error?.message || "Gagal mengambil audio dari Roblox Open Cloud.",
        assetId,
      });
    }
    res.destroy(error);
  }
}

export async function checkRobloxAudio(assetId, apiKey) {
  const id = validAssetId(assetId);
  if (!id) return { ok: false, status: 400, error: "Asset ID tidak valid." };
  if (!apiKey) return { ok: false, status: 503, error: "ROBLOX_API_KEY belum dikonfigurasi." };

  const url = `${API_BASE}/asset-delivery-api/v1/assetId/${encodeURIComponent(id)}`;
  try {
    const resolver = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      redirect: "follow",
    });

    const text = await resolver.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (!resolver.ok) {
      return {
        ok: false,
        assetId: id,
        status: resolver.status,
        contentType: resolver.headers.get("content-type"),
        url,
        error: data?.message || data?.error || data?.details?.[0]?.message || text || `HTTP ${resolver.status}`,
      };
    }

    const location = typeof data?.location === "string" ? data.location.trim() : "";
    if (!location) {
      return {
        ok: false,
        assetId: id,
        status: 502,
        contentType: resolver.headers.get("content-type"),
        url,
        error: "Open Cloud merespons 200 tetapi location audio tidak ditemukan.",
      };
    }

    const media = await fetch(location, {
      method: "GET",
      headers: { Range: "bytes=0-1", Accept: "*/*", "Accept-Encoding": "identity" },
      redirect: "follow",
    });

    const mediaType = media.headers.get("content-type");
    const mediaLength = media.headers.get("content-length");
    const mediaRange = media.headers.get("content-range");
    const mediaAcceptRanges = media.headers.get("accept-ranges");
    await media.body?.cancel();

    return {
      ok: media.ok && !String(mediaType || "").includes("application/json"),
      assetId: id,
      status: media.status,
      contentType: mediaType,
      contentLength: mediaLength,
      contentRange: mediaRange,
      acceptRanges: mediaAcceptRanges,
      url: location,
      resolverUrl: url,
      resolverContentType: resolver.headers.get("content-type"),
      assetTypeId: data?.assetTypeId ?? null,
      isArchived: data?.isArchived ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      assetId: id,
      status: 502,
      url,
      error: error?.message || "Gagal memverifikasi audio.",
    };
  }
}
