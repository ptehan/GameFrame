#!/bin/sh
set -eu
test "${GAMEFRAME_DATA_DIR}" = /var/data/gameframe
mkdir -p /var/data/gameframe /var/data/assets /var/data/gameframe-backups
chown gameframe:gameframe /var/data/gameframe /var/data/assets /var/data/gameframe-backups
if [ -n "${RCLONE_CONFIG:-}" ] && [ -f "$RCLONE_CONFIG" ]; then
    install -D -m 600 -o gameframe -g gameframe "$RCLONE_CONFIG" /home/gameframe/.config/rclone/rclone.conf
    export RCLONE_CONFIG=/home/gameframe/.config/rclone/rclone.conf
fi
gosu gameframe node /app/scripts/provision-assets.cjs
exec gosu gameframe node /app/server.js
