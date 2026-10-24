# Admin UI + Worker without Cloudflare, for a server on the store LAN (README.md).
# Same code as the Cloudflare deploy, run by workerd (wrangler dev, local mode); D1 and the
# live-view Durable Object are SQLite files under /data. Build context: web/ (compose.yaml).
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx vite build
COPY --from=lan entrypoint.sh /entrypoint.sh

ENV CI=true WRANGLER_SEND_METRICS=false
EXPOSE 8787
CMD ["sh", "/entrypoint.sh"]
