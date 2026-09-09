import { Readable } from "stream";

const API_BASE = "https://apis.roblox.com";
const DEFAULT_UA = "RobloxMID-AudioProxy/1.0";

function validAssetId(value) {
  const id = String(value || "").trim();
  return /^\d+$/.test(id) ? id : null;
}

function upstreamHeaders(req) {
  const headers = {
    "User-Agent": DEFAULT_UA,
    Accept: "*/*",
    "Accept-Encoding": "identity",
  };

  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
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

  res.setHeader("content-disposition", "inline");
  res.setHeader("x-roblox-audio-proxy", "open-cloud");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified");
}

async function readJsonResponse(response) {
  const text = await response.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { text, data };
}

async function resolveAssetLocation(assetId, apiKey) {
  const url = `${API_BASE}/asset-delivery-api/v1/assetId/${encodeURIComponent(assetId)}`;
  const resolver = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
      "User-Agent": DEFAULT_UA,
    },
    redirect: "follow",
  });

  const { text, data } = await readJsonResponse(resolver);

  if (!resolver.ok) {
    const message = data?.message || data?.error || data?.details?.[0]?.message || text || `Roblox Open Cloud HTTP ${resolver.status}`;
    const error = new Error(message);
    error.status = resolver.status;
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

  return {
    location,
    resolverUrl: url,
    assetTypeId: data?.assetTypeId ?? null,
    isArchived: data?.isArchived ?? null,
    requestId: data?.requestId ?? null,
  };
}

async function fetchMedia(location, req) {
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
    const resolved = await resolveAssetLocation(assetId, apiKey);
    const upstream = await fetchMedia(resolved.location, req);

    if (!upstream.ok) {
      const { text, data } = await readJsonResponse(upstream);
      return res.status(upstream.status).json({
        error: data?.message || data?.error || data?.details?.[0]?.message || text || `Roblox content delivery HTTP ${upstream.status}`,
        assetId,
        status: upstream.status,
        resolverUrl: resolved.resolverUrl,
      });
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

  try {
    const resolved = await resolveAssetLocation(id, apiKey);
    const candidates = [
      { range: "bytes=0-1", label: "range" },
      { range: null, label: "full" },
    ];

    const attempts = [];
    for (const candidate of candidates) {
      try {
        const headers = {
          "User-Agent": DEFAULT_UA,
          Accept: "*/*",
          "Accept-Encoding": "identity",
        };
        if (candidate.range) headers.Range = candidate.range;

        const media = await fetch(resolved.location, {
          method: "GET",
          headers,
          redirect: "follow",
        });

        const mediaType = media.headers.get("content-type");
        const mediaLength = media.headers.get("content-length");
        const mediaRange = media.headers.get("content-range");
        const mediaAcceptRanges = media.headers.get("accept-ranges");
        const bodyPreview = await media.text().catch(() => "");
        attempts.push({
          mode: candidate.label,
          status: media.status,
          ok: media.ok,
          contentType: mediaType,
          contentLength: mediaLength,
          contentRange: mediaRange,
          acceptRanges: mediaAcceptRanges,
          bodyPreview: bodyPreview.slice(0, 500),
        });

        if (media.ok && mediaType && !mediaType.includes("application/json") && !mediaType.includes("text/html")) {
          return {
            ok: true,
            assetId: id,
            status: media.status,
            contentType: mediaType,
            contentLength: mediaLength,
            contentRange: mediaRange,
            acceptRanges: mediaAcceptRanges,
            url: resolved.location,
            resolverUrl: resolved.resolverUrl,
            assetTypeId: resolved.assetTypeId,
            isArchived: resolved.isArchived,
            requestId: resolved.requestId,
            attempts,
          };
        }
      } catch (error) {
        attempts.push({ mode: candidate.label, status: 0, ok: false, error: error?.message || String(error) });
      }
    }

    const last = attempts.at(-1) || {};
    return {
      ok: false,
      assetId: id,
      status: last.status || 502,
      contentType: last.contentType || null,
      contentLength: last.contentLength || null,
      contentRange: last.contentRange || null,
      acceptRanges: last.acceptRanges || null,
      url: resolved.location,
      resolverUrl: resolved.resolverUrl,
      assetTypeId: resolved.assetTypeId,
      isArchived: resolved.isArchived,
      requestId: resolved.requestId,
      attempts,
    };
  } catch (error) {
    return {
      ok: false,
      assetId: id,
      status: error?.status || 502,
      url: error?.upstreamUrl || null,
      error: error?.message || "Gagal memverifikasi audio.",
    };
  }
}
