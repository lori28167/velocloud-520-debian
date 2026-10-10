// SPDX-License-Identifier: GPL-2.0-only
/*
 * VeloCloud Edge 520/540 ("edge5x0") board glue built into igb, for kernels
 * without gpio-ich, mdio-gpio, i2c-gpio and leds-pca963x (Debian 13).
 *
 * Copyright (c) 2026 Lorenzo Cozzaglio
 *
 * igb_vc.c (from github.com/gallops-gannets/velo540openwrt) drives the I354
 * side and looks for the 88E1514 WAN PHYs on the mii_bus "gpio-0".  This file
 * provides that bus and the rest of what the OpenWrt port does with
 * gpio-ich/mdio-gpio/i2c-gpio/leds-pca963x and its velo540-switch script:
 *
 *   - SoC core-well GPIO 11/12 (I2C SDA/SCL) and 13/14 (MDIO/MDC), bit-banged
 *     on the GPIO registers (same code as the FreeBSD if_vcigb driver);
 *   - "gpio-0": clause 22 MDIO bus to the 88E1514s (address 0 = GE1, 1 = GE2);
 *   - WAN PHY reset through PCA9557@0x18 pin 4 (active low) and WAN jack LEDs;
 *   - the two 88E6176 switches brought up as plain 4-port switches;
 *   - the front logo RGB LED: PCA9634@0x54 channels 0/1/2, outputs enabled
 *     by SoC suspend-well GPIO 7 (GPIO 39 overall, active low), registered as
 *     velocloud:{red,green,blue}:logo in /sys/class/leds.
 *
 * Board rev B (DMI board version 2.x) only: rev A uses other WAN MDIO pins.
 */

#include <linux/module.h>
#include <linux/pci.h>
#include <linux/delay.h>
#include <linux/dmi.h>
#include <linux/io.h>
#include <linux/mutex.h>
#include <linux/phy.h>
#include <linux/leds.h>
#include <linux/platform_device.h>

#include "e1000_mac.h"
#include "e1000_82575.h"
#include "e1000_hw.h"
#include "igb.h"

static bool vc_switch_autoinit = true;
module_param(vc_switch_autoinit, bool, 0444);
MODULE_PARM_DESC(vc_switch_autoinit,
		 "VeloCloud edge5x0: bring the 88E6176 switches up as plain switches (default 1)");

/*
 * Atom C2000 LPC bridge: GPIO base in config register 0x48.  Core-well GPIOs
 * 0-31 at offsets 0x00 (USE_SEL, 1 = GPIO), 0x04 (IO_SEL, 1 = input), 0x08
 * (LVL); suspend-well GPIOs 32-59 at 0x80/0x84/0x88.  LVL does not read back
 * the level of output pins, so the core-well LVL is written from a shadow.
 * The pins must be switched to GPIO in USE_SEL before IO_SEL/LVL writes take
 * effect.  32-bit accesses only.
 */
#define C2000_LPC_GBASE		0x48
#define C2000_GPIO_USE_SEL	0x00
#define C2000_GPIO_IO_SEL	0x04
#define C2000_GPIO_LVL		0x08
#define C2000_GPIO_SUS		0x80	/* suspend-well bank offset */

#define VC_GPIO_I2C_SDA		11
#define VC_GPIO_I2C_SCL		12
#define VC_GPIO_MDIO		13
#define VC_GPIO_MDC		14
#define VC_GPIO_MASK		(BIT(VC_GPIO_I2C_SDA) | BIT(VC_GPIO_I2C_SCL) | \
				 BIT(VC_GPIO_MDIO) | BIT(VC_GPIO_MDC))
#define VC_GPIO_SUS_LED_OE	7	/* GPIO 39: PCA9634 /OE */

#define PCA9557_ADDR		0x18
#define PCA9557_OUT		1
#define PCA9557_CFG		3	/* 1 = input */
#define PCA9557_WAN_RST		BIT(4)	/* 88E1514 reset, active low */

