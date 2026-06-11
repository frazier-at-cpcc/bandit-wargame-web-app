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

echo "==> Provisioning via qemu-nbd + chroot (uses the runner's network, no passt)"
# virt-customize --network relies on passt, which is incompatible with libguestfs
# on Ubuntu 24.04 hosted runners ("passt exited with status 1"). Instead, attach
# the disk with qemu-nbd, mount it, and run apt inside a chroot that shares the
# runner's working network namespace — no guest networking helper involved.
MNT="$WORKDIR/mnt"
NBD=/dev/nbd0
mkdir -p "$MNT"

modprobe nbd max_part=8
qemu-nbd --connect="$NBD" expanded.qcow2

# Find the root partition. virt-resize can renumber GPT partitions, and 24.04
# cloud images carry a small separate ext4 /boot, so detect by filesystem type AND
# pick the LARGEST ext4 partition (the real root).
ROOT=""
for _ in $(seq 1 15); do
  ROOT="$(lsblk -brno NAME,FSTYPE,SIZE "$NBD" \
    | awk '$2=="ext4"{print $3, "/dev/"$1}' | sort -nr | head -1 | awk '{print $2}')"
  [ -n "$ROOT" ] && break
  sleep 1
done
[ -n "$ROOT" ] || { echo "ERROR: no ext4 root partition on $NBD" >&2; lsblk "$NBD" >&2; exit 1; }
echo "    root partition: $ROOT"
mount "$ROOT" "$MNT"
# Sanity-check we mounted the real root, not /boot or similar.
[ -x "$MNT/bin/bash" ] || { echo "ERROR: $ROOT is not the root fs" >&2; ls -la "$MNT" >&2; exit 1; }

# Bind mounts for a working chroot.
for d in dev dev/pts proc sys run; do mount --bind "/$d" "$MNT/$d"; done
# Working DNS for apt. The guest's /etc/resolv.conf is a systemd-resolved symlink;
# replace it with a real file (the chroot shares the runner's network namespace, so
# public resolvers are reachable). The symlink is restored after provisioning.
rm -f "$MNT/etc/resolv.conf"
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > "$MNT/etc/resolv.conf"
# Block package post-install from starting services inside the chroot.
printf '#!/bin/sh\nexit 101\n' > "$MNT/usr/sbin/policy-rc.d"
chmod 0755 "$MNT/usr/sbin/policy-rc.d"

# Place appliance files directly onto the mounted filesystem.
install -d -m 0755 "$MNT/opt/bandit" "$MNT/etc/bandit"
cp "$IMAGE_TAR" "$MNT/opt/bandit/image.tar.gz"
cp "$APPLIANCE_DIR/app.env" "$MNT/etc/bandit/app.env"
install -m 0755 "$APPLIANCE_DIR/bandit-run.sh" "$MNT/usr/local/bin/bandit-run.sh"
cp "$APPLIANCE_DIR/bandit-app.service" "$MNT/etc/systemd/system/bandit-app.service"
install -m 0600 "$APPLIANCE_DIR/netplan-99-dhcp.yaml" "$MNT/etc/netplan/99-dhcp.yaml"
printf 'network: {config: disabled}\n' > "$MNT/etc/cloud/cloud.cfg.d/99-disable-network-config.cfg"
printf 'PasswordAuthentication yes\n' > "$MNT/etc/ssh/sshd_config.d/00-bandit.conf"
printf 'ssh_pwauth: true\n' > "$MNT/etc/cloud/cloud.cfg.d/99-bandit-pwauth.cfg"
echo bandit-appliance > "$MNT/etc/hostname"

# Guest-context provisioning: install Docker, create the user, enable services.
chroot "$MNT" /bin/bash -eux <<'CHROOT'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends docker.io
systemctl enable docker
systemctl enable ssh
systemctl enable bandit-app.service
id bandit >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo,docker bandit
echo 'bandit:bandit' | chpasswd
chage -d 0 bandit
truncate -s 0 /etc/machine-id
apt-get clean
CHROOT

# Restore the cloud image's managed resolv.conf and drop the install guard.
rm -f "$MNT/usr/sbin/policy-rc.d"
ln -sf ../run/systemd/resolve/stub-resolv.conf "$MNT/etc/resolv.conf" 2>/dev/null || true

# Unwind mounts and detach the disk.
sync
for d in run sys proc dev/pts dev; do umount -l "$MNT/$d" 2>/dev/null || true; done
umount "$MNT" 2>/dev/null || umount -l "$MNT" 2>/dev/null || true
qemu-nbd --disconnect "$NBD"

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
