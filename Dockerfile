FROM node:22.23-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# What the image actually runs. `next build` needs the dev dependencies; `next start` does not, so the
# runtime stage installs its own tree rather than carrying the build's.
FROM node:22.23-bookworm-slim AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22.23-bookworm-slim AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22.23-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/app ./app
COPY --from=build /app/components ./components
COPY --from=build /app/convex ./convex
COPY --from=build /app/lib ./lib
COPY --from=build /app/services ./services
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/proxy.ts ./proxy.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
USER node
# The server process itself, so Railway's SIGTERM reaches it rather than a shell and npm. `next start`
# reads PORT from the environment and binds every interface by default.
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0"]
