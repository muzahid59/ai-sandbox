# Use Node 22 as base image
FROM node:22-alpine

# Install OpenSSL (required by Prisma on Alpine)
RUN apk add --no-cache openssl

# Set working directory
WORKDIR /usr/src/app

# Copy shared types first
COPY shared/types /usr/src/shared/types

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm install

# Install nodemon for live reload
RUN npm install -g nodemon

# Copy prisma schema and generate client
COPY backend/prisma ./prisma
RUN npx prisma generate

# Copy app files
COPY backend/ .

# Expose port 5001
EXPOSE 5001

# Run migrations and start the app
CMD sh -c "until npx prisma migrate deploy; do echo 'DB not ready, retrying in 3s...'; sleep 3; done && npm run dev"
