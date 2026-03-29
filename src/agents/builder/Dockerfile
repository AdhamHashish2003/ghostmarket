FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY src/shared ./src/shared
COPY src/db ./src/db
COPY src/agents/builder ./src/agents/builder
RUN npm ci --omit=dev && npm run build:builder
CMD ["node", "dist/agents/builder/index.js"]
