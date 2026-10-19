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
    setTrashed: (v) => { it.papelera = v; },
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
        return { id: it.id, name: it.name, mimeType: it.mimeType, parents: [it.padre], trashed: !!it.papelera, modifiedTime: it.modifiedTime, md5Checksum: it.md5Checksum };
      },
      create: (r) => {
        const nueva = { id: nuevoId(), name: r.name, mimeType: r.mimeType, padre: r.parents[0] };
        items.push(nueva);
        return { id: nueva.id };
      },
      copy: (r, id) => {
        const it = buscar(id);
        if (!it || it.sinAcceso) throw new Error('Sin acceso');
        const copia = { ...it, id: nuevoId(), name: r.name, padre: r.parents[0], descripcion: r.description || '' };
        items.push(copia);
        return { id: copia.id };
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
  assert.strictEqual(gs.jsonWso2TextoCarpeta_('9300_PROD', 2), 'JSON-WSO2/9300_PROD (2 JSON)');
  assert.strictEqual(gs.jsonWso2EsLineaCarpeta_('JSON-WSO2/9300_PROD (2 JSON)'), true);
  assert.strictEqual(gs.jsonWso2EsLineaCarpeta_('  JSON-WSO2/9300_SIN_AMBIENTE (12 JSON) '), true);
  // La de antes, solo por caso, tambien se reconoce.
  assert.strictEqual(gs.jsonWso2EsLineaCarpeta_('JSON-WSO2/9300 (2 JSON)'), true);
  assert.strictEqual(gs.jsonWso2EsLineaCarpeta_('Sin carpeta ni link'), false);
  assert.strictEqual(gs.jsonWso2EsLineaCarpeta_('https://drive.google.com/file/d/x/view'), false);
  assert.deepStrictEqual(plano(gs.jsonWso2LeerLinea_('JSON-WSO2/9300_PREPROD (3 JSON)')),
    { nombre: '9300_PREPROD', caso: '9300', ambiente: 'PREPROD', total: 3, vieja: false });
  assert.deepStrictEqual(plano(gs.jsonWso2LeerLinea_('JSON-WSO2/9300 (2 JSON)')),
    { nombre: '9300', caso: '9300', ambiente: '', total: 2, vieja: true });
  assert.strictEqual(gs.jsonWso2LeerLinea_('otra cosa'), null);
});

test('nombre de la carpeta: caso y codigo del ambiente de la columna F', () => {
  const n = (amb) => gs.jsonWso2NombreCarpeta_('9300', amb);
  assert.strictEqual(n('Producción'), '9300_PROD');
  assert.strictEqual(n('Preproducción'), '9300_PREPROD');
  assert.strictEqual(n('Pruebas'), '9300_PRUEBAS');
  assert.strictEqual(n('  produccion '), '9300_PROD', 'sin tilde ni mayusculas');
  assert.strictEqual(n(''), '9300_SIN_AMBIENTE');
  assert.strictEqual(n('Otro'), '9300_SIN_AMBIENTE');
});

test('ids de los links a archivos de la columna N', () => {
  assert.deepStrictEqual(plano(gs.jsonWso2IdsDeUrls_([
    urlArchivo(ID('a')), 'https://drive.google.com/open?id=' + ID('b'), urlArchivo(ID('a')), 'https://otra.cosa/'
  ])), [ID('a'), ID('b')]);
});

test('uno por camino: mismo camino queda el mas reciente; otro camino, los dos', () => {
  const r = gs.jsonWso2UnoPorCamino_([
    { id: 'a', nombre: 'config.json', ruta: [], modificado: '2026-09-01' },
    { id: 'b', nombre: 'api.json', ruta: ['v1.0', 'docs'], modificado: '2026-09-01' },
    { id: 'c', nombre: 'config.json', ruta: [], modificado: '2026-09-05' },
    { id: 'd', nombre: 'api.json', ruta: ['v1.0.1', 'docs'], modificado: '2026-08-01' }
  ]);
  assert.deepStrictEqual(plano(r.map((x) => x.id)), ['c', 'b', 'd']);
  assert.strictEqual(gs.jsonWso2Clave_({ nombre: 'api.json', ruta: ['v1.0', 'docs'] }), 'v1.0/docs/api.json');
});

