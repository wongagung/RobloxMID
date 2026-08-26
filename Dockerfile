FROM node:22-alpine

RUN apk add --no-cache ffmpeg curl python3 py3-pip \
    && pip3 install --break-system-packages yt-dlp

# Verify yt-dlp can find node at build time
RUN yt-dlp --version

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p uploads data
EXPOSE 8787
CMD ["npm","start"]
