# Use Node 18 as base image
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app files
COPY . .

# Expose port 5001
EXPOSE 5001

# Start the app
CMD ["npm", "start"]