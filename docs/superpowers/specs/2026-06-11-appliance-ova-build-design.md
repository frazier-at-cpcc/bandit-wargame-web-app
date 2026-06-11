# Appliance Image (OVA + qcow2) Build — Design Spec

**Date:** 2026-06-11
**Status:** Approved design — ready to build

## Purpose

Add a GitHub Actions pipeline that packages the Bandit Wargame Web App as a deployable
VM appliance: an **OVA** (portable) and a **qcow2** (clean Proxmox import). The appliance
boots, runs the app's existing Docker image, and serves it on port 80.

## Decisions (from brainstorming)

- **Runtime inside the VM:** Docker, reusing the app's existing `Dockerfile`. The image is
  built and `docker save`d in CI; the appliance only `docker load`s + `docker run`s it.
- **Artifacts:** both OVA and qcow2.
- **Trigger:** every push to `main` (docs-only paths ignored) + manual `workflow_dispatch`.
  Artifacts uploaded via `actions/upload-artifact` (14-day retention).
- **Access:** container maps host `:80` → app `:3000`, DHCP networking, default user
  `bandit`/`bandit` (sudo) with SSH password auth, forced password change on first login.
  `HEADER_TEXT` set via `/etc/bandit/app.env`.
- **VM hardware defaults:** 2 vCPU, 2 GB RAM, 12 GB disk, 1 SATA disk, 1 e1000 NIC.

## Build method

`libguestfs` offline customization of an Ubuntu 24.04 cloud image — no ISO install, no VM
boot during build, fully scriptable on hosted runners (which expose `/dev/kvm`).

1. CI builds the app image and `docker save | gzip` → `image.tar.gz`.
2. Download Ubuntu 24.04 `cloudimg` qcow2; `virt-resize --expand /dev/sda1` into a 12 GB disk
   (grows rootfs offline before any boot).
3. `virt-customize --network`:
   - `apt install docker.io`, enable Docker.
   - copy `image.tar.gz` → `/opt/bandit/`, `app.env` → `/etc/bandit/`, `bandit-run.sh` →
     `/usr/local/bin/`, `bandit-app.service` → `/etc/systemd/system/` (enabled), DHCP netplan.
   - create `bandit` user (sudo + docker groups), set password, force change, enable SSH
     password auth via an early-sorting sshd drop-in, disable cloud-init network management.
4. Convert: `qemu-img convert -O qcow2 -c` (Proxmox-native) and
   `qemu-img convert -O vmdk -o subformat=streamOptimized`; wrap the VMDK with a parameterized
   OVF + `.mf` manifest; `tar` (OVF, MF, VMDK order) → `.ova`.
5. Emit `SHA256SUMS` + `IMPORT.md`; upload all as a workflow artifact.

## Files

```
.github/workflows/build-appliance.yml   # CI: build image, run build-ova.sh, upload artifacts
appliance/build-ova.sh                   # libguestfs + convert + OVA/qcow2 packaging
appliance/ovf.template.xml               # parameterized OVF descriptor (capacity/file-size/name)
appliance/bandit-app.service             # systemd oneshot unit -> bandit-run.sh
appliance/bandit-run.sh                  # idempotent docker load + run (host :80 -> :3000)
appliance/app.env                        # HEADER_TEXT (admin-editable)
appliance/netplan-99-dhcp.yaml           # DHCP on e* interfaces
appliance/IMPORT.md                      # Proxmox import steps (qm importdisk / GUI OVA wizard)
```

The `appliance/` dir and `.github/` are excluded from the app Docker image via `.dockerignore`.

## Caveats

- OVF is hand-templated; CI validates well-formedness and the VMDK, but the only true test is
  importing on real Proxmox. The qcow2 is the safety net.
- Appliance requires outbound internet at runtime to reach `overthewire.org`.
- Default `bandit/bandit` login forces a password change on first login.
- libguestfs on hosted runners: kernel must be readable (`chmod +r /boot/vmlinuz-*`) and the
  build runs as root with `LIBGUESTFS_BACKEND=direct`.

## Out of scope

- Direct Proxmox API provisioning (Packer proxmox builder) — we emit portable artifacts instead.
- TLS/reverse proxy in the appliance — app serves plain HTTP on :80.
- Tagged-release asset upload — easy follow-on; currently artifact-only.
