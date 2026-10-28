/* eslint-disable @typescript-eslint/no-require-imports -- Shared local tutorial acceptance support. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTutorialCatalog() {
  const modules = new Map();
  function loadModule(file) {
    const resolved = fs.existsSync(`${file}.ts`) ? `${file}.ts` : fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(file, 'index.ts');
    if (modules.has(resolved)) return modules.get(resolved);
    const exports = {};
    modules.set(resolved, exports);
    const compiled = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('exports', 'require', compiled)(exports, name => {
      if (!name.startsWith('.')) throw new Error(`Unsupported tutorial dependency: ${name}`);
      return loadModule(path.resolve(path.dirname(resolved), name));
    });
    return exports;
  }
  return loadModule(path.resolve('src/lib/feature-tutorials.ts'));
}

module.exports = { loadTutorialCatalog };
