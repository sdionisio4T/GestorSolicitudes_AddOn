// Copia de los JSON a la carpeta JSON-WSO2 (src/JsonWso2.gs) y como la
// usan la busqueda y el boton "Pasar JSON a JSON-WSO2" (src/IndiceJson.gs).

const test = require('node:test');
const assert = require('node:assert');
const { cargarGs } = require('./cargar-gs');

const gs = cargarGs({ console: { log() {}, warn() {}, error() {} } });
const plano = (x) => JSON.parse(JSON.stringify(x));
const ID = (s) => (s + 'xxxxxxxxxxxxxxxxxxxxxxxxx').slice(0, 25);
const urlArchivo = (id) => 'https://drive.google.com/file/d/' + id + '/view';
const CARP = 'application/vnd.google-apps.folder';

// Drive falso con DriveApp (carpetas, copias, contenido) y el servicio
// avanzado Drive (listar hijos, leer datos de un archivo).
function driveFalso(items) {
  let siguiente = 1;
  const nuevoId = () => ID('nuevo' + siguiente++);
  const buscar = (id) => items.find((i) => i.id === id);
  const iterador = (lista) => {
    let k = 0;
    return { hasNext: () => k < lista.length, next: () => lista[k++] };
  };
  const carpeta = (it) => ({
    getId: () => it.id,
    getUrl: () => 'https://drive.google.com/drive/folders/' + it.id,
    isTrashed: () => !!it.papelera,
    getFoldersByName: (n) => iterador(items.filter((i) => i.padre === it.id && i.mimeType === CARP && i.name === n).map(carpeta)),
    createFolder: (n) => {
      const nueva = { id: nuevoId(), name: n, mimeType: CARP, padre: it.id };
      items.push(nueva);
      return carpeta(nueva);
    }
  });
  const archivo = (it) => ({
    getId: () => it.id,
    makeCopy: (n, destino) => {
      if (it.sinAcceso) throw new Error('Sin acceso');
      const copia = { ...it, id: nuevoId(), name: n, padre: destino.getId(), descripcion: '' };
      items.push(copia);
      return archivo(copia);
    },
    getBlob: () => {
      if (it.sinAcceso) throw new Error('Sin acceso');
      return { getDataAsString: () => it.contenido || '' };
    },
    setContent: (c) => { it.contenido = c; it.md5Checksum = 'md5:' + c; },
    setDescription: (d) => { it.descripcion = d; }
  });
  return {
    items,
    DriveApp: {
      getFolderById: (id) => { const it = buscar(id); if (!it) throw new Error('No existe'); return carpeta(it); },
      getFileById: (id) => { const it = buscar(id); if (!it) throw new Error('No existe'); return archivo(it); }
    },
    Drive: { Files: {
      get: (id, op) => {
        const it = buscar(id);
        if (!it || it.sinAcceso) throw new Error('File not found: ' + id);
        if (op && op.fields === 'description') return { description: it.descripcion || '' };
        return { id: it.id, name: it.name, modifiedTime: it.modifiedTime, md5Checksum: it.md5Checksum };
      },
      list: (p) => {
        const padre = /^'([^']+)' in parents/.exec(p.q)[1];
        return { files: items.filter((i) => i.padre === padre && !i.papelera) };
      }
    } }
  };
}

function instalar(d) {
  const props = {};
  gs.DriveApp = d.DriveApp;
  gs.Drive = d.Drive;
  gs.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) };
  return props;
}

const RAIZ = ID('raiz');
const json = (id, name, padre, md5, mod, extra) => ({
  id: ID(id), name, mimeType: 'application/json', padre, md5Checksum: md5, modifiedTime: mod, contenido: 'c-' + md5, ...extra
});
const sinLimite = () => 600000;

test('linea de la carpeta en la columna N', () => {
  assert.strictEqual(gs.jsonWso2TextoCarpeta_('9300', 2), 'JSON-WSO2/9300 (2 JSON)');
  assert.strictEqual(gs.jsonWso2EsLineaCarpeta_('JSON-WSO2/9300 (2 JSON)'), true);
  assert.strictEqual(gs.jsonWso2EsLineaCarpeta_('  JSON-WSO2/9300 (12 JSON) '), true);
  assert.strictEqual(gs.jsonWso2EsLineaCarpeta_('Sin carpeta ni link'), false);
  assert.strictEqual(gs.jsonWso2EsLineaCarpeta_('https://drive.google.com/file/d/x/view'), false);
});

