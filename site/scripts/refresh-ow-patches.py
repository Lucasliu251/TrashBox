#!/usr/bin/env python3
"""Read official Chinese retail notes; publish public IDs/dates only, never translated prose."""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import tempfile
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

BEIJING = dt.timezone(dt.timedelta(hours=8))
SOURCES = {
    'cn': ('https://ow.blizzard.cn/news/patch-notes/live/', 'zh-CN'),
    'global': ('https://overwatch.blizzard.com/zh-tw/news/patch-notes/live/', 'zh-TW'),
}
# Official regional names map to the same stable hero IDs; no translation of notes.
TW_NAMES = {
    '攔路豬': 'roadhog', '駭影': 'sombra', 'D.Va': 'dva', '多米娜': 'domina',
    '壁壘機兵': 'bastion', '卡西迪': 'cassidy', '伊默': 'emre', '源氏': 'genji',
    '死怨': 'shion', '安娜': 'ana', '血律': 'doctrine', '路西歐': 'lucio',
    '安燃': 'anran', '艾西': 'ashe', '巴帝斯特': 'baptiste', '毀滅拳王': 'doomfist',
    '迴音': 'echo', '半藏': 'hanzo', '災害': 'hazard', '伊拉里': 'illari',
    '火箭貓': 'jetpackcat', '垃圾鎮女王': 'junker-queen', '炸彈鼠': 'junkrat',
    '朱諾': 'juno', '霧子': 'kiriko', '織命': 'lifeweaver', '莫加': 'mauga',
    '慈悲': 'mercy', '瑞稀': 'mizuki', '莫伊拉': 'moira', '萊因哈特': 'reinhardt',
    '席艾拉': 'sierra', '索潔恩': 'sojourn', '辛梅塔': 'symmetra', '托比昂': 'torbjorn',
    '閃光': 'tracer', '無畏': 'venture', '火爆鋼球': 'wrecking-ball', '無漾': 'wuyang',
    '禪亞塔': 'zenyatta', '札莉雅': 'zarya', '弗蕾亞': 'freja', '宿怨': 'vendetta',
    '溫斯頓': 'winston', '士兵：76': 'soldier-76', '奪命女': 'widowmaker',
    '死神': 'reaper', '歐瑞莎': 'orisa', '拉瑪塔': 'ramattra', '小美': 'mei',
    '法拉': 'pharah', '席格馬': 'sigma', '碧姬': 'brigitte', '禦子': 'kiriko',
}

class Node:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children = []

    def has(self, classname):
        return classname in self.attrs.get('class', '').split()

    def text(self):
        return re.sub(r'\s+', ' ', ''.join(child if isinstance(child, str) else child.text() for child in self.children)).strip()

    def descendants(self):
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.descendants()

    def first(self, classname):
        return next((n for n in self.descendants() if n.has(classname)), None)

