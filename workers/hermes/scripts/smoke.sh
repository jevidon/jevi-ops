#!/bin/sh
# Claims at most one real queued request; may use paid model inference.
set -eu
package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec python3 "$package_dir/adapter/worker.py" once "$@"