test('celda de la N: carpeta con su link y debajo los que no se copiaron', () => {
  const rich = gs.jsonWso2Celda_({ url: 'https://carpeta', nombre: '9300_PROD', total: 2 }, ['https://drive.google.com/file/d/p/view']);
  assert.strictEqual(rich.getText(), 'JSON-WSO2/9300_PROD (2 JSON)\nhttps://drive.google.com/file/d/p/view');
  const runs = rich.getRuns().filter((r) => r.getLinkUrl());
  assert.deepStrictEqual(runs.map((r) => [r.getText(), r.getLinkUrl()]),
    [['JSON-WSO2/9300_PROD (2 JSON)', 'https://carpeta'], ['https://drive.google.com/file/d/p/view', 'https://drive.google.com/file/d/p/view']]);
});

test('copiar al caso: crea JSON-WSO2/<caso>_<ambiente>, uno por nombre, y no duplica', () => {
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
  const r = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '09300', 'Producción', archivos, sinLimite));
  assert.strictEqual(r.carpeta.caso, '9300');
  assert.strictEqual(r.carpeta.nombre, '9300_PROD');
  assert.strictEqual(r.carpeta.total, 2);
  assert.deepStrictEqual(r.pendientes, []);
  const principal = d.items.find((i) => i.name === 'JSON-WSO2');
  assert.strictEqual(principal.padre, RAIZ);
  assert.ok(Object.values(props).includes(principal.id));
  const delCaso = d.items.find((i) => i.name === '9300_PROD' && i.padre === principal.id);
  assert.strictEqual(d.items.filter((i) => i.padre === delCaso.id).length, 2);
  // Otra fila del mismo caso y ambiente con el mismo JSON: no se copia otra vez.
  const otra = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', 'Producción', archivos.slice(0, 1), sinLimite));
  assert.strictEqual(otra.carpeta.total, 2);
  assert.strictEqual(d.items.filter((i) => i.padre === delCaso.id).length, 2);
  assert.strictEqual(d.items.filter((i) => i.name === '9300_PROD').length, 1);
  // Otro ambiente del mismo caso: su propia carpeta y su propia copia.
  const pruebas = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', 'Pruebas', archivos.slice(0, 1), sinLimite));
  assert.strictEqual(pruebas.carpeta.nombre, '9300_PRUEBAS');
  assert.strictEqual(pruebas.carpeta.total, 1);
  assert.strictEqual(d.items.filter((i) => i.name === 'config.json' && i.padre !== 'otra').length, 2);
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
  gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', 'Producción', a('viejo', '2026-09-01', 'A'), sinLimite);
  const copia = () => d.items.find((i) => i.name === 'config.json' && i.descripcion !== undefined && i.padre !== 'otra');
  const idCopia = copia().id;
  gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', 'Producción', a('nuevo', '2026-09-10', 'B'), sinLimite);
  assert.strictEqual(copia().contenido, 'c-B');
  assert.strictEqual(copia().id, idCopia, 'se reemplaza el contenido sobre el mismo archivo');
  gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', 'Producción', a('antiguo', '2026-08-01', 'C'), sinLimite);
  assert.strictEqual(copia().contenido, 'c-B', 'uno mas viejo no reemplaza');
});

