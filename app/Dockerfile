FROM node:22-alpine

WORKDIR /usr/src/app

COPY shared/types /usr/src/shared/types
COPY app/package.json app/package-lock.json ./
RUN npm install --legacy-peer-deps

COPY app/ .

EXPOSE 3000
CMD ["npm", "start"]
