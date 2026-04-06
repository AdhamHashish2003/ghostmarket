FROM node:20-slim

# Install Playwright + Chromium for browser-based scrapers
RUN npx playwright install --with-deps chromium || echo "Playwright optional"

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/scrapers/package*.json ./packages/scrapers/
COPY packages/scoring/package*.json ./packages/scoring/

RUN npm install

COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/scrapers/ ./packages/scrapers/
COPY packages/scoring/ ./packages/scoring/

# Build shared + scoring (needed for dist/ imports)
RUN cd packages/shared && npx tsc --skipLibCheck && cd ../scoring && npx tsc --skipLibCheck

EXPOSE 3007
WORKDIR /app/packages/scrapers
CMD ["sh", "-c", "PORT_API=${PORT:-3007} exec npx tsx src/index.ts"]
