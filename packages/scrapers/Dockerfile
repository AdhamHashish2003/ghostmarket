FROM node:20-slim

RUN npx playwright install --with-deps chromium

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/scrapers/package*.json ./packages/scrapers/
COPY packages/scoring/package*.json ./packages/scoring/

RUN npm install --workspace=packages/shared --workspace=packages/scrapers --workspace=packages/scoring

COPY packages/shared/ ./packages/shared/
COPY packages/scrapers/ ./packages/scrapers/
COPY packages/scoring/ ./packages/scoring/

RUN npm run build --workspace=packages/shared

WORKDIR /app/packages/scrapers
CMD ["npx", "tsx", "src/index.ts"]
