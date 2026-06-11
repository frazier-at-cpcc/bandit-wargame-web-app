#!/usr/bin/env bash
# Build a Bandit Wargame Web App appliance: customize an Ubuntu cloud image with
# libguestfs, then emit a Proxmox-friendly qcow2 and a portable OVA.
#
# Expects the app's Docker image already saved to $IMAGE_TAR (docker save | gzip).
# Run as root (libguestfs needs to read the host kernel and /dev/kvm).
set -euo pipefail

APPLIANCE_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKDIR="${WORKDIR:-$PWD/build}"
OUT_DIR="${OUT_DIR:-$WORKDIR/out}"
IMAGE_TAR="${IMAGE_TAR:-$WORKDIR/image.tar.gz}"
DISK_SIZE="${DISK_SIZE:-12G}"
VM_NAME="${VM_NAME:-bandit-wargame-appliance}"
UBUNTU_IMG_URL="${UBUNTU_IMG_URL:-https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img}"

if [[ ! -f "$IMAGE_TAR" ]]; then
  echo "ERROR: app image tarball not found at $IMAGE_TAR" >&2
  exit 1
fi

mkdir -p "$WORKDIR" "$OUT_DIR"
cd "$WORKDIR"

echo "==> Downloading Ubuntu cloud image"
curl -fSL -o base.img "$UBUNTU_IMG_URL"

echo "==> Expanding root filesystem into a ${DISK_SIZE} disk (offline)"
qemu-img create -f qcow2 expanded.qcow2 "$DISK_SIZE"
# virt-resize grows the root partition AND its filesystem before any boot, so the
# subsequent docker.io install + image tarball have room.
virt-resize --expand /dev/sda1 base.img expanded.qcow2
rm -f base.img   # no longer needed; reclaim runner disk

echo "==> Staging appliance assets"
STAGE="$WORKDIR/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp "$IMAGE_TAR" "$STAGE/image.tar.gz"
cp "$APPLIANCE_DIR/app.env" "$STAGE/app.env"
cp "$APPLIANCE_DIR/bandit-run.sh" "$STAGE/bandit-run.sh"
cp "$APPLIANCE_DIR/bandit-app.service" "$STAGE/bandit-app.service"
cp "$APPLIANCE_DIR/netplan-99-dhcp.yaml" "$STAGE/99-dhcp.yaml"

echo "==> Customizing image with virt-customize"
# --network enables slirp networking inside the appliance so apt can fetch packages.
virt-customize -a expanded.qcow2 --network \
  --hostname bandit-appliance \
  --install docker.io \
  --run-command 'systemctl enable docker' \
  --mkdir /opt/bandit \
  --mkdir /etc/bandit \
  --copy-in "$STAGE/image.tar.gz:/opt/bandit" \
  --copy-in "$STAGE/app.env:/etc/bandit" \
  --copy-in "$STAGE/bandit-run.sh:/usr/local/bin" \
  --run-command 'chmod 0755 /usr/local/bin/bandit-run.sh' \
  --copy-in "$STAGE/bandit-app.service:/etc/systemd/system" \
  --run-command 'systemctl enable bandit-app.service' \
  --copy-in "$STAGE/99-dhcp.yaml:/etc/netplan" \
  --run-command 'chmod 0600 /etc/netplan/99-dhcp.yaml' \
  --write '/etc/cloud/cloud.cfg.d/99-disable-network-config.cfg:network: {config: disabled}' \
  --run-command 'useradd -m -s /bin/bash -G sudo,docker bandit || true' \
  --run-command "echo 'bandit:bandit' | chpasswd" \
  --write '/etc/ssh/sshd_config.d/00-bandit.conf:PasswordAuthentication yes' \
  --write '/etc/cloud/cloud.cfg.d/99-bandit-pwauth.cfg:ssh_pwauth: true' \
  --run-command 'chage -d 0 bandit' \
  --run-command 'systemctl enable ssh' \
  --run-command 'truncate -s 0 /etc/machine-id'

echo "==> Producing qcow2 (compressed)"
qemu-img convert -O qcow2 -c expanded.qcow2 "$OUT_DIR/$VM_NAME.qcow2"

echo "==> Producing streamOptimized VMDK"
qemu-img convert -O vmdk -o subformat=streamOptimized expanded.qcow2 "$OUT_DIR/$VM_NAME.vmdk"

echo "==> Generating OVF descriptor"
CAPACITY="$(qemu-img info --output=json expanded.qcow2 | jq -r '."virtual-size"')"
FILESIZE="$(stat -c%s "$OUT_DIR/$VM_NAME.vmdk")"
rm -f expanded.qcow2   # both converted outputs are written; reclaim runner disk
sed -e "s/@@VMDK_FILE@@/$VM_NAME.vmdk/g" \
    -e "s/@@DISK_FILE_SIZE@@/$FILESIZE/g" \
    -e "s/@@DISK_CAPACITY@@/$CAPACITY/g" \
    -e "s/@@VM_NAME@@/$VM_NAME/g" \
    "$APPLIANCE_DIR/ovf.template.xml" > "$OUT_DIR/$VM_NAME.ovf"

echo "==> Writing manifest and packaging OVA (ovf, mf, vmdk order)"
(
  cd "$OUT_DIR"
  OVF_SHA="$(sha256sum "$VM_NAME.ovf" | awk '{print $1}')"
  VMDK_SHA="$(sha256sum "$VM_NAME.vmdk" | awk '{print $1}')"
  printf 'SHA256(%s)= %s\nSHA256(%s)= %s\n' \
    "$VM_NAME.ovf" "$OVF_SHA" "$VM_NAME.vmdk" "$VMDK_SHA" > "$VM_NAME.mf"
  tar -cf "$VM_NAME.ova" "$VM_NAME.ovf" "$VM_NAME.mf" "$VM_NAME.vmdk"
  # Keep only the deliverables: the OVA and the standalone qcow2.
  rm -f "$VM_NAME.vmdk" "$VM_NAME.ovf" "$VM_NAME.mf"
  cp "$APPLIANCE_DIR/IMPORT.md" IMPORT.md
  sha256sum "$VM_NAME.ova" "$VM_NAME.qcow2" > SHA256SUMS
)

echo "==> Done. Artifacts:"
ls -lh "$OUT_DIR"
