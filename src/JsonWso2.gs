/**
 * JsonWso2.gs: copia de los JSON a la carpeta JSON-WSO2 de la raíz.
 *
 * Los .json de cada caso se copian a [Raíz]/JSON-WSO2/<caso>/, cada uno en
 * el mismo camino de subcarpetas que tiene dentro del caso (v1.0/EI/docs);
 * si en ese camino llega uno con otro contenido, queda el más reciente. La
 * columna N enlaza la carpeta del caso con el texto "JSON-WSO2/<caso> (<n>
 * JSON)". Copian el botón "Pasar JSON a JSON-WSO2", el envío (si le queda
 * tiempo) y los reintentos; las búsquedas solo escriben los links.
 */

var JSON_WSO2 = {
  CARPETA: 'JSON-WSO2',
  PREFIJO_ID: 'JSON_WSO2_ID_',
  // Una acción de botón dura 30 s. El envío copia los JSON en el momento
  // solo si le quedan al menos MARGEN_ACCION_MS, y deja de copiar cuando
  // le quedan RESERVA_ACCION_MS para terminar de escribir.
  LIMITE_ACCION_MS: 30000,
  MARGEN_ACCION_MS: 8000,
  RESERVA_ACCION_MS: 4000,
  // Sin saber cuánto lleva la ejecución (reintentos), se copia como mucho
  // este tiempo; lo que no alcance lo pasa después el botón.
  PRESUPUESTO_SIN_INICIO_MS: 8000
};

var JSON_WSO2_REGEX_LINEA = /^JSON-WSO2\/(\d+) \((\d+) JSON\)$/;

// Inicio de la acción del botón en curso (envío o edición); 0 si la
// ejecución no viene de un botón.
var JSON_WSO2_INICIO_ACCION = 0;

function jsonWso2MarcarInicioAccion_() {
  JSON_WSO2_INICIO_ACCION = Date.now();
}

/**
 * Cuánto tiempo queda para copiar JSON en esta ejecución. Devuelve una
 * función quedaMs() (copiar mientras sea > 0), o null si no conviene
 * empezar (a la acción le queda menos de MARGEN_ACCION_MS).
 */
function jsonWso2TiempoParaCopiar_() {
  if (!JSON_WSO2_INICIO_ACCION) {
    var limite = Date.now() + JSON_WSO2.PRESUPUESTO_SIN_INICIO_MS;
    return function() { return limite - Date.now(); };
  }
  var inicio = JSON_WSO2_INICIO_ACCION;
  var queda = function() { return JSON_WSO2.LIMITE_ACCION_MS - (Date.now() - inicio); };
  if (queda() < JSON_WSO2.MARGEN_ACCION_MS) return null;
  return function() { return queda() - JSON_WSO2.RESERVA_ACCION_MS; };
}

// ── Celda de la columna N ─────────────────────────────────────────────

/**
 * ¿Es la línea "JSON-WSO2/<caso> (<n> JSON)" de una celda de la N?
 */
function jsonWso2EsLineaCarpeta_(linea) {
  return JSON_WSO2_REGEX_LINEA.test(String(linea || '').trim());
}

function jsonWso2TextoCarpeta_(caso, total) {
  return JSON_WSO2.CARPETA + '/' + caso + ' (' + total + ' JSON)';
}

/**
 * Celda de la N: primero la línea de la carpeta del caso (con su link) y
 * debajo, una por línea, las URLs de los JSON que no se pudieron copiar.
 *   carpeta: { url, caso, total } o null
 */
function jsonWso2Celda_(carpeta, urlsPendientes) {
  var lineas = [];
  if (carpeta) lineas.push(jsonWso2TextoCarpeta_(carpeta.caso, carpeta.total));
  (urlsPendientes || []).forEach(function(u) { lineas.push(u); });
  var builder = SpreadsheetApp.newRichTextValue().setText(lineas.join('\n'));
  var inicio = 0;
  lineas.forEach(function(linea, i) {
    var url = (i === 0 && carpeta) ? carpeta.url : linea;
    builder.setLinkUrl(inicio, inicio + linea.length, url);
    inicio += linea.length + 1;
  });
  return builder.build();
}

/**
 * IDs de los archivos enlazados en las líneas URL de una celda de la N.
 */
function jsonWso2IdsDeUrls_(urls) {
  var ids = [];
  (urls || []).forEach(function(u) {
    var m = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(u) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(u);
    if (m && ids.indexOf(m[1]) === -1) ids.push(m[1]);
  });
  return ids;
}

// ── Copia ─────────────────────────────────────────────────────────────

/**
 * Clave de un JSON dentro de la carpeta del caso: su camino de subcarpetas
 * y su nombre ("v1.0/EI/docs/config.json").
 */
function jsonWso2Clave_(a) {
  return (a.ruta || []).concat([a.nombre]).join('/');
}

