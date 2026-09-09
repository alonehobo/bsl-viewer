"""Probe the managed-form preview in a running WebView2 debug session."""
import json
import base64
from pathlib import Path
import sys
import urllib.request

from websocket import create_connection

sys.stdout.reconfigure(encoding="utf-8")


port = int(sys.argv[1]) if len(sys.argv) > 1 else 9229
with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list") as response:
    pages = json.load(response)
ws_url = next(
    page["webSocketDebuggerUrl"]
    for page in pages
    if page.get("type") == "page" and "viewer" in page.get("url", "")
)


def evaluate(expression):
    ws = create_connection(ws_url, timeout=15)
    try:
        ws.send(json.dumps({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "returnByValue": True, "awaitPromise": True},
        }))
        while True:
            message = json.loads(ws.recv())
            if message.get("id") != 1:
                continue
            result = message.get("result", {})
            if result.get("exceptionDetails"):
                raise RuntimeError(result["exceptionDetails"])
            return result.get("result", {}).get("value")
    finally:
        ws.close()


def screenshot(path):
    ws = create_connection(ws_url, timeout=15)
    try:
        ws.send(json.dumps({
            "id": 2,
            "method": "Page.captureScreenshot",
            "params": {"format": "png", "fromSurface": True},
        }))
        while True:
            message = json.loads(ws.recv())
            if message.get("id") != 2:
                continue
            data = base64.b64decode(message["result"]["data"])
            Path(path).write_bytes(data)
            return len(data)
    finally:
        ws.close()


probe = r"""
(async () => {
  await new Promise(resolve => setTimeout(resolve, 1200));
  const outlinePanel = document.querySelector('#outline-panel');
  if (outlinePanel) outlinePanel.style.display = 'none';
  const cardTab = [...document.querySelectorAll('.fp-pages-tab')]
    .find(node => node.textContent.includes('Карточка'));
  if (cardTab) cardTab.click();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const viewport = document.querySelector('.fp-spreadsheet-viewport');
  const first = {
    tabs: [...document.querySelectorAll('.fp-pages-tab')].map(node => node.textContent.trim()),
    sheet: !!viewport,
    fallback: document.body.innerText.includes('SpreadSheetDocumentField'),
    sheetBox: viewport ? (() => {
      const rect = viewport.getBoundingClientRect();
      return {
        width: Math.round(rect.width), height: Math.round(rect.height),
        scrollWidth: viewport.scrollWidth, scrollHeight: viewport.scrollHeight
      };
    })() : null
  };

  const requisitesTab = [...document.querySelectorAll('.fp-pages-tab')]
    .find(node => node.textContent.includes('Реквизиты'));
  if (requisitesTab) requisitesTab.click();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const target = document.querySelector('[data-id="522"]');
  const horizontalOverflow = target
    ? [...target.querySelectorAll('.fp-children-horizontal')]
        .filter(node => node.scrollWidth > node.clientWidth + 1
          && /^(auto|scroll)$/.test(getComputedStyle(node).overflowX))
        .map(node => ({
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          overflowX: getComputedStyle(node).overflowX,
          text: node.innerText.slice(0, 100)
        }))
    : [];
  const title = target && target.querySelector('.fp-collapsible-title');
  const arrow = target && target.querySelector('.fp-collapse-arrow');
  const result = {
    first,
    second: {
      links: document.querySelectorAll('.fp-rich-link').length,
      rawLinkMarkup: document.querySelector('#form-preview').innerText.includes('<link'),
      outlineRawLinkMarkup: document.querySelector('#outline-list').innerText.includes('<link'),
      linkSamples: [...document.querySelectorAll('.fp-rich-link')].slice(0, 8)
        .map(node => node.textContent),
      collapsibleGroups: document.querySelectorAll('.fp-collapsible-title').length,
      targetArrow: arrow && arrow.textContent,
      targetExpanded: title && title.getAttribute('aria-expanded'),
      targetCollapsedAfterClick: title ? (() => {
        title.click();
        const state = {
          arrow: arrow && arrow.textContent,
          expanded: title.getAttribute('aria-expanded'),
          hidden: target.querySelector('.fp-collapsible-body').offsetParent === null
        };
        title.click();
        return state;
      })() : null,
      horizontalScrollContainers: horizontalOverflow
    }
  };
  if (target) target.scrollIntoView({block: 'start', inline: 'nearest'});
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return result;
})()
"""

shot_prefix = Path(sys.argv[2]) if len(sys.argv) > 2 else None
if shot_prefix:
    evaluate("[...document.querySelectorAll('.fp-pages-tab')].find(n => n.textContent.includes('Карточка'))?.click()")
    card_path = shot_prefix.with_name(shot_prefix.name + "-card.png")
    print(f"screenshot={screenshot(card_path)} bytes path={card_path}")
result = evaluate(probe)
print(json.dumps(result, ensure_ascii=False, indent=2))
if shot_prefix:
    requisites_path = shot_prefix.with_name(shot_prefix.name + "-requisites.png")
    print(f"screenshot={screenshot(requisites_path)} bytes path={requisites_path}")
