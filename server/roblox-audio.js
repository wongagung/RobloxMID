import { Readable } from "stream";

const OPEN_CLOUD_BASE = "https://apis.roblox.com";
const ASSET_DELIVERY_BASE = "https://assetdelivery.roblox.com";
const DEFAULT_UA = "RobloxMID-AudioProxy/2.0";

function validAssetId(value) {
  const id = String(value || "").trim();
  return /^\d+$/.test(id) ? id : null;
}

function mediaHeaders(req, range = null) {
  const headers = {
    "User-Agent": DEFAULT_UA,
    Accept: "*/*",
    "Accept-Encoding": "identity",
  };

  const requestedRange = range || req?.headers?.range;
  if (requestedRange) headers.Range = requestedRange;
  if (req?.headers?.["if-range"]) headers["If-Range"] = req.headers["if-range"];
  if (req?.headers?.["if-none-match"]) headers["If-None-Match"] = req.headers["if-none-match"];
  if (req?.headers?.["if-modified-since"]) headers["If-Modified-Since"] = req.headers["if-modified-since"];
  return headers;
}

function sniffAudioType(assetTypeId, contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.startsWith("audio/")) return contentType;
  if (assetTypeId === 3 || type.includes("application/octet-stream")) return "audio/ogg";
  return contentType || "application/octet-stream";
}

function forwardResponseHeaders(upstream, res, source, assetTypeId = null) {
  const contentType = sniffAudioType(assetTypeId, upstream.headers.get("content-type"));
  res.setHeader("Content-Type", contentType);

  for (const name of [
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
    "expires",
  ]) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }

  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified");
  res.setHeader("X-Roblox-Source", source);
}

async function responseDetails(response) {
  const text = await response.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { text, data };
}

async function resolveOpenCloud(assetId, apiKey) {
  const url = `${OPEN_CLOUD_BASE}/asset-delivery-api/v1/assetId/${encodeURIComponent(assetId)}`;
  const response = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
      "User-Agent": DEFAULT_UA,
    },
    redirect: "follow",
  });

  const { text, data } = await responseDetails(response);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || data?.details?.[0]?.message || text || `Roblox Open Cloud HTTP ${response.status}`);
    error.status = response.status;
    error.code = "OPEN_CLOUD_HTTP";
    throw error;
  }

  const location = typeof data?.location === "string" ? data.location.trim() : "";
  if (!location) {
    const error = new Error(data?.isArchived
      ? "Asset Roblox sedang archived dan tidak memiliki signed media location."
      : "Roblox Open Cloud tidak mengembalikan signed media location.");
    error.status = 502;
    error.code = "OPEN_CLOUD_NO_LOCATION";
    error.response = data;
    throw error;
  }

  return {
    location,
    assetTypeId: Number(data?.assetTypeId) || null,
    isArchived: data?.isArchived ?? null,
    requestId: data?.requestId ?? null,
    resolverUrl: url,
    source: "OpenCloud",
  };
}

async function resolveLegacy(assetId, req) {
  const url = `${ASSET_DELIVERY_BASE}/v2/assetId/${encodeURIComponent(assetId)}`;
  const response = await fetch(url, {
    method: req?.method === "HEAD" ? "HEAD" : "GET",
    headers: mediaHeaders(req),
    redirect: "follow",
  });

  if (!response.ok) {
    const { text, data } = await responseDetails(response);
    const error = new Error(data?.message || data?.error || data?.details?.[0]?.message || text || `Roblox Asset Delivery HTTP ${response.status}`);
    error.status = response.status;
    error.code = "ASSET_DELIVERY_HTTP";
    throw error;
  }

  return {
    response,
    assetTypeId: 3,
    resolverUrl: url,
    source: "AssetDelivery",
  };
}

async function fetchOpenCloudMedia(location, req) {
  return fetch(location, {
    method: req.method === "HEAD" ? "HEAD" : "GET",
    headers: mediaHeaders(req),
    redirect: "follow",
  });
}

