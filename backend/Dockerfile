# Use Node 18 as base image
FROM node:18-alpine

# Install OpenSSL (required by Prisma on Alpine)
RUN apk add --no-cache openssl

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Install nodemon for live reload
RUN npm install -g nodemon

# Copy prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy app files
COPY . .

# Expose port 5001
EXPOSE 5001

# Run migrations and start the app
CMD npx prisma migrate deploy && npm run dev