FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
COPY --from=build /app/dist ./dist
EXPOSE 8080
VOLUME /data
CMD ["node", "dist/server/entry.mjs"]
