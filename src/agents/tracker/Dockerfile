FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY src/shared ./src/shared
COPY src/db ./src/db
COPY src/agents/tracker ./src/agents/tracker
RUN npm ci --omit=dev && npm run build:tracker
CMD ["node", "dist/agents/tracker/index.js"]
