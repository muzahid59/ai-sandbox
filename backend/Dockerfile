FROM node:22-alpine

RUN apk add --no-cache openssl
WORKDIR /usr/src/app

COPY backend/package*.json ./
RUN npm ci

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY shared/types /usr/src/shared/types
COPY backend/ .

EXPOSE 5001
CMD ["npx", "tsx", "watch", "src/server.ts"]
