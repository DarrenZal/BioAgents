# Base stage with full build tooling
FROM node:23.3.0-slim AS base

# Install pnpm and essential native build tools
RUN npm install -g pnpm@9.15.4 && \
    apt-get update && \
    apt-get install -y \
    git \
    python3 \
    python3-pip \
    curl \
    node-gyp \
    ffmpeg \
    libtool-bin \
    autoconf \
    automake \
    libopus-dev \
    make \
    g++ \
    build-essential \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    libssl-dev \
    libsecret-1-dev \
    ghostscript \
    graphicsmagick && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package manager files early for better caching
COPY package.json pnpm-lock.yaml* ./

# Install dependencies early to maximize layer caching
RUN pnpm install

# Copy rest of the code
COPY . .

# Build stage
FROM base AS builder

RUN pnpm build

# Production stage (slimmer, faster runtime)
FROM node:23.3.0-slim AS production

# Only install runtime dependencies
RUN npm install -g pnpm@9.15.4 && \
    apt-get update && \
    apt-get install -y \
    git \
    python3 \
    ffmpeg \
    ghostscript \
    graphicsmagick && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY .env .env

# Copy just the production node modules and built code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy DB/migrations/schemas/etc
COPY drizzle ./drizzle
COPY src/db/schemas ./src/db/schemas
COPY drizzle.config.ts ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
