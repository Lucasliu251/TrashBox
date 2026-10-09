#!/usr/bin/env python3
"""Private JSON-only adapter. No native UI, rendering, AI or participant fan-out."""
import asyncio
import contextlib
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PIN = '4403cbd5006764551ede35c7d70b9907ade105c5'
RAW_FIELDS = ('matchId','beginTs','_dashenSeason','mapGuid','heroGuid','instanceType','roleType',
              'matchRet','teamScore','opponentScore','kill','assist','death','heroDamage','cure')

def signed_request(body,signature,secret,seen,now=None):
    now=time.time() if now is None else now
    if len(body)>8192 or not secret or not re.fullmatch('[a-f0-9]{64}',signature or ''):
        raise ValueError('unauthorized')
    expected=hmac.new(secret.encode(),body,hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected,signature):raise ValueError('unauthorized')
    request=json.loads(body)
    if not isinstance(request,dict) or set(request)!={'operation','selector','expires','nonce'}:raise ValueError('invalid_request')
    expires=request['expires'];nonce=request['nonce'];selector=request['selector']
    if isinstance(expires,bool) or not isinstance(expires,int) or not now<=expires<=now+120:raise ValueError('expired')
    if not isinstance(nonce,str) or not re.fullmatch('[a-f0-9]{32}',nonce):raise ValueError('invalid_request')
    for key,expiry in list(seen.items()):
        if expiry<now:seen.pop(key,None)
    if nonce in seen or len(seen)>=5000:raise ValueError('replay')
    if request['operation'] not in ('resolve','matches') or not isinstance(selector,str) or len(selector)>128:raise ValueError('invalid_request')
    if request['operation']=='matches' and not re.fullmatch('[0-9]{1,32}',selector):raise ValueError('invalid_request')
    if request['operation']=='resolve' and not re.fullmatch(r'[^#\x00-\x1f\x7f]{1,64}#[0-9]{3,12}',selector):raise ValueError('invalid_request')
    seen[nonce]=expires
    return request

def safe_rows(rows):
    if not isinstance(rows,list) or len(rows)>100:raise ValueError('invalid_batch')
    result=[]
    for row in rows:
        if not isinstance(row,dict):raise ValueError('invalid_batch')
        # Remove all names, external IDs, avatars, credentials, participant arrays and raw data.
        projected={key:row.get(key) for key in RAW_FIELDS if key in row}
        if any(value is not None and not isinstance(value,(str,int,float)) for value in projected.values()):raise ValueError('invalid_batch')
        result.append(projected)
    return result

