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
const ROOT = path.resolve(process.cwd());

function activeAccount() {
  const accountsFile = path.join(ROOT, "data", "roblox-accounts.json");
  try {
    const data = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
    const acc = data.accounts?.find(a => a.id === data.active);
    if (acc?.apiKey && acc?.userId) return { apiKey: acc.apiKey, userId: String(acc.userId), label: acc.label || acc.id };
  } catch {}
  const apiKey = process.env.ROBLOX_API_KEY;
  const userId = process.env.ROBLOX_USER_ID;
  if (!apiKey || !userId) throw new Error("Roblox account/API key belum dikonfigurasi.");
  return { apiKey, userId: String(userId), label: "Default (.env)" };
}

function contentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.bmp':'image/bmp','.tga':'image/x-tga','.fbx':'model/fbx','.gltf':'model/gltf+json','.glb':'model/gltf-binary','.rbxm':'model/x-rbxm','.rbxmx':'model/x-rbxm','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm'})[ext] || 'application/octet-stream';
}

function normalizeAssetType(value) {
  const raw = String(value || "Image").trim().toLowerCase();
  const map = { image:"image", decal:"decal", model:"model", animation:"animation", audio:"audio", video:"video", asset_type_image:"image", asset_type_decal:"decal", asset_type_model:"model", asset_type_animation:"animation", asset_type_audio:"audio", asset_type_video:"video" };
  return map[raw] || raw;
}

export function createAssetHubRouter() {
  const r = express.Router();
  r.get("/api/assets/health", (_req, res) => res.json({ ok: true, service: "asset-hub" }));

  r.post("/api/assets/upload", upload.single("file"), async (req, res) => {
    let temp = null;
    try {
      const account = activeAccount();
      if (!req.file) return res.status(400).json({ error: "File wajib diisi." });
      const assetType = normalizeAssetType(req.body.assetType);
      const creatorType = String(req.body.creatorType || "user").toLowerCase();
      const groupId = String(req.body.groupId || "").trim();
      const displayName = String(req.body.displayName || path.basename(req.file.originalname, path.extname(req.file.originalname))).trim();
      const description = String(req.body.description || "");
      if (displayName.length < 3 || displayName.length > 50) return res.status(400).json({ error: "Nama asset harus 3–50 karakter." });
      if (!["user", "group"].includes(creatorType)) return res.status(400).json({ error: "Creator type tidak valid." });
      if (creatorType === "group" && !/^\d+$/.test(groupId)) return res.status(400).json({ error: "Group ID tidak valid." });
      temp = path.join(os.tmpdir(), `robloxmid-${Date.now()}-${crypto.randomUUID()}${path.extname(req.file.originalname).toLowerCase()}`);
      fs.writeFileSync(temp, req.file.buffer);
      const result = await uploadGenericAsset({ filePath: temp, originalName: req.file.originalname, assetType, displayName, description, creatorType, userId: account.userId, groupId, apiKey: account.apiKey, fileContentType: contentType(req.file.originalname) });
      const assetId = result.assetId || null;
      res.json({ ok: true, ...result, assetId, displayName, assetType, account: account.label, assetUri: assetId ? `rbxassetid://${assetId}` : null, assetUrl: assetId ? `https://create.roblox.com/store/asset/${assetId}` : null });
    } catch (error) {
      console.error("[Asset Hub] upload error:", error);
      res.status(400).json({ error: error?.message || "Upload asset gagal." });
    } finally { if (temp) { try { fs.unlinkSync(temp); } catch {} } }
  });

  r.get("/api/assets/:assetId/thumbnail", async (req,res)=>{
    try {
      const id=String(req.params.assetId||"").trim();
      if(!/^\d+$/.test(id)) return res.status(400).json({error:"Asset ID tidak valid."});
      const url=`https://thumbnails.roblox.com/v1/assets?assetIds=${encodeURIComponent(id)}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`;
      const response=await fetch(url);
      const text=await response.text();
      let data={}; try{data=text?JSON.parse(text):{};}catch{}
      if(!response.ok) return res.status(response.status).json({error:data?.errors?.[0]?.message||`Thumbnail HTTP ${response.status}`});
      const item=data?.data?.[0]||null;
      res.json({ok:true,state:item?.state||"Unavailable",imageUrl:item?.imageUrl||null,version:item?.version||null});
    } catch(e){res.status(400).json({error:e?.message||"Gagal mengambil thumbnail."});}
  });

  r.get("/api/assets/:assetId", async (req, res) => {
    try {
      const { apiKey } = activeAccount();
      const defaultMask = "description,displayName,creationContext,revisionId,revisionCreateTime,moderationResult,icon,previews,state";
      const requestedMask = String(req.query.readMask || defaultMask).trim();
      res.json({ ok: true, asset: await getGenericAsset(req.params.assetId, apiKey, requestedMask || defaultMask) });
    } catch (error) { res.status(400).json({ error: error?.message || "Gagal mengambil metadata asset." }); }
  });

  async function roblox(url, apiKey, init = {}) {
    const response = await fetch(url, { ...init, headers: { "x-api-key": apiKey, ...(init.headers || {}) } });
    const text = await response.text(); let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) throw new Error(data?.message || data?.error || data?.details?.[0]?.message || `HTTP ${response.status}`);
    return data;
  }
  r.get("/api/assets/:assetId/versions", async (req, res) => { try { const { apiKey }=activeAccount(); res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}/versions?maxPageSize=50`,apiKey)); } catch(e){res.status(400).json({error:e.message});} });
  r.get("/api/assets/:assetId/versions/:version", async (req, res) => { try { const { apiKey }=activeAccount(); res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}/versions/${encodeURIComponent(req.params.version)}`,apiKey)); } catch(e){res.status(400).json({error:e.message});} });
  r.post("/api/assets/:assetId/rollback", express.json(), async (req,res)=>{try{const {apiKey}=activeAccount();const version=String(req.body?.versionNumber||req.body?.assetVersion||"").trim();if(!version) return res.status(400).json({error:"Version number wajib diisi."});const assetVersion=version.includes("/versions/")?version:`assets/${req.params.assetId}/versions/${version}`;res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}/versions:rollback`,apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assetVersion})}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/api/assets/:assetId/archive", async (req,res)=>{try{const {apiKey}=activeAccount();res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}:archive`,apiKey,{method:'POST',headers:{'Content-Type':'application/json'}}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/api/assets/:assetId/restore", async (req,res)=>{try{const {apiKey}=activeAccount();res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}:restore`,apiKey,{method:'POST',headers:{'Content-Type':'application/json'}}));}catch(e){res.status(400).json({error:e.message});}});
  return r;
}
