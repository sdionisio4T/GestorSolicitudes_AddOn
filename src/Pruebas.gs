/**
 * Pruebas.gs: pruebas de viabilidad del índice de JSON.
 *
 * ARCHIVO TEMPORAL. No hacer commit. Se borra al terminar las pruebas.
 *
 * Se corren a mano desde el editor de Apps Script (elegir la función en el
 * desplegable y presionar Ejecutar). Solo trabajan sobre el Sheet y la
 * carpeta de prueba; nunca sobre los reales.
 *
 * Antes de correrlas, en el editor: Configuración del proyecto (engranaje),
 * Propiedades del script, agregar:
 *   TEST_SHEET_ID    ID del Sheet de prueba
 *   TEST_SHEET_TAB   Nombre de la pestaña con las solicitudes
 *   TEST_CARPETA_ID  ID de la carpeta raíz de prueba (dentro de la unidad compartida)
 *
 * Requiere el servicio avanzado de Drive (v3) activado en el manifiesto.
 */

var PRUEBAS_MAX_LOG = 60;

function leerConfigPruebas_() {
  var p = PropertiesService.getScriptProperties();
  var cfg = {
    sheetId: p.getProperty('TEST_SHEET_ID'),
    sheetTab: p.getProperty('TEST_SHEET_TAB'),
    carpetaId: p.getProperty('TEST_CARPETA_ID')
  };
  if (!cfg.sheetId || !cfg.sheetTab || !cfg.carpetaId) {
    throw new Error('Faltan propiedades del script: TEST_SHEET_ID, TEST_SHEET_TAB y TEST_CARPETA_ID.');
  }
  return cfg;
}

function listarTodo_(params) {
  var items = [];
  var paginas = 0;
  var incompleta = false;
  var token = null;
  do {
    var opts = {};
    for (var k in params) {
      if (params.hasOwnProperty(k)) opts[k] = params[k];
    }
    if (token) opts.pageToken = token;
    var resp = Drive.Files.list(opts);
    paginas++;
    if (resp.incompleteSearch) incompleta = true;
    items = items.concat(resp.files || []);
    token = resp.nextPageToken;
  } while (token);
  return { items: items, paginas: paginas, incompleta: incompleta };
}

/**
 * Lista carpetas y archivos de la unidad compartida donde está la raíz de
 * prueba y arma el árbol. Devuelve todo lo necesario para P2 y P3.
 */
function cargarArbol_(carpetaRaizId) {
  var raiz = Drive.Files.get(carpetaRaizId, { fields: 'id,name,driveId', supportsAllDrives: true });
  if (!raiz.driveId) {
    throw new Error('La carpeta raíz de prueba no está en una unidad compartida.');
  }

  var base = {
    corpora: 'drive',
    driveId: raiz.driveId,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 1000
  };

  var t0 = Date.now();
  var paramsCarpetas = Object.assign({}, base, {
    q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'nextPageToken,incompleteSearch,files(id,name,parents)'
  });
  var carpetas = listarTodo_(paramsCarpetas);
  var tCarpetas = Date.now() - t0;

  var t1 = Date.now();
  var paramsArchivos = Object.assign({}, base, {
    q: "mimeType != 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,size,modifiedTime,md5Checksum,shortcutDetails)'
  });
  var archivos = listarTodo_(paramsArchivos);
  var tArchivos = Date.now() - t1;

  var mapaCarpetas = {};
  carpetas.items.forEach(function(c) {
    mapaCarpetas[c.id] = { nombre: c.name, padre: (c.parents && c.parents[0]) || null };
  });

  return {
    raiz: raiz,
    carpetas: carpetas,
    archivos: archivos,
    mapaCarpetas: mapaCarpetas,
    tCarpetas: tCarpetas,
    tArchivos: tArchivos
  };
}

/**
 * Devuelve los nombres de carpeta desde la raíz hasta el padre directo, o
 * null si la carpeta no cuelga de la raíz.
 */
