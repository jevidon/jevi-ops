#!/bin/sh
# Foreground process: supervise with your normal service manager if persistent.
set -eu
package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec python3 "$package_dir/adapter/worker.py" run "$@"
