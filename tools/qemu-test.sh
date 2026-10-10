#!/bin/sh
# Boots a throw-away copy of the image in QEMU, laid out like the box:
# q35 (ICH9 TCO watchdog), DMI EDGE520 2.8, virtio NICs at the PCI
# addresses of the real ports: 00:14.0 = lan58 (LAN side, the host reaches
# 10.11.0.1:22 as localhost:2222), 00:14.2 = ge1 (WAN, slirp DHCP).
# Console (ttyS1) -> out/qemu-com2.log
set -eu
cd "$(dirname "$0")/.."
qemu-img create -q -f qcow2 -F raw -b "$PWD/${IMG:-out/velocloud-debian.img}" out/qemu-test.qcow2
exec qemu-system-x86_64 -machine q35,accel=kvm -cpu host -smp 2 -m 1536 \
	-smbios type=1,manufacturer="VeloCloud Networks,, Inc.",product=EDGE520 \
	-smbios type=2,manufacturer="VeloCloud Networks,, Inc.",product=EDGE520,version=2.8 \
	-drive file=out/qemu-test.qcow2,if=virtio,format=qcow2 \
	-netdev user,id=lan,net=10.11.0.0/24,host=10.11.0.2,dhcpstart=10.11.0.60,hostfwd=tcp:127.0.0.1:2222-10.11.0.1:22,hostfwd=tcp:127.0.0.1:9443-10.11.0.1:443 \
	-device virtio-net-pci,netdev=lan,addr=14.0,multifunction=on \
	-netdev user,id=wan \
	-device virtio-net-pci,netdev=wan,addr=14.2 \
	-serial null -serial file:out/qemu-com2.log \
	-display none -pidfile out/qemu.pid
