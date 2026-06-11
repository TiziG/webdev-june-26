# Build stage: compile server (tsc) and frontend (vite) in one go.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build

# Runtime stage: Node server serves both the API/websocket and the built
# frontend (dist/public) on a single port.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "dist/server/src/index.js"]
