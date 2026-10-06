// Corre en Node los tests de src/Tests.gs, sin modificarlos.

const test = require('node:test');
const assert = require('node:assert');
const { cargarGs } = require('./cargar-gs');

test('correrTodosLosTests de Tests.gs', () => {
  const gs = cargarGs();
  const resultado = gs.correrTodosLosTests();
  assert.strictEqual(resultado.fail, 0);
  assert.ok(resultado.ok > 0, 'no corrio ningun test');
});
