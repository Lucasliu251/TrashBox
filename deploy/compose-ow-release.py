#!/usr/bin/env python3
"""Compose OW onto an account-aware site snapshot without modifying that source.

Usage: python3 deploy/compose-ow-release.py ACCOUNT_BASE OW_WORKTREE OUTPUT
ACCOUNT_BASE must contain site/ and shared/auth.ts from the current production
source; OUTPUT must be an empty/new directory. No server mutations are performed.
"""
from pathlib import Path
import hashlib
import json
import shutil
import sys

base, ow, output = (Path(arg).resolve() for arg in sys.argv[1:])
output.mkdir(parents=True, exist_ok=True)
if any(output.iterdir()):
    raise SystemExit('Output must be empty')
excluded = shutil.ignore_patterns('node_modules', 'dist', '*.tsbuildinfo', '.env', '.env.*')
shutil.copytree(base / 'site', output / 'site', ignore=excluded)
shutil.copytree(base / 'shared', output / 'shared', ignore=excluded)
hashes = {}
for prefix in ('site', 'shared'):
    for file in (output / prefix).rglob('*'):
        if file.is_file():
            hashes[str(file.relative_to(output))] = hashlib.sha256(file.read_bytes()).hexdigest()

community = output / 'site/src/CommunityApp.vue'
text = community.read_text()
original = text
own = (ow / 'site/src/CommunityApp.vue').read_text()

def replace_once(old, new):
    global text
    if text.count(old) != 1:
        raise SystemExit('Account baseline changed: ' + old[:90])
    text = text.replace(old, new, 1)

if "import App from './App.vue'" not in (output / 'site/src/main.ts').read_text():
    raise SystemExit('Expected production App session gate')
replace_once("ref } from 'vue'", "ref, watch } from 'vue'")
replace_once("import RichContent from './RichContent'", "import RichContent from './RichContent'\nimport OwHome from './features/ow/OwHome.vue'")
game_state = own[own.index("const game = ref"):own.index("const initial =")]
replace_once("const initial = query.get('view')", game_state + "const initial = query.get('view')")
replace_once("function loadView() {", "function loadView() {\n  if (game.value === 'ow') return")
replace_once("function navigate(target: View, id = '') {", "function navigate(target: View, id = '') {\n  if (game.value === 'ow') lastOwUrl = `${location.pathname}${location.search}`\n  game.value = 'cs2'")
switch = own[own.index('function switchGame('):own.index('function onPopState()')]
replace_once('function onPopState() {', switch + 'function onPopState() {')
replace_once("function onPopState() {\n  const query = new URLSearchParams(location.search)", "function onPopState() {\n  const query = new URLSearchParams(location.search)\n  game.value = query.get('game') === 'ow' ? 'ow' : 'cs2'")
replace_once('<div class="community-app">', '<div class="community-app" :class="{ \'game-ow\': game === \'ow\' }">')
replace_once('<header class="topbar">', '<header class="topbar account-aware-topbar">')
switch_markup = own[own.index('      <div class="game-switch"'):own.index('      <nav v-if="game')]
replace_once('<nav class="desktop-tabs" aria-label="主站导航">', switch_markup.strip() + '\n      <nav v-if="game === \'cs2\'" class="desktop-tabs" aria-label="CS2 与社区导航">')
replace_once('      </nav>\n      <a class="account-entry"', '      </nav>\n      <span v-else class="ow-header-caption">英雄集结 · 国服数据观察</span>\n      <a class="account-entry"')
replace_once('<main class="page-shell"', '<OwHome v-if="game === \'ow\'" />\n    <main v-else class="page-shell"')
replace_once('<nav class="tabbar"', '<nav v-if="game === \'cs2\'" class="tabbar"')

# These authentication invariants must survive composition verbatim.
for invariant in ("const props = defineProps", "credentials: 'include'", 'response.status === 401', 'props.steamId', 'class="account-entry"', 'accountUrl()'):
    if invariant not in original or invariant not in text:
        raise SystemExit('Lost account invariant: ' + invariant)
community.write_text(text)
main = output / 'site/src/main.ts'
main.write_text(main.read_text().replace("import './community.css'", "import './community.css'\nimport './game-navigation.css'"))
shutil.copytree(ow / 'site/src/features/ow', output / 'site/src/features/ow')
shutil.copy2(ow / 'site/src/game-navigation.css', output / 'site/src/game-navigation.css')
shutil.copytree(ow / 'site/public/ow-data', output / 'site/public/ow-data')
shutil.copytree(ow / 'site/scripts', output / 'site/scripts')
package = output / 'site/package.json'
data = json.loads(package.read_text())
data['scripts'].update({key: value for key, value in json.loads((ow / 'site/package.json').read_text())['scripts'].items() if key.startswith('ow:')})
package.write_text(json.dumps(data, indent=2) + '\n')
vite = output / 'site/vite.config.ts'
config = vite.read_text()
proxy = (ow / 'site/vite.config.ts').read_text()
ow_proxy = proxy[proxy.index("      '/ow-live':"):proxy.index('\n    },', proxy.index("      '/ow-live':"))]
config = config.replace("  base: '/',", "  base: '/',\n  cacheDir: '../../vite-cache',", 1)
config = config.replace('    proxy: {', '    proxy: {\n' + ow_proxy, 1)
vite.write_text(config)
(output / 'account-baseline-sha256.json').write_text(json.dumps(hashes, indent=2) + '\n')
print('Composed OW release preserving production account gate:', output)
