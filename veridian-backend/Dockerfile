# Build stage: sqlite3 is a native addon. It ships prebuilt binaries for most
# platforms, but if none matches the build target it falls back to compiling
# from source, which needs python3/make/g++ - not present in the slim runtime
# image. Installing them only in this stage keeps the final image lean.
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

# Runtime stage
FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

EXPOSE 5000

CMD ["node", "src/server.js"]
