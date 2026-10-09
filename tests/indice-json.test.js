// Funciones de src/IndiceJson.gs: busqueda por numero de caso, columnas
// N y O, pestana "JSON sin fila", eleccion de filas y activadores.

const test = require('node:test');
const assert = require('node:assert');
const { cargarGs } = require('./cargar-gs');

const gs = cargarGs({ console: { log() {}, warn() {}, error() {} } });

const ID = (s) => (s + 'xxxxxxxxxxxxxxxxxxxxxxxxx').slice(0, 25);
const RAIZ = ID('raiz');
// Los arreglos creados dentro del contexto de vm tienen otro prototipo.
const plano = (x) => JSON.parse(JSON.stringify(x));

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

test('ids de una celda: links y URLs en texto plano sin repetir', () => {
  const url1 = 'https://drive.google.com/drive/folders/' + ID('f1');
  const url2 = 'https://drive.google.com/file/d/' + ID('f2') + '/view';
  const texto = 'Carpeta ' + url2 + ' y ' + url2;
  const rich = gs.SpreadsheetApp.newRichTextValue().setText(texto).setLinkUrl(0, 7, url1).build();
  assert.deepStrictEqual(plano(gs.indiceIdsDeCelda_(rich)), [ID('f1'), ID('f2')]);
});

// Busqueda por numero de caso (diseno sin pestanas, columnas N y O).
function arbolPorCaso() {
  const R = ID('raizCaso');
  const c = {};
  const add = (id, nombre, padre) => { c[ID(id)] = [nombre, padre === null ? R : ID(padre)]; };
  add('pagos', 'Pagos', null);
  add('c1', '9300', 'pagos');
  add('c1b', '9300 docs', 'c1');
  add('sub1', 'Ajustes', 'c1');
  add('c2', '9300_2', 'pagos');
  add('c19300', '19300', 'pagos');
  add('c5555', '5555', 'pagos');
  add('pagso', 'Pagso', null);
  add('c3', '9300', 'pagso');
  add('apim', 'APIM', null);
  add('asrv', 'Pagos', 'apim');
  add('a1', '9300', 'asrv');
  add('resp', 'Respaldo 2026', null);
  add('m8000', 'caso 8000', null);
  add('cv', 'Copia vieja', null);
  const j = (id, nombre, padre, mod, md5) => [ID(id), nombre, ID(padre), mod, md5];
  return {
    raizId: R,
    carpetas: c,
    jsons: [
      j('j1', 'config.json', 'c1', '2026-09-01T00:00:00Z', 'A'),
      j('j2', 'config.json', 'c2', '2026-09-05T00:00:00Z', 'A'),
      j('j3', 'tarifas.json', 'c2', '2026-09-05T00:00:00Z', 'B'),
      j('j4', 'config.json', 'a1', '2026-09-10T00:00:00Z', 'C'),
      j('j5', 'extra.json', 'sub1', '2026-09-02T00:00:00Z', 'D'),
      j('j6', 'x.json', 'c19300', '2026-09-02T00:00:00Z', 'E'),
      j('j7', 'notas.json', 'resp', '2026-09-02T00:00:00Z', 'F'),
      j('j8', 'm.json', 'm8000', '2026-09-02T00:00:00Z', 'G'),
      j('j9', 'cv.json', 'cv', '2026-09-02T00:00:00Z', 'H')
    ]
  };
}

test('numeros de caso en nombres de carpeta: completos y sin el sufijo _N', () => {
  const n = (s) => plano(gs.indiceNumerosEnNombre_(s));
  assert.deepStrictEqual(n('9300'), ['9300']);
  assert.deepStrictEqual(n('9300_2'), ['9300']);
  assert.deepStrictEqual(n('caso 9300'), ['9300']);
  assert.deepStrictEqual(n('19300'), ['19300']);
  assert.deepStrictEqual(n('Pagos'), []);
  assert.deepStrictEqual(n('0912'), ['912']);
  assert.strictEqual(gs.indiceNormalizarCaso_(9300), '9300');
  assert.strictEqual(gs.indiceNormalizarCaso_(' 09300 '), '9300');
  assert.strictEqual(gs.indiceNormalizarCaso_('abc'), '');
});