export async function proxyRobloxAudio(req, res, apiKey) {
  const assetId = validAssetId(req.params.assetId || req.query.id);
  if (!assetId) return res.status(400).json({ error: "Asset ID tidak valid." });
  if (!apiKey) return res.status(503).json({ error: "ROBLOX_API_KEY belum dikonfigurasi." });

  const attempts = [];

  try {
    let resolved = null;

    try {
      resolved = await resolveOpenCloud(assetId, apiKey);
      attempts.push({ source: resolved.source, ok: true });
    } catch (error) {
      attempts.push({ source: "OpenCloud", ok: false, status: error?.status || 502, error: error?.message || String(error) });
    }

    if (resolved) {
      try {
        const upstream = await fetchOpenCloudMedia(resolved.location, req);
        if (upstream.ok) {
          forwardResponseHeaders(upstream, res, resolved.source, resolved.assetTypeId);
          res.status(upstream.status);
          if (req.method === "HEAD" || !upstream.body) return res.end();
          Readable.fromWeb(upstream.body).pipe(res);
          return;
        }

        const { text, data } = await responseDetails(upstream);
        attempts.push({
          source: "OpenCloudMedia",
          ok: false,
          status: upstream.status,
          error: data?.message || data?.error || text || `Content Delivery HTTP ${upstream.status}`,
        });
      } catch (error) {
        attempts.push({ source: "OpenCloudMedia", ok: false, status: 502, error: error?.message || String(error) });
      }
    }

    try {
      const legacy = await resolveLegacy(assetId, req);
      const upstream = legacy.response;
      attempts.push({ source: legacy.source, ok: true, status: upstream.status });
      forwardResponseHeaders(upstream, res, legacy.source, legacy.assetTypeId);
      res.status(upstream.status);
      if (req.method === "HEAD" || !upstream.body) return res.end();
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    } catch (error) {
      attempts.push({ source: "AssetDelivery", ok: false, status: error?.status || 502, error: error?.message || String(error) });
    }

    return res.status(502).json({
      ok: false,
      error: "Roblox tidak dapat mengirim media untuk asset ini.",
      assetId,
      attempts,
    });
  } catch (error) {
    console.error(`[Roblox Audio Proxy] ${assetId}:`, error);
    if (!res.headersSent) {
      return res.status(error?.status || 502).json({
        ok: false,
        error: error?.message || "Gagal mengambil audio dari Roblox.",
        assetId,
        attempts,
      });
    }
    res.destroy(error);
  }
}

export async function checkRobloxAudio(assetId, apiKey) {
  const id = validAssetId(assetId);
  if (!id) return { ok: false, status: 400, error: "Asset ID tidak valid." };
  if (!apiKey) return { ok: false, status: 503, error: "ROBLOX_API_KEY belum dikonfigurasi." };

  const attempts = [];

  try {
    try {
      const resolved = await resolveOpenCloud(id, apiKey);
      const media = await fetchOpenCloudMedia(resolved.location, { method: "GET", headers: { range: "bytes=0-1" } });
      const mediaType = sniffAudioType(resolved.assetTypeId, media.headers.get("content-type"));
      const result = {
        source: resolved.source,
        status: media.status,
        ok: media.ok,
        contentType: mediaType,
        contentLength: media.headers.get("content-length"),
        contentRange: media.headers.get("content-range"),
        acceptRanges: media.headers.get("accept-ranges"),
        resolverUrl: resolved.resolverUrl,
        assetTypeId: resolved.assetTypeId,
        isArchived: resolved.isArchived,
        requestId: resolved.requestId,
      };
      await media.body?.cancel();
      attempts.push(result);

      if (result.ok && String(mediaType).startsWith("audio/")) {
        return { ok: true, assetId: id, ...result, attempts };
      }
    } catch (error) {
      attempts.push({ source: "OpenCloud", ok: false, status: error?.status || 502, error: error?.message || String(error) });
    }

    try {
      const legacy = await resolveLegacy(id, { method: "GET", headers: { range: "bytes=0-1" } });
      const media = legacy.response;
      const mediaType = sniffAudioType(legacy.assetTypeId, media.headers.get("content-type"));
      const result = {
        source: legacy.source,
        status: media.status,
        ok: media.ok,
        contentType: mediaType,
        contentLength: media.headers.get("content-length"),
        contentRange: media.headers.get("content-range"),
        acceptRanges: media.headers.get("accept-ranges"),
        resolverUrl: legacy.resolverUrl,
        assetTypeId: legacy.assetTypeId,
      };
      await media.body?.cancel();
      attempts.push(result);

      if (result.ok && String(mediaType).startsWith("audio/")) {
        return { ok: true, assetId: id, ...result, attempts };
      }
    } catch (error) {
      attempts.push({ source: "AssetDelivery", ok: false, status: error?.status || 502, error: error?.message || String(error) });
    }

    return {
      ok: false,
      assetId: id,
      status: attempts.at(-1)?.status || 502,
      error: "Asset tidak dapat dikonfirmasi sebagai media audio.",
      attempts,
    };
  } catch (error) {
    return {
      ok: false,
      assetId: id,
      status: error?.status || 502,
      error: error?.message || "Gagal memverifikasi audio.",
      attempts,
    };
  }
}
