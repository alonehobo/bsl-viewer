import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/* Test-only XML DOM good enough for the preview parsers: element tree with
 * tagName/localName/children/attributes and collapsed textContent. Avoids a
 * jsdom dependency for what the modules actually touch. */
export function parseXmlDom(xml) {
  xml = String(xml).replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  let pos = 0;
  function skipWs() {
    while (pos < xml.length && /\s/.test(xml[pos])) pos++;
  }
  function parseName() {
    const m = xml.slice(pos).match(/^[A-Za-z_][\w:.-]*/);
    if (!m) return '';
    pos += m[0].length;
    return m[0];
  }
  function parseAttrs() {
    const attrs = {};
    for (;;) {
      skipWs();
      const m = xml.slice(pos).match(/^([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/);
      if (!m) break;
      attrs[m[1]] = m[3] != null ? m[3] : m[4];
      pos += m[0].length;
    }
    return attrs;
  }
  function makeNode(tag, attrs) {
    const local = tag.includes(':') ? tag.slice(tag.lastIndexOf(':') + 1) : tag;
    const node = {
      tagName: tag,
      localName: local,
      children: [],
      childNodes: null,
      attributes: attrs,
      textContent: '',
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
      querySelector() { return null; }
    };
    node.childNodes = node.children;
    return node;
  }
  function parseNode() {
    skipWs();
    if (xml[pos] !== '<') return null;
    pos++;
    if (xml[pos] === '/') return null;
    const tag = parseName();
    const attrs = parseAttrs();
    skipWs();
    const node = makeNode(tag, attrs);
    if (xml[pos] === '/' && xml[pos + 1] === '>') {
      pos += 2;
      return node;
    }
    if (xml[pos] !== '>') throw new Error('xml');
    pos++;
    const texts = [];
    for (;;) {
      skipWs();
      if (xml.startsWith('</', pos)) {
        pos += 2;
        parseName();
        skipWs();
        if (xml[pos] === '>') pos++;
        break;
      }
      if (xml[pos] === '<') {
        const child = parseNode();
        if (child) node.children.push(child);
      } else {
        const end = xml.indexOf('<', pos);
        const chunk = xml.slice(pos, end < 0 ? xml.length : end);
        texts.push(chunk);
        pos = end < 0 ? xml.length : end;
      }
    }
    node.textContent = (texts.join('') + node.children.map((c) => c.textContent).join('')).replace(/\s+/g, ' ').trim();
    return node;
  }
  skipWs();
  const documentElement = parseNode();
  return {
    documentElement,
    children: documentElement ? [documentElement] : [],
    querySelector(sel) { return sel === 'parsererror' ? null : null; }
  };
}

/* Loads browser-global modules from web/ into one vm sandbox, in order, and
 * hands back the sandbox window. `xml-util.js` comes first because the preview
 * modules alias its exports at load time. */
export function loadWebModules(root, files, extra = {}) {
  const sandbox = {
    navigator: { language: 'ru-RU' },
    document: {},
    DOMParser: function DOMParser() {
      this.parseFromString = (xml) => parseXmlDom(xml);
    },
    ...extra
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, 'web', file), 'utf8'), sandbox);
  }
  return sandbox;
}
