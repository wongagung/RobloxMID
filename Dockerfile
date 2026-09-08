FROM node:22-alpine

RUN apk add --no-cache ffmpeg curl python3 py3-pip \
    && pip3 install --break-system-packages -U "yt-dlp[default]" bgutil-ytdlp-pot-provider

# Verify yt-dlp + EJS + BGUTIL plugin are installed.
RUN yt-dlp --version \
    && python3 -c "import yt_dlp_plugins.extractor.getpot_bgutil_http; print('bgutil plugin OK')"

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Keep the existing source handlers as fallback, but put the robust downloader first.
RUN sed -i '1i import { mountYtDownloadFallback } from "./youtube-download-fallback.js";' server/asset-preload.js \
    && sed -i 's/const r=express.Router();/const r=express.Router();mountYtDownloadFallback(r);/' server/asset-preload.js

# Load the polished playlist UI after the existing app/pagination scripts.
RUN sed -i 's#<script src="/audio-studio.js"></script>#<script src="/audio-studio.js"></script><script src="/playlist-ui-fix.js"></script>#' public/index.html

RUN mkdir -p uploads data
EXPOSE 8787
CMD ["npm","start"]
