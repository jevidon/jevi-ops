#!/bin/sh
set -eu
package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# `check` is an offline real-runtime/instruction/tool-loading test.
case "${1:-}" in
  --check-runtime) shift; exec python3 "$package_dir/adapter/worker.py" check "$@" ;;
  *) exec python3 "$package_dir/adapter/worker.py" health "$@" ;;
esac