/**
 * Uno por camino, el más reciente (solo calcula). Dos JSON con el mismo
 * nombre en subcarpetas distintas (v1.0 y v1.0.1) son dos archivos; el
 * mismo camino en un reenvío (9300 y 9300_2) es el mismo archivo.
 *   archivos: [{ id, nombre, ruta, modificado, md5 }]
 */
function jsonWso2UnoPorCamino_(archivos) {
  var porClave = {};
  var orden = [];
  (archivos || []).forEach(function(a) {
    var k = jsonWso2Clave_(a);
    var actual = porClave[k];
    if (!actual) {
      porClave[k] = a;
      orden.push(k);
    } else if (String(a.modificado || '') > String(actual.modificado || '')) {
      porClave[k] = a;
    }
  });
  return orden.map(function(k) { return porClave[k]; });
}

/**
 * Carpeta JSON-WSO2 de la raíz; con crear, la crea si no existe. Su ID
 * queda en las propiedades del script para no buscarla cada vez.
 */
function jsonWso2CarpetaPrincipal_(raizId, crear) {
  var props = PropertiesService.getScriptProperties();
  var clave = JSON_WSO2.PREFIJO_ID + raizId;
  var id = props.getProperty(clave);
  if (id) {
    try {
      var guardada = DriveApp.getFolderById(id);
      if (!guardada.isTrashed()) return guardada;
    } catch (err) {
      // Borrada o sin acceso: se busca de nuevo.
    }
  }
  var raiz = DriveApp.getFolderById(raizId);
  var existentes = raiz.getFoldersByName(JSON_WSO2.CARPETA);
  var carpeta = existentes.hasNext() ? existentes.next() : (crear ? raiz.createFolder(JSON_WSO2.CARPETA) : null);
  if (carpeta) props.setProperty(clave, carpeta.getId());
  return carpeta;
}

function jsonWso2Subcarpeta_(padre, nombre) {
  var existentes = padre.getFoldersByName(nombre);
  return existentes.hasNext() ? existentes.next() : padre.createFolder(nombre);
}

/**
 * Todos los .json bajo una carpeta, con su camino desde ella. Una consulta
 * por carpeta. Devuelve { clave: { id, md5 } }.
 */
function jsonWso2JsonBajo_(carpetaId) {
  var res = {};
  var cola = [{ id: carpetaId, ruta: [] }];
  var vueltas = 0;
  while (cola.length > 0 && vueltas < 200) {
    vueltas++;
    var actual = cola.shift();
    indiceListarHijos_(actual.id, null, true).forEach(function(h) {
      if (h.mimeType === INDICE_CONFIG.CARPETA_MIME) {
        cola.push({ id: h.id, ruta: actual.ruta.concat([h.name]) });
      } else if (/\.json$/i.test(h.name || '')) {
        res[actual.ruta.concat([h.name]).join('/')] = { id: h.id, md5: h.md5Checksum || '' };
      }
    });
  }
  return res;
}

/**
 * Copia los JSON a [Raíz]/JSON-WSO2/<caso>/, cada uno en su camino de
 * subcarpetas. Si ya hay uno en el mismo camino: mismo contenido (md5), no
 * se toca; otro contenido, se reemplaza si el que llega es más reciente que
 * el que se copió (fecha guardada en la descripción de la copia). El
 * contenido se reemplaza sobre el mismo archivo, así su link no cambia.
 *
 *   archivos: [{ id, nombre, ruta, modificado, md5 }]
 *   quedaMs(): tiempo que queda para copiar; se deja de copiar en 0.
 * Devuelve { carpeta: { id, url, caso, total }, pendientes: [id] } o null
 * si el caso no es un número o no se pudo abrir la carpeta. pendientes son
 * los que no se copiaron (sin tiempo o sin acceso).
 */
