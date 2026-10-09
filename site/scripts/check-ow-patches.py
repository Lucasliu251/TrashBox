#!/usr/bin/env python3
"""Regression checks for source selection, mode isolation and outage preservation."""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import tempfile
import sys
sys.dont_write_bytecode = True
from pathlib import Path

spec = importlib.util.spec_from_file_location('patches', Path(__file__).with_name('refresh-ow-patches.py'))
patches = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patches)

def section(title, body, kind='hero_update'):
    return f'<div class="PatchNotes-section PatchNotes-section-{kind}"><h4 class="PatchNotes-sectionTitle">{title}</h4>{body}</div>'

def hero(name, changes):
    return f'<div class="PatchNotesHeroUpdate"><h5 class="PatchNotesHeroUpdate-name">{name}</h5><ul>' + ''.join(f'<li>{line}</li>' for line in changes) + '</ul></div>'

def article(day, body):
    return f'<div class="PatchNotes-patch"><div class="anchor" id="patch-{day}"></div><div class="PatchNotes-date">{day.replace("-", "年", 1).replace("-", "月", 1)}日</div><h3 class="PatchNotes-patchTitle">补丁说明 {day.replace("-", "年", 1).replace("-", "月", 1)}日</h3>{body}</div>'

names = {'安娜': 'ana', 'D.Va': 'dva', '源氏': 'genji'}
cn = patches.SOURCES['cn'][0] + '2026/10/'
gl = patches.SOURCES['global'][0] + '2026/10/'
body = section('英雄更新', hero('安娜', ['治療量從 10 提高至 15。', '冷卻時間從 8 縮短至 6 秒。']))
body += section('肉盾', hero('D.Va', ['護甲從 100 降低至 80。', '護甲從 100 提高至 150。（6v6）']))
body += section('角斗领域更新', '', 'generic_update')
body += section('输出', hero('源氏', ['傷害從 10 提高至 20。']))
source = article('2026-10-08', section('错误修复', '<p>Fix only</p>', 'generic_update')) + article('2026-10-07', body)
parsed = patches.parse_notes(source, 'cn', cn, names, dt.date(2026,10,9))
assert parsed['date'] == '2026-10-07', 'Bug fix date must not become balance date'
assert parsed['groups'] == {'enhances':['ana'], 'weakens':['dva'], 'adjusts':[]}
assert not any(h['id'] == 'genji' for h in parsed['heroes']), 'Stadium must not leak into retail picks'
mixed = article('2026-10-07', section('英雄更新', hero('安娜', ['治療量從 10 提高至 20。', '冷卻時間從 4 延長至 8 秒。'])))
assert patches.parse_notes(mixed,'cn',cn,names,dt.date(2026,10,9))['groups']['adjusts'] == ['ana']
rework = article('2026-10-07', section('英雄重製', hero('安娜', ['治療量從 10 提高至 20。'])))
assert patches.parse_notes(rework,'cn',cn,names,dt.date(2026,10,9))['groups']['adjusts'] == ['ana']
assert patches.parse_notes(article('2026-10-10', body),'cn',cn,names,dt.date(2026,10,9)) is None

class FixedDateTime(dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026,10,9,12,tzinfo=patches.BEIJING)

patches.dt.datetime = FixedDateTime
routes = {cn: article('2026-10-06', section('英雄更新',hero('安娜',['治療量從 10 提高至 20。']))), gl: source}
def fixture(url, cache):
    if url not in routes:
        raise OSError('Fixture source outage')
    return routes[url]
patches.read_source = fixture
with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
    root = Path(folder)
    catalog, output, published = root/'catalog.json', root/'patch.json', root/'published.json'
    catalog.write_text(json.dumps({'heroes':[{'id':key,'name':name} for name,key in names.items()]}))
    patches.refresh(catalog,[output,published],root/'cache')
    first = json.loads(output.read_text())
    assert first['region'] == 'global' and first['date'] == '2026-10-07'
    assert output.read_bytes() == published.read_bytes()
    routes.pop(gl)
    patches.refresh(catalog,[output,published],root/'cache')
    retained = json.loads(output.read_text())
    assert retained['date'] == first['date'] and retained['refreshStatus'] == 'retained', 'Outage must not roll back newer global notes'
    routes[cn] = source
    patches.refresh(catalog,[output,published],root/'cache')
    assert json.loads(output.read_text())['region'] == 'cn', 'Same-date domestic notes win'
    routes.clear()
    patches.refresh(catalog,[output,published],root/'cache')
    assert json.loads(output.read_text())['refreshStatus'] == 'retained'
print('OW Chinese patches passed: latest balance vs fixes, numeric direction, rework, 6v6/Stadium exclusion, source ordering, atomic copies and outage preservation.')
