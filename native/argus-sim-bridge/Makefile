# Makefile — builds the argus-sim-bridge binary.
#
# Compiles main.swift + ArgusBridge.swift with swiftc, compiles
# ArgusHID.m with clang, and links everything into a single macOS
# command-line binary.
#
# Usage:
#   make              # build argus-sim-bridge
#   make clean        # remove build artefacts

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BRIDGE_SWIFT    := ArgusBridge.swift
HID_OBJC        := ArgusHID.m
BRIDGE_HEADER   := ArgusBridge.h

BUILD_DIR       := .build
BINARY          := argus-sim-bridge

# ---------------------------------------------------------------------------
# Toolchain
# ---------------------------------------------------------------------------

SWIFTC          := swiftc
CLANG           := clang

# macOS SDK path (uses whatever Xcode's active developer directory provides)
SDK             := $(shell xcrun --show-sdk-path)

# ---------------------------------------------------------------------------
# Compiler flags
# ---------------------------------------------------------------------------

# Swift: compile main.swift and ArgusBridge.swift together in one pass so
# they share the same module and can call each other's @_cdecl symbols.
SWIFT_FLAGS     := \
    -sdk $(SDK) \
    -target arm64-apple-macosx12.0 \
    -import-objc-header $(BRIDGE_HEADER) \
    -O

# Clang: compile the ObjC file to an object.
CLANG_FLAGS     := \
    -isysroot $(SDK) \
    -target arm64-apple-macosx12.0 \
    -fobjc-arc \
    -O2 \
    -c

# Linker frameworks required by ArgusBridge.swift + ArgusHID.m.
FRAMEWORKS      := \
    -framework IOSurface \
    -framework CoreGraphics \
    -framework AppKit \
    -framework Foundation

# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------

.PHONY: all clean

all: $(BINARY)

# Step 1 — compile ArgusHID.m to an object file
$(BUILD_DIR)/ArgusHID.o: $(HID_OBJC) | $(BUILD_DIR)
	$(CLANG) $(CLANG_FLAGS) -o $@ $<

# Step 2 — compile the Swift sources and link everything into the final binary.
#
# swiftc is used as the linker driver here so it automatically links the Swift
# standard library and runtime. The ObjC object is passed directly as an extra
# input so swiftc forwards it to the linker.
$(BINARY): main.swift $(BRIDGE_SWIFT) $(BUILD_DIR)/ArgusHID.o
	$(SWIFTC) $(SWIFT_FLAGS) \
	    main.swift $(BRIDGE_SWIFT) \
	    $(BUILD_DIR)/ArgusHID.o \
	    $(FRAMEWORKS) \
	    -o $@

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

clean:
	rm -rf $(BUILD_DIR) $(BINARY)
