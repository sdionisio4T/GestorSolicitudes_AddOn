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

// La consulta agrupada ('a' in parents or 'b' in parents ...) pierde
// archivos sin avisar (P3c): se recorre una carpeta por consulta.
var PRUEBAS_PADRES_POR_CONSULTA = 1;
var CARPETA_MIME = 'application/vnd.google-apps.folder';

/**
 * Parámetros comunes de Drive.Files.list según dónde esté la raíz:
 * unidad compartida (corpora=drive) o Mi unidad (corpora=user).
 */
function parametrosBase_(raiz) {
  var base = {
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 1000
  };
  if (raiz.driveId) {
    base.corpora = 'drive';
    base.driveId = raiz.driveId;
  } else {
    base.corpora = 'user';
  }
  return base;
}

/**
 * Lista carpetas y archivos bajo la raíz de prueba y arma el árbol.
 * Unidad compartida: dos consultas sobre toda la unidad.
 * Mi unidad: recorrido por niveles, agrupando varios padres por consulta.
 */
function cargarArbol_(carpetaRaizId, padresPorConsulta) {
  var raiz = Drive.Files.get(carpetaRaizId, { fields: 'id,name,driveId', supportsAllDrives: true });
  return raiz.driveId
    ? cargarArbolUnidadCompartida_(raiz)
    : cargarArbolMiUnidad_(raiz, padresPorConsulta || PRUEBAS_PADRES_POR_CONSULTA);
}

function cargarArbolMiUnidad_(raiz, padresPorConsulta) {
  var base = parametrosBase_(raiz);
  var carpetas = { items: [], paginas: 0, incompleta: false };
  var archivos = { items: [], paginas: 0, incompleta: false };
  var mapaCarpetas = {};
  var pendientes = [raiz.id];
  var niveles = 0;

  var t0 = Date.now();
  while (pendientes.length > 0) {
    niveles++;
    var siguientes = [];
    for (var i = 0; i < pendientes.length; i += padresPorConsulta) {
      var grupo = pendientes.slice(i, i + padresPorConsulta);
      var q = '(' + grupo.map(function(id) {
        return "'" + id + "' in parents";
      }).join(' or ') + ') and trashed = false';
      var res = listarTodo_(Object.assign({}, base, {
        q: q,
        fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,size,modifiedTime,md5Checksum,shortcutDetails)'
      }));
      if (res.incompleta) {
        carpetas.incompleta = true;
        archivos.incompleta = true;
      }
      carpetas.paginas += res.paginas;
      res.items.forEach(function(f) {
        if (f.mimeType === CARPETA_MIME) {
          carpetas.items.push(f);
          var padre = (f.parents || []).filter(function(p) { return grupo.indexOf(p) !== -1; })[0] ||
            (f.parents && f.parents[0]) || null;
          mapaCarpetas[f.id] = { nombre: f.name, padre: padre };
          siguientes.push(f.id);
        } else {
          archivos.items.push(f);
        }
      });
    }
    pendientes = siguientes;
  }
  var tTotal = Date.now() - t0;
  console.log('Modo Mi unidad: ' + niveles + ' niveles recorridos, ' + carpetas.paginas + ' consultas.');

  return {
    raiz: raiz,
    carpetas: carpetas,
    archivos: archivos,
    mapaCarpetas: mapaCarpetas,
    tCarpetas: tTotal,
    tArchivos: 0
  };
}

