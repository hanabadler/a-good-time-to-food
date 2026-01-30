# Backend Dockerfile
# Use Debian 11 (Bullseye): has OpenSSL 1.1.x. Prisma 5.x defaults to debian-openssl-1.1.x
# and fails on Bookworm (OpenSSL 3) unless we force binaryTargets + env. Bullseye works out of the box.
FROM node:18-bullseye-slim

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