test('directorio por caso: todas las carpetas del numero, en cualquier rama', () => {
  const dir = gs.indiceDirectorioPorCaso_(arbolPorCaso());
  const e = dir.porCaso['9300'];
  const ids = plano(e.carpetas.map((c) => c.id)).sort();
  assert.deepStrictEqual(ids, [ID('a1'), ID('c1'), ID('c1b'), ID('c2'), ID('c3')].sort());
  assert.strictEqual(e.carpetas.find((c) => c.id === ID('a1')).rama, 'APIM');
  assert.strictEqual(e.carpetas.find((c) => c.id === ID('c1')).rama, 'General');
  const jsons = plano(e.jsons.map((j) => j.id)).sort();
  assert.deepStrictEqual(jsons, [ID('j1'), ID('j2'), ID('j3'), ID('j4'), ID('j5')].sort());
  assert.deepStrictEqual(plano(dir.casosDeJson[ID('j6')]), ['19300']);
  assert.deepStrictEqual(plano(dir.casosDeJson[ID('j9')]), []);
});

test('JSON del caso: identicos una vez (prioridad sin _N), modificados los dos', () => {
  const dir = gs.indiceDirectorioPorCaso_(arbolPorCaso());
  const res = plano(gs.indiceJsonDelCaso_(dir.porCaso['9300']).map((j) => j.id));
  // config.json: j4 (APIM, otro contenido, mas reciente) y j1 (sin _2, gana a j2).
  assert.deepStrictEqual(res, [ID('j4'), ID('j1'), ID('j5'), ID('j3')]);
});

test('repetidos: con el mismo sufijo, gana el mas reciente; sin huella, todos', () => {
  const r = plano(gs.indiceQuitarRepetidos_([
    { id: 'a', nombre: 'x.json', md5: 'M', modificado: '2026-01-01', conSufijo: false },
    { id: 'b', nombre: 'x.json', md5: 'M', modificado: '2026-02-01', conSufijo: false },
    { id: 'c', nombre: 'y.json', md5: '', modificado: '2026-01-01', conSufijo: true },
    { id: 'd', nombre: 'y.json', md5: '', modificado: '2026-01-01', conSufijo: true }
  ]).map((j) => j.id));
  assert.deepStrictEqual(r, ['b', 'c', 'd']);
});

test('carpeta de la fila: por ruta, de respaldo por numero en su rama', () => {
  const arbol = arbolPorCaso();
  const dir = gs.indiceDirectorioPorCaso_(arbol);
  const f = (servicio, componente, caso, ids) => plano(gs.indiceCarpetaDeFila_(
    { caso, servicio, componente, ids: ids || [] }, arbol, dir));
  const ids = (r) => r.carpetas.map((c) => c.id);

  const esb = f('Pagos', 'ESB', '9300');
  assert.strictEqual(esb.por, 'ruta');
  assert.deepStrictEqual(ids(esb), [ID('c1'), ID('c2')]);

  const api = f('Pagos', 'API', '9300');
  assert.strictEqual(api.por, 'ruta');
  assert.deepStrictEqual(ids(api), [ID('a1')]);

  // Servicio escrito distinto: por numero, solo en su rama y sin subcarpetas repetidas.
  const otroNombre = f('Pagos SA', 'ESB', '9300');
  assert.strictEqual(otroNombre.por, 'numero');
  assert.deepStrictEqual(ids(otroNombre).sort(), [ID('c1'), ID('c2'), ID('c3')].sort());

  const apiOtroNombre = f('Otro', 'APIM', '9300');
  assert.strictEqual(apiOtroNombre.por, 'numero');
  assert.deepStrictEqual(ids(apiOtroNombre), [ID('a1')]);

  assert.strictEqual(f('Pagos', 'ESB', '9300', [ID('c1')]).yaEnlazada, true);
  assert.strictEqual(f('Pagos', 'ESB', '7000').por, null);
});

