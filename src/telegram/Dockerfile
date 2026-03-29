FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY src/shared ./src/shared
COPY src/db ./src/db
COPY src/telegram ./src/telegram
RUN npm ci --omit=dev && npm run build:telegram
CMD ["node", "dist/telegram/index.js"]
