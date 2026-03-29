FROM node:20-slim
WORKDIR /app
RUN npm install -g vercel
COPY package.json package-lock.json* tsconfig.json ./
COPY src/shared ./src/shared
COPY src/db ./src/db
COPY src/agents/deployer ./src/agents/deployer
RUN npm ci --omit=dev && npm run build:deployer
CMD ["node", "dist/agents/deployer/index.js"]
