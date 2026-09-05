import fs from "fs";
import path from "path";
import crypto from "crypto";

const API_BASE = "https://apis.roblox.com";
const MAX_BYTES = 20 * 1024 * 1024;

const TYPES = {
  image: { assetType: "Image", exts: [".png", ".jpg", ".jpeg", ".bmp", ".tga"] },
  decal: { assetType: "Decal", exts: [".png", ".jpg", ".jpeg", ".bmp", ".tga"] },
  model: { assetType: "Model", exts: [".fbx", ".gltf", ".glb", ".rbxm", ".rbxmx"] },
  animation: { assetType: "Animation", exts: [".fbx", ".rbxm", ".rbxmx"] },
  audio: { assetType: "Audio", exts: [".mp3", ".wav", ".ogg", ".flac"] },
  video: { assetType: "Video", exts: [".mp4", ".mov", ".webm"] }
};
const MIME = { '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.bmp':'image/bmp','.tga':'image/x-tga','.fbx':'model/fbx','.gltf':'model/gltf+json','.glb':'model/gltf-binary','.rbxm':'application/octet-stream','.rbxmx':'application/xml','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm' };

async function robloxRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
  if (!response.ok) {
    const msg = data?.message || data?.error || data?.details?.[0]?.message || data?.raw || `HTTP ${response.status}`;
    throw new Error(`${msg} (HTTP ${response.status})`);
  }
  return data;
}

function makeMultipart({ request, fileBuffer, fileName, fileContentType }) {
  const boundary = `----RobloxMIDAsset${Date.now()}${crypto.randomUUID().replace(/-/g, "")}`;
  const CRLF = "\r\n";
  return { body: Buffer.concat([
    Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="request"${CRLF}Content-Type: application/json${CRLF}${CRLF}${JSON.stringify(request)}${CRLF}`),
    Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="fileContent"; filename="${fileName}"${CRLF}Content-Type: ${fileContentType}${CRLF}${CRLF}`),
    fileBuffer, Buffer.from(`${CRLF}--${boundary}--${CRLF}`)
  ]), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function waitForOperation(operationId, apiKey, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, 2000));
    const op = await robloxRequest(`${API_BASE}/assets/v1/operations/${encodeURIComponent(operationId)}`, { headers: { "x-api-key": apiKey } });
    if (!op?.done) continue;
    if (op?.error) throw new Error(op.error?.message || JSON.stringify(op.error));
    const assetId = op?.response?.assetId || op?.response?.asset?.assetId || op?.response?.asset?.id || op?.response?.id;
    if (!assetId) throw new Error(`Operation selesai tetapi assetId tidak ditemukan: ${JSON.stringify(op)}`);
    return { operationId, assetId: String(assetId), status: "completed", raw: op };
  }
  return { operationId, status: "processing" };
}

export async function uploadGenericAsset({ filePath, originalName, assetType, displayName, description = "", creatorType = "user", userId, groupId, apiKey }) {
  if (!apiKey) throw new Error("ROBLOX_API_KEY tidak tersedia.");
  if (!TYPES[assetType]) throw new Error(`Asset type tidak didukung: ${assetType}`);
  if (!fs.existsSync(filePath)) throw new Error("File upload tidak ditemukan.");
  const stat = fs.statSync(filePath);
  if (stat.size <= 0) throw new Error("File kosong.");
  if (stat.size > MAX_BYTES) throw new Error("Maksimum ukuran asset adalah 20 MB.");
  const ext = path.extname(originalName || filePath).toLowerCase();
  const cfg = TYPES[assetType];
  if (!cfg.exts.includes(ext)) throw new Error(`Format ${assetType} tidak didukung: ${ext}`);
  const creatorId = creatorType === "group" ? groupId : userId;
  if (!creatorId || !/^\d+$/.test(String(creatorId))) throw new Error(`${creatorType === "group" ? "Group ID" : "User ID"} tidak valid.`);

  const request = { assetType: cfg.assetType, displayName: String(displayName || path.basename(originalName || filePath, ext)).slice(0,50), description: String(description || "").slice(0,1000), creationContext: { creator: creatorType === "group" ? { groupId: String(creatorId) } : { userId: String(creatorId) } } };
  const multipart = makeMultipart({ request, fileBuffer: fs.readFileSync(filePath), fileName: originalName || path.basename(filePath), fileContentType: MIME[ext] || "application/octet-stream" });
  const created = await robloxRequest(`${API_BASE}/assets/v1/assets`, { method:"POST", headers:{"x-api-key":apiKey,"Content-Type":multipart.contentType,"Content-Length":String(multipart.body.length)}, body:multipart.body });
  const operationId=created?.operationId||created?.path?.split("/").pop();
  const directAssetId=created?.assetId||created?.asset?.assetId||created?.asset?.id||created?.id;
  if(!operationId&&!directAssetId) throw new Error(`Roblox tidak mengembalikan operationId/assetId: ${JSON.stringify(created)}`);
  if(directAssetId) return {status:"completed",assetId:String(directAssetId),operationId:null};
  return waitForOperation(operationId,apiKey);
}

export async function getGenericAsset(assetId, apiKey, readMask = "description,displayName,creationContext,revisionId,revisionCreateTime,moderationResult,icon,previews,state") {
  const params = new URLSearchParams({ readMask });
  return robloxRequest(`${API_BASE}/assets/v1/assets/${encodeURIComponent(assetId)}?${params.toString()}`, { headers:{"x-api-key":apiKey} });
}

export const ASSET_HUB_TYPES=TYPES;
export const ASSET_HUB_MAX_BYTES=MAX_BYTES;
