#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Builds the DKMS source tree of the VeloCloud igb module:
#   igb from the Debian linux-source tarball + the OpenWrt patch (200)
#   + our board glue (300, igb_vc_board.c).
# usage: mkdkms.sh /usr/src/linux-source-6.12.tar.xz <out dir> <version>
set -e
SRC=$1 OUT=$2 VER=$3
D=$(cd "$(dirname "$0")" && pwd)
[ -f "$SRC" ] && [ -n "$OUT" ] && [ -n "$VER" ] || { echo "usage: $0 linux-source.tar.xz outdir version"; exit 1; }
rm -rf "$OUT"; mkdir -p "$OUT"
top=$(tar -tf "$SRC" | head -1 | cut -d/ -f1)
tar -xf "$SRC" -C "$OUT" --strip-components=6 "$top/drivers/net/ethernet/intel/igb"
cd "$OUT"
patch -s -p6 < "$D/200-igb-velocloud-edge5x0.patch"
patch -s -p1 < "$D/300-igb-velocloud-board.patch"
cp "$D/igb_vc_board.c" .
cat > dkms.conf <<DKMS
PACKAGE_NAME="velocloud-igb"
PACKAGE_VERSION="$VER"
BUILT_MODULE_NAME[0]="igb"
DEST_MODULE_LOCATION[0]="/updates/dkms"
MAKE[0]="make -C \${kernel_source_dir} M=\${dkms_tree}/\${PACKAGE_NAME}/\${PACKAGE_VERSION}/build CONFIG_IGB=m modules"
CLEAN="make -C \${kernel_source_dir} M=\${dkms_tree}/\${PACKAGE_NAME}/\${PACKAGE_VERSION}/build clean"
AUTOINSTALL="yes"
DKMS
echo "velocloud-igb $VER: $(ls | wc -l) files in $OUT"
