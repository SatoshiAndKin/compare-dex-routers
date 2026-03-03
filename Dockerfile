FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm install -g tsx

COPY src/ ./src/
COPY static/ ./static/
COPY tsconfig.json ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["tsx", "src/server.ts"]