function rutaDesdeRaiz_(carpetaId, raizId, mapaCarpetas) {
  var nombres = [];
  var actual = carpetaId;
  var vueltas = 0;
  while (actual && vueltas < 50) {
    if (actual === raizId) return nombres.reverse();
    var info = mapaCarpetas[actual];
    if (!info) return null;
    nombres.push(info.nombre);
    actual = info.padre;
    vueltas++;
  }
  return null;
}

function cuelgaDe_(carpetaId, ancestroId, mapaCarpetas) {
  var actual = carpetaId;
  var vueltas = 0;
  while (actual && vueltas < 50) {
    if (actual === ancestroId) return true;
    var info = mapaCarpetas[actual];
    if (!info) return false;
    actual = info.padre;
    vueltas++;
  }
  return false;
}

/**
 * Interpreta la ruta de un JSON con las tres estructuras de carpetas que
 * conviven en la raíz: Servicio/Caso, SERVICIOS CAPA/[APIM/]Servicio/Caso y
 * [APIM/]Servicio/Caso.
 */
function clasificarRuta_(segmentos) {
  var s = segmentos.slice();
  var capaIntermedia = false;
  if (s[0] === 'SERVICIOS CAPA') {
    s.shift();
    capaIntermedia = true;
  }
  var rama = 'General';
  if (s[0] === 'APIM') {
    s.shift();
    rama = 'APIM';
  }
  if (s.length < 2) return null;
  var carpetaEnvio = s[1];
  return {
    rama: rama,
    servicio: s[0],
    carpetaEnvio: carpetaEnvio,
    caso: carpetaEnvio.replace(/_\d+$/, ''),
    resto: s.slice(2).join('/'),
    capaIntermedia: capaIntermedia
  };
}

function limpiarNombreServicio_(servicio) {
  return (String(servicio || '(sin servicio)')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()) || '(sin servicio)';
}

/**
 * P2: lista la unidad compartida, mide tiempos y cuenta los JSON con cada
 * criterio. Resultado en el registro de ejecución.
 */
function pruebaP2_listarRaiz() {
  var cfg = leerConfigPruebas_();
  var arbol = cargarArbol_(cfg.carpetaId);

  var jsonPorNombre = [];
  var tiposDeJson = {};
  var accesosDirectos = 0;
  var fueraDeRaiz = 0;

  arbol.archivos.items.forEach(function(f) {
    if (f.mimeType === 'application/vnd.google-apps.shortcut') accesosDirectos++;
    if (!/\.json$/i.test(f.name || '')) return;
    var padre = f.parents && f.parents[0];
    if (!cuelgaDe_(padre, cfg.carpetaId, arbol.mapaCarpetas)) {
      fueraDeRaiz++;
      return;
    }
    jsonPorNombre.push(f);
    tiposDeJson[f.mimeType] = (tiposDeJson[f.mimeType] || 0) + 1;
  });

  var t2 = Date.now();
  var porMime = listarTodo_({
    corpora: 'drive',
    driveId: arbol.raiz.driveId,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 1000,
    q: "mimeType = 'application/json' and trashed = false",
    fields: 'nextPageToken,incompleteSearch,files(id)'
  });
  var tMime = Date.now() - t2;

  var carpetasBajoRaiz = Object.keys(arbol.mapaCarpetas).filter(function(id) {
    return cuelgaDe_(id, cfg.carpetaId, arbol.mapaCarpetas);
  }).length;

  console.log('=== P2: listado de la unidad compartida ===');
  console.log('Raíz de prueba: ' + arbol.raiz.name + ' | ¿es la raíz de la unidad?: ' + (arbol.raiz.id === arbol.raiz.driveId));
  console.log('Carpetas en la unidad: ' + arbol.carpetas.items.length + ' (' + arbol.carpetas.paginas + ' páginas, ' + arbol.tCarpetas + ' ms, incompleta: ' + arbol.carpetas.incompleta + ')');
  console.log('Carpetas bajo la raíz: ' + carpetasBajoRaiz);
  console.log('Archivos en la unidad: ' + arbol.archivos.items.length + ' (' + arbol.archivos.paginas + ' páginas, ' + arbol.tArchivos + ' ms, incompleta: ' + arbol.archivos.incompleta + ')');
  console.log('JSON por nombre bajo la raíz: ' + jsonPorNombre.length + ' | fuera de la raíz: ' + fueraDeRaiz);
  console.log('Tipos de archivo de esos JSON: ' + JSON.stringify(tiposDeJson));
  console.log('JSON con mimeType application/json en toda la unidad: ' + porMime.items.length + ' (' + tMime + ' ms)');
  console.log('Accesos directos en la unidad: ' + accesosDirectos);
  console.log('Tiempo total de listado: ' + (arbol.tCarpetas + arbol.tArchivos) + ' ms');

  probarLargoConsulta_(arbol.raiz.driveId, Object.keys(arbol.mapaCarpetas));
}