test('copiar al caso: sin tiempo queda pendiente; sin acceso, fallido', () => {
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
  const conAcceso = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', 'Producción', archivos, sinLimite));
  // Sin acceso es un error (fallidos); sin tiempo, solo queda pendiente.
  assert.deepStrictEqual(conAcceso.fallidos, [ID('j2')]);
  assert.deepStrictEqual(conAcceso.pendientes, []);
  assert.strictEqual(conAcceso.carpeta.total, 1);
  const sinTiempo = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '7799', 'Producción', archivos, () => 0));
  assert.deepStrictEqual(sinTiempo.pendientes, [ID('j1'), ID('j2')]);
  assert.deepStrictEqual(sinTiempo.fallidos, []);
  assert.strictEqual(sinTiempo.carpeta.total, 0);
  assert.strictEqual(gs.jsonWso2CopiarAlCaso_(RAIZ, 'abc', 'Producción', archivos, sinLimite), null);
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
  const linea = 'JSON-WSO2/9300_PROD (2 JSON)';
  const celda = plano(gs.indiceAnalizarCeldaN_(linea + '\nhttps://drive.google.com/file/d/x/view'));
  assert.deepStrictEqual(celda, { links: ['https://drive.google.com/file/d/x/view'], carpetas: [linea], motivos: [], viejas: [] });
  // La carpeta de antes (solo por caso) tambien cuenta como lista para las
  // busquedas, pero queda anotada para "Pasar".
  const vieja = plano(gs.indiceAnalizarCeldaN_('JSON-WSO2/9300 (2 JSON)'));
  assert.deepStrictEqual(vieja.viejas, ['JSON-WSO2/9300 (2 JSON)']);
  assert.strictEqual(gs.indiceDecidirCeldaN_(linea, { links: ['https://y'], motivo: null }, true).accion, 'nada');
  const filas = [
    { fila: 2, textoN: linea, textoO: 'x' },
    { fila: 3, textoN: '', textoO: 'x' },
    { fila: 4, textoN: 'Sin carpeta ni link', textoO: 'x' }
  ];
  assert.deepStrictEqual(plano(gs.indiceElegirFilas_(filas, 0, null).map((f) => f.fila)), [3, 4]);
});

test('filas por pasar: links a archivos o la carpeta de antes en la N', () => {
  assert.strictEqual(gs.indiceContarPorPasar_([
    ['https://drive.google.com/file/d/a/view'],
    ['JSON-WSO2/9300_PROD (1 JSON)'],
    ['JSON-WSO2/9300_PROD (1 JSON)\nhttps://drive.google.com/file/d/b/view'],
    ['JSON-WSO2/7799 (2 JSON)'],
    ['Sin carpeta ni link'],
    ['']
  ]), 3);
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
    celdas[clave(r, gs.SHEET_COLS.AMBIENTE)] = { valor: filas[r].ambiente || '' };
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
  const hoja = sheetFalso({ 5: { caso: '9300', ambiente: 'Pruebas' }, 6: { caso: '9300', ambiente: 'Pruebas' } });
  gs.agregarJsonAFilas_(hoja, [5, 6], [urlArchivo(ID('e1')), urlArchivo(ID('e2'))]);
  [5, 6].forEach((r) => {
    assert.strictEqual(hoja.celda(r, gs.SHEET_COLS.ARCHIVOS_JSON).getValue(), 'JSON-WSO2/9300_PRUEBAS (2 JSON)');
  });
  assert.strictEqual(d.items.filter((i) => i.name === 'config.json').length, 2, 'una copia por nombre, no una por fila');
});

test('envio: una fila con la carpeta de antes la conserva y deja los links para "Pasar"', () => {
  const d = driveFalso([
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    json('e1', 'config.json', 'envio', 'A', '2026-09-01')
  ]);
  instalar(d);
  gs.obtenerCarpetaRaizId = () => RAIZ;
  gs.JSON_WSO2_INICIO_ACCION = 0;
  const hoja = sheetFalso({
    5: { caso: '9300', ambiente: 'Producción', n: gs.jsonWso2Celda_({ url: 'https://vieja', nombre: '9300', total: 2 }, []) }
  });
  gs.agregarJsonAFilas_(hoja, [5], [urlArchivo(ID('e1'))]);
  const n = hoja.celda(5, gs.SHEET_COLS.ARCHIVOS_JSON);
  assert.strictEqual(n.getValue(), 'JSON-WSO2/9300 (2 JSON)\n' + urlArchivo(ID('e1')));
  assert.strictEqual(n.getRichTextValue().getRuns()[0].getLinkUrl(), 'https://vieja');
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
      7: { caso: '9300', ambiente: 'Producción', n: gs.jsonWso2Celda_({ url: 'https://carpeta', nombre: '9300_PROD', total: 1 }, []) }
    });
    gs.agregarJsonAFilas_(conCarpeta, [7], [urlArchivo(ID('e1'))]);
    const n = conCarpeta.celda(7, gs.SHEET_COLS.ARCHIVOS_JSON);
    assert.strictEqual(n.getValue(), 'JSON-WSO2/9300_PROD (1 JSON)\n' + urlArchivo(ID('e1')));
    assert.strictEqual(n.getRichTextValue().getRuns()[0].getLinkUrl(), 'https://carpeta');
  } finally {
    if (DateReal) gs.Date = DateReal; else delete gs.Date;
    gs.JSON_WSO2_INICIO_ACCION = 0;
  }
});

