"""Create a source handoff without credentials, runtimes or builds."""
from pathlib import Path
import json
import os
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {"node_modules", ".venv", ".venv-house", ".venv-house312", "__pycache__", ".pytest_cache", ".git", ".next", ".vinext", ".wrangler", ".sites-runtime", "dist", "outputs", "coverage", ".agents", ".codex", "work"}


def source_files():
    for directory, names, files in os.walk(ROOT):
        names[:] = sorted(name for name in names if name not in SKIP_DIRS)
        for name in sorted(files):
            if (name.startswith((".env", ".dev.vars")) and name != ".env.example") or name == ".npmrc":
                continue
            if name.endswith((".pem", ".key", ".pyc", ".tsbuildinfo", ".log")) or name in {"next-env.d.ts", "professional-editor-check.png"}:
                continue
            yield Path(directory) / name


def local_secret_values():
    config = ROOT / ".dev.vars"
    if not config.exists():
        return []
    secrets = []
    for line in config.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        value = value.strip().strip('"').strip("'")
        if sep and ("KEY" in key or "TOKEN" in key or "SECRET" in key) and len(value) >= 12:
            secrets.append(value.encode())
    return secrets


def main():
    files = list(source_files())
    secrets = local_secret_values()
    for file in files:
        content = file.read_bytes()
        if any(secret in content for secret in secrets):
            raise RuntimeError(f"Credential value found in source file: {file.relative_to(ROOT)}")
    # Client build is independently checked; server bindings remain runtime-only.
    client = ROOT / "dist" / "client"
    if client.exists():
        for file in client.rglob("*"):
            if file.is_file() and any(secret in file.read_bytes() for secret in secrets):
                raise RuntimeError(f"Credential value found in browser build: {file.relative_to(ROOT)}")
    output = ROOT / "outputs"
    output.mkdir(exist_ok=True)
    archive = output / "roomcraft-source.zip"
    temporary = output / "roomcraft-source.zip.tmp"
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=8, strict_timestamps=False) as bundle:
        for file in files:
            bundle.write(file, "roomcraft/" + file.relative_to(ROOT).as_posix())
    temporary.replace(archive)
    report = {"archive": archive.name, "files": len(files), "bytes": archive.stat().st_size,
              "credentialsInSourceOrBrowserBuild": False, "excluded": sorted(SKIP_DIRS)}
    (output / "source-package-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
