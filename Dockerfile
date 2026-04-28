FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY tsconfig.json ./
COPY src ./src
# Optional: ship the office-ambience WAV (custom background noise loop).
# Safe to omit — code falls back to the synthetic generator if assets/ is missing.
COPY assets ./assets

RUN npm run build
RUN npm prune --production

EXPOSE 3000
EXPOSE 9092

CMD ["node", "dist/index.js"]
