FROM node:20-slim
WORKDIR /app
COPY src/dashboard/package.json src/dashboard/package-lock.json* ./
RUN npm ci
COPY src/dashboard ./
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