test('copiar al caso: repite las subcarpetas y no pierde versiones con el mismo nombre', () => {
  const d = driveFalso([
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    json('v10', 'api.json', 'otra', 'A', '2026-09-01'),
    json('v101', 'api.json', 'otra', 'B', '2026-09-05')
  ]);
  instalar(d);
  const r = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '7799', 'Producción', [
    { id: ID('v10'), nombre: 'api.json', ruta: ['v1.0', 'EI', 'docs'], modificado: '2026-09-01', md5: 'A' },
    { id: ID('v101'), nombre: 'api.json', ruta: ['v1.0.1', 'EI', 'docs'], modificado: '2026-09-05', md5: 'B' }
  ], sinLimite));
  assert.strictEqual(r.carpeta.total, 2);
  const buscar = (id) => d.items.find((i) => i.id === id);
  const caminoDe = (it) => {
    const partes = [];
    let p = it.padre;
    while (p && buscar(p).name !== '7799_PROD') { partes.unshift(buscar(p).name); p = buscar(p).padre; }
    return partes.concat([it.name]).join('/');
  };
  const copias = d.items.filter((i) => i.name === 'api.json' && i.padre !== 'otra').map(caminoDe).sort();
  assert.deepStrictEqual(copias, ['v1.0.1/EI/docs/api.json', 'v1.0/EI/docs/api.json']);
  // Otra vez lo mismo: no se duplica nada.
  gs.jsonWso2CopiarAlCaso_(RAIZ, '7799', 'Producción', [
    { id: ID('v10'), nombre: 'api.json', ruta: ['v1.0', 'EI', 'docs'], modificado: '2026-09-01', md5: 'A' }
  ], sinLimite);
  assert.strictEqual(d.items.filter((i) => i.name === 'api.json' && i.padre !== 'otra').length, 2);
  assert.strictEqual(d.items.filter((i) => i.name === 'EI').length, 2);
});

test('camino dentro del caso: desde la carpeta del caso o desde la carpeta enlazada en la fila', () => {
  const d = driveFalso([
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    { id: ID('srv'), name: 'Documentacion WSO2', mimeType: CARP, padre: RAIZ },
    { id: ID('caso'), name: '7799_2', mimeType: CARP, padre: ID('srv') },
    { id: ID('v'), name: 'v1.0.1', mimeType: CARP, padre: ID('caso') },
    { id: ID('ei'), name: 'EI', mimeType: CARP, padre: ID('v') },
    json('j1', 'api.json', ID('ei'), 'A', '2026-09-01'),
    json('j0', 'suelto.json', ID('caso'), 'B', '2026-09-01'),
    { id: ID('entrega'), name: 'Entrega', mimeType: CARP, padre: 'otraPersona' },
    { id: ID('docs'), name: 'docs', mimeType: CARP, padre: ID('entrega') },
    json('j2', 'orig.json', ID('docs'), 'C', '2026-09-01'),
    { id: ID('pdf'), name: 'manual.pdf', mimeType: 'application/pdf', padre: ID('caso') }
  ]);
  instalar(d);
  const r = plano(gs.jsonWso2LeerArchivos_([ID('j1'), ID('j0'), ID('j2'), ID('pdf'), ID('borrado')], '7799', [ID('entrega')]));
  assert.deepStrictEqual(r.archivos.map((a) => [a.nombre, a.ruta.join('/')]),
    [['api.json', 'v1.0.1/EI'], ['suelto.json', ''], ['orig.json', 'docs']]);
  assert.deepStrictEqual(r.noLeidos, [ID('pdf'), ID('borrado')]);
});

