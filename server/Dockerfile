# Backend Dockerfile
FROM node:18-alpine

WORKDIR /app

# Install Prisma CLI globally (needed for migrations)
RUN npm install -g prisma

# Copy package files
COPY package*.json ./

# Install all dependencies (Prisma is in devDependencies)
RUN npm ci

# Copy Prisma schema
COPY prisma ./prisma

# Generate Prisma Client
RUN npx prisma generate

# Copy application code
COPY . .

# Create directory for database if it doesn't exist
RUN mkdir -p /app/prisma

# Expose port
EXPOSE 3001

# Run migrations and start server
CMD ["sh", "-c", "npx prisma migrate deploy || true && node index.js"]
