#!/usr/bin/env python3
"""Pi のオフライン導入パッケージを作る（開発PC、ネット接続あり、Docker 不要）。

    python3 scripts/build_pi_bundle.py [--out dist/kmt-pi-bundle]

対象: 64-bit Raspberry Pi OS (Debian 13 trixie, arm64)。中身:
  pi_initial.sh, CHECKLIST.md, SHA256SUMS, VERSION
  debs/    Docker CE・Compose・whiptail と不足しがちな依存 + apt 用 Packages
  images/  python:3.13-slim-trixie (docker load 形式)
  app/     main.py ほか (git HEAD)、models/ (scripts/export_model.sh の出力)、wheels/
"""

import argparse
import gzip
import hashlib
import json
import lzma
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCH = "arm64"
SUITE = "trixie"
DOCKER_REPO = "https://download.docker.com/linux/debian"
# security > updates > main is only a fallback order; the highest version wins.
DEBIAN_INDEXES = [
    ("https://security.debian.org/debian-security", "trixie-security"),
    ("https://deb.debian.org/debian", "trixie-updates"),
    ("https://deb.debian.org/debian", "trixie"),
]
APT_PACKAGES = ["docker-ce", "docker-ce-cli", "containerd.io", "docker-buildx-plugin",
                "docker-compose-plugin", "whiptail"]
BASE_IMAGE = ("library/python", "3.13-slim-trixie")
NCNN = "ncnn==1.0.20260526"   # same pin as Dockerfile
APP_FILES = ["Dockerfile", "compose.yaml", ".dockerignore", "main.py", "utils.py",
             "draw_zones.py", "config.json", "requirements-pi.txt"]
MODEL_PARAM = "models/yolo26n_ncnn_model/model.ncnn.param"


def log(msg):
    print(f"[bundle] {msg}", flush=True)


