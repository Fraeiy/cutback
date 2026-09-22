FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-liberation ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY samples ./samples
RUN npm ci && npm run build

ENV NODE_ENV=production
ENV PORT=8791
ENV CUTBACK_DATA_DIR=/data
EXPOSE 8791
VOLUME ["/data"]
CMD ["npm", "start"]