class Tree(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = self.current = Node()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        child = Node(tag, attrs, self.current)
        self.current.children.append(child)
        if tag not in self.VOID:
            self.current = child

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        node = self.current
        while node.parent:
            if node.tag == tag:
                self.current = node.parent
                return
            node = node.parent

    def handle_data(self, data):
        self.current.children.append(data)

def note_date(text):
    match = re.search(r'(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', text)
    if not match:
        raise ValueError('Official note date missing')
    return dt.date(*(int(x) for x in match.groups())).isoformat()

def numeric_direction(text):
    # Only explicit comparisons. Unknown effects, reworks and hitboxes remain adjustments.
    if '6v6' in text.lower():
        return None
    inverse = re.search(r'冷卻|冷却|消耗|施放時間|施放时间|變形時間|变形时间|恢復時間|恢复时间|延遲時間|延迟时间|散布|擴散|扩散|裝填時間|装填时间', text)
    positive = re.search(r'傷害|伤害|治療|治疗|生命值|護甲|护甲|射速|射擊頻率|射擊速率|攻击速度|攻擊速度|移動速度|移动速度|彈匣容量|弹匣容量|彈道速度|弹道速度|彈藥數|弹药数|持續時間|持续时间', text)
    if not inverse and not positive:
        return 'adjusts'
    pair = re.search(r'(?:從|从)\s*(\d+(?:\.\d+)?)\D{0,20}?(?:至|到|為|为)\s*(\d+(?:\.\d+)?)', text)
    if pair:
        delta = float(pair[2]) - float(pair[1])
    elif re.search(r'提高|提升|增加|延長|延长', text):
        delta = 1
    elif re.search(r'降低|減少|减少|縮短|缩短|縮小|缩小', text):
        delta = -1
    else:
        return 'adjusts'
    if delta == 0:
        return 'adjusts'
    return 'enhances' if delta * (-1 if inverse else 1) > 0 else 'weakens'

def parse_notes(text, region, url, names, today):
    root = Tree(text).root
    parsed = []
    for patch in (n for n in root.descendants() if n.has('PatchNotes-patch')):
        title = patch.first('PatchNotes-patchTitle')
        if not title:
            continue
        date = note_date(title.text())
        if date > today.isoformat():
            continue
        groups = {key: set() for key in ('enhances', 'weakens', 'adjusts')}
        heroes, unmapped, seen = {}, set(), set()
        stadium = False
        for section in (n for n in patch.descendants() if n.has('PatchNotes-section')):
            heading = section.first('PatchNotes-sectionTitle')
            label = heading.text() if heading else ''
            if re.search(r'角斗|鬥技|斗技|Stadium|6v6', label, re.I):
                stadium = True
            elif re.search(r'英雄更新|英雄重製|英雄重制', label):
                stadium = False
            if stadium or not section.has('PatchNotes-section-hero_update'):
                continue
            structural = bool(re.search(r'重製|重制|命中區域|命中区域', label))
            for hero in (n for n in section.descendants() if n.has('PatchNotesHeroUpdate')):
                if id(hero) in seen:
                    continue
                seen.add(id(hero))
                heading = hero.first('PatchNotesHeroUpdate-name')
                if not heading:
                    continue
                source_name = heading.text()
                key = names.get(source_name)
                if not key:
                    unmapped.add(source_name)
                    continue
                directions = set()
                for item in (n for n in hero.descendants() if n.tag == 'li'):
                    direction = 'adjusts' if structural else numeric_direction(item.text())
                    if direction:
                        directions.add(direction)
                if not directions:
                    continue
                if {'enhances', 'weakens'} <= directions:
                    # Do not claim net strength for a mixed kit change.
                    directions = {'adjusts'}
                for direction in directions:
                    groups[direction].add(key)
                heroes[key] = {'id': key, 'sourceName': source_name}
        if not heroes and not unmapped:
            continue  # Bug fixes/event news are not new balance patches.
        anchor = next((n.attrs['id'] for n in patch.descendants() if n.attrs.get('id', '').startswith('patch-')), '')
        published = patch.first('PatchNotes-date')
        parsed.append({
            'date': date, 'publishedDate': note_date(published.text()) if published else date,
            'title': title.text(), 'region': region, 'language': SOURCES[region][1],
            'sourceUrl': url + ('#' + anchor if anchor else ''),
            'groups': {key: sorted(value) for key, value in groups.items()},
            'heroes': sorted(heroes.values(), key=lambda row: row['id']), 'unmappedNames': sorted(unmapped),
        })
    return max(parsed, key=lambda patch: patch['date']) if parsed else None

def read_source(url, cache_dir):
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(url.encode()).hexdigest()
    body, metadata = cache_dir / (key + '.html'), cache_dir / (key + '.json')
    headers = {'User-Agent': 'TrashBox-OW-Patch/1.0 (+https://trashbox.tech/)', 'Accept': 'text/html'}
    if metadata.exists() and body.exists():
        old = json.loads(metadata.read_text())
        for source, target in [('etag', 'If-None-Match'), ('lastModified', 'If-Modified-Since')]:
            if old.get(source):
                headers[target] = old[source]
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=18) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError('Official page exceeds bound')
            text = raw.decode('utf-8')
            body.write_text(text)
            metadata.write_text(json.dumps({'etag': response.headers.get('ETag'), 'lastModified': response.headers.get('Last-Modified')}))
            return text
    except urllib.error.HTTPError as error:
        if error.code == 304 and body.exists():
            return body.read_text()
        raise

def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.ow-patch-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as file:
            json.dump(value, file, ensure_ascii=False, indent=2)
            file.write('\n')
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)

def refresh(catalog_path, outputs, cache_dir):
    now = dt.datetime.now(BEIJING)
    names = {hero['name']: hero['id'] for hero in json.loads(catalog_path.read_text())['heroes']}
    names.update(TW_NAMES)
    names.update({'D.Mon': 'dmon', 'D.VA': 'dva', '卢西奥': 'lucio'})
    current = now.date().replace(day=1)
    previous = (current - dt.timedelta(days=1)).replace(day=1)
    candidates, errors = [], []
    for region, (base, _) in SOURCES.items():
        for month in (current, previous):
            url = base + month.strftime('%Y/%m/')
            try:
                patch = parse_notes(read_source(url, cache_dir), region, url, names, now.date())
                if patch:
                    candidates.append(patch)
                    break
            except Exception as error:
                errors.append({'region': region, 'month': month.strftime('%Y-%m'), 'error': type(error).__name__})
    previous_data = None
    for path in outputs:
        try:
            retained = json.loads(path.read_text())
            if retained.get('schemaVersion') == 1 and (not previous_data or retained['date'] > previous_data['date']):
                previous_data = retained
        except (OSError, ValueError, KeyError):
            pass
    if not candidates:
        if not previous_data:
            raise RuntimeError('No Chinese official balance notes; no prior snapshot')
        result = {**previous_data, 'checkedAt': now.isoformat(), 'refreshStatus': 'retained', 'sourceErrors': errors}
    else:
        # A same-date Chinese domestic record wins; a source outage cannot roll back newer data.
        newest = max(candidates, key=lambda patch: (patch['date'], patch['region'] == 'cn'))
        if previous_data and previous_data['date'] > newest['date']:
            result = {**previous_data, 'checkedAt': now.isoformat(), 'refreshStatus': 'retained', 'sourceErrors': errors}
        else:
            result = {'schemaVersion': 1, **newest, 'fetchedAt': now.isoformat(), 'checkedAt': now.isoformat(),
                      'refreshStatus': 'ok', 'sourceErrors': errors, 'classification': 'explicit-numeric-v1'}
    for path in outputs:
        atomic_json(path, result)
    print(json.dumps({'date': result['date'], 'region': result['region'], 'heroes': len(result['heroes']), 'status': result['refreshStatus']}, ensure_ascii=False))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--publish', type=Path)
    parser.add_argument('--cache-dir', type=Path, required=True)
    args = parser.parse_args()
    refresh(args.catalog, [args.output] + ([args.publish] if args.publish else []), args.cache_dir)

if __name__ == '__main__':
    main()
