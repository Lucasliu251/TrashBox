#!/usr/bin/env python3
"""Apply a composed OW artifact on Ubuntu; preserve account/other-site state.

Usage: python3 apply-ow-release.py ARCHIVE EXPECTED_NGINX_SHA256 RELEASE_ID
The archive must be produced by the checked/reviewed local composition workflow.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile

archive, expected_nginx, release_id = sys.argv[1:]
root = Path('/home/ubuntu/TrashBox')
nginx = Path('/etc/nginx/sites-available/trashbox')
release = root / '.ow-releases' / release_id
release.mkdir(parents=True, exist_ok=False)
payload = release / 'payload'
payload.mkdir()

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def sudo(*args):
    subprocess.run(['sudo', '-n', *args], check=True)

with tarfile.open(archive) as bundle:
    for member in bundle.getmembers():
        target = (payload / member.name).resolve()
        if not target.is_relative_to(payload.resolve()) or member.issym() or member.islnk():
            raise SystemExit('Unexpected archive path/link')
    bundle.extractall(payload)
manifest = json.loads((payload / 'release-manifest.json').read_text())
for name, checksum in manifest.items():
    if sha(payload / name) != checksum:
        raise SystemExit('Artifact checksum mismatch: ' + name)
baseline = json.loads((payload / 'account-baseline-sha256.json').read_text())

def check_baseline():
    changed = [name for name, checksum in baseline.items() if not (root / name).is_file() or sha(root / name) != checksum]
    if changed:
        raise SystemExit('Production account source changed; recompose before publishing: ' + ', '.join(changed))

check_baseline()
if sha(nginx) != expected_nginx:
    raise SystemExit('Nginx changed; rebase its include before publishing')
for path in ('/etc/nginx/conf.d/trashbox-ow-limit.conf', '/etc/nginx/snippets/trashbox-ow-proxy.conf', '/etc/nginx/snippets/trashbox-ow-locations.conf'):
    if Path(path).exists():
        raise SystemExit('Existing OW config requires reviewed update: ' + path)
if not Path('/etc/ssl/certs/ca-certificates.crt').is_file():
    raise SystemExit('Missing upstream CA store')
published = root / '.serve-public'
shutil.copytree(published, release / 'published-before')
shutil.copytree(root / 'site/dist', release / 'dist-before')
shutil.copy2(nginx, release / 'nginx-before.conf')
source_before = release / 'source-before'
source_before.mkdir()
source_files = list((payload / 'source').rglob('*'))
existed = []
for source in source_files:
    if not source.is_file():
        continue
    name = str(source.relative_to(payload / 'source'))
    target = root / name
    if target.is_file():
        backup = source_before / name
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, backup)
        existed.append(name)
(release / 'source-existing.json').write_text(json.dumps(existed, indent=2) + '\n')

config = nginx.read_text()
anchor = config.index('# --- HTTPS 主服务器 ---')
position = config.index('server_name trashbox.tech;', anchor) + len('server_name trashbox.tech;')
config = config[:position] + '\n    include /etc/nginx/snippets/trashbox-ow-locations.conf;\n' + config[position:]
candidate_nginx = release / 'nginx-after.conf'
candidate_nginx.write_text(config)
installed = []
source_started = False
published_started = False

def overlay(source, destination):
    for file in source.rglob('*'):
        if not file.is_file():
            continue
        target = destination / file.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + '.ow-new')
        shutil.copy2(file, temporary)
        os.chmod(temporary, 0o644)
        os.replace(temporary, target)

try:
    for name, destination in [
        ('nginx-ow-http.conf', '/etc/nginx/conf.d/trashbox-ow-limit.conf'),
        ('nginx-ow-proxy.conf', '/etc/nginx/snippets/trashbox-ow-proxy.conf'),
        ('nginx-ow-locations.conf', '/etc/nginx/snippets/trashbox-ow-locations.conf'),
    ]:
        sudo('install', '-m', '644', str(payload / 'nginx' / name), destination)
        installed.append(destination)
    sudo('install', '-m', '644', str(candidate_nginx), str(nginx))
    sudo('nginx', '-t')
    check_baseline()
    source_started = True
    overlay(payload / 'source', root)
    overlay(payload / 'dist', root / 'site/dist')
    # Upload hashed chunks and public snapshots before the new entrypoint. Keep
    # old chunks, auth/, radar/ and every independent app intact.
    published_started = True
    for directory in ('site-static', 'ow-data'):
        overlay(payload / 'dist' / directory, published / directory)
    entry = published / 'index.html.ow-new'
    shutil.copy2(payload / 'dist/index.html', entry)
    os.chmod(entry, 0o644)
    sudo('systemctl', 'reload', 'nginx')
    os.replace(entry, published / 'index.html')
    (release / 'complete.json').write_text(json.dumps({'release_id': release_id, 'index_sha256': sha(published / 'index.html'), 'account_gate_preserved': True}, indent=2) + '\n')
    print('Published OW release:', release_id)
    print('Rollback backup:', release)
except BaseException:
    sudo('install', '-m', '644', str(release / 'nginx-before.conf'), str(nginx))
    for path in installed:
        sudo('rm', '-f', path)
    sudo('nginx', '-t')
    sudo('systemctl', 'reload', 'nginx')
    if source_started:
        for source in source_files:
            if source.is_file():
                name = str(source.relative_to(payload / 'source'))
                target = root / name
                if name in existed:
                    shutil.copy2(source_before / name, target)
                elif target.exists():
                    target.unlink()
        overlay(release / 'dist-before', root / 'site/dist')
    if published_started:
        shutil.copy2(release / 'published-before/index.html', published / 'index.html')
    raise