#define PCA9634_ADDR		0x54
#define PCA9634_MODE1		0x00
#define PCA9634_MODE2		0x01
#define PCA9634_PWM(n)		(0x02 + (n))
#define PCA9634_LEDOUT0		0x0c
#define PCA9634_MODE2_INVRT	0x10
#define PCA9634_MODE2_OUTDRV	0x04
#define PCA9634_LED_OFF		0
#define PCA9634_LED_ON		1
#define PCA9634_LED_PWM		2

#define M88_PHY_ID1		0x0141

/* 88E6176, single-chip addressing on the I354 MDIO of funcs 0/1 */
#define SW_PORT(p)		(0x10 + (p))
#define SW_GLOBAL2		0x1c
#define SW_SMI_CMD		0x18
#define SW_SMI_DATA		0x19
#define SW_SMI_BUSY		0x8000
#define SW_SMI_C22_WRITE	0x1400
#define SW_SMI_C22_READ		0x1800
#define SW_SERDES_DEV		0x0f
#define SW_ID_MASK		0xfff0
#define SW_ID_88E6176		0x1760

static DEFINE_MUTEX(vc_bb_lock);	/* GPIO bit-bang: MDIO and I2C */
static u16 vc_gpio_base;
static u32 vc_gpio_lvl;			/* shadow of the core-well LVL */

static struct platform_device *vc_pdev;
static struct mii_bus *vc_wan_bus;

/* SoC core-well GPIO */
static void vc_gpio_dir(int pin, bool out)
{
	u32 v = inl(vc_gpio_base + C2000_GPIO_IO_SEL);

	if (out)
		v &= ~BIT(pin);
	else
		v |= BIT(pin);
	outl(v, vc_gpio_base + C2000_GPIO_IO_SEL);
}

static void vc_gpio_set(int pin, int val)
{
	if (val)
		vc_gpio_lvl |= BIT(pin);
	else
		vc_gpio_lvl &= ~BIT(pin);
	outl(vc_gpio_lvl, vc_gpio_base + C2000_GPIO_LVL);
}

static int vc_gpio_get(int pin)
{
	return (inl(vc_gpio_base + C2000_GPIO_LVL) >> pin) & 1;
}

static int vc_gpio_setup(void)
{
	struct pci_dev *lpc;
	u32 gbase, v, io;

	lpc = pci_get_domain_bus_and_slot(0, 0, PCI_DEVFN(0x1f, 0));
	if (!lpc)
		return -ENODEV;
	if (lpc->vendor != PCI_VENDOR_ID_INTEL || (lpc->device & 0xfffc) != 0x1f38) {
		pci_dev_put(lpc);
		return -ENODEV;
	}
	pci_read_config_dword(lpc, C2000_LPC_GBASE, &gbase);
	pci_dev_put(lpc);
	gbase &= 0xff80;
	if (!gbase)
		return -ENODEV;
	vc_gpio_base = gbase;

	mutex_lock(&vc_bb_lock);
	/* Take the pins from their native function first: coreboot leaves
	 * MDIO/MDC native, and IO_SEL/LVL writes to a native pin are dropped
	 * (MDC then stays an input and the PHYs never answer after a cold boot).
	 */
	v = inl(vc_gpio_base + C2000_GPIO_USE_SEL);
	if ((v & VC_GPIO_MASK) != VC_GPIO_MASK)
		outl(v | VC_GPIO_MASK, vc_gpio_base + C2000_GPIO_USE_SEL);
	/* Latch our pins low, MDC driven, MDIO/SDA/SCL released. */
	vc_gpio_lvl = inl(vc_gpio_base + C2000_GPIO_LVL) & ~VC_GPIO_MASK;
	outl(vc_gpio_lvl, vc_gpio_base + C2000_GPIO_LVL);
	io = inl(vc_gpio_base + C2000_GPIO_IO_SEL);
	io |= VC_GPIO_MASK;
	io &= ~BIT(VC_GPIO_MDC);
	outl(io, vc_gpio_base + C2000_GPIO_IO_SEL);
	mutex_unlock(&vc_bb_lock);

	pr_info("igb: VeloCloud edge5x0: GPIO base %#x, USE_SEL %#010x -> %#010x, IO_SEL %#010x\n",
		vc_gpio_base, v, inl(vc_gpio_base + C2000_GPIO_USE_SEL),
		inl(vc_gpio_base + C2000_GPIO_IO_SEL));
	if (inl(vc_gpio_base + C2000_GPIO_IO_SEL) & BIT(VC_GPIO_MDC)) {
		pr_err("igb: VeloCloud edge5x0: MDC GPIO %d did not become an output\n",
		       VC_GPIO_MDC);
		return -EIO;
	}
	return 0;
}