/**
 * Parte de P2: mide cuántos "'id' in parents" acepta una sola consulta.
 */
function probarLargoConsulta_(driveId, idsCarpetas) {
  var tamanos = [10, 20, 40, 80, 160, 320];
  var maxOk = 0;
  for (var i = 0; i < tamanos.length; i++) {
    var n = tamanos[i];
    if (idsCarpetas.length < n) break;
    var q = '(' + idsCarpetas.slice(0, n).map(function(id) {
      return "'" + id + "' in parents";
    }).join(' or ') + ') and trashed = false';
    try {
      Drive.Files.list({
        corpora: 'drive',
        driveId: driveId,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageSize: 1,
        q: q,
        fields: 'files(id)'
      });
      maxOk = n;
      console.log('Consulta con ' + n + ' padres: OK (largo ' + q.length + ' caracteres)');
    } catch (err) {
      console.log('Consulta con ' + n + ' padres: FALLA (largo ' + q.length + '): ' + err.message);
      break;
    }
  }
  console.log('Máximo de padres por consulta probado sin error: ' + maxOk);
}

/**
 * P3: cruza cada fila del Sheet de prueba con los JSON del árbol.
 * Primero por la carpeta de la columna C; si no, por rama + servicio + caso.
 */
function pruebaP3_cruce() {
  var cfg = leerConfigPruebas_();
  var arbol = cargarArbol_(cfg.carpetaId);

  var jsons = [];
  arbol.archivos.items.forEach(function(f) {
    if (!/\.json$/i.test(f.name || '')) return;
    var padre = f.parents && f.parents[0];
    var segs = rutaDesdeRaiz_(padre, cfg.carpetaId, arbol.mapaCarpetas);
    if (!segs) return;
    jsons.push({ archivo: f, padre: padre, ruta: clasificarRuta_(segs) });
  });

  var porClave = {};
  var sinRuta = 0;
  jsons.forEach(function(j) {
    if (!j.ruta) {
      sinRuta++;
      return;
    }
    var clave = j.ruta.rama + '|' + j.ruta.servicio + '|' + j.ruta.caso;
    if (!porClave[clave]) porClave[clave] = { carpetas: {}, total: 0 };
    porClave[clave].carpetas[j.ruta.carpetaEnvio] = true;
    porClave[clave].total++;
  });

  var sheet = SpreadsheetApp.openById(cfg.sheetId).getSheetByName(cfg.sheetTab);
  if (!sheet) throw new Error('No existe la pestaña ' + cfg.sheetTab + ' en el Sheet de prueba.');
  var ultima = sheet.getLastRow();
  if (ultima < 2) throw new Error('El Sheet de prueba no tiene filas de datos.');

  var n = ultima - 1;
  var valores = sheet.getRange(2, 1, n, SHEET_NUM_COLS).getValues();
  var textoC = sheet.getRange(2, SHEET_COLS.DRIVE, n, 1).getRichTextValues();

  var resumen = { porCarpeta: 0, porRutaDirecto: 0, ambiguo: 0, sinJson: 0 };
  var lineas = [];

  for (var i = 0; i < n; i++) {
    var fila = valores[i];
    var caso = String(fila[SHEET_COLS.NUMERO_CASO - 1] || '').trim();
    if (!caso) continue;
    var servicio = String(fila[SHEET_COLS.SERVICIO - 1] || '');
    var componente = String(fila[SHEET_COLS.COMPONENTE - 1] || '');

    var carpetaC = null;
    textoC[i][0].getRuns().forEach(function(run) {
      var url = run.getLinkUrl();
      var parsed = url ? parsearIdDrive(url) : null;
      if (!carpetaC && parsed && arbol.mapaCarpetas[parsed.id] &&
          cuelgaDe_(parsed.id, cfg.carpetaId, arbol.mapaCarpetas)) {
        carpetaC = parsed.id;
      }
    });

    var resultado;
    if (carpetaC) {
      var deCarpeta = jsons.filter(function(j) {
        return cuelgaDe_(j.padre, carpetaC, arbol.mapaCarpetas);
      }).length;
      resultado = 'por carpeta (C): ' + deCarpeta + ' JSON';
      resumen.porCarpeta++;
    } else {
      var rama = esComponenteAPIM(componente) ? 'APIM' : 'General';
      var clave = rama + '|' + limpiarNombreServicio_(servicio) + '|' + caso;
      var info = porClave[clave];
      if (!info) {
        resultado = 'sin JSON (' + rama + ')';
        resumen.sinJson++;
      } else {
        var carpetasEnvio = Object.keys(info.carpetas);
        if (carpetasEnvio.length === 1) {
          resultado = 'por ruta: ' + info.total + ' JSON en ' + carpetasEnvio[0];
          resumen.porRutaDirecto++;
        } else {
          resultado = 'AMBIGUO: ' + info.total + ' JSON en ' + carpetasEnvio.join(', ');
          resumen.ambiguo++;
        }
      }
    }
    lineas.push('Fila ' + (i + 2) + ' | caso ' + caso + ' | ' + componente + ' | ' + resultado);
  }

  console.log('=== P3: cruce de filas con JSON ===');
  console.log('JSON bajo la raíz: ' + jsons.length + ' | con ruta no reconocida: ' + sinRuta);
  lineas.slice(0, PRUEBAS_MAX_LOG).forEach(function(l) { console.log(l); });
  if (lineas.length > PRUEBAS_MAX_LOG) console.log('... ' + (lineas.length - PRUEBAS_MAX_LOG) + ' filas más');
  console.log('Resumen: ' + JSON.stringify(resumen));
}

