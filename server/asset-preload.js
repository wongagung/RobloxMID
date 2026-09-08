import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import multer from "multer";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { uploadGenericAsset, getGenericAsset } from "./asset-hub.js";
import { mountUrlSourceRoutes } from "./url-source.js";
import { mountYtDownloadFallback } from "./youtube-download-fallback.js";

const execFileAsync = promisify(execFile);
const API_BASE = "https://apis.roblox.com";
const MAX_BYTES = 20 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });
const ROOT = path.resolve(process.cwd());

function normalizeSourceUrl(value) {
  let url = String(value ?? "").trim();
  for (let i = 0; i < 2; i++) {
    try { const decoded = decodeURIComponent(url); if (decoded === url) break; url = decoded.trim(); } catch { break; }
  }
  return url.replace(/^\s*[`'\"]+/, "").replace(/[\`'\"]+\s*$/, "").replace(/&amp;/gi, "&").trim();
}
function requestUrl(req) {
  const body = req.body;
  const candidate = typeof body === "string" ? body : body?.url ?? body?.sourceUrl ?? body?.link ?? req.query?.url ?? req.query?.u ?? "";
  let url = normalizeSourceUrl(candidate);
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && /^(?:www\.)?(?:youtube\.com|youtu\.be|music\.youtube\.com|soundcloud\.com)/i.test(url)) url = `https://${url}`;
  return url;
}
function activeAccount(){const accountsFile=path.join(ROOT,"data","roblox-accounts.json");try{const data=JSON.parse(fs.readFileSync(accountsFile,"utf8"));const acc=data.accounts?.find(a=>a.id===data.active);if(acc?.apiKey&&acc?.userId)return{apiKey:acc.apiKey,userId:String(acc.userId),label:acc.label||acc.id};}catch{}const apiKey=process.env.ROBLOX_API_KEY,userId=process.env.ROBLOX_USER_ID;if(!apiKey||!userId)throw new Error("Roblox account/API key belum dikonfigurasi.");return{apiKey,userId:String(userId),label:"Default (.env)"};}
function contentType(filename){const ext=path.extname(filename).toLowerCase();return({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.bmp':'image/bmp','.tga':'image/x-tga','.fbx':'model/fbx','.gltf':'model/gltf+json','.glb':'model/gltf-binary','.rbxm':'model/x-rbxm','.rbxmx':'model/x-rbxm','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm'})[ext]||'application/octet-stream';}
function normalizeAssetType(value){const raw=String(value||"Image").trim().toLowerCase();const map={image:"image",decal:"decal",model:"model",animation:"animation",audio:"audio",video:"video",asset_type_image:"image",asset_type_decal:"decal",asset_type_model:"model",asset_type_animation:"animation",asset_type_audio:"audio",asset_type_video:"video"};return map[raw]||raw;}

export function createAssetHubRouter(){
  const r=express.Router();
  r.use(express.json({limit:"2mb"}));
  r.get("/app.js",(_req,res)=>{try{const appJs=fs.readFileSync(path.join(ROOT,"public","app.js"),"utf8");const paginationJs=fs.readFileSync(path.join(ROOT,"public","playlist-pagination.js"),"utf8");res.type("application/javascript").set("Cache-Control","no-store").send(`${appJs}\n\n/* ---- RobloxMID playlist pagination ---- */\n${paginationJs}`);}catch(error){console.error("[Asset Hub] app.js wrapper failed:",error);res.status(500).type("text/plain").send("Failed to load application script.");}});
  r.get("/api/assets/health",(_req,res)=>res.json({ok:true,service:"asset-hub"}));

  r.post("/api/playlist-info",(req,res,next)=>{const url=requestUrl(req);try{const parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol)||!parsed.pathname.toLowerCase().endsWith(".mp3"))return next();const filename=path.basename(parsed.pathname)||"track.mp3";const title=path.basename(filename,path.extname(filename)).replace(/[-_]+/g," ").trim().slice(0,100)||"Track";return res.json({isPlaylist:false,playlistTitle:null,total:1,limited:false,items:[{id:crypto.createHash("sha1").update(url).digest("hex").slice(0,16),title,duration:0,duration_string:"",thumbnail:null,uploader:"",webpage_url:url,playlist_title:null}]});}catch{return next();}});

  r.post("/api/playlist-info",async(req,res,next)=>{
    const url=requestUrl(req);if(!url)return res.status(400).json({error:"Masukkan URL lengkap, misalnya https://youtube.com/playlist?list=...",code:"INVALID_URL"});let parsed;try{parsed=new URL(url);}catch{return res.status(400).json({error:"URL tidak valid. Gunakan https://...",code:"INVALID_URL"});}if(!["http:","https:"].includes(parsed.protocol))return res.status(400).json({error:"URL harus menggunakan http:// atau https://",code:"INVALID_URL"});
    const page=Math.max(1,Math.floor(Number(req.query.page)||1));
    const pageSize=Math.min(50,Math.max(10,Math.floor(Number(req.query.pageSize)||50)));
    const rawMax=Number(req.query.maxItems??100);const maxItems=rawMax===0?0:([100,500].includes(rawMax)?rawMax:100);
    const start=((page-1)*pageSize)+1;if(maxItems>0&&start>maxItems)return res.json({isPlaylist:true,playlistTitle:null,total:0,page,pageSize,maxItems,hasNext:false,items:[]});
    const wantedEnd=maxItems>0?Math.min(maxItems,start+pageSize-1):start+pageSize-1;const probeEnd=maxItems>0&&wantedEnd>=maxItems?wantedEnd:wantedEnd+1;
    try{
      const cookiesPath=path.join(ROOT,"cookies.txt");const hasCookies=fs.existsSync(cookiesPath)&&fs.statSync(cookiesPath).size>0;
      const args=["--js-runtimes",`node:${process.execPath}`,"--remote-components","ejs:github","--yes-playlist","--flat-playlist","--playlist-start",String(start),"--playlist-end",String(probeEnd),"--dump-json","--no-warnings","--retries","3","--socket-timeout","30",...(hasCookies?["--cookies",cookiesPath]:[]),url];
      const{stdout}=await execFileAsync("yt-dlp",args,{timeout:90000,maxBuffer:20*1024*1024});
      const rawItems=String(stdout||"").split("\n").filter(Boolean).map(line=>{try{const info=JSON.parse(line);return{id:String(info.id||crypto.createHash("sha1").update(JSON.stringify(info)).digest("hex").slice(0,16)),title:String(info.title||info.fulltitle||"Unknown").slice(0,100),duration:Number(info.duration||0),duration_string:info.duration_string||"",thumbnail:info.thumbnail||null,uploader:info.uploader||info.channel||"",webpage_url:info.webpage_url||info.original_url||info.url||url,playlist_title:info.playlist_title||info.playlist||null};}catch{return null;}}).filter(Boolean);
      const items=rawItems.slice(0,pageSize);const playlistTitle=rawItems.find(x=>x.playlist_title)?.playlist_title||null;const isPlaylist=Boolean(playlistTitle)||rawItems.length>1||page>1;const hasNext=isPlaylist&&rawItems.length>items.length&&(maxItems===0||wantedEnd<maxItems);
      res.json({isPlaylist,playlistTitle,total:items.length,totalLoaded:items.length,page,pageSize,maxItems,hasNext,limited:false,items});
    }catch(error){const msg=String(error?.stderr||error?.message||"").toLowerCase();if(msg.includes("sign in")||msg.includes("captcha")||msg.includes("not a bot")||msg.includes("cookies"))return res.status(403).json({error:"Sumber meminta login/verifikasi. Upload cookies.txt terbaru.",code:"AUTH_REQUIRED"});res.status(502).json({error:"Gagal mengambil playlist. Pastikan URL valid dan dapat diakses.",code:"PLAYLIST_FETCH_FAILED"});}
  });

  mountYtDownloadFallback(r);
  mountUrlSourceRoutes(r);

  r.post("/api/assets/upload",upload.single("file"),async(req,res)=>{let temp=null;try{const account=activeAccount();if(!req.file)return res.status(400).json({error:"File wajib diisi."});const assetType=normalizeAssetType(req.body.assetType);const creatorType=String(req.body.creatorType||"user").toLowerCase();const groupId=String(req.body.groupId||"").trim();const displayName=String(req.body.displayName||path.basename(req.file.originalname,path.extname(req.file.originalname))).trim();const description=String(req.body.description||"");if(displayName.length<3||displayName.length>50)return res.status(400).json({error:"Nama asset harus 3–50 karakter."});if(!["user","group"].includes(creatorType))return res.status(400).json({error:"Creator type tidak valid."});if(creatorType==="group"&&!/^\d+$/.test(groupId))return res.status(400).json({error:"Group ID tidak valid."});temp=path.join(os.tmpdir(),`robloxmid-${Date.now()}-${crypto.randomUUID()}${path.extname(req.file.originalname).toLowerCase()}`);fs.writeFileSync(temp,req.file.buffer);const result=await uploadGenericAsset({filePath:temp,originalName:req.file.originalname,assetType,displayName,description,creatorType,userId:account.userId,groupId,apiKey:account.apiKey,fileContentType:contentType(req.file.originalname)});const assetId=result.assetId||null;res.json({ok:true,...result,assetId,displayName,assetType,account:account.label,assetUri:assetId?`rbxassetid://${assetId}`:null,assetUrl:assetId?`https://create.roblox.com/store/asset/${assetId}`:null});}catch(error){console.error("[Asset Hub] upload error:",error);res.status(400).json({error:error?.message||"Upload asset gagal."});}finally{if(temp){try{fs.unlinkSync(temp)}catch{}}}});
  r.get("/api/assets/:assetId/thumbnail",async(req,res)=>{try{const id=String(req.params.assetId||"").trim();if(!/^\d+$/.test(id))return res.status(400).json({error:"Asset ID tidak valid."});const url=`https://thumbnails.roblox.com/v1/assets?assetIds=${encodeURIComponent(id)}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`;const response=await fetch(url);const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{}if(!response.ok)return res.status(response.status).json({error:data?.errors?.[0]?.message||`Thumbnail HTTP ${response.status}`});const item=data?.data?.[0]||null;res.json({ok:true,state:item?.state||"Unavailable",imageUrl:item?.imageUrl||null,version:item?.version||null});}catch(e){res.status(400).json({error:e?.message||"Gagal mengambil thumbnail."});}});
  r.get("/api/assets/:assetId",async(req,res)=>{try{const{apiKey}=activeAccount();const defaultMask="description,displayName,creationContext,revisionId,revisionCreateTime,moderationResult,icon,previews,state";const requestedMask=String(req.query.readMask||defaultMask).trim();res.json({ok:true,asset:await getGenericAsset(req.params.assetId,apiKey,requestedMask||defaultMask)});}catch(error){res.status(400).json({error:error?.message||"Gagal mengambil metadata asset."});}});
  async function roblox(url,apiKey,init={}){const response=await fetch(url,{...init,headers:{"x-api-key":apiKey,...(init.headers||{})}});const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}if(!response.ok)throw new Error(data?.message||data?.error||data?.details?.[0]?.message||`HTTP ${response.status}`);return data;}
  r.get("/api/assets/:assetId/versions",async(req,res)=>{try{const{apiKey}=activeAccount();res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}/versions?maxPageSize=50`,apiKey));}catch(e){res.status(400).json({error:e.message});}});
  r.get("/api/assets/:assetId/versions/:version",async(req,res)=>{try{const{apiKey}=activeAccount();res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}/versions/${encodeURIComponent(req.params.version)}`,apiKey));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/api/assets/:assetId/rollback",express.json(),async(req,res)=>{try{const{apiKey}=activeAccount();const version=String(req.body?.versionNumber||req.body?.assetVersion||"").trim();if(!version)return res.status(400).json({error:"Version number wajib diisi."});const assetVersion=version.includes("/versions/")?version:`assets/${req.params.assetId}/versions/${version}`;res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}/versions:rollback`,apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assetVersion})}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/api/assets/:assetId/archive",async(req,res)=>{try{const{apiKey}=activeAccount();res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}:archive`,apiKey,{method:'POST',headers:{'Content-Type':'application/json'}}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/api/assets/:assetId/restore",async(req,res)=>{try{const{apiKey}=activeAccount();res.json(await roblox(`${API_BASE}/assets/v1/assets/${encodeURIComponent(req.params.assetId)}:restore`,apiKey,{method:'POST',headers:{'Content-Type':'application/json'}}));}catch(e){res.status(400).json({error:e.message});}});
  return r;
}
