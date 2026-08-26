FROM node:22-alpine

RUN apk add --no-cache ffmpeg curl

# Install yt-dlp as a static binary — no Python required
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p uploads data
EXPOSE 8787
CMD ["npm","start"]
