// Platform-owned (plan 06 §9, A7.3/A7.9): stamps every JSX element of `src/**/*.tsx|jsx` with
// `data-tlm-loc="<path>:<line>:<col>"` (1-based, the TAG NAME's position — what AM's `exec.visual-edit` parses back)
// and `data-tlm-e` (what can be patched deterministically: `t` static text, `s` static src, `r` rendered from an array).
// Registered by next.config.ts only when TOTALUM_SOURCE_TAGS=1 (AM sets it for preview builds, 0 for publish), so a
// published app carries no file paths. It only ADDS attributes; a file that fails to parse is returned untouched.
'use strict';
const path = require('node:path');

const NOT_DOM = new Set([
  'Fragment',
  'React.Fragment',
  'Suspense',
  'StrictMode',
  'Profiler',
  'ErrorBoundary',
]);
const MEDIA = new Set(['img', 'source', 'video', 'audio', 'Image']);
const ARRAY_CALLBACKS = new Set(['map', 'flatMap', 'forEach']);

function stamp(source, file, root) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (!rel.startsWith('src/') || rel.startsWith('src/components/ui/') || !/\.(tsx|jsx)$/.test(rel))
    return source;
  if (!source.includes('<')) return source;
  let ts;
  try {
    ts = require('typescript');
  } catch {
    return source;
  }
  try {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const literal = (n) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));
    const attr = (tag, name) =>
      tag.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
    const staticText = (tag) => {
      if (!ts.isJsxOpeningElement(tag)) return false;
      const kids = tag.parent.children.filter((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces));
      return (
        kids.length > 0 &&
        kids.every((c) => ts.isJsxText(c) || (ts.isJsxExpression(c) && literal(c.expression)))
      );
    };
    const staticSrc = (tag, name) => {
      if (!MEDIA.has(name)) return false;
      let init = attr(tag, 'src')?.initializer;
      if (init && ts.isJsxExpression(init)) init = init.expression;
      return literal(init);
    };
    const repeated = (node) => {
      for (let n = node.parent; n && !ts.isSourceFile(n); n = n.parent) {
        if (!(ts.isArrowFunction(n) || ts.isFunctionExpression(n)) || !ts.isCallExpression(n.parent))
          continue;
        const callee = n.parent.expression;
        if (!ts.isPropertyAccessExpression(callee)) continue;
        if (ARRAY_CALLBACKS.has(callee.name.text)) return true;
        if (callee.name.text === 'from' && callee.expression.getText(sf) === 'Array') return true;
      }
      return false;
    };
    const inserts = [];
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(sf);
        if (!NOT_DOM.has(name) && !/(Provider|Context)$/.test(name) && !attr(node, 'data-tlm-loc')) {
          const at = sf.getLineAndCharacterOfPosition(node.tagName.getStart(sf));
          const flags =
            (staticText(node) ? 't' : '') + (staticSrc(node, name) ? 's' : '') + (repeated(node) ? 'r' : '');
          inserts.push({
            at: node.attributes.pos,
            text: ` data-tlm-loc="${rel}:${at.line + 1}:${at.character + 1}"${flags ? ` data-tlm-e="${flags}"` : ''}`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    let out = source;
    for (const i of inserts.sort((a, b) => b.at - a.at)) out = out.slice(0, i.at) + i.text + out.slice(i.at);
    return out;
  } catch {
    return source;
  }
}

module.exports = function tlmSourceTags(source) {
  return stamp(source, this.resourcePath, process.cwd());
};
module.exports.stamp = stamp;
