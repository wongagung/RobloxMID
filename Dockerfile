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

# Runtime source wiring lives in the repository. Do not mutate application files
# during image build; this keeps Docker builds reproducible and prevents deleted
# modules from being reintroduced.

RUN mkdir -p uploads data
EXPOSE 8787
CMD ["npm","start"]
