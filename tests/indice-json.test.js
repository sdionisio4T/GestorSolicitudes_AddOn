// Funciones puras del indice de JSON (src/IndiceJson.gs): lectura de rutas,
// cruce con filas del Sheet y orden.

const test = require('node:test');
const assert = require('node:assert');
const { cargarGs } = require('./cargar-gs');

const gs = cargarGs({ console: { log() {}, warn() {}, error() {} } });

const ID = (s) => (s + 'xxxxxxxxxxxxxxxxxxxxxxxxx').slice(0, 25);
const RAIZ = ID('raiz');
// Los arreglos creados dentro del contexto de vm tienen otro prototipo.
const plano = (x) => JSON.parse(JSON.stringify(x));

test('clasificar ruta: Servicio/Caso con subcarpetas', () => {
  const r = gs.indiceClasificarRuta_(['Pagos', '9300_2', 'Envio 2', 'Ajustes']);
  assert.strictEqual(r.rama, 'General');
  assert.strictEqual(r.servicio, 'Pagos');
  assert.strictEqual(r.carpetaEnvio, '9300_2');
  assert.strictEqual(r.caso, '9300');
  assert.strictEqual(r.resto, 'Envio 2/Ajustes');
});

test('clasificar ruta: APIM y SERVICIOS CAPA', () => {
  const a = gs.indiceClasificarRuta_(['APIM', 'Pagos', '9300']);
  assert.strictEqual(a.rama, 'APIM');
  assert.strictEqual(a.servicio, 'Pagos');
  assert.strictEqual(a.resto, '');
  const c = gs.indiceClasificarRuta_(['SERVICIOS CAPA', 'APIM', 'Pagos', '9300', 'x']);
  assert.strictEqual(c.rama, 'APIM');
  assert.strictEqual(c.caso, '9300');
  assert.strictEqual(c.resto, 'x');
});

test('clasificar ruta: sin nivel de caso devuelve null', () => {
  assert.strictEqual(gs.indiceClasificarRuta_(['Pagos']), null);
  assert.strictEqual(gs.indiceClasificarRuta_(['APIM', 'Pagos']), null);
});

test('limpiar servicio igual que al crear carpetas', () => {
  assert.strictEqual(gs.indiceLimpiarServicio_('https://papi/x'), 'https___papi_x');
  assert.strictEqual(gs.indiceLimpiarServicio_('  '), '(sin servicio)');
});

test('cadena de carpetas desde la raiz', () => {
  const carpetas = { [ID('a')]: ['Pagos', RAIZ], [ID('b')]: ['9300', ID('a')] };
  const c = gs.indiceCadena_(ID('b'), RAIZ, carpetas);
  assert.deepStrictEqual(plano(c.map((x) => x.nombre)), ['Pagos', '9300']);
  assert.strictEqual(gs.indiceCadena_(ID('zz'), RAIZ, carpetas), null);
});

function escenario() {
  const carpetas = {
    [ID('srv')]: ['Pagos', RAIZ],
    [ID('c1')]: ['9300', ID('srv')],
    [ID('c1sub')]: ['Ajustes', ID('c1')],
    [ID('c2')]: ['9215', ID('srv')],
    [ID('c3a')]: ['9100', ID('srv')],
    [ID('c3b')]: ['9100_2', ID('srv')],
    [ID('apim')]: ['APIM', RAIZ],
    [ID('asrv')]: ['Pagos', ID('apim')],
    [ID('ac1')]: ['9300', ID('asrv')],
    [ID('otro')]: ['Sueltos', RAIZ]
  };
  const jsons = [
    [ID('j1'), 'config.json', ID('c1sub'), '2026-09-20T10:00:00Z'],
    [ID('j2'), 'a.json', ID('c2'), ''],
    [ID('j3'), 'b.json', ID('c3b'), ''],
    [ID('j4'), 'api.json', ID('ac1'), ''],
    [ID('j5'), 'suelto.json', ID('otro'), '']
  ];
  return { raizId: RAIZ, carpetas, jsons };
}