test('ids de los links a archivos de la columna N', () => {
  assert.deepStrictEqual(plano(gs.jsonWso2IdsDeUrls_([
    urlArchivo(ID('a')), 'https://drive.google.com/open?id=' + ID('b'), urlArchivo(ID('a')), 'https://otra.cosa/'
  ])), [ID('a'), ID('b')]);
});

test('uno por nombre: queda el mas reciente', () => {
  const r = gs.jsonWso2UnoPorNombre_([
    { id: 'a', nombre: 'config.json', modificado: '2026-09-01' },
    { id: 'b', nombre: 'tarifas.json', modificado: '2026-09-01' },
    { id: 'c', nombre: 'config.json', modificado: '2026-09-05' }
  ]);
  assert.deepStrictEqual(plano(r.map((a) => a.id)), ['c', 'b']);
});

test('celda de la N: carpeta con su link y debajo los que no se copiaron', () => {
  const rich = gs.jsonWso2Celda_({ url: 'https://carpeta', caso: '9300', total: 2 }, ['https://drive.google.com/file/d/p/view']);
  assert.strictEqual(rich.getText(), 'JSON-WSO2/9300 (2 JSON)\nhttps://drive.google.com/file/d/p/view');
  const runs = rich.getRuns().filter((r) => r.getLinkUrl());
  assert.deepStrictEqual(runs.map((r) => [r.getText(), r.getLinkUrl()]),
    [['JSON-WSO2/9300 (2 JSON)', 'https://carpeta'], ['https://drive.google.com/file/d/p/view', 'https://drive.google.com/file/d/p/view']]);
});

test('copiar al caso: crea JSON-WSO2/<caso>, uno por nombre, y no duplica', () => {
  const d = driveFalso([
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    json('j1', 'config.json', 'otra', 'A', '2026-09-01'),
    json('j2', 'tarifas.json', 'otra', 'B', '2026-09-01')
  ]);
  const props = instalar(d);
  const archivos = [
    { id: ID('j1'), nombre: 'config.json', modificado: '2026-09-01', md5: 'A' },
    { id: ID('j2'), nombre: 'tarifas.json', modificado: '2026-09-01', md5: 'B' }
  ];
  const r = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '09300', archivos, sinLimite));
  assert.strictEqual(r.carpeta.caso, '9300');
  assert.strictEqual(r.carpeta.total, 2);
  assert.deepStrictEqual(r.pendientes, []);
  const principal = d.items.find((i) => i.name === 'JSON-WSO2');
  assert.strictEqual(principal.padre, RAIZ);
  assert.ok(Object.values(props).includes(principal.id));
  const delCaso = d.items.find((i) => i.name === '9300' && i.padre === principal.id);
  assert.strictEqual(d.items.filter((i) => i.padre === delCaso.id).length, 2);
  // Otra fila del mismo caso con el mismo JSON: no se copia otra vez.
  const otra = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', archivos.slice(0, 1), sinLimite));
  assert.strictEqual(otra.carpeta.total, 2);
  assert.strictEqual(d.items.filter((i) => i.padre === delCaso.id).length, 2);
  assert.strictEqual(d.items.filter((i) => i.name === '9300').length, 1);
});

test('copiar al caso: mismo nombre con otro contenido, reemplaza solo si es mas reciente', () => {
  const d = driveFalso([
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    json('viejo', 'config.json', 'otra', 'A', '2026-09-01'),
    json('nuevo', 'config.json', 'otra', 'B', '2026-09-10'),
    json('antiguo', 'config.json', 'otra', 'C', '2026-08-01')
  ]);
  instalar(d);
  const a = (id, mod, md5) => [{ id: ID(id), nombre: 'config.json', modificado: mod, md5 }];
  gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', a('viejo', '2026-09-01', 'A'), sinLimite);
  const copia = () => d.items.find((i) => i.name === 'config.json' && i.descripcion !== undefined && i.padre !== 'otra');
  const idCopia = copia().id;
  gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', a('nuevo', '2026-09-10', 'B'), sinLimite);
  assert.strictEqual(copia().contenido, 'c-B');
  assert.strictEqual(copia().id, idCopia, 'se reemplaza el contenido sobre el mismo archivo');
  gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', a('antiguo', '2026-08-01', 'C'), sinLimite);
  assert.strictEqual(copia().contenido, 'c-B', 'uno mas viejo no reemplaza');
});