class Core:
    def __init__(self):
        root=Path(os.environ['OVERSTATS_VENDOR_ROOT'])
        current=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
        if current!=PIN:raise ValueError('unreviewed_version')
        credential_file=Path(os.environ['OVERSTATS_CREDENTIALS_FILE'])
        if stat.S_IMODE(credential_file.stat().st_mode)&0o077:raise ValueError('credential_permissions')
        credentials=json.loads(credential_file.read_text())
        accounts=credentials.get('accounts',[])
        if not accounts or not all(isinstance(account.get('role_id'),int) and account['role_id']>0
              and isinstance(account.get('token'),str) and len(account['token'])>=16 for account in accounts):raise ValueError('credentials_missing')
        # The same flag controls player identity, match-detail and request-metrics recorders.
        os.environ['OVERSTATS_ENABLE_DATABASE_WRITE']='0'
        os.environ['OVERSTATS_DASHEN_LOG_REQUESTS']='0'
        os.environ['OVERSTATS_DASHEN_MAX_CONCURRENT_REQUESTS']='1'
        sys.path.insert(0,str(root.parent))
        with open(os.devnull,'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            from overstats.config import config
            config.ENABLE_DATABASE_WRITE=False
            config.DASHEN_ACCOUNTS=accounts
            config.DASHEN_DTS=int(credentials.get('dts',time.localtime().tm_year))
            config.DASHEN_SERVER=1
            config.DASHEN_NETEASE_PROXIES=[]
            from overstats.config import is_database_write_enabled
            from overstats.src.client import apiclient
            if is_database_write_enabled() or apiclient.is_database_write_enabled():raise ValueError('storage_not_disabled')
            from overstats.src.modules.bnet_search import bnet_search_module
            from overstats.src.modules.dashen_match.requests import DashenMatchRequests, DashenMatchQuery
        self.search=bnet_search_module
        self.client=apiclient.dashen_api_client
        self.requests=DashenMatchRequests(self.client)
        self.query_type=DashenMatchQuery
        metadata=json.loads((root/'res/query_tool.json').read_text())
        self.maps={str(row.get('guid')):row.get('name') for row in metadata.get('mapList',[]) if isinstance(row,dict)}
        self.heroes={str(row[key]):row.get('name') for row in metadata.get('heroList',[]) if isinstance(row,dict)
                     for key in ('heroGuid','heroId','guid','id') if row.get(key) is not None}

    async def query(self,operation,selector):
        # Vendor logging is silenced even on exceptions; no URL/body/target reaches journald.
        with open(os.devnull,'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            output=await self.search.search(selector,render=False)
            result=output.result
            source_id=str(result.bnet_id)
            if not source_id.isdigit() or not result.customer_token:raise ValueError('identity_mismatch')
            if operation=='matches' and source_id!=selector:raise ValueError('identity_mismatch')
            if operation=='resolve':
                card=await self.client.query_card(result.customer_token)
                data=card.get('data') if isinstance(card,dict) else None
                if card.get('code') != 0 or not isinstance(data,dict) or data.get('name')!=selector or str(data.get('bnetId'))!=source_id:
                    raise ValueError('identity_mismatch')
                return {'ok':True,'source_id':source_id,'battle_tag':data['name']}
            rows=await self.requests.list_recent_matches(self.query_type(customer_token=result.customer_token,
              include_previous_season=True,include_fight=False,target_count=48))
            clean=safe_rows(rows[:48])
            for row in clean:
                # Only names from the public game dictionary, never raw player/name fields.
                row['mapName']=self.maps.get(str(row.get('mapGuid')))
                row['heroName']=self.heroes.get(str(row.get('heroGuid')))
            return {'ok':True,'source_id':source_id,'matches':clean}

def serve():
    secret=os.environ.get('OVERSTATS_BRIDGE_SECRET','')
    if len(secret)<32:raise ValueError('bridge_secret_missing')
    loop=asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    core=Core()
    thread=threading.Thread(target=loop.run_forever,daemon=True);thread.start()
    busy=threading.Lock();seen={}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def reply(self,status,data):
            body=json.dumps(data,ensure_ascii=False).encode()
            self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
        def do_GET(self):
            self.reply(200,{'ok':True,'commit':PIN,'storage':False,'concurrency':1}) if self.path=='/healthz' else self.reply(404,{'ok':False})
        def do_POST(self):
            if self.path!='/authorized-query':return self.reply(404,{'ok':False})
            if not busy.acquire(blocking=False):return self.reply(429,{'ok':False,'error':'busy'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 1<=length<=8192:return self.reply(400,{'ok':False,'error':'invalid_request'})
                request=signed_request(self.rfile.read(length),self.headers.get('X-Trashbox-Signature',''),secret,seen)
                future=asyncio.run_coroutine_threadsafe(core.query(request['operation'],request['selector']),loop)
                try:data=future.result(timeout=85)
                except Exception:
                    future.cancel();return self.reply(502,{'ok':False,'error':'upstream_unavailable'})
                self.reply(200,data)
            except Exception:self.reply(403,{'ok':False,'error':'query_rejected'})
            finally:busy.release()
    # Fixed loopback, no native Overstats server/UI/general search endpoint.
    server=ThreadingHTTPServer(('127.0.0.1',18081),Handler)
    server.serve_forever()

if __name__=='__main__':
    try:serve()
    except Exception:
        print('Overstats 私有配置未完成或与审核版本不符；服务未启动。',file=sys.stderr)
        raise SystemExit(1)