test('busqueda: si el caso ya tiene sus JSON en JSON-WSO2, pone esa carpeta en vez del motivo', () => {
  const d = driveFalso([
    { id: ID('c9300'), name: '9300_PROD', mimeType: CARP, padre: 'wso2' },
    { id: ID('sub'), name: 'docs', mimeType: CARP, padre: ID('c9300') },
    json('copia', 'api.json', ID('sub'), 'A', '2026-09-01'),
    { id: ID('vacia'), name: '5555_PROD', mimeType: CARP, padre: 'wso2' },
    { id: ID('v7799'), name: '7799', mimeType: CARP, padre: 'wso2' },
    json('copia2', 'b.json', ID('v7799'), 'B', '2026-09-01')
  ]);
  instalar(d);
  const casos = {
    '9300_PROD': { id: ID('c9300'), url: 'https://c9300' },
    '5555_PROD': { id: ID('vacia'), url: 'https://vacia' },
    7799: { id: ID('v7799'), url: 'https://v7799' }
  };
  const motivo = { links: [], motivo: 'Sin carpeta ni link' };
  const r = gs.indiceResultadoDesdeWso2_(motivo, '9300', 'Producción', casos);
  assert.deepStrictEqual(plano(r.links), ['https://c9300']);
  assert.strictEqual(r.celda.getText(), 'JSON-WSO2/9300_PROD (1 JSON)');
  // Otro ambiente del caso no tiene carpeta: queda el motivo.
  assert.strictEqual(gs.indiceResultadoDesdeWso2_(motivo, '9300', 'Pruebas', casos), motivo);
  // Sin la de su ambiente, usa la de antes (solo por caso); "Pasar" la pasa despues.
  assert.strictEqual(gs.indiceResultadoDesdeWso2_(motivo, '7799', 'Pruebas', casos).celda.getText(), 'JSON-WSO2/7799 (1 JSON)');
  // Carpeta vacia, sin carpeta o con links propios: queda como estaba.
  assert.strictEqual(gs.indiceResultadoDesdeWso2_(motivo, '5555', 'Producción', casos), motivo);
  assert.strictEqual(gs.indiceResultadoDesdeWso2_(motivo, '4444', 'Producción', casos), motivo);
  const conLinks = { links: ['https://x'], motivo: null };
  assert.strictEqual(gs.indiceResultadoDesdeWso2_(conLinks, '9300', 'Producción', casos), conLinks);
});

test('busqueda: la fila cuya carpeta de JSON-WSO2 ya no existe se vuelve a buscar', () => {
  const casos = { '9300_PROD': { id: 'x', url: 'u' } };
  const filas = [
    { fila: 2, textoN: 'JSON-WSO2/9300_PROD (2 JSON)', textoO: 'x' },
    { fila: 3, textoN: 'JSON-WSO2/7799_PROD (1 JSON)', textoO: 'x' }
  ];
  const lista = plano(gs.indiceElegirFilas_(filas, 0, null, casos).map((f) => [f.fila, f.necesitaN, f.reparar]));
  assert.deepStrictEqual(lista, [[3, true, true]]);
  // Sin la lista de JSON-WSO2 (no se pudo leer): no se repara nada.
  assert.deepStrictEqual(plano(gs.indiceElegirFilas_(filas, 0, null, null)), []);
});

test('textos de la seccion Activadores', () => {
  const ahora = 100 * 60 * 1000;
  gs.formatearHoraIndice_ = () => '12:38:00';
  const t = (nota, de, total) => gs.indiceTextoActivadores_(nota, de, total, ahora);
  assert.strictEqual(t(null, 0, 3), 'Sin tareas programadas de esta búsqueda; 3 en total (máximo ' +
    gs.REINTENTOS_CONFIG.MAX_TRIGGERS_ACTIVOS + ').');
  assert.ok(t({ etapa: 'buscando', activador: { estado: 'programado', en: ahora - 1000, desde: 'panel de Sheets' } }, 1, 3)
    .startsWith('Siguiente parte: arranca en unos segundos (la dejó lista un clic en el panel).'));
  assert.ok(t({ etapa: 'buscando', activador: { estado: 'a_la_hora', en: ahora + 3600000, desde: 'activador' } }, 1, 3)
    .includes('Presiona "Ver avance" para adelantarla (la programó la parte anterior).'));
  assert.ok(t({ etapa: 'buscando', activador: { estado: 'sin_cupo', en: ahora, desde: 'activador' } }, 0, 20)
    .includes('hay demasiadas tareas programadas'));
  assert.strictEqual(t(null, 0, -1), 'No se pudieron leer las tareas programadas.');
});

