"""Install a repo-local Windows Node.js runtime and run Global Atlas.

Uses Python's standard library only. No administrator access, global Node.js
installation, permanent PATH changes, or PowerShell policy changes are needed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile


PROJECT = Path(__file__).resolve().parents[1]
REPOSITORY = PROJECT.parent
INSTALLATIONS = REPOSITORY / "_installations"
NODE_VERSION = "22.23.5"


def download(url: str, destination: Path) -> None:
    print(f"Downloading {url}", flush=True)
    partial = destination.with_name(destination.name + ".part")
    with urllib.request.urlopen(url, timeout=60) as response:
        with partial.open("wb") as output:
            shutil.copyfileobj(response, output)
    partial.replace(destination)


def install_node() -> Path:
    # PROCESSOR_ARCHITEW6432 identifies native Windows when Python is 32-bit.
    machine = os.environ.get(
        "PROCESSOR_ARCHITEW6432",
        os.environ.get("PROCESSOR_ARCHITECTURE", platform.machine()),
    ).lower()
    architectures = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}
    if machine not in architectures:
        raise RuntimeError(f"This launcher needs 64-bit Windows (detected {machine}).")
    folder = f"node-v{NODE_VERSION}-win-{architectures[machine]}"
    node_directory = INSTALLATIONS / folder
    node = node_directory / "node.exe"
    npm_cli = node_directory / "node_modules" / "npm" / "bin" / "npm-cli.js"
    if node.is_file() and npm_cli.is_file():
        return node_directory

    downloads = INSTALLATIONS / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    archive = downloads / f"{folder}.zip"
    checksums = downloads / f"node-v{NODE_VERSION}-SHASUMS256.txt"
    base_url = f"https://nodejs.org/dist/v{NODE_VERSION}"
    download(f"{base_url}/SHASUMS256.txt", checksums)
    expected = None
    for line in checksums.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1] == archive.name:
            expected = parts[0]
            break
    if expected is None:
        raise RuntimeError(f"The official checksums do not list {archive.name}.")
    if not archive.is_file():
        download(f"{base_url}/{archive.name}", archive)
    with archive.open("rb") as source:
        digest = hashlib.sha256()
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != expected:
        archive.unlink()
        raise RuntimeError("Node.js download checksum failed. Run the launcher again to retry.")

    print(f"Verified Node.js {NODE_VERSION}; extracting into {INSTALLATIONS}", flush=True)
    with zipfile.ZipFile(archive) as bundle:
        # All archive entries must remain inside this version's directory.
        for member in bundle.infolist():
            target = (INSTALLATIONS / member.filename).resolve()
            if not target.is_relative_to(node_directory.resolve()):
                raise RuntimeError(f"Unexpected path in Node.js archive: {member.filename}")
        bundle.extractall(INSTALLATIONS)
    if not node.is_file() or not npm_cli.is_file():
        raise RuntimeError("The Node.js archive did not contain the expected executables.")
    return node_directory


def run(command: list[str], environment: dict[str, str]) -> None:
    subprocess.run(command, cwd=PROJECT, env=environment, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--install-only", action="store_true", help="Install dependencies without starting the server.")
    mode.add_argument("--build", action="store_true", help="Install dependencies and check the production build.")
    args = parser.parse_args()
    if sys.platform != "win32":
        raise RuntimeError("This portable launcher is for Windows.")

    node_directory = install_node()
    environment = os.environ.copy()
    environment["PATH"] = str(node_directory) + os.pathsep + environment.get("PATH", "")
    environment["npm_config_cache"] = str(INSTALLATIONS / "npm-cache")
    environment["npm_config_update_notifier"] = "false"
    # Invoking npm through Node.js also works when PowerShell blocks npm.ps1.
    npm = [str(node_directory / "node.exe"), str(node_directory / "node_modules" / "npm" / "bin" / "npm-cli.js")]
    run([str(node_directory / "node.exe"), "--version"], environment)

    manifest = PROJECT / "package.json"
    lockfile = PROJECT / "package-lock.json"
    marker = INSTALLATIONS / "atlas-dependencies.json"

    def dependency_state() -> dict[str, str]:
        return {
            "node": NODE_VERSION,
            "manifest": hashlib.sha256(manifest.read_bytes()).hexdigest(),
            "lockfile": hashlib.sha256(lockfile.read_bytes()).hexdigest() if lockfile.exists() else "",
        }

    try:
        installed_state = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        installed_state = None
    if installed_state != dependency_state() or not (PROJECT / "node_modules" / ".bin" / "vite.cmd").is_file():
        print("Installing the page's packages (this may take a few minutes)...", flush=True)
        run(npm + ["ci" if lockfile.exists() else "install", "--no-fund", "--no-audit"], environment)
        marker.write_text(json.dumps(dependency_state(), indent=2) + "\n", encoding="utf-8")

    run([sys.executable, str(PROJECT / "scripts" / "prepare_data.py"), "data/pins.csv"], environment)
    if args.build:
        run(npm + ["run", "build"], environment)
    elif not args.install_only:
        print("Opening Global Atlas. Leave this window open; press Ctrl+C to stop.", flush=True)
        run(npm + ["run", "dev", "--", "--host", "127.0.0.1", "--open"], environment)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nGlobal Atlas stopped.")
    except urllib.error.URLError as error:
        print(f"\nDownload failed: {error}", file=sys.stderr)
        print(
            "Downloads need access to nodejs.org and registry.npmjs.org. If university IT blocks "
            "downloads or portable programs, ask IT to allow them; this launcher does not change "
            "security settings. After a connection failure, run it again to retry.",
            file=sys.stderr,
        )
        sys.exit(1)
    except subprocess.CalledProcessError as error:
        print(f"\nA setup or build command failed (exit {error.returncode}). See the output above.", file=sys.stderr)
        sys.exit(1)
    except (OSError, RuntimeError, zipfile.BadZipFile) as error:
        print(f"\nSetup failed: {error}", file=sys.stderr)
        sys.exit(1)
