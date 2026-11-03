#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Builds the DKMS source tree of the mt7601u module with access point mode:
#   mt7601u from the Debian linux-source tarball + our patch (400), which adds
#   AP mode (hardware beacons, TIM/DTIM, buffered multicast) to the station-only
#   driver.  The result replaces the stock module for the USB MT7601U adapter.
# usage: mkdkms-mt7601u.sh /usr/src/linux-source-6.12.tar.xz <out dir> <version>
set -e
SRC=$1 OUT=$2 VER=$3
D=$(cd "$(dirname "$0")" && pwd)
[ -f "$SRC" ] && [ -n "$OUT" ] && [ -n "$VER" ] || { echo "usage: $0 linux-source.tar.xz outdir version"; exit 1; }
rm -rf "$OUT"; mkdir -p "$OUT"
top=$(tar -tf "$SRC" | head -1 | cut -d/ -f1)
tar -xf "$SRC" -C "$OUT" --strip-components=6 "$top/drivers/net/wireless/mediatek/mt7601u"
cd "$OUT"
patch -s -p1 < "$D/400-mt7601u-ap.patch"
cat > dkms.conf <<DKMS
PACKAGE_NAME="velocloud-mt7601u"
PACKAGE_VERSION="$VER"
BUILT_MODULE_NAME[0]="mt7601u"
DEST_MODULE_LOCATION[0]="/updates/dkms"
MAKE[0]="make -C \${kernel_source_dir} M=\${dkms_tree}/\${PACKAGE_NAME}/\${PACKAGE_VERSION}/build CONFIG_MT7601U=m modules"
CLEAN="make -C \${kernel_source_dir} M=\${dkms_tree}/\${PACKAGE_NAME}/\${PACKAGE_VERSION}/build clean"
AUTOINSTALL="yes"
DKMS
echo "velocloud-mt7601u $VER: $(ls | wc -l) files in $OUT"
