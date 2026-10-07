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

test('plan de la columna N: solo cruces seguros, ambiguas aparte', () => {
  const filasSheet = [
    { fila: 2, caso: '9300', servicio: 'Pagos' },
    { fila: 3, caso: '9300', servicio: 'Pagos' },
    { fila: 4, caso: '9100', servicio: 'Pagos' },
    { fila: 5, caso: '9000', servicio: 'Pagos' }
  ];
  const indice = [
    { url: 'u1', cruce: 'por carpeta', numerosFila: [3, 2] },
    { url: 'u2', cruce: 'por ruta', numerosFila: [2] },
    { url: 'u1', cruce: 'por carpeta', numerosFila: [2] },
    { url: 'u3', cruce: 'ambiguo', numerosFila: [4] },
    { url: 'u4', cruce: 'sin fila', numerosFila: [] }
  ];
  const plan = plano(gs.indicePlanColumnaN_(indice, filasSheet));
  assert.deepStrictEqual(plan.objetivos.map((o) => [o.fila, o.urls]), [[2, ['u1', 'u2']], [3, ['u1']]]);
  assert.strictEqual(plan.ambiguas, 1);
  assert.strictEqual(plan.sinJson, 1);
});

test('texto de la columna N: una URL por linea con tope', () => {
  assert.strictEqual(gs.indiceTextoColumnaN_(['a', 'b']), 'a\nb');
  const muchas = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const texto = gs.indiceTextoColumnaN_(muchas);
  assert.strictEqual(texto.split('\n').length, 7);
  assert.match(texto, /y 2 más en la pestaña Índice JSON$/);
});

// Sheet en memoria: filas como arreglos [caso, servicio, ..., N].
function hojaFalsa(filas) {
  const escritas = {};
  const N = gs.SHEET_COLS.ARCHIVOS_JSON;
  return {
    escritas,
    hoja: {
      getLastRow: () => filas.length,
      getRange(fila, col, nFilas = 1, nCols = 1) {
        return {
          getValues: () => Array.from({ length: nFilas }, (_, i) =>
            Array.from({ length: nCols }, (_, j) => filas[fila - 1 + i][col - 1 + j])),
          getValue: () => filas[fila - 1][col - 1],
          setValue() { return this; },
          setFontWeight() { return this; },
          setRichTextValues(valores) {
            assert.strictEqual(col, N);
            valores.forEach((v, i) => { escritas[fila + i] = v[0].getText(); });
          }
        };
      }
    }
  };
}

test('bloque de la columna N: verifica cada fila y no pisa lo que hay', () => {
  const N = gs.SHEET_COLS.ARCHIVOS_JSON;
  const fila = (caso, servicio, n) => {
    const f = new Array(N).fill('');
    f[0] = caso; f[1] = servicio; f[N - 1] = n;
    return f;
  };
  const datos = [
    fila('Número de caso', 'Servicio', 'Archivos JSON'),
    fila(9300, 'Pagos', ''),
    fila(9300, 'Pagos', 'https://ya/estaba'),
    fila(9215, 'Pagos', ''),
    fila(9100, 'Pagos', '')
  ];
  const { hoja, escritas } = hojaFalsa(datos);
  gs.obtenerSheetTab = () => 'Solicitudes';
  gs.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };
  gs.SpreadsheetApp.flush = () => {};
  const ss = { getSheetByName: () => hoja };

  const cuenta = { llenadas: 0, yaTenian: 0, cambiaron: 0 };
  const bloque = [
    { fila: 2, caso: '9300', servicio: 'Pagos', urls: ['https://a'] },
    { fila: 3, caso: '9300', servicio: 'Pagos', urls: ['https://b'] },
    // La fila 4 ahora es otro caso: alguien ordeno el Sheet.
    { fila: 4, caso: '9999', servicio: 'Pagos', urls: ['https://c'] },
    { fila: 5, caso: '9100', servicio: 'Pagos', urls: ['https://d', 'https://e'] },
    // Ya no existe: el Sheet tiene 5 filas.
    { fila: 6, caso: '9000', servicio: 'Pagos', urls: ['https://f'] }
  ];
  assert.strictEqual(gs.indiceEscribirBloqueN_(ss, bloque, cuenta), true);
  assert.deepStrictEqual(plano(cuenta), { llenadas: 2, yaTenian: 1, cambiaron: 2 });
  assert.deepStrictEqual(plano(escritas), { 2: 'https://a', 5: 'https://d\nhttps://e' });
});

