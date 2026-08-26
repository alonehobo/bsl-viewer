import json, time, urllib.request, base64, sys
from websocket import create_connection

OUT = r'C:\Users\Serge\YandexDisk\Cursor\OtherProjects\tc-bsl-viewer\testdata\scroll-test'

def pages():
    with urllib.request.urlopen('http://127.0.0.1:9229/json/list') as r:
        return json.load(r)

def ws_url():
    for p in pages():
        if p.get('type') == 'page' and 'viewer' in p.get('url', ''):
            return p['webSocketDebuggerUrl']
    raise SystemExit('no page')

def call(ws, method, params=None, id=1):
    ws.send(json.dumps({'id': id, 'method': method, 'params': params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == id:
            return msg

def evaluate(expr):
    ws = create_connection(ws_url(), timeout=15)
    try:
        msg = call(ws, 'Runtime.evaluate', {
            'expression': expr,
            'returnByValue': True,
            'awaitPromise': True,
        })
        res = msg.get('result', {}).get('result', {})
        if res.get('subtype') == 'error':
            raise RuntimeError(res.get('description'))
        if 'exceptionDetails' in msg.get('result', {}):
            raise RuntimeError(str(msg['result']['exceptionDetails']))
        return res.get('value')
    finally:
        ws.close()

def shot(path):
    ws = create_connection(ws_url(), timeout=15)
    try:
        msg = call(ws, 'Page.captureScreenshot', {
            'format': 'png', 'fromSurface': True
        }, id=9)
        data = base64.b64decode(msg['result']['data'])
        open(path, 'wb').write(data)
        return len(data)
    finally:
        ws.close()

for i in range(60):
    if evaluate('!!(window.__bslDebug && window.__bslDebug().editor)'):
        break
    time.sleep(0.1)
else:
    raise SystemExit('no editor')

expr = r'''
(async function(){
  var a=window.__bslDebug(); var ed=a.editor;
  function dump(tag){
    var lc=document.querySelector('.lines-content');
    var vl=document.querySelector('.view-lines');
    var kids=Array.from(vl.children);
    var edRect=document.getElementById('editor').getBoundingClientRect();
    var lcRect=lc.getBoundingClientRect();
    return {
      tag:tag, st:ed.getScrollTop(), lcTop:lc.style.top, lcHeight:lc.style.height,
      lcRect:{t:Math.round(lcRect.top), h:Math.round(lcRect.height)},
      edRect:{t:Math.round(edRect.top), h:Math.round(edRect.height)},
      n:kids.length,
      lines: kids.filter((_,i)=>i<3||i>=kids.length-2).map(c=>{
        var r=c.getBoundingClientRect();
        var cs=getComputedStyle(c);
        return {styleTop:c.style.top, txt:c.innerText.replace(/\s+/g,' ').slice(0,40),
          rectT:Math.round(r.top), vis:(r.bottom>edRect.top && r.top<edRect.bottom),
          op:cs.opacity, color:cs.color};
      })
    };
  }
  ed.setScrollTop(0); ed.render(true);
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  var a0=dump('st0');
  ed.setScrollTop(3000); ed.render(true);
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  var a1=dump('st3000');
  return {a0:a0,a1:a1};
})()
'''
print(json.dumps(evaluate(expr), ensure_ascii=False, indent=2))
print('shot', shot(OUT + r'\31-py-st3000.png'))
