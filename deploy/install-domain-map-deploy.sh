#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  printf '%s\n' 'run this provisioning script as root' >&2
  exit 1
fi

readonly DEPLOY_USER=domainmap-deploy
readonly ROOT=/opt/domain-map
readonly INCOMING="$ROOT/incoming"
readonly RELEASES="$ROOT/releases"
readonly WRAPPER=/usr/local/sbin/domain-map-deploy
readonly PUBLIC_KEY=${1:-}

[[ -n "$PUBLIC_KEY" && -f "$PUBLIC_KEY" ]] || {
  printf 'usage: %s /path/to/domainmap-deploy.pub\n' "$0" >&2
  exit 2
}

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --system --create-home --user-group --shell /bin/bash "$DEPLOY_USER"
fi

readonly DEPLOY_GROUP=$(id -gn "$DEPLOY_USER")

install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 700 "$INCOMING"
install -d -o root -g root -m 755 "$RELEASES"
install -o root -g root -m 755 "$(dirname "$0")/domain-map-deploy.sh" "$WRAPPER"
install -o root -g root -m 755 "$(dirname "$0")/domain-map-backup.sh" /usr/local/sbin/domain-map-backup.sh
install -o root -g root -m 644 "$(dirname "$0")/domain-map.service" /etc/systemd/system/domain-map.service
install -o root -g root -m 644 "$(dirname "$0")/domain-map-backup.service" /etc/systemd/system/domain-map-backup.service
install -o root -g root -m 644 "$(dirname "$0")/domain-map-backup.timer" /etc/systemd/system/domain-map-backup.timer
systemctl daemon-reload
systemctl enable domain-map.service domain-map-backup.timer

install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 700 "/home/$DEPLOY_USER/.ssh"
install -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 600 "$PUBLIC_KEY" \
  "/home/$DEPLOY_USER/.ssh/authorized_keys"

cat > /etc/sudoers.d/domainmap-deploy <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: $WRAPPER
EOF
chmod 440 /etc/sudoers.d/domainmap-deploy
visudo -cf /etc/sudoers.d/domainmap-deploy

printf '%s\n' 'domain-map deploy user installed'
printf '%s\n' 'Add the matching private key and VPS host key to the protected GitHub production environment.'