def fetch(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def download(url, path, sha256=None, headers=None):
    """Stream url to path; verify sha256 when given. Existing verified files are kept."""
    if sha256 and os.path.exists(path) and file_sha256(path) == sha256:
        return
    req = urllib.request.Request(url, headers=headers or {})
    h = hashlib.sha256()
    with urllib.request.urlopen(req, timeout=120) as r, open(path + ".part", "wb") as f:
        while chunk := r.read(1 << 20):
            h.update(chunk)
            f.write(chunk)
    if sha256 and h.hexdigest() != sha256:
        os.remove(path + ".part")
        sys.exit(f"sha256 mismatch: {url}")
    os.replace(path + ".part", path)


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


# --- Debian version comparison (dpkg semantics) ---------------------------------

def _order(c):
    if c == "~":
        return -1
    if c.isalpha():
        return ord(c)
    return ord(c) + 256 if c else 0


def _cmp_part(a, b):
    while a or b:
        na = re.match(r"\D*", a).group()
        nb = re.match(r"\D*", b).group()
        for i in range(max(len(na), len(nb))):
            oa = _order(na[i] if i < len(na) else "")
            ob = _order(nb[i] if i < len(nb) else "")
            if oa != ob:
                return oa - ob
        a, b = a[len(na):], b[len(nb):]
        da = re.match(r"\d*", a).group()
        db = re.match(r"\d*", b).group()
        if int(da or 0) != int(db or 0):
            return int(da or 0) - int(db or 0)
        a, b = a[len(da):], b[len(db):]
    return 0


def version_cmp(a, b):
    def split(v):
        epoch, _, rest = v.partition(":") if ":" in v else ("0", "", v)
        upstream, _, rev = rest.rpartition("-") if "-" in rest else (rest, "", "0")
        return int(epoch or 0), upstream, rev
    ea, ua, ra = split(a)
    eb, ub, rb = split(b)
    return (ea - eb) or _cmp_part(ua, ub) or _cmp_part(ra, rb)


# --- apt packages -----------------------------------------------------------------

def parse_packages(text, base):
    """Stanzas of a Packages index, each with its raw text and the repository base URL."""
    out = []
    for block in text.split("\n\n"):
        if not block.strip():
            continue
        fields = dict(re.findall(r"^([\w-]+): (.*)$", block, re.M))
        fields["_raw"], fields["_base"] = block.strip("\n"), base
        out.append(fields)
    return out


def load_indexes():
    stanzas = []
    url = f"{DOCKER_REPO}/dists/{SUITE}/stable/binary-{ARCH}/Packages"
    stanzas += parse_packages(fetch(url).decode(), DOCKER_REPO)
    for base, suite in DEBIAN_INDEXES:
        url = f"{base}/dists/{suite}/main/binary-{ARCH}/Packages.xz"
        try:
            stanzas += parse_packages(lzma.decompress(fetch(url)).decode(), base)
        except urllib.error.HTTPError as e:
            log(f"skip {url} ({e.code})")
    best, provides = {}, {}
    for s in stanzas:
        name = s["Package"]
        if name not in best or version_cmp(s["Version"], best[name]["Version"]) > 0:
            best[name] = s
    for s in best.values():
        for p in s.get("Provides", "").split(","):
            p = re.sub(r"\(.*\)", "", p).strip()
            if p:
                provides.setdefault(p, s["Package"])
    return best, provides


def resolve(best, provides, wanted):
    """Wanted packages and their Depends/Pre-Depends, minus Essential/required ones
    (always on Raspberry Pi OS). Recommends are left out (installed with --no-install-recommends)."""
    chosen, todo = {}, list(wanted)
    while todo:
        name = todo.pop()
        name = name if name in best else provides.get(name, name)
        if name in chosen:
            continue
        s = best.get(name)
        if s is None:
            sys.exit(f"apt package not found: {name}")
        if name not in wanted and (s.get("Essential") == "yes" or s.get("Priority") == "required"):
            continue
        chosen[name] = s
        deps = ",".join(s.get(k, "") for k in ("Pre-Depends", "Depends"))
        for dep in filter(None, (d.strip() for d in deps.split(","))):
            alts = [re.sub(r"\(.*\)|\[.*\]|:\w+", "", a).strip() for a in dep.split("|")]
            # First alternative that exists (as a package or a virtual one)
            pick = next((a for a in alts if a in best or a in provides), alts[0])
            todo.append(pick)
    return chosen


def build_debs(out):
    log("apt indexes...")
    best, provides = load_indexes()
    chosen = resolve(best, provides, APT_PACKAGES)
    os.makedirs(out, exist_ok=True)
    stanzas = []
    for name, s in sorted(chosen.items()):
        fname = os.path.basename(s["Filename"])
        download(f'{s["_base"]}/{s["Filename"]}', os.path.join(out, fname), s["SHA256"])
        stanzas.append(re.sub(r"^Filename: .*$", f"Filename: ./{fname}", s["_raw"], flags=re.M))
        log(f'  {name} {s["Version"]}')
    with open(os.path.join(out, "Packages"), "w") as f:
        f.write("\n\n".join(stanzas) + "\n")
    keep = {os.path.basename(s["Filename"]) for s in chosen.values()} | {"Packages"}
    for name in set(os.listdir(out)) - keep:   # left over from an earlier run
        os.remove(os.path.join(out, name))
    return {n: s["Version"] for n, s in chosen.items()}


# --- base image (docker load format, without Docker) --------------------------------

def build_base_image(path):
    repo, tag = BASE_IMAGE
    token = json.loads(fetch(
        f"https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull"))["token"]
    auth = {"Authorization": f"Bearer {token}"}
    reg = f"https://registry-1.docker.io/v2/{repo}"
    index = json.loads(fetch(f"{reg}/manifests/{tag}", {**auth, "Accept": ",".join([
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json"])}))
    entry = next(m for m in index["manifests"]
                 if m["platform"].get("architecture") == ARCH and m["platform"].get("os") == "linux")
    manifest = json.loads(fetch(f'{reg}/manifests/{entry["digest"]}', {**auth, "Accept": ",".join([
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json"])}))
    config_raw = fetch(f'{reg}/blobs/{manifest["config"]["digest"]}', auth)
    config = json.loads(config_raw)
    diff_ids = config["rootfs"]["diff_ids"]

    with tempfile.TemporaryDirectory() as tmp, tarfile.open(path + ".part", "w") as tar:
        cfg_name = hashlib.sha256(config_raw).hexdigest() + ".json"
        cfg_path = os.path.join(tmp, cfg_name)
        with open(cfg_path, "wb") as f:
            f.write(config_raw)
        tar.add(cfg_path, cfg_name)
        layers = []
        for layer, diff_id in zip(manifest["layers"], diff_ids):
            if not layer["mediaType"].endswith("gzip"):
                sys.exit(f'unsupported layer type {layer["mediaType"]}')
            gz = os.path.join(tmp, "layer.gz")
            download(f'{reg}/blobs/{layer["digest"]}', gz, layer["digest"].split(":")[1], auth)
            plain = os.path.join(tmp, "layer.tar")
            with gzip.open(gz) as src, open(plain, "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
            # docker load checks layers against the config's diff_ids; check here first.
            if "sha256:" + file_sha256(plain) != diff_id:
                sys.exit(f"diff_id mismatch for {layer['digest']}")
            name = f'{diff_id.split(":")[1]}/layer.tar'
            tar.add(plain, name)
            layers.append(name)
        man = os.path.join(tmp, "manifest.json")
        with open(man, "w") as f:
            json.dump([{"Config": cfg_name, "RepoTags": [f"python:{tag}"], "Layers": layers}], f)
        tar.add(man, "manifest.json")
    os.replace(path + ".part", path)
    return entry["digest"]


# --- app ---------------------------------------------------------------------------

def build_app(out):
    if not os.path.exists(os.path.join(ROOT, MODEL_PARAM)):
        sys.exit(f"{MODEL_PARAM} がありません: 先に scripts/export_model.sh を実行してください")
    dirty = subprocess.run(["git", "status", "--porcelain", "--", *APP_FILES, "scripts/pi_initial.sh"],
                           cwd=ROOT, capture_output=True, text=True, check=True).stdout
    if dirty:
        log(f"WARN: uncommitted changes are NOT in the bundle (it takes git HEAD):\n{dirty}")
    os.makedirs(out, exist_ok=True)
    archive = subprocess.run(["git", "archive", "HEAD", "--", *APP_FILES],
                             cwd=ROOT, capture_output=True, check=True).stdout
    with tempfile.TemporaryFile() as f:
        f.write(archive)
        f.seek(0)
        with tarfile.open(fileobj=f) as tar:
            tar.extractall(out)
    shutil.copytree(os.path.join(ROOT, "models"), os.path.join(out, "models"), dirs_exist_ok=True)

    wheels = os.path.join(out, "wheels")
    os.makedirs(wheels, exist_ok=True)
    pip = [sys.executable, "-m", "pip", "download", "-q", "--only-binary=:all:", "-d", wheels,
           "--platform", "manylinux_2_28_aarch64", "--python-version", "3.13", "--implementation", "cp"]
    subprocess.run(pip + ["-r", os.path.join(out, "requirements-pi.txt")], check=True)
    subprocess.run(pip + ["--no-deps", NCNN], check=True)
    return sorted(os.listdir(wheels))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", default=os.path.join(ROOT, "dist", "kmt-pi-bundle"))
    args = p.parse_args(argv)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    # Downloads in debs/ are kept (re-verified) between runs; app/ is rebuilt from HEAD.
    shutil.rmtree(os.path.join(out, "app"), ignore_errors=True)

    debs = build_debs(os.path.join(out, "debs"))
    log("base image...")
    os.makedirs(os.path.join(out, "images"), exist_ok=True)
    digest = build_base_image(os.path.join(out, "images", "python-3.13-slim-trixie.tar"))
    log("app, models, wheels...")
    wheels = build_app(os.path.join(out, "app"))
    for name, dst in [("scripts/pi_initial.sh", "pi_initial.sh"), ("deploy/pi-bundle/CHECKLIST.md", "CHECKLIST.md")]:
        shutil.copy2(os.path.join(ROOT, name), os.path.join(out, dst))

    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                            capture_output=True, text=True, check=True).stdout.strip()
    with open(os.path.join(out, "VERSION"), "w") as f:
        f.write(f"commit {commit}\ntarget Raspberry Pi OS 64-bit ({SUITE}, {ARCH})\n"
                f"base image python:{BASE_IMAGE[1]} {digest}\n")
        f.write("debs " + " ".join(f"{n}={v}" for n, v in sorted(debs.items())) + "\n")
        f.write("wheels " + " ".join(wheels) + "\n")

    sums = []
    for d, _, files in os.walk(out):
        for name in files:
            rel = os.path.relpath(os.path.join(d, name), out)
            if rel != "SHA256SUMS" and not rel.endswith(".part"):
                sums.append(f"{file_sha256(os.path.join(out, rel))}  {rel}")
    with open(os.path.join(out, "SHA256SUMS"), "w") as f:
        f.write("\n".join(sorted(sums, key=lambda s: s.split("  ", 1)[1])) + "\n")
    size = sum(os.path.getsize(os.path.join(d, n)) for d, _, fs in os.walk(out) for n in fs)
    log(f"done: {out} ({size / 2**20:.0f} MB)")


if __name__ == "__main__":
    main()
