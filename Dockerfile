FROM node:22-alpine

RUN apk add --no-cache ffmpeg curl python3 py3-pip \
    && pip3 install --break-system-packages yt-dlp bgutil-ytdlp-pot-provider

# Verify plugin is found by yt-dlp
RUN python3 -c "import yt_dlp_plugins.extractor.getpot_bgutil_http; print('bgutil plugin OK')"

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p uploads data
EXPOSE 8787
CMD ["npm","start"]
