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

RUN npm run build --workspace=packages/shared && npm run build --workspace=packages/scoring

WORKDIR /app/packages/scrapers
# Railway sets PORT at runtime — map it to PORT_API for the scraper fleet
CMD ["sh", "-c", "PORT_API=${PORT:-3007} exec npx tsx src/index.ts"]