/**
 * P4: crea dos pestañas en el Sheet de prueba para comprobar que
 * IFNA + FILTER + HYPERLINK dejan links clicables. Revisar a mano.
 */
function pruebaP4_buscador() {
  var cfg = leerConfigPruebas_();
  var arbol = cargarArbol_(cfg.carpetaId);
  var ss = SpreadsheetApp.openById(cfg.sheetId);

  var filas = [];
  arbol.archivos.items.forEach(function(f) {
    if (!/\.json$/i.test(f.name || '')) return;
    var segs = rutaDesdeRaiz_(f.parents && f.parents[0], cfg.carpetaId, arbol.mapaCarpetas);
    var ruta = segs ? clasificarRuta_(segs) : null;
    if (!ruta) return;
    filas.push([ruta.servicio, ruta.caso, f.name, 'https://drive.google.com/file/d/' + f.id + '/view']);
  });
  if (filas.length === 0) throw new Error('No se encontraron JSON bajo la raíz de prueba.');

  var idx = ss.getSheetByName('Prueba Indice') || ss.insertSheet('Prueba Indice');
  idx.clear();
  idx.getRange(1, 1, 1, 4).setValues([['Servicio', 'Caso', 'Archivo', 'URL']]);
  idx.getRange(2, 1, filas.length, 4).setValues(filas);

  var bus = ss.getSheetByName('Prueba Buscador') || ss.insertSheet('Prueba Buscador');
  bus.clear();
  bus.getRange('A1').setValue('Servicio:');
  bus.getRange('B1').setValue(filas[0][0]);
  var servicios = Object.keys(filas.reduce(function(acc, f) { acc[f[0]] = true; return acc; }, {}));
  bus.getRange('B1').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(servicios, true).build()
  );
  bus.getRange('A3').setValue('Variante 1: ARRAYFORMULA');
  bus.getRange('A4').setFormula(
    "=IFNA(ARRAYFORMULA(HYPERLINK(FILTER('Prueba Indice'!D2:D, 'Prueba Indice'!A2:A=B1), " +
    "FILTER('Prueba Indice'!C2:C, 'Prueba Indice'!A2:A=B1))), \"Sin resultados\")"
  );
  bus.getRange('C3').setValue('Variante 2: MAP');
  bus.getRange('C4').setFormula(
    "=IFNA(MAP(FILTER('Prueba Indice'!D2:D, 'Prueba Indice'!A2:A=B1), " +
    "FILTER('Prueba Indice'!C2:C, 'Prueba Indice'!A2:A=B1), " +
    "LAMBDA(u, n, HYPERLINK(u, n))), \"Sin resultados\")"
  );
  bus.getRange('E3').setValue('Sin resultados (debe decir "Sin resultados")');
  bus.getRange('E4').setFormula(
    "=IFNA(FILTER('Prueba Indice'!C2:C, 'Prueba Indice'!A2:A=\"servicio que no existe\"), \"Sin resultados\")"
  );

  console.log('=== P4 ===');
  console.log(filas.length + ' JSON escritos en "Prueba Indice". Abre "Prueba Buscador", cambia el servicio en B1 y comprueba que los links de las columnas A y C abren el JSON.');
}