// Hoja completa (columnas A a O) para "Buscar en filas": lee valores y
// texto enriquecido, y escribe la N y la O.
function hojaCompleta(filas) {
  const N = gs.SHEET_COLS.ARCHIVOS_JSON;
  const O = gs.INDICE_COL_CARPETA;
  const datos = [new Array(O).fill('')];
  datos[0][0] = 'Número de caso';
  filas.forEach((f) => {
    const r = new Array(O).fill('');
    r[gs.SHEET_COLS.NUMERO_CASO - 1] = f.caso;
    r[gs.SHEET_COLS.SERVICIO - 1] = f.servicio || 'Pagos';
    r[gs.SHEET_COLS.AMBIENTE - 1] = f.ambiente || 'Producción';
    r[gs.SHEET_COLS.COMPONENTE - 1] = f.componente || 'ESB';
    r[N - 1] = f.n || '';
    datos.push(r);
  });
  const rich = (t) => gs.SpreadsheetApp.newRichTextValue().setText(String(t)).build();
  const hoja = {
    getLastRow: () => datos.length,
    getRange(fila, col, nFilas = 1, nCols = 1) {
      const filasDe = (fn) => Array.from({ length: nFilas }, (_, i) =>
        Array.from({ length: nCols }, (_, j) => fn(datos[fila - 1 + i][col - 1 + j] ?? '')));
      return {
        getValues: () => filasDe((v) => v),
        getRichTextValues: () => filasDe(rich),
        getValue: () => datos[fila - 1][col - 1] ?? '',
        setValue(v) { datos[fila - 1][col - 1] = v; return this; },
        setFontWeight() { return this; },
        setWrapStrategy() { return this; },
        setHorizontalAlignment() { return this; },
        setRichTextValues(valores) {
          valores.forEach((v, i) => { datos[fila - 1 + i][col - 1] = v[0].getText(); });
        }
      };
    }
  };
  gs.SpreadsheetApp.openById = () => ({ getSheetByName: () => hoja });
  gs.SpreadsheetApp.WrapStrategy = { CLIP: 'CLIP' };
  gs.SpreadsheetApp.flush = () => {};
  gs.obtenerSheetTab = () => 'Solicitudes';
  gs.obtenerCarpetaRaizId = () => RAIZ;
  gs.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };
  return { n: (r) => datos[r - 1][N - 1], o: (r) => datos[r - 1][O - 1] };
}

function raizDeFilas() {
  return [
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    { id: ID('pagos'), name: 'Pagos', mimeType: CARP, padre: RAIZ },
    { id: ID('p9300'), name: '9300', mimeType: CARP, padre: ID('pagos') },
    { id: ID('v10'), name: 'v1.0', mimeType: CARP, padre: ID('p9300') },
    json('cfg', 'config.json', ID('v10'), 'A', '2026-09-01'),
    json('tar', 'tarifas.json', ID('p9300'), 'B', '2026-09-01'),
    { id: ID('p7799'), name: '7799', mimeType: CARP, padre: ID('pagos') },
    json('api', 'api.json', ID('p7799'), 'C', '2026-09-01')
  ];
}

