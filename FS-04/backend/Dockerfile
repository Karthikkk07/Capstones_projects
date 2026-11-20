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
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# The prisma CLI (migrate deploy) and tsx (seed) are devDependencies, so node_modules is kept whole.
COPY --from=build /app /app
RUN mkdir -p /data/uploads
ENV UPLOAD_DIR=/data/uploads
EXPOSE 4000
# The API applies migrations on boot; the worker runs from the same image with `node dist/worker.js`.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