/* Clause 22 bit-bang MDIO, same bit timing as Linux mdio-bitbang. */
static void vc_mdio_bit_out(int b)
{
	vc_gpio_set(VC_GPIO_MDIO, b);
	udelay(1);
	vc_gpio_set(VC_GPIO_MDC, 1);
	udelay(1);
	vc_gpio_set(VC_GPIO_MDC, 0);
}

static int vc_mdio_bit_in(void)
{
	vc_gpio_set(VC_GPIO_MDC, 1);
	udelay(1);
	vc_gpio_set(VC_GPIO_MDC, 0);
	udelay(1);
	return vc_gpio_get(VC_GPIO_MDIO);
}

static void vc_mdio_release(void)
{
	/* Leave the latch low before turning the line around. */
	vc_gpio_set(VC_GPIO_MDIO, 0);
	vc_gpio_dir(VC_GPIO_MDIO, false);
}

static void vc_mdio_cmd(int op, int phy, int reg)
{
	int i;

	vc_gpio_dir(VC_GPIO_MDIO, true);
	for (i = 0; i < 32; i++)
		vc_mdio_bit_out(1);
	vc_mdio_bit_out(0);
	vc_mdio_bit_out(1);
	vc_mdio_bit_out((op >> 1) & 1);
	vc_mdio_bit_out(op & 1);
	for (i = 4; i >= 0; i--)
		vc_mdio_bit_out((phy >> i) & 1);
	for (i = 4; i >= 0; i--)
		vc_mdio_bit_out((reg >> i) & 1);
}

static int vc_bb_mdio_read(int phy, int reg)
{
	int i, v = 0;

	mutex_lock(&vc_bb_lock);
	vc_mdio_cmd(2, phy, reg);
	vc_mdio_release();
	if (vc_mdio_bit_in() != 0) {
		/* No PHY drove the turnaround low: flush and fail. */
		for (i = 0; i < 32; i++)
			vc_mdio_bit_in();
		mutex_unlock(&vc_bb_lock);
		return -EIO;
	}
	for (i = 0; i < 16; i++)
		v = (v << 1) | vc_mdio_bit_in();
	vc_mdio_bit_in();
	mutex_unlock(&vc_bb_lock);
	return v;
}

static int vc_bb_mdio_write(int phy, int reg, u16 val)
{
	int i;

	mutex_lock(&vc_bb_lock);
	vc_mdio_cmd(1, phy, reg);
	vc_mdio_bit_out(1);
	vc_mdio_bit_out(0);
	for (i = 15; i >= 0; i--)
		vc_mdio_bit_out((val >> i) & 1);
	vc_mdio_release();
	vc_mdio_bit_in();
	mutex_unlock(&vc_bb_lock);
	return 0;
}

static int vc_wan_mii_read(struct mii_bus *bus, int addr, int reg)
{
	return vc_bb_mdio_read(addr, reg);
}

static int vc_wan_mii_write(struct mii_bus *bus, int addr, int reg, u16 val)
{
	return vc_bb_mdio_write(addr, reg, val);
}

/* Bit-bang I2C master, open drain emulated with the direction bit: the
 * latch stays low, "high" means released to the board pull-ups.
 */
static void vc_i2c_line(int pin, int high)
{
	int i;

	vc_gpio_dir(pin, !high);
	if (high && pin == VC_GPIO_I2C_SCL)
		for (i = 0; i < 1000 && vc_gpio_get(pin) == 0; i++)
			udelay(1);	/* clock stretching */
	udelay(5);
}

