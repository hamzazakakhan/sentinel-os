# ──────────────────────────────────────────────────────────────
# sentinel-os/compositor/Makefile
# Build Sentinel-WM Wayland compositor
# ──────────────────────────────────────────────────────────────

CC = gcc
CFLAGS = -Wall -Wextra -Werror -std=c11 \
         $(shell pkg-config --cflags wlroots-0.19 wayland-server xkbcommon) \
         -DWLR_USE_UNSTABLE

LDFLAGS = $(shell pkg-config --libs wlroots-0.19 wayland-server xkbcommon) \
          -lm -lwayland-client

TARGET = sentinel-wm

SRC = sentinel-wm.c
OBJ = $(SRC:.c=.o)

all: $(TARGET)

$(TARGET): $(OBJ)
	$(CC) -o $@ $^ $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	rm -f $(OBJ) $(TARGET)

install: $(TARGET)
	install -m 755 $(TARGET) /usr/bin/sentinel-wm
	install -m 644 config.lua /etc/sentinel-wm/config.lua

.PHONY: all clean install
