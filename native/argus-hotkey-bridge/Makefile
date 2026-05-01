# Makefile — builds the argus-hotkey-bridge binary.
#
# A single-file Swift program that watches global flagsChanged events for
# a double-press of right Option and emits JSON to stdout. Linked against
# AppKit + Foundation. Requires Accessibility permission at runtime to
# observe key events outside the focused app.

BUILD_DIR       := .build
BINARY          := argus-hotkey-bridge

SWIFTC          := swiftc
SDK             := $(shell xcrun --show-sdk-path)

SWIFT_FLAGS     := \
    -sdk $(SDK) \
    -target arm64-apple-macosx12.0 \
    -O

FRAMEWORKS      := \
    -framework AppKit \
    -framework Foundation \
    -framework ApplicationServices

.PHONY: all clean

all: $(BINARY)

$(BINARY): main.swift
	$(SWIFTC) $(SWIFT_FLAGS) main.swift $(FRAMEWORKS) -o $@

clean:
	rm -rf $(BUILD_DIR) $(BINARY)