/**
 * P6 (parte 1): la corre el usuario A. Crea una pestaña con validación y
 * protección solo de advertencia.
 */
function pruebaP6_crearProteccion() {
  var cfg = leerConfigPruebas_();
  var ss = SpreadsheetApp.openById(cfg.sheetId);
  var hoja = ss.getSheetByName('Prueba Proteccion') || ss.insertSheet('Prueba Proteccion');
  hoja.clear();
  hoja.getRange('A1').setValue('Escrito por ' + Session.getEffectiveUser().getEmail() + ' el ' + new Date());
  hoja.getRange('B1').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['uno', 'dos'], true).build()
  );
  hoja.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function(p) { p.remove(); });
  hoja.protect().setDescription('Prueba P6').setWarningOnly(true);
  console.log('=== P6 parte 1: pestaña "Prueba Proteccion" creada con protección solo de advertencia. Ahora otro usuario debe correr pruebaP6_escribirComoOtroUsuario.');
}

/**
 * P6 (parte 2): la corre OTRO usuario con acceso al proyecto y al Sheet.
 */
function pruebaP6_escribirComoOtroUsuario() {
  var cfg = leerConfigPruebas_();
  var hoja = SpreadsheetApp.openById(cfg.sheetId).getSheetByName('Prueba Proteccion');
  if (!hoja) throw new Error('Primero corre pruebaP6_crearProteccion.');
  hoja.getRange('A2').setValue('Escrito por ' + Session.getEffectiveUser().getEmail() + ' el ' + new Date());
  console.log('=== P6 parte 2: escritura OK, la protección de advertencia no bloquea al script.');
}

/**
 * Borra las pestañas creadas por P4 y P6 en el Sheet de prueba.
 */
function limpiarPruebas() {
  var cfg = leerConfigPruebas_();
  var ss = SpreadsheetApp.openById(cfg.sheetId);
  ['Prueba Indice', 'Prueba Buscador', 'Prueba Proteccion'].forEach(function(nombre) {
    var h = ss.getSheetByName(nombre);
    if (h) ss.deleteSheet(h);
  });
  console.log('Pestañas de prueba borradas.');
}
