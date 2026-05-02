# Makefile — builds the argus-hotkey-bridge binary.
#
# A single-file Swift program that watches global flagsChanged events for
# a double-press of right Option and emits JSON to stdout. Linked against
# AppKit + Foundation. Requires Accessibility permission at runtime to
# observe key events outside the focused app.
#
# We embed Info.plist via `-sectcreate __TEXT __info_plist` so macOS can
# identify the helper as a proper agent (own bundle id, LSUIElement). Without
# this, TCC has no Info.plist to read and the Accessibility prompt UI is
# silently skipped — the user can never grant the permission the helper needs.

BUILD_DIR       := .build
BINARY          := argus-hotkey-bridge
INFO_PLIST      := Info.plist

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

LINKER_FLAGS    := \
    -Xlinker -sectcreate \
    -Xlinker __TEXT \
    -Xlinker __info_plist \
    -Xlinker $(INFO_PLIST)

.PHONY: all clean

all: $(BINARY)

$(BINARY): main.swift $(INFO_PLIST)
	$(SWIFTC) $(SWIFT_FLAGS) main.swift $(FRAMEWORKS) $(LINKER_FLAGS) -o $@

clean:
	rm -rf $(BUILD_DIR) $(BINARY)