test('copiar al caso: sin tiempo o sin acceso quedan pendientes', () => {
  const d = driveFalso([
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    json('j1', 'a.json', 'otra', 'A', '2026-09-01'),
    json('j2', 'b.json', 'otra', 'B', '2026-09-01', { sinAcceso: true })
  ]);
  instalar(d);
  const archivos = [
    { id: ID('j1'), nombre: 'a.json', modificado: '2026-09-01', md5: 'A' },
    { id: ID('j2'), nombre: 'b.json', modificado: '2026-09-01', md5: 'B' }
  ];
  const conAcceso = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', archivos, sinLimite));
  assert.deepStrictEqual(conAcceso.pendientes, [ID('j2')]);
  assert.strictEqual(conAcceso.carpeta.total, 1);
  const sinTiempo = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '7799', archivos, () => 0));
  assert.deepStrictEqual(sinTiempo.pendientes, [ID('j1'), ID('j2')]);
  assert.strictEqual(sinTiempo.carpeta.total, 0);
  assert.strictEqual(gs.jsonWso2CopiarAlCaso_(RAIZ, 'abc', archivos, sinLimite), null);
});

test('tiempo para copiar en un envio: solo si quedan 8 segundos', () => {
  const DateReal = gs.Date;
  let reloj = 1000000;
  gs.Date = { now: () => reloj };
  try {
    gs.JSON_WSO2_INICIO_ACCION = 0;
    const sinInicio = gs.jsonWso2TiempoParaCopiar_();
    assert.strictEqual(sinInicio(), 8000);
    gs.jsonWso2MarcarInicioAccion_();
    reloj += 10000;
    const queda = gs.jsonWso2TiempoParaCopiar_();
    assert.strictEqual(queda(), 30000 - 10000 - 4000);
    reloj += 13000;
    assert.strictEqual(gs.jsonWso2TiempoParaCopiar_(), null);
  } finally {
    if (DateReal) gs.Date = DateReal; else delete gs.Date;
    gs.JSON_WSO2_INICIO_ACCION = 0;
  }
});

test('columna N: la carpeta de JSON-WSO2 cuenta como lista', () => {
  const linea = 'JSON-WSO2/9300 (2 JSON)';
  const celda = plano(gs.indiceAnalizarCeldaN_(linea + '\nhttps://drive.google.com/file/d/x/view'));
  assert.deepStrictEqual(celda, { links: ['https://drive.google.com/file/d/x/view'], carpetas: [linea], motivos: [] });
  assert.strictEqual(gs.indiceDecidirCeldaN_(linea, { links: ['https://y'], motivo: null }, true).accion, 'nada');
  const filas = [
    { fila: 2, textoN: linea, textoO: 'x' },
    { fila: 3, textoN: '', textoO: 'x' },
    { fila: 4, textoN: 'Sin carpeta ni link', textoO: 'x' }
  ];
  assert.deepStrictEqual(plano(gs.indiceElegirFilas_(filas, 0, null).map((f) => f.fila)), [3, 4]);
});

test('filas por pasar: las que tienen links a archivos en la N', () => {
  assert.strictEqual(gs.indiceContarPorPasar_([
    ['https://drive.google.com/file/d/a/view'],
    ['JSON-WSO2/9300 (1 JSON)'],
    ['JSON-WSO2/9300 (1 JSON)\nhttps://drive.google.com/file/d/b/view'],
    ['Sin carpeta ni link'],
    ['']
  ]), 2);
});

test('la busqueda no recorre la carpeta JSON-WSO2 de la raiz', () => {
  const items = [
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    { id: ID('wso2'), name: 'JSON-WSO2', mimeType: CARP, padre: RAIZ },
    { id: ID('c9300'), name: '9300', mimeType: CARP, padre: ID('wso2') },
    json('copia', 'config.json', ID('c9300'), 'A', '2026-09-01'),
    { id: ID('pagos'), name: 'Pagos', mimeType: CARP, padre: RAIZ },
    { id: ID('p9300'), name: '9300', mimeType: CARP, padre: ID('pagos') },
    json('orig', 'config.json', ID('p9300'), 'A', '2026-09-01')
  ];
  const d = driveFalso(items);
  instalar(d);
  gs.Drive.Files.get = () => ({ id: RAIZ, driveId: '' });
  const arbol = plano(gs.indiceRecorrerRaiz_(RAIZ, () => 600000, null, null));
  assert.deepStrictEqual(Object.keys(arbol.carpetas).sort(), [ID('p9300'), ID('pagos')].sort());
  assert.deepStrictEqual(arbol.jsons.map((j) => j[0]), [ID('orig')]);
  // Igual al leer la unidad de una vez.
  const deUnaVez = plano(gs.indiceArbolDeUnidad_(RAIZ, '', items.filter((i) => i.mimeType === CARP).map((i) => ({ ...i, parents: [i.padre] })),
    items.filter((i) => i.mimeType !== CARP).map((i) => ({ ...i, parents: [i.padre] }))));
  assert.deepStrictEqual(Object.keys(deUnaVez.carpetas).sort(), [ID('p9300'), ID('pagos')].sort());
  assert.deepStrictEqual(deUnaVez.jsons.map((j) => j[0]), [ID('orig')]);
});

