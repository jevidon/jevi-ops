#!/usr/bin/env python3
"""Create a fresh isolated worker installation; never changes a normal Hermes profile."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

PACKAGE = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    destination = args.directory.expanduser().resolve()
    if destination.exists(): parser.error('Destination exists. Choose a new empty installation path; existing profiles are never overwritten.')
    if not shutil.which('git') or not shutil.which('uv'): parser.error('Install git and uv before bootstrap.')
    pin = json.loads((PACKAGE / 'runtime.json').read_text(encoding='utf-8'))
    os.umask(0o077)
    destination.mkdir(mode=0o700, parents=True)
    repo = destination / 'runtime'
    subprocess.run(['git', 'clone', '--depth', '1', '--branch', pin['tag'], pin['repository'], str(repo)], check=True)
    commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    if commit != pin['commit']: raise RuntimeError('Release tag no longer matches the reviewed commit; installation stopped.')
    subprocess.run(['uv', 'sync', '--frozen', '--no-dev', '--python', pin['python']], cwd=repo, check=True)
    profile = destination / 'profile'; profile.mkdir(mode=0o700)
    for name in ('workspace', 'skills'): shutil.copytree(PACKAGE / name, profile / name)
    shutil.copy2(PACKAGE / 'SOUL.md', profile / 'SOUL.md')
    shutil.copy2(PACKAGE / 'config.yaml.example', profile / 'config.yaml')
    (profile / '.no-bundled-skills').touch(mode=0o600)
    for name in ('state', 'runs'): (destination / name).mkdir(mode=0o700)
    config = (PACKAGE / 'worker.toml.example').read_text(encoding='utf-8').replace('"/absolute/path/to/jevi-hermes"', json.dumps(str(destination)))
    (destination / 'worker.toml').write_text(config, encoding='utf-8')
    shutil.copy2(PACKAGE / '.env.example', destination / '.env'); (destination / '.env').chmod(0o600)
    shutil.copy2(PACKAGE / 'runtime.json', destination / 'runtime.json')
    print('Installed pinned Hermes runtime in ' + str(destination))
    print('Configure worker.toml and .env, then run scripts/health.sh --check-runtime --config ' + str(destination / 'worker.toml'))
if __name__ == '__main__': main()
