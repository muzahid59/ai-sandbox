# Use Node 22 LTS
FROM node:22-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy shared types first
COPY shared/types /usr/src/shared/types

# Copy package files
COPY app/package.json app/package-lock.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy app files
COPY app/ .

# Expose port 3000
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