test('buscar en filas: copia lo encontrado a JSON-WSO2 y pasa las filas con links', () => {
  const d = driveFalso(raizDeFilas());
  instalar(d);
  const h = hojaCompleta([
    { caso: '9300' },                           // 2: vacia, su carpeta tiene 2 JSON
    { caso: '9300', ambiente: 'Pruebas' },      // 3: mismo caso, otro ambiente: su propia copia
    { caso: '7799', n: urlArchivo(ID('api')) }, // 4: ya tenia el link: se pasa
    { caso: '4444' },                           // 5: sin carpeta: motivo, sin copiar
    { caso: '9300' }                            // 6: mismo caso y ambiente que la 2: no copia de nuevo
  ]);
  const res = plano(gs.indiceBuscarEnFilas_('sheet', { desde: 2, hasta: 6 }));
  assert.strictEqual(h.n(2), 'JSON-WSO2/9300_PROD (2 JSON)');
  assert.strictEqual(h.n(3), 'JSON-WSO2/9300_PRUEBAS (2 JSON)');
  assert.strictEqual(h.n(6), 'JSON-WSO2/9300_PROD (2 JSON)');
  assert.strictEqual(h.o(2), 'Pagos/9300');
  assert.strictEqual(h.n(4), 'JSON-WSO2/7799_PROD (1 JSON)');
  assert.strictEqual(h.n(5), 'Sin carpeta ni link');
  assert.strictEqual(d.items.filter((i) => i.name === 'config.json').length, 3, 'el original y una copia por ambiente');
  const wso2 = d.items.find((i) => i.name === 'JSON-WSO2');
  assert.ok(!d.items.some((i) => /^4444/.test(i.name) && i.padre === wso2.id), 'sin JSON no se crea la carpeta del caso');
  // La copia repite las subcarpetas del caso.
  const v10Copia = d.items.find((i) => i.name === 'v1.0' && i.padre !== ID('p9300'));
  assert.ok(d.items.some((i) => i.name === 'config.json' && i.padre === v10Copia.id));
  assert.strictEqual(res.faltaDesde, null);
  assert.strictEqual(gs.indiceTextoResultadoFilas_({ desde: 2, hasta: 6 }, res),
    'Filas 2 a 6: 3 con JSON, 1 pasada(s) a JSON-WSO2, 1 sin JSON (con su motivo), 3 con carpeta en la columna O.');
});

test('carpetas de antes: se pasan a la carpeta del ambiente de cada fila y despues van a la papelera', () => {
  const items = raizDeFilas();
  items.push(
    { id: ID('wso2'), name: 'JSON-WSO2', mimeType: CARP, padre: RAIZ },
    { id: ID('viejo'), name: '9300', mimeType: CARP, padre: ID('wso2') },
    { id: ID('vsub'), name: 'v1.0', mimeType: CARP, padre: ID('viejo') },
    json('cv', 'config.json', ID('vsub'), 'A', '2026-09-03', { descripcion: 'Copia de ' + ID('cfg') + '; modificado:2026-09-01' })
  );
  const d = driveFalso(items);
  instalar(d);
  const vieja = 'JSON-WSO2/9300 (1 JSON)';
  const h = hojaCompleta([
    { caso: '9300', n: vieja },
    { caso: '9300', ambiente: 'Pruebas', n: vieja }
  ]);
  const viejo = () => d.items.find((i) => i.id === ID('viejo'));

  // Solo la fila 2: la 3 todavia enlaza la carpeta de antes, no se borra.
  gs.indiceBuscarEnFilas_('sheet', { desde: 2, hasta: 2 });
  assert.strictEqual(h.n(2), 'JSON-WSO2/9300_PROD (1 JSON)');
  assert.strictEqual(h.n(3), vieja);
  assert.ok(!viejo().papelera);

  // La fila 3: ya ninguna la enlaza, va a la papelera.
  const res = plano(gs.indiceBuscarEnFilas_('sheet', { desde: 3, hasta: 3 }));
  assert.strictEqual(h.n(3), 'JSON-WSO2/9300_PRUEBAS (1 JSON)');
  assert.strictEqual(viejo().papelera, true);
  assert.ok(gs.indiceTextoResultadoFilas_({ desde: 3, hasta: 3 }, res).includes('1 carpeta(s) de antes a la papelera'));

  // Cada copia nueva repite el camino y conserva de que original salio.
  const nuevas = d.items.filter((i) => i.name === 'config.json' && i.padre !== ID('v10') && i.padre !== ID('vsub'));
  assert.strictEqual(nuevas.length, 2);
  nuevas.forEach((c) => {
    assert.strictEqual(d.items.find((i) => i.id === c.padre).name, 'v1.0');
    assert.strictEqual(c.descripcion, 'Copia de ' + ID('cfg') + '; modificado:2026-09-01');
  });
});

