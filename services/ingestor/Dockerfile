FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Expose ports
EXPOSE 8080 5555

# Start application
CMD ["node", "src/index.js"]
