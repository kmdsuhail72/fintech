"""Repeatable local-only integration check for the production Alloy pipeline."""
import argparse, json, os, re, socket, subprocess, time, urllib.request
from uuid import uuid4
from datetime import datetime, timezone
from pathlib import Path
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description="Verify Alloy normalization locally with synthetic logs; no cluster or Loki is contacted.")
parser.add_argument('--alloy', type=Path, required=True, help='Approved Alloy executable')
args=parser.parse_args()
executable=args.alloy.resolve()
work=root/'.runtime'/('alloy-smoke-'+uuid4().hex)
work.mkdir(parents=True)

def port():
 with socket.socket() as s:
  s.bind(('127.0.0.1',0));return s.getsockname()[1]
api,ui=port(),port()
s=(root/'k8s/monitoring/loki/alloy.example.alloy').read_text();pipeline=s[s.index('loki.process "asteriq"'):s.index('loki.write "asteriq"')].replace('loki.write.asteriq.receiver','loki.echo.test.receiver')
config=f'''loki.source.api "test" {{
 http {{
  listen_address = "127.0.0.1"
  listen_port = {api}
 }}
 grpc {{
  listen_address = "127.0.0.1"
  listen_port = 0
 }}
 forward_to = [loki.process.asteriq.receiver]
}}
loki.echo "test" {{}}
'''+pipeline
path=work/'test.alloy';path.write_text(config)
log=work/'output.log'
with log.open('w',encoding='utf-8') as output:
 proc=subprocess.Popen([str(executable),'run','--disable-reporting',f'--server.http.listen-addr=127.0.0.1:{ui}','--storage.path',str(work/'state'),str(path)],stdout=output,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
 try:
  for attempt in range(120):
   if proc.poll() is not None:raise RuntimeError('Collector failed: '+log.read_text())
   try:
    urllib.request.urlopen(f'http://127.0.0.1:{api}/ready',timeout=1);break
   except Exception:time.sleep(.25)
  else:raise RuntimeError('Collector readiness timeout')
  events=[json.dumps({'timestamp':datetime.now(timezone.utc).isoformat(),'level':'error','message':'synthetic pipeline test postgresql://private:password@database/test Bearer private-bearer','requestId':'synthetic-request','traceId':'a'*32,'status':500,'event':'database_failure','token':'secret-with-escaped-"quote'}),'E1012 synthetic system error ?token=private-value operator@example.com']
  payload={'streams':[{'stream':{'namespace':'asteriq-dev','pod':'test-pod','node':'test-node','container':'api','service':'api','environment':'dev'},'values':[[str(time.time_ns()+i),value] for i,value in enumerate(events)]}]}
  request=urllib.request.Request(f'http://127.0.0.1:{api}/loki/api/v1/push',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
  assert urllib.request.urlopen(request,timeout=5).status in [200,204]
  time.sleep(1)
 finally:
  proc.terminate()
  try:proc.wait(timeout=5)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
text=log.read_text()
entries=[]
for line in text.splitlines():
 if 'component_id=loki.echo.test' not in line or 'received log entry' not in line:continue
 entry=re.search(r'\bentry=("(?:\\.|[^"\\])*")',line)
 labels=re.search(r'\blabels=("(?:\\.|[^"\\])*")',line)
 assert entry and labels, 'Cannot parse Alloy echo output'
 body=json.loads(json.loads(entry.group(1)))
 labelset=json.loads(labels.group(1))
 required={'timestamp','service','environment','namespace','pod','level','request_id','trace_id','user_safe_identifier','endpoint','status_code'}
 assert required <= body.keys()
 assert body['namespace']=='asteriq-dev' and body['pod']=='test-pod'
 assert body['level']=='error'
 assert all(name+'=' not in labelset for name in ['request_id','trace_id','pod','user_safe_identifier','endpoint'])
 entries.append(body)
assert len(entries)==2, 'Expected both structured and native logs'
assert entries[0]['request_id']=='synthetic-request' and entries[0]['status_code']=='500'
assert entries[0]['trace_id']=='a'*32
normalized=json.dumps(entries)
assert all(secret not in normalized for secret in ['private:password','private-bearer','private-value','operator@example.com','secret-with-escaped'])
(work/'normalized.json').write_text(json.dumps(entries,indent=2)+'\n')
print('Alloy smoke test passed: two normalized records, complete fields, credential redaction, bounded index labels')