test('resultado de la fila: links del caso, links de C y D, o el motivo', () => {
  const arbol = arbolPorCaso();
  const dir = gs.indiceDirectorioPorCaso_(arbol);
  const O = ID('orig1');
  const originales = {
    estados: { [O]: 'carpeta', [ID('orig2')]: 'sin_acceso', [ID('pdf')]: 'otro' },
    carpetas: { [O]: ['Entrega', null] },
    jsons: [[ID('jo'), 'o.json', O, '2026-09-01T00:00:00Z', 'Z']]
  };
  const r = (caso, ids, orig) => plano(gs.indiceResultadoFila_(
    { caso, servicio: 'X', componente: 'ESB', ids: ids || [] }, arbol, dir,
    orig === undefined ? originales : orig));
  const url = (id) => 'https://drive.google.com/file/d/' + ID(id) + '/view';

  assert.deepStrictEqual(r('9300').links, [url('j4'), url('j1'), url('j5'), url('j3')]);
  assert.strictEqual(r('5555').motivo, 'Hay carpeta del caso en el Drive, pero no tiene JSON');
  assert.deepStrictEqual(r('8000').links, [url('j8')]);
  assert.deepStrictEqual(r('4444', [ID('cv')]).links, [url('j9')]);
  assert.deepStrictEqual(r('3333', [O]).links, [url('jo')]);
  assert.strictEqual(r('3333', [ID('orig2')]).motivo, 'Sin acceso al original o fue borrado; pedir permiso');
  assert.strictEqual(r('3333', [ID('pdf')]).motivo, 'El original no tiene JSON');
  assert.strictEqual(r('3333', []).motivo, 'No hay carpeta del caso en el Drive ni link en la fila');
  assert.strictEqual(r('3333', [O], null).pendiente, true);
});

test('celda N: vacia se escribe, links no se tocan, mixta se limpia, motivo solo al revisar', () => {
  const links = { links: ['https://a', 'https://b'], motivo: null };
  const motivo = { links: [], motivo: 'El original no tiene JSON' };
  const d = (actual, res, revisar) => plano(gs.indiceDecidirCeldaN_(actual, res, revisar));

  assert.deepStrictEqual(d('', links, false), { accion: 'escribir', texto: 'https://a\nhttps://b', tipo: 'links' });
  assert.deepStrictEqual(d('', motivo, false), { accion: 'escribir', texto: 'El original no tiene JSON', tipo: 'motivo' });
  assert.strictEqual(d('https://ya', links, true).accion, 'nada');
  assert.deepStrictEqual(d('Sin acceso al original o fue borrado; pedir permiso\nhttps://nuevo', motivo, false),
    { accion: 'limpiar', texto: 'https://nuevo', tipo: 'limpiada' });
  assert.strictEqual(d('El original no tiene JSON', links, false).accion, 'nada');
  assert.strictEqual(d('Sin acceso al original o fue borrado; pedir permiso', links, true).accion, 'escribir');
  assert.strictEqual(d('El original no tiene JSON', motivo, true).tipo, 'mismoMotivo');
  assert.strictEqual(d('', { pendiente: true, links: [], motivo: null }, false).accion, 'nada');
});

// Sheet en memoria con columnas hasta la O.
function hojaConO(filas) {
  const escritas = {};
  const recortadas = [];
  return {
    escritas,
    recortadas,
    hoja: {
      getLastRow: () => filas.length,
      getRange(fila, col, nFilas = 1, nCols = 1) {
        return {
          getValues: () => Array.from({ length: nFilas }, (_, i) =>
            Array.from({ length: nCols }, (_, j) => (filas[fila - 1 + i][col - 1 + j] ?? ''))),
          getValue: () => filas[fila - 1][col - 1] ?? '',
          setValue(v) { filas[fila - 1][col - 1] = v; return this; },
          setFontWeight() { return this; },
          setWrapStrategy(w) { recortadas.push([fila, col, nFilas, w]); return this; },
          setHorizontalAlignment() { return this; },
          setRichTextValues(valores) {
            valores.forEach((v, i) => {
              escritas[(fila + i) + ',' + col] = v[0].getText();
              filas[fila - 1 + i][col - 1] = v[0].getText();
            });
          }
        };
      }
    }
  };
}