function jsonWso2CopiarAlCaso_(raizId, caso, archivos, quedaMs) {
  var numero = indiceNormalizarCaso_(caso);
  if (!numero || !raizId) return null;
  var pendientes = [];
  var carpeta;
  try {
    carpeta = jsonWso2Subcarpeta_(jsonWso2CarpetaPrincipal_(raizId, true), numero);
  } catch (err) {
    console.warn('[JSON-WSO2] No se pudo abrir la carpeta del caso: ' + err.message);
    return null;
  }

  var existentes = jsonWso2JsonBajo_(carpeta.getId());
  var subcarpetas = { '': carpeta };
  var carpetaDe = function(ruta) {
    var k = ruta.join('/');
    if (!subcarpetas[k]) subcarpetas[k] = jsonWso2Subcarpeta_(carpetaDe(ruta.slice(0, -1)), ruta[ruta.length - 1]);
    return subcarpetas[k];
  };

  jsonWso2UnoPorCamino_(archivos).forEach(function(a) {
    if (quedaMs() <= 0) {
      pendientes.push(a.id);
      return;
    }
    var clave = jsonWso2Clave_(a);
    var ya = existentes[clave];
    try {
      if (ya && ya.md5 && ya.md5 === a.md5) return;
      var descripcion = 'Copia de ' + a.id + '; modificado:' + (a.modificado || '');
      if (ya) {
        var actual = Drive.Files.get(ya.id, { fields: 'description', supportsAllDrives: true }).description || '';
        var copiadoDe = (/modificado:(\S+)/.exec(actual) || [])[1] || '';
        if (copiadoDe && String(a.modificado || '') < copiadoDe) return;
        var archivo = DriveApp.getFileById(ya.id);
        archivo.setContent(DriveApp.getFileById(a.id).getBlob().getDataAsString());
        archivo.setDescription(descripcion);
        ya.md5 = a.md5;
      } else {
        var copia = DriveApp.getFileById(a.id).makeCopy(a.nombre, carpetaDe(a.ruta || []));
        copia.setDescription(descripcion);
        existentes[clave] = { id: copia.getId(), md5: a.md5 };
      }
    } catch (err) {
      console.warn('[JSON-WSO2] No se pudo copiar un JSON: ' + err.message);
      pendientes.push(a.id);
    }
  });

  return {
    carpeta: { id: carpeta.getId(), url: carpeta.getUrl(), caso: numero, total: Object.keys(existentes).length },
    pendientes: pendientes
  };
}

/**
 * Camino de subcarpetas de un archivo dentro de su caso: sube por sus
 * carpetas hasta la del caso (nombre con el número de caso, como 9300 o
 * 9300_2) o hasta una carpeta enlazada en la fila (topes), sin incluirlas.
 * Si no llega a ninguna, devuelve [] (el archivo va suelto en la carpeta
 * del caso). memo guarda las carpetas ya consultadas.
 */
function jsonWso2CaminoEnElCaso_(padreId, caso, topes, memo) {
  var nombres = [];
  var actual = padreId;
  for (var vueltas = 0; actual && vueltas < 20; vueltas++) {
    if ((topes || []).indexOf(actual) !== -1) return nombres;
    var datos = memo[actual];
    if (datos === undefined) {
      try {
        var f = Drive.Files.get(actual, { fields: 'id,name,parents', supportsAllDrives: true });
        datos = { nombre: f.name || '', padre: (f.parents || [])[0] || '' };
      } catch (err) {
        datos = null;
      }
      memo[actual] = datos;
    }
    if (!datos) return [];
    if (indiceNumerosEnNombre_(datos.nombre).indexOf(caso) !== -1) return nombres;
    nombres.unshift(datos.nombre);
    actual = datos.padre;
  }
  return [];
}

/**
 * Datos de los JSON enlazados por ID (para los que solo se tiene el link),
 * con su camino dentro del caso. Los que no se pueden abrir o no son .json
 * quedan en noLeidos. topes: carpetas enlazadas en la fila (columnas C y D).
 * Devuelve { archivos: [{ id, nombre, ruta, modificado, md5 }], noLeidos: [id] }.
 */
function jsonWso2LeerArchivos_(ids, caso, topes) {
  var numero = indiceNormalizarCaso_(caso);
  var memo = {};
  var archivos = [];
  var noLeidos = [];
  (ids || []).forEach(function(id) {
    try {
      var f = Drive.Files.get(id, { fields: 'id,name,parents,modifiedTime,md5Checksum', supportsAllDrives: true });
      if (!/\.json$/i.test(f.name || '')) {
        noLeidos.push(id);
        return;
      }
      archivos.push({
        id: f.id,
        nombre: f.name,
        ruta: numero ? jsonWso2CaminoEnElCaso_((f.parents || [])[0], numero, topes, memo) : [],
        modificado: f.modifiedTime || '',
        md5: f.md5Checksum || ''
      });
    } catch (err) {
      noLeidos.push(id);
    }
  });
  return { archivos: archivos, noLeidos: noLeidos };
}

/**
 * Carpetas de casos que ya existen en JSON-WSO2 (sin crear nada): una
 * consulta. Devuelve { caso: { id, url } } o {} si JSON-WSO2 no existe.
 */
function jsonWso2CarpetasDeCasos_(raizId) {
  var res = {};
  try {
    var principal = jsonWso2CarpetaPrincipal_(raizId, false);
    if (!principal) return res;
    indiceListarHijos_(principal.getId(), null, true).forEach(function(h) {
      if (h.mimeType !== INDICE_CONFIG.CARPETA_MIME) return;
      var numero = indiceNormalizarCaso_(h.name);
      if (numero) res[numero] = { id: h.id, url: indiceUrlCarpeta_(h.id) };
    });
  } catch (err) {
    console.warn('[JSON-WSO2] No se pudo leer la carpeta JSON-WSO2: ' + err.message);
  }
  return res;
}
