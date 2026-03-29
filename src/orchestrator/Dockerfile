FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY src/shared ./src/shared
COPY src/db ./src/db
COPY src/orchestrator ./src/orchestrator
RUN npm ci --omit=dev && npm run build:orchestrator
EXPOSE 4000
CMD ["node", "dist/orchestrator/index.js"]
