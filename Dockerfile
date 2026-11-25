# syntax=docker/dockerfile:1

# ── Build stage: install everything (incl. devDependencies) and stage
# the application source. This app has no compile/build step (plain
# ESM Node), so the stage exists to keep the runtime image clean.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# ── Runtime stage: production dependencies only, no dev tooling.
# The old image installed bash/git/curl via apk — none are needed at
# runtime, so they are not installed here.
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/src ./src
# The app serves /uploads and multer writes there at runtime; the
# non-root `node` user needs a writable directory.
RUN mkdir -p uploads && chown -R node:node /app
USER node
EXPOSE 5000
CMD ["npm", "start"]
