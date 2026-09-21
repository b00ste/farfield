# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor/rarefriends-friendsdk-0.1.2.tgz ./vendor/rarefriends-friendsdk-0.1.2.tgz
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY games ./games
COPY host ./host
COPY scripts ./scripts
COPY server ./server
COPY shared ./shared
COPY tsconfig.json ./
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4173 RF_WAGERS_ENABLED=false
WORKDIR /app
# Docker initializes a new named volume from this owned directory. The marker
# ensures the UID 1000 directory is populated on first use, without root startup.
RUN mkdir -p /data && touch /data/.keep && chown -R node:node /data
COPY --from=build --chown=node:node /app/dist/server.mjs ./dist/server.mjs
COPY --from=build --chown=node:node /app/games/farfield/.friendsdk ./games/farfield/.friendsdk
USER node
EXPOSE 4173
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
