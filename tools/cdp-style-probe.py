import json, urllib.request
from websocket import create_connection

def ws_url():
    with urllib.request.urlopen('http://127.0.0.1:9229/json/list') as r:
        for p in json.load(r):
            if p.get('type') == 'page' and 'viewer' in p.get('url', ''):
                return p['webSocketDebuggerUrl']
    raise SystemExit('no page')

def evaluate(expr):
    ws = create_connection(ws_url(), timeout=15)
    try:
        ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {
            'expression': expr, 'returnByValue': True, 'awaitPromise': True
        }}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get('id') == 1:
                res = msg['result']['result']
                if res.get('subtype') == 'error':
                    raise RuntimeError(res.get('description'))
                return res.get('value')
    finally:
        ws.close()

expr = r'''
(async function(){
  var ed=window.__bslDebug().editor;
  ed.setScrollTop(3000); ed.render(true);
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  var lc=document.querySelector('.lines-content');
  var vl=document.querySelector('.view-lines');
  var line=vl.children[1];
  function box(el){
    if(!el) return null;
    var r=el.getBoundingClientRect();
    var cs=getComputedStyle(el);
    return {
      tag: el.className,
      styleTop: el.style.top,
      stylePos: el.style.position,
      csTop: cs.top,
      csPos: cs.position,
      csTransform: cs.transform,
      csContain: cs.contain,
      csWillChange: cs.willChange,
      rect: {t:Math.round(r.top), h:Math.round(r.height)},
      offsetTop: el.offsetTop,
      parent: el.parentElement && el.parentElement.className
    };
  }
  return {
    lc: box(lc),
    vl: box(vl),
    line: box(line),
    lineHtml: line && line.outerHTML.slice(0,200),
    scrollable: box(document.querySelector('.monaco-scrollable-element')),
    overflowGuard: box(document.querySelector('.overflow-guard'))
  };
})()
'''
print(json.dumps(evaluate(expr), ensure_ascii=False, indent=2))
