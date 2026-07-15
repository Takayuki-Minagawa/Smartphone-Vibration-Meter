'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', 'app/index.html'];

function readHTML(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('inline scripts compile', () => {
  for (const relativePath of htmlFiles) {
    const html = readHTML(relativePath);
    const scripts = [...html.matchAll(
      /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi
    )];
    for (let index = 0; index < scripts.length; index++) {
      assert.doesNotThrow(
        () => new vm.Script(scripts[index][1], {
          filename: `${relativePath}:inline-script-${index + 1}`
        }),
        `${relativePath} inline script ${index + 1} must compile`
      );
    }
  }
});

test('HTML ids are unique and label/ARIA references resolve', () => {
  for (const relativePath of htmlFiles) {
    const html = readHTML(relativePath);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${relativePath} has duplicate ids`);

    const references = [...html.matchAll(
      /\b(?:aria-controls|aria-describedby|aria-labelledby|for)="([^"]+)"/g
    )].flatMap((match) => match[1].trim().split(/\s+/));
    for (const reference of references) {
      assert.ok(ids.includes(reference), `${relativePath} references missing #${reference}`);
    }
  }
});

test('remote scripts are version-pinned and protected by SHA-384 SRI', () => {
  const html = readHTML('app/index.html');
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="https:\/\/[^>]+><\/script>/gi)]
    .map((match) => match[0]);
  const expectedIntegrity = new Map([
    [
      'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
      'sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ'
    ],
    [
      'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
      'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG'
    ]
  ]);
  assert.ok(tags.length > 0, 'expected remote dependency scripts');

  for (const tag of tags) {
    assert.match(tag, /@\d+\.\d+\.\d+\//, 'remote dependency must pin an exact version');
    assert.match(tag, /\bintegrity="sha384-[A-Za-z0-9+/=]+"/);
    assert.match(tag, /\bcrossorigin="anonymous"/);
    assert.match(tag, /\breferrerpolicy="no-referrer"/);
    const source = tag.match(/\bsrc="([^"]+)"/)[1];
    const integrity = tag.match(/\bintegrity="([^"]+)"/)[1];
    assert.equal(integrity, expectedIntegrity.get(source), `${source} SRI must match`);
  }
  assert.equal(tags.length, expectedIntegrity.size);
});

test('local script sources exist', () => {
  for (const relativePath of htmlFiles) {
    const html = readHTML(relativePath);
    const directory = path.dirname(path.join(root, relativePath));
    const sources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)]
      .map((match) => match[1])
      .filter((source) => !/^https?:\/\//i.test(source));
    for (const source of sources) {
      assert.ok(fs.existsSync(path.resolve(directory, source)), `${source} must exist`);
    }
  }
});