test('buscar en filas: sin tiempo para copiar deja los links y "Continuar" los pasa', () => {
  const d = driveFalso(raizDeFilas());
  instalar(d);
  const h = hojaCompleta([{ caso: '9300' }, { caso: '7799' }]);
  const DateReal = gs.Date;
  let reloj = 1000000;
  gs.Date = { now: () => reloj };
  const copiar = d.Drive.Files.copy;
  try {
    // La primera copia se lleva el tiempo que queda.
    d.Drive.Files.copy = (r, id) => { reloj += 16000; return copiar(r, id); };
    const res = plano(gs.indiceBuscarEnFilas_('sheet', { desde: 2, hasta: 3 }));
    assert.strictEqual(res.faltaDesde, 2);
    assert.deepStrictEqual(h.n(2).split('\n').sort(), [urlArchivo(ID('cfg')), urlArchivo(ID('tar'))].sort());
    assert.strictEqual(h.n(3), '', 'la fila siguiente no se toco');
    assert.ok(gs.indiceTextoResultadoFilas_({ desde: 2, hasta: 3 }, res).includes('falta desde la fila 2'));

    // "Continuar": desde la fila que falto, con tiempo.
    d.Drive.Files.copy = copiar;
    const sigue = plano(gs.indiceBuscarEnFilas_('sheet', { desde: 2, hasta: 3 }));
    assert.strictEqual(sigue.faltaDesde, null);
    assert.strictEqual(h.n(2), 'JSON-WSO2/9300_PROD (2 JSON)');
    assert.strictEqual(h.n(3), 'JSON-WSO2/7799_PROD (1 JSON)');
    assert.strictEqual(d.items.filter((i) => i.name === 'config.json').length + d.items.filter((i) => i.name === 'tarifas.json').length, 4,
      'lo copiado antes no se duplica');
  } finally {
    d.Drive.Files.copy = copiar;
    if (DateReal) gs.Date = DateReal; else delete gs.Date;
  }
});

test('buscar en filas: un JSON sin acceso deja la fila con su link y lo cuenta', () => {
  const items = raizDeFilas();
  items.push({ id: ID('ajena'), name: 'privado.json', mimeType: 'application/json', padre: 'otra', sinAcceso: true });
  const d = driveFalso(items);
  instalar(d);
  const h = hojaCompleta([{ caso: '5555', n: urlArchivo(ID('ajena')) }]);
  const res = plano(gs.indiceBuscarEnFilas_('sheet', { desde: 2, hasta: 2 }));
  assert.strictEqual(h.n(2), urlArchivo(ID('ajena')));
  assert.strictEqual(res.noCopiadas, 1);
  assert.strictEqual(gs.indiceTextoResultadoFilas_({ desde: 2, hasta: 2 }, res),
    'Fila 2: 1 con JSON sin copiar a JSON-WSO2 (quedan en "Pasar").');
});

test('copiar varias filas con la misma memoria: no repite consultas a JSON-WSO2', () => {
  const d = driveFalso([
    { id: RAIZ, name: 'Raiz', mimeType: CARP, padre: 'mi' },
    json('a', 'a.json', 'otra', 'A', '2026-09-01'),
    json('b', 'b.json', 'otra', 'B', '2026-09-01')
  ]);
  instalar(d);
  let listados = 0;
  const listar = d.Drive.Files.list;
  d.Drive.Files.list = (p) => { listados++; return listar(p); };
  const memo = gs.jsonWso2NuevaMemoria_();
  const a = (id, n) => [{ id: ID(id), nombre: n, ruta: [], modificado: '2026-09-01', md5: id.toUpperCase() }];
  gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', 'Producción', a('a', 'a.json'), sinLimite, memo);
  const primera = listados;
  const r = plano(gs.jsonWso2CopiarAlCaso_(RAIZ, '9300', 'Producción', a('b', 'b.json'), sinLimite, memo));
  assert.strictEqual(listados, primera, 'la segunda fila del caso no vuelve a listar nada');
  assert.strictEqual(r.carpeta.total, 2);
  // La copia lleva su descripcion en la misma consulta.
  assert.ok(d.items.find((i) => i.name === 'b.json' && i.padre !== 'otra').descripcion.startsWith('Copia de '));
});
