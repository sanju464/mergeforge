# Stage 1: Build the React frontend
FROM node:20-slim AS build
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

# Stage 2: Runtime
FROM node:20-slim
# Install only specified packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-java-common \
    qpdf \
    fonts-liberation \
    fonts-freefont-ttf \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --production
COPY server/ ./
# Copy built static files from stage 1 into the public folder
COPY --from=build /app/client/dist ./public

EXPOSE 5000
ENV PORT=5000
ENV NODE_ENV=production

CMD ["node", "index.js"]
