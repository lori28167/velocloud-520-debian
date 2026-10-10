#!/bin/sh
# Mounts the image and: sets root's password hash ($ROOT_HASH, if given) and
# regenerates grub.cfg with root=UUID=.  Runs in the build container:
#   docker run --rm --privileged -v $PWD:/w -e ROOT_HASH=... vc-debian-build /w/tools/img-fixup.sh /w/out/velocloud-debian.img
set -eu
LOOP=$(losetup -fP --show "$1")
n=${LOOP#/dev/}
for i in $(seq 20); do [ -e /sys/block/$n/${n}p1/dev ] && break; sleep 0.2; done
mm=$(cat /sys/block/$n/${n}p1/dev)
[ -b "${LOOP}p1" ] || mknod "${LOOP}p1" b "${mm%:*}" "${mm#*:}"
M=$(mktemp -d); mount "${LOOP}p1" "$M"
for d in dev proc sys run; do mount --bind /$d "$M/$d"; done
if [ -n "${ROOT_HASH:-}" ]; then chroot "$M" usermod -p "$ROOT_HASH" root; echo "root password set"; fi
UUID=$(blkid -s UUID -o value "${LOOP}p1")
mkdir -p /dev/disk/by-uuid; ln -sf "${LOOP}p1" "/dev/disk/by-uuid/$UUID"
chroot "$M" update-grub 2>&1 | tail -1
grep -E "^\s*(linux|search)" "$M/boot/grub/grub.cfg" | head -3
grep UUID "$M/etc/fstab"
for d in run sys proc dev; do umount "$M/$d"; done
umount "$M"; losetup -d "$LOOP"
