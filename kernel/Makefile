# ──────────────────────────────────────────────────────────────
# sentinel-os/kernel/Makefile
# Build custom Sentinel OS kernel modules
# ──────────────────────────────────────────────────────────────

KDIR ?= /lib/modules/$(shell uname -r)/build
PWD := $(shell pwd)

obj-m += sentinel-lsm.o
obj-m += rtlsdr-sentinel.o

all:
	$(MAKE) -C $(KDIR) M=$(PWD) modules

clean:
	$(MAKE) -C $(KDIR) M=$(PWD) clean

install:
	$(MAKE) -C $(KDIR) M=$(PWD) modules_install

.PHONY: all clean install