function cargarArbolUnidadCompartida_(raiz) {
  var base = parametrosBase_(raiz);

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

  var carpetasBajoRaiz = Object.keys(arbol.mapaCarpetas).filter(function(id) {
    return cuelgaDe_(id, cfg.carpetaId, arbol.mapaCarpetas);
  }).length;
  var jsonConMimeJson = jsonPorNombre.filter(function(f) {
    return f.mimeType === 'application/json';
  }).length;
  var esUnidad = !!arbol.raiz.driveId;

  console.log('=== P2: listado (' + (esUnidad ? 'unidad compartida' : 'Mi unidad') + ') ===');
  console.log('Raíz de prueba: ' + arbol.raiz.name +
    (esUnidad ? ' | ¿es la raíz de la unidad?: ' + (arbol.raiz.id === arbol.raiz.driveId) : ''));
  console.log('Carpetas listadas: ' + arbol.carpetas.items.length + ' (' + arbol.carpetas.paginas + ' consultas, ' + arbol.tCarpetas + ' ms, incompleta: ' + arbol.carpetas.incompleta + ')');
  console.log('Carpetas bajo la raíz: ' + carpetasBajoRaiz);
  console.log('Archivos listados: ' + arbol.archivos.items.length + ' (' + arbol.archivos.paginas + ' consultas, ' + arbol.tArchivos + ' ms, incompleta: ' + arbol.archivos.incompleta + ')');
  console.log('JSON por nombre bajo la raíz: ' + jsonPorNombre.length + ' | fuera de la raíz: ' + fueraDeRaiz);
  console.log('Tipos de archivo de esos JSON: ' + JSON.stringify(tiposDeJson));
  console.log('De esos, con mimeType application/json: ' + jsonConMimeJson + ' (si es menor, filtrar solo por tipo perdería JSON)');
  console.log('Accesos directos: ' + accesosDirectos);
  console.log('Tiempo total de listado: ' + (arbol.tCarpetas + arbol.tArchivos) + ' ms');

  probarLargoConsulta_(arbol.raiz, Object.keys(arbol.mapaCarpetas));
}

/**
 * Parte de P2: mide cuántos "'id' in parents" acepta una sola consulta.
 */
