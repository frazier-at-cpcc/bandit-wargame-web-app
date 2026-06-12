# Deploying the Bandit Wargame appliance on Proxmox

Two artifacts are produced by the `Build appliance image` workflow:

- `bandit-wargame-appliance.qcow2` — recommended for Proxmox (cleanest import).
- `bandit-wargame-appliance.ova` — portable (VMware/VirtualBox/Proxmox 8.2+).

Verify downloads against `SHA256SUMS`:
```bash
sha256sum -c SHA256SUMS
```

> **Boot firmware: UEFI is required.** The Ubuntu cloud image this is built on boots via UEFI.
> Importing under Proxmox's default **SeaBIOS (legacy)** drops to a `grub rescue>` prompt. The
> commands below set `--bios ovmf` and add an EFI disk — do not omit them. (Verified on
> Proxmox VE 9.1 with the sibling RH104 appliance, which uses the identical build pipeline.)

## Option A — qcow2 (recommended)

Copy the qcow2 to a Proxmox node, then:
```bash
# Pick an unused VM id and your target storage (e.g. local-lvm).
VMID=9000
STORAGE=local-lvm

qm create $VMID --name bandit-wargame --memory 2048 --cores 2 \
  --net0 virtio,bridge=vmbr0 --scsihw virtio-scsi-single --ostype l26 --bios ovmf

qm importdisk $VMID bandit-wargame-appliance.qcow2 $STORAGE
# importdisk attaches it as an unused disk; attach and make it bootable:
qm set $VMID --scsi0 $STORAGE:vm-$VMID-disk-0
qm set $VMID --boot order=scsi0
qm set $VMID --efidisk0 $STORAGE:0,efitype=4m,pre-enrolled-keys=0   # UEFI boot
qm set $VMID --serial0 socket --vga serial0   # optional: serial console
qm start $VMID
```
Adjust `vmbr0` to a bridge that has outbound internet (the app reaches
`overthewire.org` at runtime).

## Option B — OVA (Proxmox 8.2+ GUI)

1. Add or use a storage with the **Import** content type enabled.
2. Upload the `.ova` to that storage, then **Import** it from the storage view and
   follow the wizard. Set the NIC bridge to one with internet egress.
3. On older Proxmox: `qm importovf <vmid> bandit-wargame-appliance.ova <storage>`
   (extract the OVA first if needed: `tar xf bandit-wargame-appliance.ova`).
4. **After import, set the VM firmware to UEFI** (Hardware → BIOS → OVMF (UEFI), add an
   EFI Disk) before first boot — see the UEFI note above.

## First boot

- The app starts automatically (systemd `bandit-app.service`) and serves on
  **http://<vm-ip>/** (host port 80 → container 3000).
- Find the IP from the Proxmox console or your DHCP server.
- Console/SSH login: **bandit / bandit** — you'll be required to set a new password
  on first login.
- Change the PDF header by editing `/etc/bandit/app.env` then:
  `sudo systemctl restart bandit-app.service`.

## Notes

- The appliance needs outbound internet to reach the OverTheWire Bandit server.
- All students connect out through this VM's IP; OverTheWire rate-limits SSH, so for a
  large class stagger logins (the app already throttles and cools down after failures).
