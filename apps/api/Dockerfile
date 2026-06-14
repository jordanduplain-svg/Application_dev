# Use an official Node.js runtime as a parent image
FROM node:20-alpine AS builder

# Set the working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy root configurations
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy monorepo packages
COPY packages ./packages
COPY apps/api ./apps/api

# Install dependencies (frozen-lockfile for CI/CD)
RUN pnpm install --frozen-lockfile

# Build shared package first
RUN cd packages/shared && pnpm build

# Generate Prisma Client
RUN cd apps/api && npx prisma generate

# Build the API
RUN cd apps/api && pnpm run build

# Production image
FROM node:20-alpine AS runner

WORKDIR /app
RUN npm install -g pnpm

# Copy built assets and necessary files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy startup script — conservé dans apps/api/scripts/ pour que les chemins
# relatifs internes au script (cd vers apps/api) restent corrects.
COPY apps/api/scripts/start.sh ./apps/api/scripts/start.sh
RUN chmod +x ./apps/api/scripts/start.sh

EXPOSE 3000

ENV NODE_ENV=production

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
ENTRYPOINT ["./apps/api/scripts/start.sh"]
