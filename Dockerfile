# Build stage for React frontend
FROM node:20-slim AS build
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

# Final stage
FROM node:20-slim

# Install LibreOffice and other dependencies
RUN apt-get update && apt-get install -y \
    libreoffice \
    libreoffice-java-common \
    qpdf \
    fonts-liberation \
    fonts-freefont-ttf \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend
COPY server/package*.json ./server/
RUN cd server && npm install --production

COPY server/ ./server/

# Copy built frontend to backend public folder or serve it via a static middleware
# Let's adjust backend to serve static files from client/dist
COPY --from=build /app/client/dist ./server/public

EXPOSE 5000

ENV PORT=5000
ENV NODE_ENV=production

WORKDIR /app/server
CMD ["node", "index.js"]
