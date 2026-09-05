import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import express from "express";
import multer from "multer";
import { uploadGenericAsset, getGenericAsset } from "./asset-hub.js";

const API_BASE = "https://apis.roblox.com";
const MAX_BYTES = 20 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

function activeAccount() {
  const apiKey = process.env.ROBLOX_API_KEY;
  const userId = process.env.ROBLOX_USER_ID;
  if (!apiKey || !userId) throw new Error("Roblox account/API key belum dikonfigurasi.");
  return { apiKey, userId };
}

function contentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ({
    '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.bmp':'image/bmp','.tga':'image/x-tga',
    '.fbx':'model/fbx','.gltf':'model/gltf+json','.glb':'model/gltf-binary','.rbxm':'application/octet-stream','.rbxmx':'application/xml',
    '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac',
    '.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm'
  })[ext] || 'application/octet-stream';
}

export function createAssetHubRouter() {
  const r = express.Router();
  r.get("/api/assets/health", (_req, res) => res.json({ ok: true, service: "asset-hub" }));

  r.post("/api/assets/upload", upload.single("file"), async (req, res) => {
    let temp = null;
    try {
      const { apiKey, userId } = activeAccount();
      if (!req.file) return res.status(400).json({ error: "File wajib diisi." });
      const assetType = String(req.body.assetType || "image").toLowerCase();
      const creatorType = String(req.body.creatorType || "user").toLowerCase();
      const groupId = String(req.body.groupId || "").trim();
      const displayName = String(req.body.displayName || path.basename(req.file.originalname, path.extname(req.file.originalname))).trim();
      const description = String(req.body.description || "");
      if (displayName.length < 3 || displayName.length > 50) return res.status(400).json({ error: "Nama asset harus 3–50 karakter." });
      if (creatorType === "group" && !/^\d+$/.test(groupId)) return res.status(400).json({ error: "Group ID tidak valid." });
      temp = path.join(os.tmpdir(), `robloxmid-${Date.now()}-${crypto.randomUUID()}${path.extname(req.file.originalname).toLowerCase()}`);
      fs.writeFileSync(temp, req.file.buffer);
      const result = await uploadGenericAsset({ filePath: temp, originalName: req.file.originalname, assetType, displayName, description, creatorType, userId, groupId, apiKey, fileContentType: contentType(req.file.originalname) });
      const assetId = result.assetId || null;
      res.json({ ok: true, ...result, assetId, displayName, assetUri: assetId ? `rbxassetid://${assetId}` : null, assetUrl: assetId ? `https://create.roblox.com/store/asset/${assetId}` : null });
    } catch (error) {
      console.error("[Asset Hub] upload error:", error);
      res.status(400).json({ error: error?.message || "Upload asset gagal." });
    } finally { if (temp) { try { fs.unlinkSync(temp); } catch {} } }
  });

  r.get("/api/assets/:assetId", async (req, res) => {
    try { const { apiKey } = activeAccount(); res.json({ ok: true, asset: await getGenericAsset(req.params.assetId, apiKey) }); }
    catch (error) { res.status(400).json({ error: error?.message || "Gagal mengambil metadata asset." }); }
  });

  async function roblox(url, apiKey, init = {}) {
    const response = await fetch(url, { ...init, headers: { "x-api-key": apiKey, ...(init.headers || {}) } });
    const text = await response.text(); let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) throw new Error(data?.message || data?.error || data?.details?.[0]?.message || `HTTP ${response.status}`);
    return data;
  }
  r.get("/api/assets/:assetId/versions", async (req, res) => { try { const { apiKey }=activeAccount(); res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}/versions`,apiKey)); } catch(e){res.status(400).json({error:e.message});} });
  r.get("/api/assets/:assetId/versions/:version", async (req, res) => { try { const { apiKey }=activeAccount(); res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}/versions/${encodeURIComponent(req.params.version)}`,apiKey)); } catch(e){res.status(400).json({error:e.message});} });
  r.post("/api/assets/:assetId/rollback", express.json(), async (req,res)=>{try{const {apiKey}=activeAccount();res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}/versions:rollback`,apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req.body||{})}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/api/assets/:assetId/archive", async (req,res)=>{try{const {apiKey}=activeAccount();res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}:archive`,apiKey,{method:'POST'}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/api/assets/:assetId/restore", async (req,res)=>{try{const {apiKey}=activeAccount();res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}:restore`,apiKey,{method:'POST'}));}catch(e){res.status(400).json({error:e.message});}});
  r.patch("/api/assets/:assetId/metadata", express.json(), async (req,res)=>{try{const {apiKey}=activeAccount();res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}`,apiKey,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(req.body||{})}));}catch(e){res.status(400).json({error:e.message});}});
  return r;
}

