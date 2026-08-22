# jevi-ops iOS companion. `make generate` is safe to run any time —
# XcodeGen regeneration is deterministic and the .xcodeproj is gitignored.

SIM_NAME ?= iPhone 17
DERIVED  := build/DerivedData
APP      := $(DERIVED)/Build/Products/Debug-iphonesimulator/JeviOps.app
BUNDLE   := com.jevidon.jeviops

.PHONY: generate build test run boot install launch screenshot clean

# UI tests drive real onboarding + the share sheet; they need the dev
# servers up (scripts/devctl.sh start) and the probe@test.local user.
test: generate
	xcodebuild -project JeviOps.xcodeproj -scheme JeviOps \
	  -destination 'platform=iOS Simulator,name=$(SIM_NAME)' \
	  -derivedDataPath $(DERIVED) \
	  test

Signing.xcconfig:
	cp Signing.xcconfig.example Signing.xcconfig

generate: Signing.xcconfig
	xcodegen generate

build: generate
	xcodebuild -project JeviOps.xcodeproj -scheme JeviOps \
	  -destination 'platform=iOS Simulator,name=$(SIM_NAME)' \
	  -derivedDataPath $(DERIVED) \
	  build

boot:
	xcrun simctl bootstatus '$(SIM_NAME)' -b

install: boot
	xcrun simctl install booted $(APP)

launch: install
	xcrun simctl launch booted $(BUNDLE)

run: build launch

screenshot:
	xcrun simctl io booted screenshot build/screenshot-$$(date +%H%M%S).png

clean:
	rm -rf build JeviOps.xcodeproj