static void vc_i2c_start(void)
{
	vc_i2c_line(VC_GPIO_I2C_SDA, 1);
	vc_i2c_line(VC_GPIO_I2C_SCL, 1);
	vc_i2c_line(VC_GPIO_I2C_SDA, 0);
	vc_i2c_line(VC_GPIO_I2C_SCL, 0);
}

static void vc_i2c_stop(void)
{
	vc_i2c_line(VC_GPIO_I2C_SDA, 0);
	vc_i2c_line(VC_GPIO_I2C_SCL, 1);
	vc_i2c_line(VC_GPIO_I2C_SDA, 1);
}

static int vc_i2c_write_byte(u8 b)
{
	int i, nak;

	for (i = 7; i >= 0; i--) {
		vc_i2c_line(VC_GPIO_I2C_SDA, (b >> i) & 1);
		vc_i2c_line(VC_GPIO_I2C_SCL, 1);
		vc_i2c_line(VC_GPIO_I2C_SCL, 0);
	}
	vc_i2c_line(VC_GPIO_I2C_SDA, 1);
	vc_i2c_line(VC_GPIO_I2C_SCL, 1);
	nak = vc_gpio_get(VC_GPIO_I2C_SDA);
	vc_i2c_line(VC_GPIO_I2C_SCL, 0);
	return nak ? -EIO : 0;
}

static u8 vc_i2c_read_byte(bool ack)
{
	u8 b = 0;
	int i;

	vc_i2c_line(VC_GPIO_I2C_SDA, 1);
	for (i = 0; i < 8; i++) {
		vc_i2c_line(VC_GPIO_I2C_SCL, 1);
		b = (b << 1) | vc_gpio_get(VC_GPIO_I2C_SDA);
		vc_i2c_line(VC_GPIO_I2C_SCL, 0);
	}
	vc_i2c_line(VC_GPIO_I2C_SDA, ack ? 0 : 1);
	vc_i2c_line(VC_GPIO_I2C_SCL, 1);
	vc_i2c_line(VC_GPIO_I2C_SCL, 0);
	vc_i2c_line(VC_GPIO_I2C_SDA, 1);
	return b;
}

static int vc_i2c_reg_read(u8 addr, u8 reg, u8 *val)
{
	int ret;

	mutex_lock(&vc_bb_lock);
	vc_i2c_start();
	ret = vc_i2c_write_byte(addr << 1);
	if (!ret)
		ret = vc_i2c_write_byte(reg);
	if (!ret) {
		vc_i2c_start();
		ret = vc_i2c_write_byte((addr << 1) | 1);
		if (!ret)
			*val = vc_i2c_read_byte(false);
	}
	vc_i2c_stop();
	mutex_unlock(&vc_bb_lock);
	return ret;
}

static int vc_i2c_reg_write(u8 addr, u8 reg, u8 val)
{
	int ret;

	mutex_lock(&vc_bb_lock);
	vc_i2c_start();
	ret = vc_i2c_write_byte(addr << 1);
	if (!ret)
		ret = vc_i2c_write_byte(reg);
	if (!ret)
		ret = vc_i2c_write_byte(val);
	vc_i2c_stop();
	mutex_unlock(&vc_bb_lock);
	return ret;
}

/* WAN jack LEDs (vendor igb_vc_setup_m88e1514): page 3, LED0 = gigabit
 * link, LED1 = 10/100 link + activity; the PHY default is both solid on.
 * Survives the PHY soft reset igb does.
 */
static void vc_wan_leds(int addr)
{
	vc_bb_mdio_write(addr, 22, 3);
	vc_bb_mdio_write(addr, 16, 0x0817);
	vc_bb_mdio_write(addr, 17, 0x0005);
	vc_bb_mdio_write(addr, 22, 0);
}

/* Take the 88E1514s out of reset through PCA9557 pin 4, touching no other
 * pin (the same expander drives the PCIe slot and switch resets), and wait
 * until both PHYs answer.
 */