test('bloque de filas: escribe N y O con las reglas y respeta lo que ya hay', () => {
  const N = gs.SHEET_COLS.ARCHIVOS_JSON;
  const O = gs.INDICE_COL_CARPETA;
  const fila = (caso, servicio, n, o) => {
    const f = new Array(O).fill('');
    f[0] = caso; f[1] = servicio; f[N - 1] = n || ''; f[O - 1] = o || '';
    return f;
  };
  const datos = [
    fila('Número de caso', 'Servicio', 'Archivos JSON', ''),
    fila(9300, 'Pagos'),                                    // 2: vacia
    fila(9300, 'Pagos', 'https://ya/estaba', 'Mi nota'),    // 3: links y O con datos
    fila(8000, 'Viejo', 'Sin acceso al original o fue borrado; pedir permiso\nhttps://nuevo'), // 4: mixta
    fila(7000, 'Otro', 'El original no tiene JSON'),        // 5: solo motivo
    fila(9999, 'Pagos')                                     // 6: cambio de caso
  ];
  const { hoja, escritas, recortadas } = hojaConO(datos);
  gs.SpreadsheetApp.WrapStrategy = { CLIP: 'CLIP' };
  gs.obtenerSheetTab = () => 'Solicitudes';
  gs.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };
  gs.SpreadsheetApp.flush = () => {};
  const ss = { getSheetByName: () => hoja };

  const carpeta = { por: 'ruta', carpetas: [{ id: ID('c1'), ruta: 'Pagos/9300' }, { id: ID('c2'), ruta: 'Pagos/9300_2' }] };
  const conLinks = { links: ['https://json1'], motivo: null };
  const bloque = [
    { fila: 2, caso: '9300', servicio: 'Pagos', resultado: conLinks, carpeta },
    { fila: 3, caso: '9300', servicio: 'Pagos', resultado: conLinks, carpeta },
    { fila: 4, caso: '8000', servicio: 'Viejo', resultado: { links: [], motivo: 'x' }, carpeta: { por: 'numero', carpetas: [{ id: ID('c8'), ruta: 'caso 8000' }] } },
    { fila: 5, caso: '7000', servicio: 'Otro', resultado: conLinks, carpeta: null },
    { fila: 6, caso: '1234', servicio: 'Pagos', resultado: conLinks, carpeta }
  ];
  const cuenta = { cambiaron: 0 };
  assert.strictEqual(gs.indiceEscribirBloqueFilas_(ss, bloque, cuenta, false), true);

  assert.strictEqual(escritas['2,' + N], 'https://json1');
  assert.strictEqual(escritas['2,' + O], 'Pagos/9300\nPagos/9300_2');
  assert.strictEqual(escritas['3,' + N], undefined);
  assert.strictEqual(escritas['3,' + O], undefined);
  assert.strictEqual(escritas['4,' + N], 'https://nuevo');
  assert.strictEqual(escritas['4,' + O], 'Por número de caso: caso 8000');
  assert.strictEqual(escritas['5,' + N], undefined);
  assert.strictEqual(escritas['6,' + N], undefined);
  assert.strictEqual(datos[0][O - 1], 'Carpeta copiada');
  // Lo escrito queda recortado desde ya (no se desborda mientras corre).
  assert.ok(recortadas.some((r) => r[0] === 2 && r[1] === N && r[3] === 'CLIP'));
  assert.ok(recortadas.some((r) => r[0] === 4 && r[1] === O && r[3] === 'CLIP'));
  assert.deepStrictEqual(plano(cuenta), { cambiaron: 1, links: 1, yaTenia: 1, limpiada: 1, conMotivo: 1, carpetas: 2 });

  // Al revisar avisos, la fila 5 (solo motivo) si se actualiza.
  const cuenta2 = { cambiaron: 0 };
  gs.indiceEscribirBloqueFilas_(ss, [bloque[3]], cuenta2, true);
  assert.strictEqual(escritas['5,' + N], 'https://json1');
});

test('eleccion de filas: normal toma N vacias y mixtas; revisar toma solo motivos desde la fila', () => {
  const filas = [
    { fila: 2, textoN: '', textoO: '' },
    { fila: 3, textoN: 'https://a', textoO: '' },
    { fila: 4, textoN: 'El original no tiene JSON\nhttps://b', textoO: '' },
    { fila: 5, textoN: 'El original no tiene JSON', textoO: '' },
    { fila: 6, textoN: 'Sin acceso al original o fue borrado; pedir permiso', textoO: 'Pagos/1' },
    { fila: 7, textoN: 'https://c', textoO: 'Pagos/9300' }
  ];
  // La fila 3 tiene carpeta encontrada y O vacia: entra solo para la O.
  const carpetaDe = (f) => (f.fila === 3 || f.fila === 7
    ? { por: 'ruta', carpetas: [{ id: 'x', ruta: 'Pagos/9300' }] }
    : { por: null, carpetas: [] });
  const resumen = (lista) => plano(lista.map((f) => [f.fila, f.necesitaN, f.limpiar, f.soloCarpeta]));

  assert.deepStrictEqual(resumen(gs.indiceElegirFilas_(filas, 'normal', 0, carpetaDe)),
    [[2, true, false, false], [3, false, false, true], [4, false, true, false]]);
  assert.deepStrictEqual(resumen(gs.indiceElegirFilas_(filas, 'revisar', 6, carpetaDe)),
    [[3, false, false, true], [4, false, true, false], [6, true, false, false]]);
});

