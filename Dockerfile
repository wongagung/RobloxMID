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

# Playlist fix: the shared yt-dlp flags intentionally use --no-playlist for single URLs.
# The playlist-info route must explicitly override that behavior with --yes-playlist.
RUN sed -i '/"--flat-playlist",/a\        "--yes-playlist",' server/url-source.js

RUN mkdir -p uploads data
EXPOSE 8787
CMD ["npm","start"]
