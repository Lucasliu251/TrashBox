#!/usr/bin/env python3
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('bridge',Path(__file__).parents[2]/'deploy/overstats_bridge.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)

class Bridge(unittest.TestCase):
    secret='fixture-secret-only-never-a-real-key'
    def request(self,**changes):
        obj={'operation':'resolve','selector':'Fixture#1111','expires':1050,'nonce':'a'*32};obj.update(changes)
        body=json.dumps(obj).encode()
        return body,hmac.new(self.secret.encode(),body,hashlib.sha256).hexdigest()
    def test_signed_expiring_and_one_use(self):
        body,sig=self.request();seen={}
        self.assertEqual(bridge.signed_request(body,sig,self.secret,seen,1000)['selector'],'Fixture#1111')
        with self.assertRaises(ValueError):bridge.signed_request(body,sig,self.secret,seen,1000)
        with self.assertRaises(ValueError):bridge.signed_request(body,sig,self.secret,{},1100)
        with self.assertRaises(ValueError):bridge.signed_request(body,sig,'wrong-key',{},1000)
    def test_no_general_query_or_numeric_substitution(self):
        body,sig=self.request(operation='other-participants')
        with self.assertRaises(ValueError):bridge.signed_request(body,sig,self.secret,{},1000)
        body,sig=self.request(operation='matches',selector='SomeoneElse#9999')
        with self.assertRaises(ValueError):bridge.signed_request(body,sig,self.secret,{},1000)
        body,sig=self.request(user_id='someone-else')
        with self.assertRaises(ValueError):bridge.signed_request(body,sig,self.secret,{},1000)
    def test_other_identity_fields_are_removed_before_transport(self):
        raw={'matchId':'fixture-own-match','beginTs':1000000000000,'kill':5,
             'players':[{'name':'Other#9999','id':'outside','customer_token':'must-not-survive'}],
             'customer_token':'secret','raw':{'otherIds':['outside']},'nickname':'Other#9999',
             'heroName':'UNTRUSTED PLAYER NAME','avatar':'https://not-needed.invalid/avatar'}
        clean=bridge.safe_rows([raw])
        self.assertEqual(clean,[{'matchId':'fixture-own-match','beginTs':1000000000000,'kill':5}])
        self.assertNotIn('Other',json.dumps(clean))
        with self.assertRaises(ValueError):bridge.safe_rows([raw]*101)

if __name__=='__main__':unittest.main()