test('JSON sin fila: caso que no esta en el Sheet, carpeta sin numero, y lo enlazado no entra', () => {
  const arbol = arbolPorCaso();
  // Copia identica de x.json en otra carpeta sin fila: debe salir dos veces.
  arbol.jsons.push([ID('j6b'), 'x.json', ID('resp'), '2026-09-02T00:00:00Z', 'E']);
  const dir = gs.indiceDirectorioPorCaso_(arbol);
  const filas = [{ caso: '9300', ids: [] }, { caso: '8000', ids: [] }, { caso: '5555', ids: [] }];
  const lista = plano(gs.indiceJsonSinFila_(arbol, dir, filas));
  assert.deepStrictEqual(lista.map((s) => [s.ruta, s.nombre, s.numeros, s.motivo]), [
    ['Copia vieja', 'cv.json', '', 'La carpeta no tiene número de caso y ninguna fila la enlaza'],
    ['Pagos/19300', 'x.json', '19300', 'Ninguna fila tiene el caso 19300'],
    ['Respaldo 2026', 'notas.json', '2026', 'Ninguna fila tiene el caso 2026'],
    ['Respaldo 2026', 'x.json', '2026', 'Ninguna fila tiene el caso 2026']
  ]);

  // Si una fila enlaza la carpeta "Copia vieja", su JSON ya tiene fila.
  const conEnlace = filas.concat([{ caso: '4444', ids: [ID('cv')] }]);
  const lista2 = plano(gs.indiceJsonSinFila_(arbol, dir, conEnlace));
  assert.ok(!lista2.some((s) => s.nombre === 'cv.json'));
});

test('fin de una parte: programar si avanzo, parar sin avance o al tope, nada si termino', () => {
  const d = (res, filaAntes) => plano(gs.indiceDecidirSiguiente_(res, filaAntes, 20));
  assert.strictEqual(d({ terminado: true, nota: { partes: 1 } }, 0).accion, 'nada');
  assert.strictEqual(d({ ocupado: true }, 0).accion, 'nada');
  assert.strictEqual(d({ nota: { partes: 1, progreso: 1 } }, 0).accion, 'programar');
  assert.strictEqual(d({ nota: { partes: 20, progreso: 5 } }, 0).accion, 'parar');
  const sinAvance = d({ nota: { partes: 3, progreso: 4, ultimoError: 'Drive caído' } }, 4);
  assert.strictEqual(sinAvance.accion, 'parar');
  assert.match(sinAvance.motivo, /Drive caído/);
});

test('celda de carpeta: cada linea con el link a su carpeta', () => {
  const v = gs.indiceCeldaCarpeta_({ por: 'ruta', carpetas: [{ id: ID('c1'), ruta: 'Pagos/9300' }, { id: ID('c2'), ruta: 'Pagos/9300_2' }] });
  const runs = v.getRuns().filter((r) => r.getLinkUrl());
  assert.deepStrictEqual(runs.map((r) => r.getText()), ['Pagos/9300', 'Pagos/9300_2']);
  assert.strictEqual(runs[1].getLinkUrl(), 'https://drive.google.com/drive/folders/' + ID('c2'));
});

test('sufijo de reenvio: solo pegado a un numero y de hasta 3 digitos', () => {
  assert.strictEqual(gs.indiceQuitarSufijo_('9300_2'), '9300');
  assert.strictEqual(gs.indiceQuitarSufijo_('9300_12'), '9300');
  assert.strictEqual(gs.indiceQuitarSufijo_('caso_9300'), 'caso_9300');
  assert.strictEqual(gs.indiceQuitarSufijo_('Pagos_9300'), 'Pagos_9300');
  assert.deepStrictEqual(plano(gs.indiceNumerosEnNombre_('caso_9300')), ['9300']);
  assert.deepStrictEqual(plano(gs.indiceNumerosEnNombre_('Pagos_9300_2')), ['9300']);
});

test('parte cortada por Google: empezo hace mas de 6 minutos y no guardo su fin', () => {
  const ahora = 10 * 60 * 1000;
  assert.strictEqual(gs.indiceParteCortada_({ parteIniciadaEn: 0 }, ahora), false);
  assert.strictEqual(gs.indiceParteCortada_({ parteIniciadaEn: 1 }, ahora), true);
  assert.strictEqual(gs.indiceParteCortada_({ parteIniciadaEn: 1, parteTerminadaEn: 300000 }, ahora), false);
  assert.strictEqual(gs.indiceParteCortada_({ parteIniciadaEn: ahora - 60000 }, ahora), false);
  assert.strictEqual(gs.indiceParteCortada_(null, ahora), false);
});