// Originales: filas sin copia en nuestra raiz.
function escenarioOriginales() {
  const datos = escenario();
  const filas = [
    // Con copia por link: no va a originales aunque tenga otro link en D.
    { fila: 2, caso: '9300', servicio: 'Pagos', componente: 'ESB', ambiente: 'Producción', estado: 'APROBADO', ids: [ID('c1'), ID('origA')] },
    // Con copia por ruta (Pagos/9215 existe): tampoco.
    { fila: 3, caso: '9215', servicio: 'Pagos', componente: 'ESB', ambiente: 'Pruebas', estado: 'PENDIENTE', ids: [ID('origB')] },
    // Sin copia: dos filas con el mismo original (filas independientes).
    { fila: 4, caso: '8000', servicio: 'Viejo', componente: 'ESB', ambiente: 'Producción', estado: 'APROBADO', ids: [ID('origC')] },
    { fila: 5, caso: '8000', servicio: 'Viejo', componente: 'EI', ambiente: 'Producción', estado: 'PENDIENTE', ids: [ID('origC')] },
    // Sin copia, original sin acceso.
    { fila: 6, caso: '7000', servicio: 'Otro', componente: 'ESB', ambiente: 'Pruebas', estado: 'PENDIENTE', ids: [ID('origX')] },
    // Sin copia, link directo a un .json suelto.
    { fila: 7, caso: '6000', servicio: 'Suelto', componente: 'ESB', ambiente: 'Pruebas', estado: 'PENDIENTE', ids: [ID('jsonD')] }
  ];
  return { datos, filas };
}

test('originales: solo se revisan links de filas sin copia, una vez por link', () => {
  const { datos, filas } = escenarioOriginales();
  const rev = gs.indiceOriginalesPorRevisar_(datos, filas);
  assert.deepStrictEqual(plano(rev.ids), [ID('origC'), ID('origX'), ID('jsonD')]);
  assert.deepStrictEqual(plano(rev.porId[ID('origC')].map((f) => f.fila)), [4, 5]);
});

test('originales: JSON en subcarpetas y sueltos se cruzan con sus filas', () => {
  const { datos, filas } = escenarioOriginales();
  datos.originales = {
    estados: { [ID('origC')]: 'carpeta', [ID('origX')]: 'sin_acceso', [ID('jsonD')]: 'json' },
    carpetas: { [ID('origC')]: ['Entrega 8000', null], [ID('sub')]: ['Config', ID('origC')] },
    jsons: [[ID('jo1'), 'orig.json', ID('sub'), ''], [ID('jsonD'), 'suelto.json', '', '']]
  };
  const res = plano(gs.indiceArmarFilas_(datos, filas));
  const o1 = res.find((r) => r.archivo === 'orig.json');
  assert.strictEqual(o1.origen, 'Original');
  assert.strictEqual(o1.cruce, 'por link original');
  assert.strictEqual(o1.filas, '4, 5');
  assert.strictEqual(o1.carpetaEnvio, 'Entrega 8000');
  assert.strictEqual(o1.resto, 'Config');
  assert.strictEqual(o1.rama, '');
  const o2 = res.find((r) => r.archivo === 'suelto.json' && r.origen === 'Original');
  assert.strictEqual(o2.filas, '7');
  assert.ok(res.filter((r) => r.origen === 'Copia').length > 0);

  const sinAcceso = plano(gs.indiceFilasSinAcceso_(datos, filas));
  assert.deepStrictEqual(sinAcceso.map((s) => s.fila), [6]);

  const marcadas = {};
  sinAcceso.forEach((s) => { marcadas[s.fila] = true; });
  const plan = plano(gs.indicePlanColumnaN_(res, filas, marcadas));
  assert.deepStrictEqual(plan.objetivos.map((o) => o.fila), [2, 3, 4, 5, 7]);
  assert.strictEqual(plan.sinAcceso, 1);
  assert.strictEqual(plan.sinJson, 0);
});
