FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg is required by the transcode worker (same image is used for api and worker)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
RUN mkdir -p /data/uploads /data/media
ENV UPLOAD_DIR=/data/uploads MEDIA_DIR=/data/media
EXPOSE 4000
CMD ["node", "dist/server.js"]
