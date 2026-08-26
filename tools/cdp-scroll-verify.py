import json, urllib.request, base64, time, io
from websocket import create_connection
from PIL import Image

def ws_url():
    with urllib.request.urlopen('http://127.0.0.1:9229/json/list') as r:
        for p in json.load(r):
            if p.get('type') == 'page' and 'viewer' in p.get('url', ''):
                return p['webSocketDebuggerUrl']
    raise SystemExit('no page')

def evaluate(expr):
    ws = create_connection(ws_url(), timeout=15)
    try:
        ws.send(json.dumps({
            'id': 1,
            'method': 'Runtime.evaluate',
            'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True},
        }))
        while True:
            msg = json.loads(ws.recv())
            if msg.get('id') == 1:
                res = msg['result']['result']
                if res.get('subtype') == 'error':
                    raise RuntimeError(res.get('description'))
                return res.get('value')
    finally:
        ws.close()

def shot_pixels():
    ws = create_connection(ws_url(), timeout=15)
    try:
        ws.send(json.dumps({
            'id': 9,
            'method': 'Page.captureScreenshot',
            'params': {'format': 'png', 'fromSurface': True},
        }))
        while True:
            msg = json.loads(ws.recv())
            if msg.get('id') == 9:
                img = Image.open(io.BytesIO(base64.b64decode(msg['result']['data'])))
                text = 0
                w, h = img.size
                for y in range(10, h - 10):
                    for x in range(40, min(400, w)):
                        r, g, b = img.getpixel((x, y))[:3]
                        if abs(r - 30) > 25 or abs(g - 30) > 25 or abs(b - 30) > 25:
                            text += 1
                            break
                return text, h
    finally:
        ws.close()

SCROLL = r'''
(async function(st){
  var ed=window.__bslDebug().editor;
  ed.setScrollTop(st); ed.render(true);
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  var kids=[...document.querySelector('.view-lines').children];
  var edRect=document.getElementById('editor').getBoundingClientRect();
  var vis=kids.filter(c=>{var r=c.getBoundingClientRect(); return r.bottom>edRect.top&&r.top<edRect.bottom;}).length;
  return {st:ed.getScrollTop(),vis:vis,n:kids.length,pos:getComputedStyle(kids[0]).position};
})(ST)
'''

for st in [0, 400, 3000, 6000, 9000]:
    info = evaluate(SCROLL.replace('ST', str(st)))
    time.sleep(0.1)
    text, h = shot_pixels()
    print(f"st={st}: vis={info['vis']}/{info['n']} pos={info['pos']} textRows={text}/{h}")

evaluate(r'''(async function(){
  var ed=window.__bslDebug().editor;
  for (var i=1;i<=80;i++) ed.setScrollTop(i*50);
  ed.render(true);
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return ed.getScrollTop();
})()''')
time.sleep(0.15)
info = evaluate(r'''(()=>{
  var kids=[...document.querySelector('.view-lines').children];
  var edRect=document.getElementById('editor').getBoundingClientRect();
  var vis=kids.filter(c=>{var r=c.getBoundingClientRect(); return r.bottom>edRect.top&&r.top<edRect.bottom;}).length;
  return {st:window.__bslDebug().editor.getScrollTop(),vis:vis,n:kids.length};
})()''')
text, h = shot_pixels()
print(f"rapid: st={info['st']} vis={info['vis']}/{info['n']} textRows={text}/{h}")
