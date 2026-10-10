#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Builds the Debian 13 image for the VeloCloud Edge 520.  Runs as root in the
# vc-debian-build container (--privileged, for the loop device):
#   docker run --rm --privileged -v $PWD:/w [-e ROOT_HASH=...] [-e SSH_KEY=...] \
#     vc-debian-build /w/build-image.sh /w/out/velocloud-debian.img
set -eu
IMG=$1
SIZE=${SIZE:-3G}
W=$(cd "$(dirname "$0")" && pwd)
VER=0.2
KVER=$(ls /usr/src | sed -n 's/^linux-headers-\(.*-amd64\)$/\1/p')
MIRROR=http://deb.debian.org/debian
COMP="main contrib non-free non-free-firmware"
PKGS="systemd-sysv,systemd-resolved,systemd-timesyncd,udev,dbus,kmod,
linux-image-amd64,linux-headers-amd64,dkms,initramfs-tools,zstd,grub-pc,
openssh-server,nftables,dnsmasq,iproute2,iputils-ping,ethtool,tcpdump,curl,
ca-certificates,nano,less,htop,procps,psmisc,pciutils,usbutils,lm-sensors,
irqbalance,iw,wireless-regdb,hostapd,firmware-atheros,fish,bash-completion,
rsync,fdisk,e2fsprogs,util-linux,tzdata,python3,openssl,
cockpit-ws,cockpit-bridge,cockpit-system,freeradius,freeradius-utils,eapoltest,ppp"

mkdir -p "$(dirname "$IMG")"
rm -f "$IMG"; truncate -s "$SIZE" "$IMG"
printf 'label: dos\nstart=2048, type=83, bootable\n' | sfdisk -q "$IMG"
LOOP=$(losetup -fP --show "$IMG")
R=/mnt/root
cleanup() {
	for d in run sys proc dev; do umount -l "$R/$d" 2>/dev/null || true; done
	umount -l "$R" 2>/dev/null || true
	losetup -d "$LOOP" 2>/dev/null || true
}
trap cleanup EXIT
# the container /dev has no udev: create the partition node by hand
n=${LOOP#/dev/}
for i in $(seq 20); do [ -e /sys/block/$n/${n}p1/dev ] && break; sleep 0.2; done
mm=$(cat /sys/block/$n/${n}p1/dev)
[ -b "${LOOP}p1" ] || mknod "${LOOP}p1" b "${mm%:*}" "${mm#*:}"
mkfs.ext4 -q -L vc-root "${LOOP}p1"
mkdir -p "$R"; mount -o noatime "${LOOP}p1" "$R"

echo "== debootstrap (kernel $KVER)"
DEBIAN_FRONTEND=noninteractive mmdebstrap --variant=minbase --include="$(echo $PKGS | tr -d ' \n')" \
	--components="$(echo $COMP | tr ' ' ,)" \
	--essential-hook='mkdir -p "$1/etc/default/grub.d" "$1/etc/kernel/postinst.d"' \
	trixie "$R" \
	"deb $MIRROR trixie $COMP" "deb $MIRROR trixie-updates $COMP" \
	"deb http://security.debian.org/debian-security trixie-security $COMP"
[ -e "$R/lib/modules/$KVER" ] || { echo "image kernel != build container kernel $KVER:"; ls "$R/lib/modules"; exit 1; }

echo "== configuration"
# --no-preserve=ownership: the overlay files belong to the builder on the host,
# they must be root:root in the image (including / itself)
cp -a --no-preserve=ownership "$W/rootfs/." "$R/"
find "$R" -xdev -name __pycache__ -prune -exec rm -rf {} +
echo velocloud > "$R/etc/hostname"
printf '127.0.0.1\tlocalhost\n127.0.1.1\tvelocloud\n::1\tlocalhost ip6-localhost ip6-loopback\n' > "$R/etc/hosts"
ln -sf /usr/share/zoneinfo/Europe/Rome "$R/etc/localtime"; echo Europe/Rome > "$R/etc/timezone"
UUID=$(blkid -s UUID -o value "${LOOP}p1")
echo "UUID=$UUID / ext4 noatime,errors=remount-ro 0 1" > "$R/etc/fstab"
ln -sf /run/systemd/resolve/stub-resolv.conf "$R/etc/resolv.conf"
if [ -n "${ROOT_HASH:-}" ]; then
	chroot "$R" usermod -p "$ROOT_HASH" root
else
	# release image: root / velocloud, to be changed at the first login
	echo "root:velocloud" | chroot "$R" chpasswd
	chroot "$R" chage -d 0 root
fi
if [ -n "${SSH_KEY:-}" ]; then
	install -d -m 700 "$R/root/.ssh"; echo "$SSH_KEY" > "$R/root/.ssh/authorized_keys"; chmod 600 "$R/root/.ssh/authorized_keys"
fi
rm -f "$R"/etc/ssh/ssh_host_*
: > "$R/etc/machine-id"

for d in dev proc sys run; do mount --bind /$d "$R/$d"; done

echo "== velocloud-igb DKMS"
"$W/driver/mkdkms.sh" /usr/src/linux-source-6.12.tar.xz "$R/usr/src/velocloud-igb-$VER" "$VER"
chroot "$R" dkms add velocloud-igb/$VER
chroot "$R" dkms install velocloud-igb/$VER -k "$KVER"
ls -l "$R/lib/modules/$KVER/updates/dkms/"

echo "== router configuration (router.json defaults -> system files)"
mkdir -p "$R/etc/velocloud"
chroot "$R" /usr/local/sbin/velocloud-apply --defaults > "$R/etc/velocloud/router.json"
cp "$R/etc/velocloud/router.json" "$R/etc/velocloud/router.confirmed.json"
chmod 600 "$R"/etc/velocloud/router*.json
chroot "$R" /usr/local/sbin/velocloud-apply --render-only /
chroot "$R" systemctl enable systemd-networkd systemd-resolved systemd-timesyncd nftables dnsmasq \
	vc-ssh-hostkeys ssh irqbalance velocloud-boot cockpit.socket
# hostapd and FreeRADIUS are switched on by velocloud-apply when the Wi-Fi needs them
chroot "$R" systemctl disable freeradius
chroot "$R" systemctl mask hostapd

echo "== initramfs + grub"
chroot "$R" update-initramfs -u -k "$KVER"
chroot "$R" grub-install --target=i386-pc "$LOOP"
# grub-mkconfig writes root=UUID= only if /dev/disk/by-uuid has the link (no udev here)
mkdir -p /dev/disk/by-uuid; ln -sf "${LOOP}p1" "/dev/disk/by-uuid/$UUID"
chroot "$R" update-grub
grep -E "^\s*linux" "$R/boot/grub/grub.cfg" | head -2
chroot "$R" apt-get clean
rm -rf "$R/var/lib/apt/lists/"*
df -h "$R" | tail -1
echo "== done: $IMG"
