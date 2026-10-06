// Correos de ejemplo guardados como archivos en tests/fixtures/.
//
// Cada caso son dos archivos con el mismo nombre:
//   <nombre>.txt   cuerpo del correo, tal cual
//   <nombre>.json  { "asunto": "...",
//                    "esperado": { campo: valor exacto },
//                    "contiene": { campo: texto que debe aparecer } }
//
// Los campos son los que devuelve extraerDatos (numeroCaso,
// servicioDesplegar, ambienteExtraido, correoSolicitante,
// driveDocumentacion, repositorio). Agregar un caso es guardar los dos
// archivos; este test los recorre todos.
//
// El repo puede ser publico: los correos van anonimizados (nombres,
// correos y links inventados).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { cargarGs } = require('./cargar-gs');

const DIR = path.join(__dirname, 'fixtures');
const silencio = { log() {}, warn() {}, error() {} };

const casos = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length))
  .sort();

test('hay al menos un correo de ejemplo', () => {
  assert.ok(casos.length > 0, 'tests/fixtures/ no tiene casos');
});

for (const nombre of casos) {
  test('correo de ejemplo: ' + nombre, () => {
    const rutaTxt = path.join(DIR, nombre + '.txt');
    assert.ok(fs.existsSync(rutaTxt), 'falta ' + nombre + '.txt');
    const cuerpo = fs.readFileSync(rutaTxt, 'utf8').replace(/\r\n/g, '\n');
    const caso = JSON.parse(fs.readFileSync(path.join(DIR, nombre + '.json'), 'utf8'));

    const gs = cargarGs({ console: silencio });
    const datos = gs.extraerDatos(cuerpo, caso.asunto || '');

    for (const [campo, valor] of Object.entries(caso.esperado || {})) {
      assert.strictEqual(datos[campo], valor, nombre + ': campo ' + campo);
    }
    for (const [campo, texto] of Object.entries(caso.contiene || {})) {
      assert.ok(String(datos[campo] || '').includes(texto),
        nombre + ': ' + campo + ' deberia contener "' + texto + '" y es "' + datos[campo] + '"');
    }
  });
}