static int vc_wan_reset(void)
{
	int i, id0 = -1, id1 = -1;
	u8 out, cfg;

	if (vc_i2c_reg_read(PCA9557_ADDR, PCA9557_OUT, &out) ||
	    vc_i2c_reg_read(PCA9557_ADDR, PCA9557_CFG, &cfg)) {
		pr_err("igb: VeloCloud edge5x0: PCA9557@%#x does not answer\n",
		       PCA9557_ADDR);
		return -EIO;
	}
	pr_info("igb: VeloCloud edge5x0: PCA9557@%#x out %#04x cfg %#04x\n",
		PCA9557_ADDR, out, cfg);

	/* Pulse the reset unless pin 4 already drives the release level. */
	if ((cfg & PCA9557_WAN_RST) || !(out & PCA9557_WAN_RST)) {
		out &= ~PCA9557_WAN_RST;
		if (vc_i2c_reg_write(PCA9557_ADDR, PCA9557_OUT, out) ||
		    vc_i2c_reg_write(PCA9557_ADDR, PCA9557_CFG, cfg & ~PCA9557_WAN_RST))
			return -EIO;
		msleep(200);
		out |= PCA9557_WAN_RST;
		if (vc_i2c_reg_write(PCA9557_ADDR, PCA9557_OUT, out))
			return -EIO;
	}

	/* 100 ms after release is not always enough: poll for up to 3 s. */
	for (i = 1; i <= 30; i++) {
		msleep(100);
		id0 = vc_bb_mdio_read(0, MII_PHYSID1);
		id1 = vc_bb_mdio_read(1, MII_PHYSID1);
		if (id0 == M88_PHY_ID1 && id1 == M88_PHY_ID1)
			break;
	}
	if (i > 30) {
		pr_err("igb: VeloCloud edge5x0: WAN PHYs not found (%#06x %#06x)\n",
		       id0, id1);
		return -ENODEV;
	}
	pr_info("igb: VeloCloud edge5x0: WAN PHYs answering after %d ms\n", i * 100);
	vc_wan_leds(0);
	vc_wan_leds(1);
	return 0;
}

/* Front logo RGB LED */
struct vc_led {
	struct led_classdev cdev;
	int ch;
};

static DEFINE_MUTEX(vc_led_lock);
static u8 vc_ledout;		/* shadow of PCA9634 LEDOUT0 */
static bool vc_leds_ok;

static int vc_led_set(struct led_classdev *cdev, enum led_brightness b)
{
	struct vc_led *led = container_of(cdev, struct vc_led, cdev);
	int shift = 2 * led->ch, mode, ret;

	if (b == LED_OFF) {
		mode = PCA9634_LED_OFF;
	} else if (b >= LED_FULL) {
		mode = PCA9634_LED_ON;
	} else {
		ret = vc_i2c_reg_write(PCA9634_ADDR, PCA9634_PWM(led->ch), b);
		if (ret)
			return ret;
		mode = PCA9634_LED_PWM;
	}
	mutex_lock(&vc_led_lock);
	vc_ledout = (vc_ledout & ~(3 << shift)) | (mode << shift);
	ret = vc_i2c_reg_write(PCA9634_ADDR, PCA9634_LEDOUT0, vc_ledout);
	mutex_unlock(&vc_led_lock);
	return ret;
}

static struct vc_led vc_leds[] = {
	{ .cdev = { .name = "velocloud:red:logo" }, .ch = 0 },
	{ .cdev = { .name = "velocloud:green:logo" }, .ch = 1 },
	{ .cdev = { .name = "velocloud:blue:logo" }, .ch = 2 },
};

