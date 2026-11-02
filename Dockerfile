FROM node:22-bookworm-slim

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install dependencies (better-sqlite3 has prebuilt binaries for node 22 Linux)
RUN npm install --omit=dev

# Copy application source files
COPY . .

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV ADMIN_PORT=4000
ENV ADMIN_USER=admin
ENV ADMIN_PASS=changeme

# Expose Player (3000) and Admin (4000)
EXPOSE 3000 4000

# Start server
CMD ["node", "server.js"]
