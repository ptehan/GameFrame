FROM node:22-bookworm-slim AS node-runtime
FROM python:3.13-slim-bookworm
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
ENV NODE_ENV=production GAMEFRAME_HOSTED=1 GAMEFRAME_DATA_DIR=/var/data/gameframe \
    GAMEFRAME_SYNTHETIC_DB=/var/data/assets/hittrax.sqlite \
    GAMEFRAME_EV_PYTHON=/usr/local/bin/python PYTHON=/usr/local/bin/python \
    FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 NUMBA_NUM_THREADS=1 \
    EV_RENDER_WORKERS=1 EV_ENCODER_THREADS=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg fonts-dejavu-core fonts-liberation make g++ rclone tini gosu \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY ev-predictor/requirements.txt ./ev-predictor/requirements.txt
RUN pip install --no-cache-dir -r ev-predictor/requirements.txt
COPY . .
RUN groupadd --gid 10001 gameframe && useradd --uid 10001 --gid gameframe --create-home gameframe \
    && mkdir -p /var/data/gameframe /var/data/assets /var/data/gameframe-backups \
    && chown gameframe:gameframe /var/data/gameframe /var/data/assets /var/data/gameframe-backups \
    && chmod +x /app/scripts/hosted-entrypoint.sh
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/hosted-entrypoint.sh"]