static void vc_led_oe_enable(void)
{
	u16 b = vc_gpio_base + C2000_GPIO_SUS;
	u32 v;

	/* GPIO 39 = suspend-well bit 7, active low: USE_SEL first, then latch
	 * low, then make it an output.  Only bit 7 changes.
	 */
	mutex_lock(&vc_bb_lock);
	v = inl(b + C2000_GPIO_USE_SEL);
	if (!(v & BIT(VC_GPIO_SUS_LED_OE)))
		outl(v | BIT(VC_GPIO_SUS_LED_OE), b + C2000_GPIO_USE_SEL);
	outl(inl(b + C2000_GPIO_LVL) & ~BIT(VC_GPIO_SUS_LED_OE), b + C2000_GPIO_LVL);
	outl(inl(b + C2000_GPIO_IO_SEL) & ~BIT(VC_GPIO_SUS_LED_OE), b + C2000_GPIO_IO_SEL);
	mutex_unlock(&vc_bb_lock);
}

static void vc_leds_init(void)
{
	u8 mode1;
	int i, ret;

	if (vc_i2c_reg_read(PCA9634_ADDR, PCA9634_MODE1, &mode1)) {
		pr_warn("igb: VeloCloud edge5x0: PCA9634@%#x (logo LED) does not answer\n",
			PCA9634_ADDR);
		return;
	}
	/* All channels off, totem-pole inverted outputs (the LEDs are active
	 * low), oscillator on (clear SLEEP, all-call off), then wait 500 us.
	 */
	vc_ledout = 0;
	if (vc_i2c_reg_write(PCA9634_ADDR, PCA9634_LEDOUT0, 0) ||
	    vc_i2c_reg_write(PCA9634_ADDR, PCA9634_MODE2,
			     PCA9634_MODE2_INVRT | PCA9634_MODE2_OUTDRV) ||
	    vc_i2c_reg_write(PCA9634_ADDR, PCA9634_MODE1, 0)) {
		pr_warn("igb: VeloCloud edge5x0: logo LED setup failed\n");
		return;
	}
	usleep_range(500, 1000);
	vc_led_oe_enable();

	for (i = 0; i < ARRAY_SIZE(vc_leds); i++) {
		vc_leds[i].cdev.max_brightness = LED_FULL;
		vc_leds[i].cdev.brightness_set_blocking = vc_led_set;
		ret = led_classdev_register(&vc_pdev->dev, &vc_leds[i].cdev);
		if (ret) {
			pr_warn("igb: VeloCloud edge5x0: %s: %d\n",
				vc_leds[i].cdev.name, ret);
			while (--i >= 0)
				led_classdev_unregister(&vc_leds[i].cdev);
			return;
		}
	}
	vc_leds_ok = true;
	/* Green = up, like the OpenWrt port; userspace can change it. */
	led_set_brightness(&vc_leds[1].cdev, LED_FULL);
	pr_info("igb: VeloCloud edge5x0: logo LED registered\n");
}

/*
 * Per-jack link state of LAN1-8 for userspace (the switches run unmanaged, so
 * no netdev shows it): /sys/devices/platform/velocloud-edge5x0/ports, one
 * line per jack, "LAN1 up 1000 full" / "LAN2 down".  Jack -> switch port map
 * measured on the box: A = func 0 (LAN5-8), B = func 1 (LAN1-4).
 */
static const struct { const char *name; u8 func, port; } vc_jacks[] = {
	{ "LAN1", 1, 1 }, { "LAN2", 1, 0 }, { "LAN3", 1, 3 }, { "LAN4", 1, 2 },
	{ "LAN5", 0, 2 }, { "LAN6", 0, 0 }, { "LAN7", 0, 1 }, { "LAN8", 0, 3 },
};

#define SW_PORT_STS_LINK	0x0800
#define SW_PORT_STS_DUPLEX	0x0400
#define SW_PORT_STS_SPEED(v)	(((v) >> 8) & 3)

