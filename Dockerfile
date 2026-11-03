# ---- build: install production deps (better-sqlite3 needs a toolchain) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: small, non-root ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DATABASE_PATH=/data/halyard.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/node.js"]
