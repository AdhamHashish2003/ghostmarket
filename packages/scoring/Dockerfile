FROM node:20-slim

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/scoring/package*.json ./packages/scoring/

RUN npm install --workspace=packages/shared --workspace=packages/scoring

COPY packages/shared/ ./packages/shared/
COPY packages/scoring/ ./packages/scoring/

RUN npm run build --workspace=packages/shared

WORKDIR /app/packages/scoring
CMD ["npx", "tsx", "src/index.ts"]
