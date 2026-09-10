/* Filesystem-shaped knowledge about 1C exports, shared by every Node-side host:
 * the MCP server, the VS Code extension and anything else that has to turn a
 * path on disk into something the browser renderers can parse.
 *
 * Deliberately free of `fs`: these are pure byte and path functions, so each
 * host keeps its own access policy (MCP allow-roots, VS Code workspace URIs)
 * and only the 1C-specific rules live here.
 *
 * Plain CommonJS because a VS Code extension host still loads CommonJS; the
 * TypeScript side gets its types from document.d.cts next to this file. */
'use strict';

const path = require('node:path');

/* An object descriptor always carries this marker; a form or template file
 * never does. Used to tell "the owning object's metadata" from "some other
 * XML that happens to sit next to the form". */
const OBJECT_META_MARKER = 'MetaDataObject';

/* 1C writes exports in whichever encoding the configuration was saved with.
 * BOMs are authoritative; without one, valid UTF-8 is UTF-8 and everything
 * else is Windows-1251, which is what the 1C designer produces on Russian
 * locales. */
function decodeText(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { content: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf8-bom' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { content: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = bytes.subarray(2);
    const swapped = new Uint8Array(body.length - (body.length % 2));
    for (let i = 0; i < swapped.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    return { content: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf16be' };
  }
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
  } catch {
    return { content: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' };
  }
}

/* `Forms/ФормаСписка.xml` is the form's descriptor, not its layout; the layout
 * the renderers want is `Forms/ФормаСписка/Ext/Form.xml`. Returns that layout
 * path for a descriptor, or '' for anything else. The caller decides whether
 * the file actually exists — a descriptor without a layout stays as it is. */
function formLayoutFor(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.xml') return '';
  const directory = path.dirname(filePath);
  if (path.basename(directory).toLowerCase() !== 'forms') return '';
  const name = path.basename(filePath, path.extname(filePath));
  if (!name) return '';
  return path.join(directory, name, 'Ext', 'Form.xml');
}

/* FormPreview draws attributes and commands that live on the owning object,
 * not in the form, so the host offers the object descriptor alongside the
 * form. Only `<Object>/Forms/<Form>/Ext/Form.xml` has one; the candidates are
 * the two places 1C puts it, most likely first. */
function objectMetaCandidates(formPath) {
  if (path.basename(formPath).toLowerCase() !== 'form.xml') return [];
  const extDir = path.dirname(formPath);
  if (path.basename(extDir).toLowerCase() !== 'ext') return [];
  const formsDir = path.dirname(path.dirname(extDir));
  if (path.basename(formsDir).toLowerCase() !== 'forms') return [];
  const objectDir = path.dirname(formsDir);
  const objectName = path.basename(objectDir);
  if (!objectName) return [];
  return [
    path.join(path.dirname(objectDir), `${objectName}.xml`),
    path.join(objectDir, `${objectName}.xml`),
  ];
}

/* The extensions any host is willing to open. */
const SUPPORTED_EXTENSIONS = ['.xml', '.mxl'];

function isSupportedExtension(filePath) {
  return SUPPORTED_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

module.exports = {
  OBJECT_META_MARKER,
  SUPPORTED_EXTENSIONS,
  decodeText,
  formLayoutFor,
  objectMetaCandidates,
  isSupportedExtension,
};