// Sheet falso: celdas por (fila, columna) con valor o texto enriquecido.
function sheetFalso(filas) {
  const celdas = {};
  const clave = (r, c) => r + ':' + c;
  Object.keys(filas).forEach((r) => {
    celdas[clave(r, gs.SHEET_COLS.NUMERO_CASO)] = { valor: filas[r].caso };
    celdas[clave(r, gs.SHEET_COLS.ARCHIVOS_JSON)] = filas[r].n ? { valor: filas[r].n.getText(), rich: filas[r].n } : { valor: '' };
  });
  const celda = (r, c) => {
    const k = clave(r, c);
    if (!celdas[k]) celdas[k] = { valor: '' };
    const x = celdas[k];
    return {
      getValue: () => x.valor,
      setValue: (v) => { x.valor = v; return { setFontWeight() {} }; },
      getRichTextValue: () => x.rich || null,
      setRichTextValue: (rv) => { x.rich = rv; x.valor = rv.getText(); }
    };
  };
  return { getRange: celda, celda };
}

test('envio y reintentos: copian a JSON-WSO2 y la N enlaza la carpeta del caso', () => {
  const d = driveFalso([
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    json('e1', 'config.json', 'envio', 'A', '2026-09-01'),
    json('e2', 'tarifas.json', 'envio', 'B', '2026-09-01')
  ]);
  instalar(d);
  gs.obtenerCarpetaRaizId = () => RAIZ;
  gs.JSON_WSO2_INICIO_ACCION = 0;
  const hoja = sheetFalso({ 5: { caso: '9300' }, 6: { caso: '9300' } });
  gs.agregarJsonAFilas_(hoja, [5, 6], [urlArchivo(ID('e1')), urlArchivo(ID('e2'))]);
  [5, 6].forEach((r) => {
    assert.strictEqual(hoja.celda(r, gs.SHEET_COLS.ARCHIVOS_JSON).getValue(), 'JSON-WSO2/9300 (2 JSON)');
  });
  assert.strictEqual(d.items.filter((i) => i.name === 'config.json').length, 2, 'una copia por nombre, no una por fila');
});

test('envio sin tiempo: la N queda con los links y despues se conserva la carpeta', () => {
  const d = driveFalso([
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    json('e1', 'config.json', 'envio', 'A', '2026-09-01')
  ]);
  instalar(d);
  gs.obtenerCarpetaRaizId = () => RAIZ;
  const DateReal = gs.Date;
  let reloj = 1000000;
  gs.Date = { now: () => reloj };
  try {
    // Al envio le quedan menos de 8 s: no copia.
    gs.jsonWso2MarcarInicioAccion_();
    reloj += 25000;
    const hoja = sheetFalso({ 5: { caso: '9300' } });
    gs.agregarJsonAFilas_(hoja, [5], [urlArchivo(ID('e1'))]);
    assert.strictEqual(hoja.celda(5, gs.SHEET_COLS.ARCHIVOS_JSON).getValue(), urlArchivo(ID('e1')));
    // Una fila que ya tenia la carpeta (reintento anterior) y llega otro
    // JSON sin tiempo: la carpeta se queda y el link nuevo va debajo.
    const conCarpeta = sheetFalso({
      7: { caso: '9300', n: gs.jsonWso2Celda_({ url: 'https://carpeta', caso: '9300', total: 1 }, []) }
    });
    gs.agregarJsonAFilas_(conCarpeta, [7], [urlArchivo(ID('e1'))]);
    const n = conCarpeta.celda(7, gs.SHEET_COLS.ARCHIVOS_JSON);
    assert.strictEqual(n.getValue(), 'JSON-WSO2/9300 (1 JSON)\n' + urlArchivo(ID('e1')));
    assert.strictEqual(n.getRichTextValue().getRuns()[0].getLinkUrl(), 'https://carpeta');
  } finally {
    if (DateReal) gs.Date = DateReal; else delete gs.Date;
    gs.JSON_WSO2_INICIO_ACCION = 0;
  }
});
