'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Evaluate the configuration loader without starting either CLI or touching
// nightshift.json. Only configuration reads are replaced with in-memory input.
function loadConfig(script, config, exists = true) {
  const filename = path.join(__dirname, '..', 'src', script);
  const source = fs.readFileSync(filename, 'utf8');
  const end = source.indexOf('\nfunction ', source.indexOf('function loadConfig()'));
  const localRequire = createRequire(filename);
  return vm.runInNewContext(source.slice(0, end) + '\nloadConfig();', {
    __dirname: path.dirname(filename),
    structuredClone,
    require: (name) => name === 'fs' ? {
      existsSync: () => exists,
      readFileSync: () => JSON.stringify(config),
    } : localRequire(name),
  }, { filename });
}

for (const script of ['cli.js', 'real-night.js']) {
  test(`${script}: invalid independence values are rejected with allowed modes`, () => {
    for (const independence of ['unknown', '', null, false, 0, []]) {
      assert.throws(() => loadConfig(script, { independence }), (err) => {
        assert.equal(err.name, 'Error');
        assert.ok(err.message.includes(JSON.stringify(independence)));
        assert.match(err.message, /allowed modes: strict, flexible, single-provider/);
        return true;
      });
    }
  });

  for (const independence of ['strict', 'flexible', 'single-provider']) {
    test(`${script}: ${independence} loads`, () => {
      assert.equal(loadConfig(script, { independence }).independence, independence);
    });
  }

  test(`${script}: independence may be omitted`, () => {
    assert.doesNotThrow(() => loadConfig(script, {}));
  });
}

test('cli.js: missing configuration retains the default independence mode', () => {
  assert.equal(loadConfig('cli.js', {}, false).independence, 'single-provider');
});