static ssize_t ports_show(struct device *dev, struct device_attribute *attr, char *buf)
{
	static const int speed[] = { 10, 100, 1000, 0 };
	char id[MII_BUS_ID_SIZE];
	struct mii_bus *bus;
	int i, st, len = 0;

	for (i = 0; i < ARRAY_SIZE(vc_jacks); i++) {
		snprintf(id, sizeof(id), "igb-vc-0000:00:14.%u", vc_jacks[i].func);
		bus = mdio_find_bus(id);
		st = bus ? mdiobus_read(bus, SW_PORT(vc_jacks[i].port), 0) : -ENODEV;
		if (bus)
			put_device(&bus->dev);
		if (st < 0)
			len += sysfs_emit_at(buf, len, "%s unknown\n", vc_jacks[i].name);
		else if (st & SW_PORT_STS_LINK)
			len += sysfs_emit_at(buf, len, "%s up %d %s\n", vc_jacks[i].name,
					     speed[SW_PORT_STS_SPEED(st)],
					     st & SW_PORT_STS_DUPLEX ? "full" : "half");
		else
			len += sysfs_emit_at(buf, len, "%s down\n", vc_jacks[i].name);
	}
	return len;
}
static DEVICE_ATTR_RO(ports);

/* Called from igb_init_module() before the PCI driver is registered, so the
 * "gpio-0" bus exists when funcs 2/3 probe.  Does nothing on other boards.
 */
int igb_vc_board_init(void)
{
	const char *board = dmi_get_system_info(DMI_BOARD_NAME);
	const char *ver = dmi_get_system_info(DMI_BOARD_VERSION);
	int ret;

	if (!board || (strcmp(board, "EDGE520") && strcmp(board, "EDGE540")))
		return 0;
	if (!ver || ver[0] != '2') {
		pr_warn("igb: VeloCloud %s board version %s: WAN pinout unknown, GE1/GE2 unsupported\n",
			board, ver ? ver : "?");
		return 0;
	}

	ret = vc_gpio_setup();
	if (ret)
		return 0;

	vc_pdev = platform_device_register_simple("velocloud-edge5x0", -1, NULL, 0);
	if (IS_ERR(vc_pdev)) {
		vc_pdev = NULL;
		return 0;
	}

	vc_wan_reset();

	vc_wan_bus = mdiobus_alloc();
	if (vc_wan_bus) {
		vc_wan_bus->name = "velocloud-wan-mdio";
		snprintf(vc_wan_bus->id, MII_BUS_ID_SIZE, "gpio-0");
		vc_wan_bus->parent = &vc_pdev->dev;
		vc_wan_bus->read = vc_wan_mii_read;
		vc_wan_bus->write = vc_wan_mii_write;
		/* igb owns the PHYs: no phylib devices on this bus */
		vc_wan_bus->phy_mask = ~0U;
		ret = mdiobus_register(vc_wan_bus);
		if (ret) {
			pr_err("igb: VeloCloud edge5x0: WAN MDIO bus: %d\n", ret);
			mdiobus_free(vc_wan_bus);
			vc_wan_bus = NULL;
		}
	}

	vc_leds_init();
	if (device_create_file(&vc_pdev->dev, &dev_attr_ports))
		pr_warn("igb: VeloCloud edge5x0: no per-jack status file\n");
	pr_info("igb: VeloCloud %s rev %s board support ready\n", board, ver);
	return 0;
}

void igb_vc_board_exit(void)
{
	int i;

	if (vc_leds_ok)
		for (i = 0; i < ARRAY_SIZE(vc_leds); i++)
			led_classdev_unregister(&vc_leds[i].cdev);
	vc_leds_ok = false;
	if (vc_wan_bus) {
		mdiobus_unregister(vc_wan_bus);
		mdiobus_free(vc_wan_bus);
		vc_wan_bus = NULL;
	}
	if (vc_pdev) {
		device_remove_file(&vc_pdev->dev, &dev_attr_ports);
		platform_device_unregister(vc_pdev);
	}
	vc_pdev = NULL;
}

/* Global 2 SMI indirection to the switch's internal PHYs and port 4 SerDes */
static int vc_smi_wait(struct mii_bus *bus)
{
	int i, v;

	for (i = 0; i < 100; i++) {
		v = mdiobus_read(bus, SW_GLOBAL2, SW_SMI_CMD);
		if (v < 0)
			return v;
		if (!(v & SW_SMI_BUSY))
			return 0;
		udelay(100);
	}
	return -ETIMEDOUT;
}

