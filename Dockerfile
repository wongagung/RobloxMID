FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p uploads data
EXPOSE 8787
CMD ["npm","start"]