test('fin de una parte: si se pidio detener, para aunque haya avanzado', () => {
  const d = gs.indiceDecidirSiguiente_({ detenido: true, nota: { partes: 1, progreso: 2 } }, 0, 20);
  assert.strictEqual(d.accion, 'parar');
  assert.strictEqual(d.motivo, 'Detenida a pedido.');
  const d2 = gs.indiceDecidirSiguiente_({ nota: { partes: 1, progreso: 2, detener: true } }, 0, 20);
  assert.strictEqual(d2.accion, 'parar');
});

test('fin de una parte: leer mas de la carpeta raiz cuenta como avance', () => {
  // Una parte que solo leyo el mapa del Drive (sin filas) avanzo: se programa la siguiente.
  assert.strictEqual(gs.indiceDecidirSiguiente_({ nota: { partes: 1, progreso: 1, filaActual: 0 } }, 0, 20).accion, 'programar');
  // Sin leer mas ni escribir filas, no avanzo.
  assert.strictEqual(gs.indiceDecidirSiguiente_({ nota: { partes: 2, progreso: 1, filaActual: 0 } }, 1, 20).accion, 'parar');
});

test('preparar una busqueda olvida la parte anterior (no se ve como cortada)', () => {
  const props = {};
  gs.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) };
  gs.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };
  // Nota vieja: busqueda detenida cuya ultima parte fue cortada por Google.
  props.INDICE_NOTA_X = JSON.stringify({ modo: 'normal', etapa: 'detenido', partes: 1, parteIniciadaEn: 1000, ocupadoHasta: 0 });
  const prep = plano(gs.indicePrepararBusqueda_('X', 'normal'));
  assert.strictEqual(prep.nota.etapa, 'buscando');
  assert.strictEqual(prep.nota.parteIniciadaEn, null);
  assert.strictEqual(gs.indiceParteCortada_(prep.nota, 60 * 60 * 1000), false);
});

test('reanudar: solo si la parte siguiente esta esperando y nadie la detuvo', () => {
  const ahora = 100 * 60 * 1000;
  const r = (nota) => gs.indiceDebeReanudar_(nota, ahora);
  assert.strictEqual(r(null), false);
  assert.strictEqual(r({ etapa: 'terminado' }), false);
  assert.strictEqual(r({ etapa: 'detenido' }), false);
  // Corriendo: no.
  assert.strictEqual(r({ etapa: 'buscando', ocupadoHasta: ahora + 60000, parteIniciadaEn: ahora - 60000 }), false);
  // Programada hace poco: esta por arrancar, no.
  assert.strictEqual(r({ etapa: 'buscando', activador: { estado: 'programado', en: ahora - 30000 } }), false);
  // A la hora, sin arrancar a tiempo, sin activador o con error: si.
  assert.strictEqual(r({ etapa: 'buscando', activador: { estado: 'a_la_hora', en: ahora + 3600000 } }), true);
  assert.strictEqual(r({ etapa: 'buscando', activador: { estado: 'programado', en: ahora - 120000 } }), true);
  assert.strictEqual(r({ etapa: 'buscando', activador: null }), true);
  assert.strictEqual(r({ etapa: 'buscando', activador: { estado: 'error', en: ahora } }), true);
  // Parte cortada por Google: si.
  assert.strictEqual(r({ etapa: 'buscando', parteIniciadaEn: ahora - 10 * 60000, ocupadoHasta: ahora + 1 }), true);
});

test('empezar de cero: en la N solo se borran las celdas con motivo, nunca las que tienen links', () => {
  const valores = [[''], ['https://a'], ['El original no tiene JSON'], ['Sin acceso al original o fue borrado; pedir permiso\nhttps://b'], ['No hay carpeta del caso en el Drive ni link en la fila']];
  assert.deepStrictEqual(plano(gs.indiceFilasConSoloMotivo_(valores)), [2, 4]);
});

test('desde donde se presiono un boton: Gmail o Sheets', () => {
  assert.strictEqual(gs.indiceHost_({ commonEventObject: { hostApp: 'GMAIL' } }), 'Gmail');
  assert.strictEqual(gs.indiceHost_({ commonEventObject: { hostApp: 'SHEETS' } }), 'Sheets');
  assert.strictEqual(gs.indiceHost_({}), 'panel');
});
