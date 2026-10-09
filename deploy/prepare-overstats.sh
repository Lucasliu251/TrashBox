#!/usr/bin/env bash
# Prepare a private pinned runtime only. Does not enable collection, migrate or start services.
set -euo pipefail
runtime_dir="${TRASHBOX_OVERSTATS_RUNTIME:-$HOME/.local/share/trashbox-overstats}"
config_dir="${TRASHBOX_OVERSTATS_CONFIG:-$HOME/.config/trashbox}"
revision=4403cbd5006764551ede35c7d70b9907ade105c5
mkdir -p "$runtime_dir" "$config_dir"
chmod 700 "$config_dir"
new_checkout=0
if [[ ! -d "$runtime_dir/overstats/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/AddOneSecondL/Overstats.git "$runtime_dir/overstats"
  new_checkout=1
fi
if [[ "$new_checkout" == 0 && -n "$(git -C "$runtime_dir/overstats" status --porcelain)" ]]; then
  echo 'Overstats 运行目录存在本地修改，已停止，避免覆盖配置。' >&2
  exit 1
fi
git -C "$runtime_dir/overstats" fetch origin "$revision"
git -C "$runtime_dir/overstats" checkout --detach "$revision"
python3 -m venv "$runtime_dir/venv"
"$runtime_dir/venv/bin/python" -m pip install -r "$runtime_dir/overstats/requirements.txt"
"$runtime_dir/venv/bin/python" - "$runtime_dir" "$config_dir" <<'PY'
import json,os,secrets,sys
from pathlib import Path
runtime,config=map(Path,sys.argv[1:])
credential=config/'overstats-credentials.json'
environment=config/'overstats.env'
if not credential.exists():
    credential.write_text(json.dumps({'dts':2026,'accounts':[{'name':'trashbox-private','role_id':0,'token':''}]},indent=2)+'\n')
if not environment.exists():
    environment.write_text('OVERSTATS_VENDOR_ROOT='+str(runtime/'overstats')+'\nOVERSTATS_CREDENTIALS_FILE='+str(credential)+'\nOVERSTATS_BRIDGE_SECRET='+secrets.token_urlsafe(48)+'\nOVERSTATS_ENABLE_DATABASE_WRITE=0\nOVERSTATS_DASHEN_LOG_REQUESTS=0\n')
for path in (credential,environment):os.chmod(path,0o600)
print('配置已准备：'+str(credential)+' 与 '+str(environment))
print('凭据未填写时服务会拒绝启动；准备脚本没有启用采集或修改数据库。')
PY