function probarLargoConsulta_(raiz, idsCarpetas) {
  var base = parametrosBase_(raiz);
  var tamanos = [10, 20, 40, 80, 160, 320];
  var maxOk = 0;
  for (var i = 0; i < tamanos.length; i++) {
    var n = tamanos[i];
    if (idsCarpetas.length < n) break;
    var q = '(' + idsCarpetas.slice(0, n).map(function(id) {
      return "'" + id + "' in parents";
    }).join(' or ') + ') and trashed = false';
    try {
      Drive.Files.list(Object.assign({}, base, {
        pageSize: 1,
        q: q,
        fields: 'files(id)'
      }));
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

  // Carpetas de envío que existen en nuestra raíz, tengan o no JSON. Sirve
  // para separar "se copió pero no trae JSON" de "nunca se copió".
  var carpetasPorClave = {};
  Object.keys(arbol.mapaCarpetas).forEach(function(id) {
    var segs = rutaDesdeRaiz_(id, cfg.carpetaId, arbol.mapaCarpetas);
    var ruta = segs ? clasificarRuta_(segs) : null;
    if (!ruta || ruta.resto !== '') return;
    var clave = ruta.rama + '|' + ruta.servicio + '|' + ruta.caso;
    if (!carpetasPorClave[clave]) carpetasPorClave[clave] = {};
    carpetasPorClave[clave][ruta.carpetaEnvio] = true;
  });

  var sheet = SpreadsheetApp.openById(cfg.sheetId).getSheetByName(cfg.sheetTab);
  if (!sheet) throw new Error('No existe la pestaña ' + cfg.sheetTab + ' en el Sheet de prueba.');
  var ultima = sheet.getLastRow();
  if (ultima < 2) throw new Error('El Sheet de prueba no tiene filas de datos.');

  var n = ultima - 1;
  var valores = sheet.getRange(2, 1, n, SHEET_NUM_COLS).getValues();
  var textoC = sheet.getRange(2, SHEET_COLS.DRIVE, n, 1).getRichTextValues();

  var resumen = {
    porCarpeta: 0,
    porRutaDirecto: 0,
    ambiguo: 0,
    copiadoSinJson: 0,
    sinCopia: 0
  };
  var lineas = [];
  var lineasSinCopia = [];

  for (var i = 0; i < n; i++) {
    var fila = valores[i];
    var caso = String(fila[SHEET_COLS.NUMERO_CASO - 1] || '').trim();
    if (!caso) continue;
    var servicio = String(fila[SHEET_COLS.SERVICIO - 1] || '');
    var componente = String(fila[SHEET_COLS.COMPONENTE - 1] || '');
    var estadoCopia = String(fila[SHEET_COLS.ESTADO_COPIA - 1] || '').substring(0, 60);

    // La columna C puede apuntar a nuestra copia o a los originales (de
    // otras personas, a veces sin acceso). Los originales no se abren: solo
    // cuenta un link a una carpeta que esté dentro de nuestra raíz.
    var carpetaC = null;
    var linksExternos = 0;
    textoC[i][0].getRuns().forEach(function(run) {
      var url = run.getLinkUrl();
      var parsed = url ? parsearIdDrive(url) : null;
      if (!parsed) return;
      if (arbol.mapaCarpetas[parsed.id] && cuelgaDe_(parsed.id, cfg.carpetaId, arbol.mapaCarpetas)) {
        if (!carpetaC) carpetaC = parsed.id;
      } else {
        linksExternos++;
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
      var copias = carpetasPorClave[clave] ? Object.keys(carpetasPorClave[clave]) : [];
      if (!info && copias.length > 0) {
        resultado = 'copiado sin JSON (' + copias.join(', ') + ')';
        resumen.copiadoSinJson++;
      } else if (!info) {
        resultado = 'SIN COPIA en nuestra raíz (' + rama + ', ' + linksExternos +
          ' link(s) a originales) | Estado copia: ' + (estadoCopia || '(vacío)');
        resumen.sinCopia++;
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
    var linea = 'Fila ' + (i + 2) + ' | caso ' + caso + ' | ' + servicio.substring(0, 40) +
      ' | ' + componente + ' | ' + resultado;
    if (resultado.indexOf('SIN COPIA') === 0) {
      lineasSinCopia.push(linea);
    } else {
      lineas.push(linea);
    }
  }

  console.log('=== P3: cruce de filas con JSON ===');
  console.log('JSON bajo la raíz: ' + jsons.length + ' | con ruta no reconocida: ' + sinRuta);

  // Muestra de la estructura real, para comparar con Servicio/Caso.
  var primerNivel = {};
  Object.keys(arbol.mapaCarpetas).forEach(function(id) {
    if (arbol.mapaCarpetas[id].padre === cfg.carpetaId) primerNivel[arbol.mapaCarpetas[id].nombre] = true;
  });
  var nombresPrimerNivel = Object.keys(primerNivel);
  console.log('Carpetas de primer nivel (' + nombresPrimerNivel.length + '): ' +
    nombresPrimerNivel.slice(0, 30).join(' | ') + (nombresPrimerNivel.length > 30 ? ' | ...' : ''));
  console.log('Muestra de rutas de JSON (desde la raíz):');
  jsons.slice(0, 15).forEach(function(j) {
    var segs = rutaDesdeRaiz_(j.padre, cfg.carpetaId, arbol.mapaCarpetas) || [];
    console.log('  ' + segs.join(' / ') + ' / ' + j.archivo.name);
  });
  var servicios = {};
  valores.forEach(function(f) {
    var s = String(f[SHEET_COLS.SERVICIO - 1] || '').trim();
    if (s) servicios[s] = true;
  });
  console.log('Muestra de servicios del Sheet: ' + Object.keys(servicios).slice(0, 10).join(' | '));
  console.log('--- Filas con copia en nuestra raíz (' + lineas.length + ') ---');
  lineas.slice(0, PRUEBAS_MAX_LOG).forEach(function(l) { console.log(l); });
  if (lineas.length > PRUEBAS_MAX_LOG) console.log('... ' + (lineas.length - PRUEBAS_MAX_LOG) + ' filas más');
  console.log('--- Filas SIN COPIA (' + lineasSinCopia.length + '), primeras 5 ---');
  lineasSinCopia.slice(0, 5).forEach(function(l) { console.log(l); });
  console.log('Resumen: ' + JSON.stringify(resumen));
}

var PRUEBAS_PRESUPUESTO_MS = 5 * 60 * 1000;

// Columnas donde se buscan links a Drive. La D (Repositorio) a veces trae
// a mano otro Drive con los JSON.
var PRUEBAS_COLUMNAS_LINKS = [SHEET_COLS.DRIVE, SHEET_COLS.REPOSITORIO];
var REGEX_URL_DRIVE = /https?:\/\/(?:drive|docs)\.google\.com\/[^\s<>"]+/gi;

/**
 * Devuelve los IDs de Drive de una celda: los textos con hipervínculo y
 * también las URLs pegadas como texto plano. Cada uno con su origen.
 */
function linksDriveDeCelda_(rich) {
  var vistos = {};
  var res = [];
  function agregar(url, origen) {
    var parsed = parsearIdDrive(url);
    if (!parsed || vistos[parsed.id]) return;
    vistos[parsed.id] = true;
    res.push({ id: parsed.id, origen: origen });
  }
  rich.getRuns().forEach(function(run) {
    var url = run.getLinkUrl();
    if (url) agregar(url, 'link');
  });
  (rich.getText().match(REGEX_URL_DRIVE) || []).forEach(function(url) {
    agregar(url, 'texto');
  });
  return res;
}

/**
 * Lee las columnas de PRUEBAS_COLUMNAS_LINKS y devuelve, por fila, los
 * links a Drive encontrados con la columna y el origen de cada uno.
 */
function linksDriveDelSheet_(sheet, n) {
  var porColumna = PRUEBAS_COLUMNAS_LINKS.map(function(col) {
    return { col: col, rich: sheet.getRange(2, col, n, 1).getRichTextValues() };
  });
  var filas = [];
  for (var i = 0; i < n; i++) {
    var links = [];
    var vistosEnFila = {};
    porColumna.forEach(function(c) {
      linksDriveDeCelda_(c.rich[i][0]).forEach(function(l) {
        // El mismo Drive en C y en D de la misma fila cuenta una sola vez
        // (gana la columna C, que se lee primero).
        if (vistosEnFila[l.id]) return;
        vistosEnFila[l.id] = true;
        links.push({ id: l.id, origen: l.origen, col: columnALetra(c.col) });
      });
    });
    filas.push(links);
  }
  return filas;
}

/**
 * P3b: busca JSON dentro de las carpetas ORIGINALES que enlaza la columna C
 * (las de otras personas). Mide cuántos links tienen acceso, cuántos JSON
 * hay y cuánto tarda. Se corta sola a los 5 min y muestra el parcial.
 */
function pruebaP3b_originales() {
  var cfg = leerConfigPruebas_();
  // Nuestra raíz solo sirve para descartar links a copias. En carpetas
  // propias la consulta agrupada es exacta (P2), así que se carga rápido y
  // el presupuesto de tiempo empieza después, para los originales.
  var arbol = cargarArbol_(cfg.carpetaId, 100);
  var inicio = Date.now();
  var sheet = SpreadsheetApp.openById(cfg.sheetId).getSheetByName(cfg.sheetTab);
  var n = sheet.getLastRow() - 1;
  if (n < 1) throw new Error('El Sheet de prueba no tiene filas de datos.');
  var linksPorFila = linksDriveDelSheet_(sheet, n);

  // ID enlazado → filas que lo enlazan. Solo originales: los links a
  // carpetas dentro de nuestra raíz son copias y ya los cubre P3.
  var filasPorId = {};
  var filasConLink = 0;
  var filasConCopia = {};
  var linksACopias = 0;
  var porOrigen = {};
  var filasSoloEnD = 0;
  for (var i = 0; i < n; i++) {
    var links = linksPorFila[i];
    if (links.length > 0) filasConLink++;
    var enC = links.some(function(l) { return l.col === columnALetra(SHEET_COLS.DRIVE); });
    if (!enC && links.length > 0) filasSoloEnD++;
    links.forEach(function(l) {
      var clave = 'col ' + l.col + ' (' + l.origen + ')';
      porOrigen[clave] = (porOrigen[clave] || 0) + 1;
      if (arbol.mapaCarpetas[l.id] && cuelgaDe_(l.id, cfg.carpetaId, arbol.mapaCarpetas)) {
        linksACopias++;
        filasConCopia[i + 2] = true;
        return;
      }
      if (!filasPorId[l.id]) filasPorId[l.id] = [];
      filasPorId[l.id].push(i + 2);
    });
  }

  var ids = Object.keys(filasPorId);
  var accesibles = 0;
  var sinAcceso = 0;
  var jsonDirectos = 0;
  var raices = [];
  var raizDeCarpeta = {};
  var jsonPorRaiz = {};
  var tGets = Date.now();
  var cortado = false;

  for (var k = 0; k < ids.length; k++) {
    if (Date.now() - inicio > PRUEBAS_PRESUPUESTO_MS / 2) {
      cortado = true;
      break;
    }
    try {
      var f = Drive.Files.get(ids[k], { fields: 'id,name,mimeType', supportsAllDrives: true });
      accesibles++;
      if (f.mimeType === CARPETA_MIME) {
        raices.push(f.id);
        raizDeCarpeta[f.id] = f.id;
      } else if (/\.json$/i.test(f.name || '')) {
        jsonDirectos++;
        jsonPorRaiz[f.id] = 1;
      }
    } catch (err) {
      sinAcceso++;
    }
  }
  tGets = Date.now() - tGets;

  var base = {
    corpora: 'allDrives',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 1000
  };
  var pendientes = raices.slice();
  var carpetasRecorridas = 0;
  var archivos = 0;
  var jsonEnCarpetas = 0;
  var consultas = 0;
  var incompleta = false;
  var tRecorrido = Date.now();

  while (pendientes.length > 0 && !cortado) {
    var siguientes = [];
    for (var j = 0; j < pendientes.length; j += PRUEBAS_PADRES_POR_CONSULTA) {
      if (Date.now() - inicio > PRUEBAS_PRESUPUESTO_MS) {
        cortado = true;
        break;
      }
      var grupo = pendientes.slice(j, j + PRUEBAS_PADRES_POR_CONSULTA);
      var q = '(' + grupo.map(function(id) {
        return "'" + id + "' in parents";
      }).join(' or ') + ') and trashed = false';
      var res = listarTodo_(Object.assign({}, base, {
        q: q,
        fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,parents)'
      }));
      consultas += res.paginas;
      if (res.incompleta) incompleta = true;
      res.items.forEach(function(item) {
        var padre = (item.parents || []).filter(function(p) { return grupo.indexOf(p) !== -1; })[0];
        var raiz = raizDeCarpeta[padre];
        if (item.mimeType === CARPETA_MIME) {
          carpetasRecorridas++;
          raizDeCarpeta[item.id] = raiz;
          siguientes.push(item.id);
        } else {
          archivos++;
          if (/\.json$/i.test(item.name || '')) {
            jsonEnCarpetas++;
            jsonPorRaiz[raiz] = (jsonPorRaiz[raiz] || 0) + 1;
          }
        }
      });
    }
    pendientes = siguientes;
  }
  tRecorrido = Date.now() - tRecorrido;

  var filasConJson = {};
  Object.keys(jsonPorRaiz).forEach(function(id) {
    (filasPorId[id] || []).forEach(function(fila) { filasConJson[fila] = true; });
  });

  console.log('=== P3b: JSON en las carpetas originales (columnas C y D) ===');
  var filasNuevas = Object.keys(filasConJson).filter(function(f) { return !filasConCopia[f]; }).length;
  console.log('Filas con algún link a Drive en C o D: ' + filasConLink + ' de ' + n +
    ' | filas con Drive solo en D: ' + filasSoloEnD);
  console.log('Links por columna y tipo: ' + JSON.stringify(porOrigen));
  console.log('Links a NUESTRAS copias (excluidos): ' + linksACopias + ' en ' + Object.keys(filasConCopia).length + ' filas');
  console.log('Links a ORIGINALES distintos: ' + ids.length + ' | revisados: ' + (accesibles + sinAcceso) +
    ' | con acceso: ' + accesibles + ' | SIN ACCESO o borrados: ' + sinAcceso + ' (' + tGets + ' ms)');
  console.log('Carpetas originales recorridas: ' + carpetasRecorridas + ' | archivos: ' + archivos +
    ' | consultas: ' + consultas + ' (' + tRecorrido + ' ms, incompleta: ' + incompleta + ')');
  console.log('JSON encontrados: ' + (jsonEnCarpetas + jsonDirectos) + ' (' + jsonDirectos + ' enlazados directo)');
  console.log('Filas con al menos un JSON en sus originales: ' + Object.keys(filasConJson).length +
    ' | de esas, SIN copia propia (lo que aportan los originales): ' + filasNuevas);
  console.log('Tiempo total: ' + (Date.now() - inicio) + ' ms' + (cortado ? ' | CORTADO por tiempo: resultado parcial' : ''));
}

/**
 * Recorre una carpeta con DriveApp (lo mismo que ve el usuario a mano).
 * Es la referencia para comparar con las consultas del API.
 */
function contarConDriveApp_(carpetaId, profundidad, acum) {
  if (profundidad > 15) return acum;
  var carpeta = DriveApp.getFolderById(carpetaId);
  var archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    var f = archivos.next();
    acum.archivos++;
    if (/\.json$/i.test(f.getName())) acum.json.push(f.getName());
  }
  var sub = carpeta.getFolders();
  while (sub.hasNext()) {
    acum.carpetas++;
    contarConDriveApp_(sub.next().getId(), profundidad + 1, acum);
  }
  return acum;
}

/**
 * Recorre una carpeta con el API de Drive, nivel por nivel, agrupando
 * `porConsulta` padres en cada consulta (1 = una carpeta por consulta).
 */
function contarConApi_(carpetaIds, porConsulta, corpora) {
  var base = { includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 1000 };
  if (corpora) base.corpora = corpora;
  var acum = { archivos: 0, carpetas: 0, json: [], incompleta: false };
  var pendientes = [].concat(carpetaIds);
  var vueltas = 0;
  while (pendientes.length > 0 && vueltas < 20) {
    vueltas++;
    var siguientes = [];
    for (var i = 0; i < pendientes.length; i += porConsulta) {
      var grupo = pendientes.slice(i, i + porConsulta);
      var q = '(' + grupo.map(function(id) { return "'" + id + "' in parents"; }).join(' or ') +
        ') and trashed = false';
      var res = listarTodo_(Object.assign({}, base, { q: q, fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType)' }));
      if (res.incompleta) acum.incompleta = true;
      res.items.forEach(function(item) {
        if (item.mimeType === CARPETA_MIME) {
          acum.carpetas++;
          siguientes.push(item.id);
        } else {
          acum.archivos++;
          if (/\.json$/i.test(item.name || '')) acum.json.push(item.name);
        }
      });
    }
    pendientes = siguientes;
  }
  return acum;
}

function extraerIdDeTexto_(texto) {
  var parsed = parsearIdDrive(texto);
  if (parsed) return parsed.id;
  var m = String(texto || '').match(/[a-zA-Z0-9_-]{25,}/);
  return m ? m[0] : null;
}

/**
 * P3c: diagnóstico de por qué P3b encuentra menos JSON de los que se ven a
 * mano. Compara, carpeta por carpeta, DriveApp (referencia) contra el API
 * con una carpeta por consulta y agrupada.
 *
 * Carpetas a revisar: propiedad TEST_ORIGINALES con IDs o URLs separados por
 * coma (por ejemplo, una carpeta donde se vieron JSON a mano). Si no existe,
 * toma las primeras carpetas originales con acceso de la columna C.
 */
function pruebaP3c_diagnostico() {
  var cfg = leerConfigPruebas_();
  var ids = [];
  var manual = PropertiesService.getScriptProperties().getProperty('TEST_ORIGINALES');
  if (manual) {
    manual.split(',').forEach(function(t) {
      var id = extraerIdDeTexto_(t.trim());
      if (id) ids.push(id);
    });
  } else {
    var arbol = cargarArbol_(cfg.carpetaId);
    var sheet = SpreadsheetApp.openById(cfg.sheetId).getSheetByName(cfg.sheetTab);
    var n = sheet.getLastRow() - 1;
    var linksPorFila = linksDriveDelSheet_(sheet, n);
    for (var i = 0; i < n && ids.length < 10; i++) {
      linksPorFila[i].forEach(function(l) {
        if (ids.length >= 10 || ids.indexOf(l.id) !== -1) return;
        if (arbol.mapaCarpetas[l.id]) return;
        try {
          var f = Drive.Files.get(l.id, { fields: 'id,mimeType', supportsAllDrives: true });
          if (f.mimeType === CARPETA_MIME) ids.push(l.id);
        } catch (e) {
          // Sin acceso: no sirve para el diagnóstico.
        }
      });
    }
  }

  console.log('=== P3c: diagnóstico en ' + ids.length + ' carpetas originales ===');
  var total = { carpetas: 0, archivos: 0, json: 0 };
  var idsOk = [];
  ids.forEach(function(id) {
    var nombre = '(sin acceso)';
    try {
      nombre = DriveApp.getFolderById(id).getName();
    } catch (e) {
      console.log(id + ' | SIN ACCESO con DriveApp: ' + e.message);
      return;
    }
    idsOk.push(id);
    var ref = contarConDriveApp_(id, 0, { archivos: 0, carpetas: 0, json: [] });
    total.carpetas += ref.carpetas;
    total.archivos += ref.archivos;
    total.json += ref.json.length;
    var uno = contarConApi_([id], 1, null);
    var agrupado = contarConApi_([id], PRUEBAS_PADRES_POR_CONSULTA, 'allDrives');
    console.log(nombre.substring(0, 50) +
      ' | DriveApp: ' + ref.carpetas + ' carp, ' + ref.archivos + ' arch, ' + ref.json.length + ' JSON' +
      ' | API 1 por consulta: ' + uno.carpetas + ' carp, ' + uno.archivos + ' arch, ' + uno.json.length + ' JSON' +
      ' | API agrupada allDrives: ' + agrupado.carpetas + ' carp, ' + agrupado.archivos + ' arch, ' + agrupado.json.length + ' JSON' +
      (agrupado.incompleta ? ' (incompleta)' : ''));
    var faltan = ref.json.filter(function(nm) { return uno.json.indexOf(nm) === -1; });
    if (faltan.length > 0) console.log('   JSON que DriveApp ve y el API no: ' + faltan.slice(0, 5).join(', '));
  });

  if (idsOk.length < 2) return;
  console.log('--- Todas las carpetas juntas ---');
  console.log('Suma DriveApp carpeta por carpeta: ' + total.carpetas + ' carp, ' + total.archivos + ' arch, ' + total.json + ' JSON');
  [['allDrives', PRUEBAS_PADRES_POR_CONSULTA], ['user', PRUEBAS_PADRES_POR_CONSULTA], [null, 1]].forEach(function(v) {
    var r = contarConApi_(idsOk, v[1], v[0]);
    console.log('API ' + (v[1] === 1 ? '1 por consulta' : 'agrupada ' + v[0]) + ': ' +
      r.carpetas + ' carp, ' + r.archivos + ' arch, ' + r.json.length + ' JSON' + (r.incompleta ? ' (incompleta)' : ''));
  });
}

/**
 * P4: crea dos pestañas en el Sheet de prueba para comprobar que
 * IFNA + FILTER + HYPERLINK dejan links clicables. Revisar a mano.
 */
function pruebaP4_buscador() {
  var cfg = leerConfigPruebas_();
  var arbol = cargarArbol_(cfg.carpetaId, 100);
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

var PRUEBAS_TOPE_LINEAS_N = 6;

/**
 * P4b: muestra cómo se vería la columna N con varios JSON en una misma
 * celda: una línea por JSON, cada nombre con su propio link. Escribe una
 * fila por carpeta de envío en la pestaña "Prueba Columna N".
 */
function pruebaP4b_columnaN() {
  var cfg = leerConfigPruebas_();
  var arbol = cargarArbol_(cfg.carpetaId, 100);
  var ss = SpreadsheetApp.openById(cfg.sheetId);

  var porEnvio = {};
  arbol.archivos.items.forEach(function(f) {
    if (!/\.json$/i.test(f.name || '')) return;
    var segs = rutaDesdeRaiz_(f.parents && f.parents[0], cfg.carpetaId, arbol.mapaCarpetas);
    var ruta = segs ? clasificarRuta_(segs) : null;
    if (!ruta) return;
    var clave = ruta.rama + ' / ' + ruta.servicio + ' / ' + ruta.carpetaEnvio;
    if (!porEnvio[clave]) porEnvio[clave] = [];
    porEnvio[clave].push({
      nombre: f.name,
      resto: ruta.resto || '(raíz del caso)',
      fecha: f.modifiedTime ? Utilities.formatDate(new Date(f.modifiedTime), 'America/Bogota', 'dd/MM') : '',
      url: 'https://drive.google.com/file/d/' + f.id + '/view'
    });
  });

  var claves = Object.keys(porEnvio).sort(function(a, b) {
    return porEnvio[b].length - porEnvio[a].length;
  });
  var hoja = ss.getSheetByName('Prueba Columna N') || ss.insertSheet('Prueba Columna N');
  hoja.clear();
  hoja.getRange(1, 1, 1, 3).setValues([['Envío (rama / servicio / carpeta)', 'Cantidad', 'Columna N (así se vería)']]).setFontWeight('bold');

  claves.forEach(function(clave, i) {
    var jsons = porEnvio[clave];
    var visibles = jsons.slice(0, PRUEBAS_TOPE_LINEAS_N);
    var lineas = visibles.map(function(j) {
      return '📄 ' + j.nombre + ' · ' + j.resto + ' · ' + j.fecha;
    });
    if (jsons.length > PRUEBAS_TOPE_LINEAS_N) {
      lineas.push('🔎 Ver los ' + jsons.length + ' en el Buscador');
    }
    var texto = lineas.join('\n');
    var rich = SpreadsheetApp.newRichTextValue().setText(texto);
    var pos = 0;
    visibles.forEach(function(j, k) {
      var inicioNombre = pos + '📄 '.length;
      rich.setLinkUrl(inicioNombre, inicioNombre + j.nombre.length, j.url);
      pos += lineas[k].length + 1;
    });
    hoja.getRange(i + 2, 1, 1, 2).setValues([[clave, jsons.length]]);
    hoja.getRange(i + 2, 3).setRichTextValue(rich.build());
  });
  hoja.setColumnWidth(1, 320);
  hoja.setColumnWidth(3, 520);
  hoja.getRange(2, 3, Math.max(claves.length, 1), 1).setWrap(true).setVerticalAlignment('top');

  console.log('=== P4b === ' + claves.length + ' envíos escritos en "Prueba Columna N", ordenados de más a menos JSON.');
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
  ['Prueba Indice', 'Prueba Buscador', 'Prueba Columna N', 'Prueba Proteccion'].forEach(function(nombre) {
    var h = ss.getSheetByName(nombre);
    if (h) ss.deleteSheet(h);
  });
  console.log('Pestañas de prueba borradas.');
}
