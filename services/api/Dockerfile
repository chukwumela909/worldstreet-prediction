# Build context is services/api (in Coolify set Base Directory to /services/api).
FROM node:22-alpine AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
# --include=dev forces devDependencies (typescript/tsc) even when the host
# injects NODE_ENV=production as a build arg, which would otherwise omit them
# and break `tsc` in the builder stage below.
RUN npm ci --include=dev

FROM dependencies AS builder
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 api

COPY --from=production-dependencies --chown=api:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=api:nodejs /app/dist ./dist
COPY --chown=api:nodejs package.json ./

USER api
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
