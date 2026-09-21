# Makefile — builds the argus-sim-input helper.
#
# Unlike argus-sim-bridge this is an *iphonesimulator* binary: it is launched
# inside the simulator with `simctl spawn` so it can reach the guest's HID
# event system, which host processes cannot.
#
# Usage:
#   make              # build argus-sim-input
#   make clean        # remove build artefacts

BINARY  := argus-sim-input
SOURCE  := main.m

SDK     := $(shell xcrun --sdk iphonesimulator --show-sdk-path)
CLANG   := clang

CLANG_FLAGS := \
    -isysroot "$(SDK)" \
    -target arm64-apple-ios17.0-simulator \
    -fobjc-arc \
    -O2 \
    -framework Foundation \
    -framework CoreFoundation

.PHONY: all clean

all: $(BINARY)

$(BINARY): $(SOURCE)
	$(CLANG) $(CLANG_FLAGS) -o $@ $<

clean:
	rm -f $(BINARY)