test('cruce por carpeta, por ruta, ambiguo y sin fila', () => {
  const filas = [
    { fila: 2, caso: '9300', servicio: 'Pagos', componente: 'ESB', ambiente: 'Producción', estado: 'APROBADO', ids: [ID('c1')] },
    { fila: 3, caso: '9300', servicio: 'Pagos', componente: 'API', ambiente: 'Producción', estado: 'APROBADO', ids: [] },
    { fila: 4, caso: '9215', servicio: 'Pagos', componente: 'ESB', ambiente: 'Preproducción', estado: 'PENDIENTE', ids: [ID('original')] },
    { fila: 5, caso: '9100', servicio: 'Pagos', componente: 'ESB', ambiente: 'Pruebas', estado: 'PENDIENTE', ids: [] }
  ];
  const res = gs.indiceArmarFilas_(escenario(), filas);
  const por = (archivo) => res.find((r) => r.archivo === archivo);

  assert.strictEqual(por('config.json').cruce, 'por carpeta');
  assert.strictEqual(por('config.json').filas, '2');
  assert.strictEqual(por('config.json').resto, 'Ajustes');

  assert.strictEqual(por('a.json').cruce, 'por ruta');
  assert.strictEqual(por('a.json').ambiente, 'Preproducción');

  assert.strictEqual(por('b.json').cruce, 'ambiguo');
  assert.strictEqual(por('b.json').carpetaEnvio, '9100_2');

  assert.strictEqual(por('api.json').cruce, 'por ruta');
  assert.strictEqual(por('api.json').rama, 'APIM');
  assert.strictEqual(por('api.json').filas, '3');

  assert.strictEqual(por('suelto.json').cruce, 'sin fila');
  assert.strictEqual(por('suelto.json').servicio, '(otra ubicación)');
});

test('una carpeta enlazada por varias filas queda asociada a todas', () => {
  const filas = [
    { fila: 2, caso: '9300', servicio: 'Pagos', componente: 'ESB', ambiente: 'Producción', estado: 'APROBADO', ids: [ID('c1')] },
    { fila: 7, caso: '9300', servicio: 'Pagos', componente: 'EI', ambiente: 'Producción', estado: 'PENDIENTE', ids: [ID('c1')] }
  ];
  const res = gs.indiceArmarFilas_(escenario(), filas);
  const j = res.find((r) => r.archivo === 'config.json');
  assert.strictEqual(j.filas, '2, 7');
  assert.strictEqual(j.componente, 'ESB / EI');
  assert.strictEqual(j.estado, 'APROBADO / PENDIENTE');
});

test('orden: servicio y luego caso del mas reciente al mas viejo', () => {
  const res = gs.indiceArmarFilas_(escenario(), []);
  const pagos = res.filter((r) => r.servicio === 'Pagos' && r.rama === 'General').map((r) => r.caso);
  assert.deepStrictEqual(plano(pagos), ['9300', '9215', '9100']);
  assert.strictEqual(res[res.length - 1].servicio, 'Pagos');
});

test('ids de una celda: links y URLs en texto plano sin repetir', () => {
  const url1 = 'https://drive.google.com/drive/folders/' + ID('f1');
  const url2 = 'https://drive.google.com/file/d/' + ID('f2') + '/view';
  const texto = 'Carpeta ' + url2 + ' y ' + url2;
  const rich = gs.SpreadsheetApp.newRichTextValue().setText(texto).setLinkUrl(0, 7, url1).build();
  assert.deepStrictEqual(plano(gs.indiceIdsDeCelda_(rich)), [ID('f1'), ID('f2')]);
});

test('trocear y unir devuelve el mismo texto', () => {
  const texto = 'x'.repeat(100) + 'y'.repeat(7);
  const trozos = gs.indiceTrocear_(texto, 25);
  assert.strictEqual(trozos.length, 5);
  assert.strictEqual(trozos.join(''), texto);
});
