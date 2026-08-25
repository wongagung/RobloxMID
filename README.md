# Roblox Music Uploader

Web dashboard untuk:
- preview audio
- upload MP3/WAV/OGG/FLAC
- kirim file ke Telegram
- upload audio ke Roblox Open Cloud
- menampilkan Roblox Asset ID
- copy `rbxassetid://...`
- menyimpan history lokal

## 1. Windows / local

```powershell
npm install
copy .env.example .env
npm start
```

Buka `http://localhost:8787`.

## 2. Environment

Isi `.env`:

```env
PORT=8787
MAX_FILE_SIZE_MB=20

ROBLOX_API_KEY=...
ROBLOX_USER_ID=...

TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

**Jangan commit `.env`.**

## 3. Roblox

Buat API key Roblox yang memiliki izin asset write dan gunakan User ID creator yang berwenang membuat asset. Audio diproses melalui Roblox Open Cloud. Roblox dapat melakukan moderation/processing sebelum asset siap dipakai.

## 4. Git → VM Ubuntu

Local:

```bash
git add .
git commit -m "feat: roblox music uploader"
git push origin main
```

VM:

```bash
git clone <REPO_URL> roblox-music-uploader
cd roblox-music-uploader
cp .env.example .env
nano .env
docker compose up -d --build
```

Update berikutnya:

```bash
git pull
docker compose up -d --build
```

## 5. Reverse proxy

Jika menggunakan Nginx, proxy domain ke:

```text
http://127.0.0.1:8787
```

## Catatan

Roblox Asset ID hanya dibuat oleh Roblox setelah upload berhasil. Aplikasi ini tidak "mengubah MP3 menjadi ID"; aplikasi mengirim audio ke Roblox Open Cloud lalu membaca hasil upload/operation.