static int vc_smi_write(struct mii_bus *bus, int dev, int reg, u16 val)
{
	int ret;

	ret = vc_smi_wait(bus);
	if (!ret)
		ret = mdiobus_write(bus, SW_GLOBAL2, SW_SMI_DATA, val);
	if (!ret)
		ret = mdiobus_write(bus, SW_GLOBAL2, SW_SMI_CMD,
				    SW_SMI_BUSY | SW_SMI_C22_WRITE | (dev << 5) | reg);
	return ret ? ret : vc_smi_wait(bus);
}

static int vc_smi_read(struct mii_bus *bus, int dev, int reg)
{
	int ret;

	ret = vc_smi_wait(bus);
	if (!ret)
		ret = mdiobus_write(bus, SW_GLOBAL2, SW_SMI_CMD,
				    SW_SMI_BUSY | SW_SMI_C22_READ | (dev << 5) | reg);
	if (!ret)
		ret = vc_smi_wait(bus);
	return ret ? ret : mdiobus_read(bus, SW_GLOBAL2, SW_SMI_DATA);
}

/*
 * Bring an 88E6176 up as a plain 4-port switch (vendor igb_vc.c sequence, as
 * in the OpenWrt velo540-switch script and the FreeBSD driver):
 *  - port 4 SerDes: power up, autoneg off, reset (SMI device 0xf, page 1)
 *  - port 4: clear PHYDetect, force MAC 1000/full
 *  - internal PHYs 0-3: clear power-down, reset, autoneg
 *  - ports 0-4 Forwarding, ports 5/6 (RGMII cross-links) Disabled
 * Called from igb_probe() after the switch MDIO bus is registered.
 */
void igb_vc_switch_up(struct igb_adapter *adapter)
{
	struct mii_bus *bus = adapter->hw.dev_spec._82575.vc_mii;
	struct device *dev = &adapter->pdev->dev;
	int id, v, ret, d, p;

	if (!bus || !vc_switch_autoinit)
		return;

	id = mdiobus_read(bus, SW_PORT(0), 3);
	if (id < 0 || (id & SW_ID_MASK) != SW_ID_88E6176) {
		dev_err(dev, "VeloCloud edge5x0: no 88E6176 behind this port (%d)\n", id);
		return;
	}

	ret = vc_smi_write(bus, SW_SERDES_DEV, 22, 1);
	v = ret ? ret : vc_smi_read(bus, SW_SERDES_DEV, 0);
	ret = v < 0 ? v : vc_smi_write(bus, SW_SERDES_DEV, 0, (v | 0x8100) & ~0x1800);
	if (ret)
		goto fail;
	msleep(1000);

	v = mdiobus_read(bus, SW_PORT(4), 0);
	ret = v < 0 ? v : mdiobus_write(bus, SW_PORT(4), 0, v & ~0x1000);
	if (!ret)
		ret = mdiobus_write(bus, SW_PORT(4), 1, 0x000e);
	if (ret)
		goto fail;

	for (d = 0; d < 4 && !ret; d++) {
		ret = vc_smi_write(bus, d, 22, 0);
		if (!ret)
			ret = vc_smi_write(bus, d, 0, 0x9140);
	}
	if (ret)
		goto fail;

	for (p = 0; p <= 6; p++) {
		v = mdiobus_read(bus, SW_PORT(p), 4);
		if (v < 0) {
			ret = v;
			goto fail;
		}
		v &= ~3;
		if (p <= 4)
			v |= 3;
		ret = mdiobus_write(bus, SW_PORT(p), 4, v);
		if (ret)
			goto fail;
	}

	dev_info(dev, "VeloCloud edge5x0: 88E6176 %#06x up, port 4 status %#06x\n",
		 id, mdiobus_read(bus, SW_PORT(4), 0));
	return;
fail:
	dev_err(dev, "VeloCloud edge5x0: switch init failed: %d\n", ret);
}
