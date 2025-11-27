# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (using npm install since package-lock.json may not exist)
RUN npm install --omit=dev

# Copy source code
COPY . .

# Expose port (Fly.io will map this to internal_port in fly.toml)
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

