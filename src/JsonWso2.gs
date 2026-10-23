/**
 * JsonWso2.gs: copia de los JSON a la carpeta JSON-WSO2 de la raíz.
 *
 * Los .json de cada fila se copian a [Raíz]/JSON-WSO2/<caso>_<ambiente>/
 * (9300_PROD, 9300_PREPROD, 9300_PRUEBAS o 9300_SIN_AMBIENTE, según la
 * columna F), cada uno en el mismo camino de subcarpetas que tiene dentro
 * del caso (v1.0/EI/docs); si en ese camino llega uno con otro contenido,
 * queda el más reciente. La columna N enlaza esa carpeta con su URL de
 * Drive. Copian el botón "Pasar JSON a
 * JSON-WSO2", "Buscar en filas", el envío (si le queda tiempo) y los
 * reintentos; "Buscar JSON" solo escribe los links.
 *
 * Las carpetas de antes eran solo por caso (JSON-WSO2/9300/). Las filas que
 * las enlazan cuentan como "por pasar": "Pasar" copia su contenido a la
 * carpeta del ambiente de cada fila y, cuando ninguna fila las usa, las
 * manda a la papelera.
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

// Código de cada ambiente (columna F, sin tildes ni mayúsculas) en el
// nombre de la carpeta.
var JSON_WSO2_AMBIENTES = {
  produccion: 'PROD',
  preproduccion: 'PREPROD',
  pruebas: 'PRUEBAS'
};
var JSON_WSO2_SIN_AMBIENTE = 'SIN_AMBIENTE';

// La N enlaza la carpeta con su URL de Drive. Las celdas de antes dicen
// "JSON-WSO2/9300_PROD (2 JSON)" y las de las carpetas solo por caso,
// "JSON-WSO2/9300 (2 JSON)".
var JSON_WSO2_REGEX_LINEA = /^JSON-WSO2\/((\d+)(?:_([A-Z_]+))?) \((\d+) JSON\)$/;
var JSON_WSO2_REGEX_URL_CARPETA = /^https?:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})\S*$/;
var JSON_WSO2_REGEX_NOMBRE = /^\d+(?:_[A-Z_]+)?$/;

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
 * ¿Es la línea de la carpeta en una celda de la N? La URL de una carpeta
 * de Drive o el texto de antes "JSON-WSO2/<caso> (<n> JSON)".
 */
function jsonWso2EsLineaCarpeta_(linea) {
  return !!jsonWso2LeerLinea_(linea);
}

/**
 * Partes de la línea de la carpeta (solo calcula): { nombre, caso,
 * ambiente, total, vieja, id, url }, o null si no es esa línea. La URL
 * solo trae id y url; el texto de antes trae el resto. vieja: carpeta de
 * antes, solo por caso.
 */
function jsonWso2LeerLinea_(linea) {
  var l = String(linea || '').trim();
  var u = JSON_WSO2_REGEX_URL_CARPETA.exec(l);
  if (u) return { nombre: '', caso: '', ambiente: '', total: null, vieja: false, id: u[1], url: l };
  var m = JSON_WSO2_REGEX_LINEA.exec(l);
  if (!m) return null;
  return { nombre: m[1], caso: m[2], ambiente: m[3] || '', total: Number(m[4]), vieja: !m[3], id: '', url: '' };
}

/**
 * Código del ambiente de la columna F: PROD, PREPROD, PRUEBAS o, si está
 * vacío o es otro, SIN_AMBIENTE.
 */
function jsonWso2CodigoAmbiente_(ambiente) {
  var k = String(ambiente || '').trim().toLowerCase()
    .replace(/[áà]/g, 'a').replace(/[éè]/g, 'e').replace(/[íì]/g, 'i')
    .replace(/[óò]/g, 'o').replace(/[úùü]/g, 'u');
  return JSON_WSO2_AMBIENTES[k] || JSON_WSO2_SIN_AMBIENTE;
}

/**
 * Nombre de la carpeta de una fila dentro de JSON-WSO2: "9300_PROD".
 *   numero: caso normalizado (indiceNormalizarCaso_)
 */
function jsonWso2NombreCarpeta_(numero, ambiente) {
  return numero + '_' + jsonWso2CodigoAmbiente_(ambiente);
}

function jsonWso2TextoCarpeta_(nombre, total) {
  return JSON_WSO2.CARPETA + '/' + nombre + ' (' + total + ' JSON)';
}

/**
 * Celda de la N: primero la URL de la carpeta y debajo, una por línea, las
 * URLs de los JSON que no se pudieron copiar. Una carpeta de antes, solo
 * por caso, sigue con su texto para que "Pasar" la encuentre.
 *   carpeta: { url, nombre, total } o null
 */
function jsonWso2Celda_(carpeta, urlsPendientes) {
  var lineas = [];
  if (carpeta) {
    lineas.push(/^\d+$/.test(carpeta.nombre || '')
      ? jsonWso2TextoCarpeta_(carpeta.nombre, carpeta.total)
      : carpeta.url);
  }
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
 * Lo que se consulta una vez por corrida y se reutiliza entre filas: la
 * carpeta JSON-WSO2, la carpeta de cada caso con lo que ya contiene y las
 * carpetas por las que se sube para armar los caminos.
 */
function jsonWso2NuevaMemoria_() {
  return { principalId: null, casos: null, contenido: {}, caminos: {} };
}

function jsonWso2CrearCarpeta_(nombre, padreId) {
  return Drive.Files.create(
    { name: nombre, mimeType: INDICE_CONFIG.CARPETA_MIME, parents: [padreId] },
    null,
    { supportsAllDrives: true, fields: 'id' }
  ).id;
}

/**
 * ID de la carpeta JSON-WSO2 de la raíz; con crear, la crea si no existe.
 * Queda en las propiedades del script para no buscarla cada vez.
 */
function jsonWso2IdPrincipal_(raizId, crear, memo) {
  if (memo && memo.principalId) return memo.principalId;
  var props = PropertiesService.getScriptProperties();
  var clave = JSON_WSO2.PREFIJO_ID + raizId;
  var id = props.getProperty(clave);
  if (id) {
    try {
      if (Drive.Files.get(id, { fields: 'id,trashed', supportsAllDrives: true }).trashed) id = null;
    } catch (err) {
      id = null;
    }
  }
  if (!id) {
    var encontrada = indiceListarHijos_(raizId, null, true).filter(function(h) {
      return h.mimeType === INDICE_CONFIG.CARPETA_MIME && h.name === JSON_WSO2.CARPETA;
    })[0];
    id = encontrada ? encontrada.id : (crear ? jsonWso2CrearCarpeta_(JSON_WSO2.CARPETA, raizId) : null);
    if (id) props.setProperty(clave, id);
  }
  if (memo && id) memo.principalId = id;
  return id;
}

/**
 * Carpetas de JSON-WSO2 por nombre ("9300_PROD", y las de antes "9300"),
 * sin crear nada. Una consulta. Devuelve { nombre: id }.
 */
function jsonWso2ListarCarpetas_(principalId) {
  var res = {};
  indiceListarHijos_(principalId, null, true).forEach(function(h) {
    if (h.mimeType !== INDICE_CONFIG.CARPETA_MIME || !JSON_WSO2_REGEX_NOMBRE.test(h.name || '')) return;
    if (!res[h.name]) res[h.name] = h.id;
  });
  return res;
}

/**
 * ID de una carpeta dentro de JSON-WSO2 por su nombre (la lista se lee una
 * vez por corrida); con crear, la crea si no existe.
 */
function jsonWso2IdCaso_(principalId, nombre, crear, memo) {
  if (!memo.casos) memo.casos = jsonWso2ListarCarpetas_(principalId);
  if (!memo.casos[nombre] && crear) memo.casos[nombre] = jsonWso2CrearCarpeta_(nombre, principalId);
  return memo.casos[nombre] || null;
}

/**
 * Todos los .json bajo una carpeta, con su camino desde ella, y sus
 * subcarpetas. Una consulta por carpeta.
 * Devuelve { jsons: { camino: { id, md5 } }, carpetas: { camino: id } }.
 */
function jsonWso2JsonBajo_(carpetaId) {
  var res = { jsons: {}, carpetas: { '': carpetaId } };
  var cola = [{ id: carpetaId, ruta: [] }];
  var vueltas = 0;
  while (cola.length > 0 && vueltas < 200) {
    vueltas++;
    var actual = cola.shift();
    indiceListarHijos_(actual.id, null, true).forEach(function(h) {
      var ruta = actual.ruta.concat([h.name]);
      if (h.mimeType === INDICE_CONFIG.CARPETA_MIME) {
        res.carpetas[ruta.join('/')] = h.id;
        cola.push({ id: h.id, ruta: ruta });
      } else if (/\.json$/i.test(h.name || '')) {
        res.jsons[ruta.join('/')] = { id: h.id, md5: h.md5Checksum || '' };
      }
    });
  }
  return res;
}

/**
 * Copia los JSON a [Raíz]/JSON-WSO2/<caso>_<ambiente>/, cada uno en su
 * camino de subcarpetas. Si ya hay uno en el mismo camino: mismo contenido
 * (md5), no se toca; otro contenido, se reemplaza si el que llega es más
 * reciente que el que se copió (fecha guardada en la descripción de la
 * copia). El contenido se reemplaza sobre el mismo archivo, así su link no
 * cambia.
 *
 *   ambiente: texto de la columna F de la fila.
 *   archivos: [{ id, nombre, ruta, modificado, md5, descripcion }];
 *     descripcion solo al pasar una carpeta de antes (se conserva la de la
 *     copia vieja).
 *   quedaMs(): tiempo que queda para copiar; se deja de copiar en 0.
 *   memo: jsonWso2NuevaMemoria_, para reutilizar consultas entre filas.
 * Devuelve { carpeta: { id, url, nombre, caso, total }, pendientes: [id],
 * fallidos: [id] } o null si el caso no es un número o no se pudo abrir la
 * carpeta. pendientes: no se copiaron por falta de tiempo; fallidos: por un
 * error (sin acceso, por ejemplo).
 */
function jsonWso2CopiarAlCaso_(raizId, caso, ambiente, archivos, quedaMs, memo) {
  var numero = indiceNormalizarCaso_(caso);
  if (!numero || !raizId) return null;
  var nombre = jsonWso2NombreCarpeta_(numero, ambiente);
  memo = memo || jsonWso2NuevaMemoria_();
  var pendientes = [];
  var fallidos = [];
  var casoId;
  var contenido;
  try {
    casoId = jsonWso2IdCaso_(jsonWso2IdPrincipal_(raizId, true, memo), nombre, true, memo);
    if (!memo.contenido[casoId]) memo.contenido[casoId] = jsonWso2JsonBajo_(casoId);
    contenido = memo.contenido[casoId];
  } catch (err) {
    console.warn('[JSON-WSO2] No se pudo abrir la carpeta del caso: ' + err.message);
    return null;
  }

  var carpetaDe = function(ruta) {
    var k = ruta.join('/');
    if (!contenido.carpetas[k]) {
      contenido.carpetas[k] = jsonWso2CrearCarpeta_(ruta[ruta.length - 1], carpetaDe(ruta.slice(0, -1)));
    }
    return contenido.carpetas[k];
  };

  jsonWso2UnoPorCamino_(archivos).forEach(function(a) {
    if (quedaMs() <= 0) {
      pendientes.push(a.id);
      return;
    }
    var clave = jsonWso2Clave_(a);
    var ya = contenido.jsons[clave];
    try {
      if (ya && ya.md5 && ya.md5 === a.md5) return;
      var descripcion = a.descripcion || ('Copia de ' + a.id + '; modificado:' + (a.modificado || ''));
      if (ya) {
        var actual = Drive.Files.get(ya.id, { fields: 'description', supportsAllDrives: true }).description || '';
        var copiadoDe = (/modificado:(\S+)/.exec(actual) || [])[1] || '';
        if (copiadoDe && String(a.modificado || '') < copiadoDe) return;
        var archivo = DriveApp.getFileById(ya.id);
        archivo.setContent(DriveApp.getFileById(a.id).getBlob().getDataAsString());
        archivo.setDescription(descripcion);
        ya.md5 = a.md5;
      } else {
        // Copia y descripción en una sola consulta.
        var copia = Drive.Files.copy(
          { name: a.nombre, parents: [carpetaDe(a.ruta || [])], description: descripcion },
          a.id,
          { supportsAllDrives: true, fields: 'id' }
        );
        contenido.jsons[clave] = { id: copia.id, md5: a.md5 };
      }
    } catch (err) {
      console.warn('[JSON-WSO2] No se pudo copiar un JSON: ' + err.message);
      fallidos.push(a.id);
    }
  });

  return {
    carpeta: { id: casoId, url: indiceUrlCarpeta_(casoId), nombre: nombre, caso: numero, total: Object.keys(contenido.jsons).length },
    pendientes: pendientes,
    fallidos: fallidos
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
 * memo (opcional): jsonWso2NuevaMemoria_, para no volver a consultar las
 * mismas carpetas en otra fila.
 * Devuelve { archivos: [{ id, nombre, ruta, modificado, md5 }], noLeidos: [id] }.
 */
function jsonWso2LeerArchivos_(ids, caso, topes, memo) {
  var numero = indiceNormalizarCaso_(caso);
  var caminos = memo ? memo.caminos : {};
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
        ruta: numero ? jsonWso2CaminoEnElCaso_((f.parents || [])[0], numero, topes, caminos) : [],
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
 * Carpetas que ya existen en JSON-WSO2 (sin crear nada): una consulta.
 * Devuelve { nombre: { id, url } } ("9300_PROD", y las de antes "9300") o
 * {} si JSON-WSO2 no existe.
 */
function jsonWso2CarpetasDeCasos_(raizId) {
  var res = {};
  try {
    var principalId = jsonWso2IdPrincipal_(raizId, false, null);
    if (!principalId) return res;
    var carpetas = jsonWso2ListarCarpetas_(principalId);
    Object.keys(carpetas).forEach(function(nombre) {
      res[nombre] = { id: carpetas[nombre], url: indiceUrlCarpeta_(carpetas[nombre]) };
    });
  } catch (err) {
    console.warn('[JSON-WSO2] No se pudo leer la carpeta JSON-WSO2: ' + err.message);
  }
  return res;
}

// ── Carpetas de antes (solo por caso) ─────────────────────────────────

/**
 * JSON de una carpeta de antes (JSON-WSO2/9300/), listos para copiarlos a
 * la carpeta del ambiente: con su camino y la descripción de la copia
 * vieja (dice de qué original salió y su fecha). Una consulta por carpeta y
 * una por JSON. Devuelve null si la carpeta ya no existe.
 *   nombre: "9300"
 */
function jsonWso2ArchivosDeCarpetaVieja_(raizId, nombre, memo) {
  var principalId = jsonWso2IdPrincipal_(raizId, false, memo);
  var id = principalId ? jsonWso2IdCaso_(principalId, nombre, false, memo) : null;
  if (!id) return null;
  if (!memo.contenido[id]) memo.contenido[id] = jsonWso2JsonBajo_(id);
  var jsons = memo.contenido[id].jsons;
  return Object.keys(jsons).map(function(camino) {
    var partes = camino.split('/');
    var descripcion = Drive.Files.get(jsons[camino].id, { fields: 'description', supportsAllDrives: true }).description || '';
    return {
      id: jsons[camino].id,
      nombre: partes[partes.length - 1],
      ruta: partes.slice(0, -1),
      modificado: (/modificado:(\S+)/.exec(descripcion) || [])[1] || '',
      md5: jsons[camino].md5,
      descripcion: descripcion
    };
  });
}

/**
 * Manda a la papelera las carpetas de antes (nombre solo con el número) que
 * ya no enlaza ninguna fila. Queda 30 días en la papelera de Drive.
 *   valoresN: [[texto]] de toda la columna N.
 * Devuelve cuántas mandó.
 */
function jsonWso2PapeleraViejas_(raizId, valoresN) {
  var usadas = {};
  (valoresN || []).forEach(function(v) {
    String(v[0] == null ? '' : v[0]).split('\n').forEach(function(linea) {
      var l = jsonWso2LeerLinea_(linea);
      if (l && l.vieja) usadas[l.nombre] = true;
    });
  });
  var principalId = jsonWso2IdPrincipal_(raizId, false, null);
  if (!principalId) return 0;
  var carpetas = jsonWso2ListarCarpetas_(principalId);
  var n = 0;
  Object.keys(carpetas).forEach(function(nombre) {
    if (!/^\d+$/.test(nombre) || usadas[nombre]) return;
    try {
      DriveApp.getFolderById(carpetas[nombre]).setTrashed(true);
      n++;
    } catch (err) {
      console.warn('[JSON-WSO2] No se pudo mandar a la papelera la carpeta ' + nombre + ': ' + err.message);
    }
  });
  if (n > 0) console.log('[JSON-WSO2] Carpetas de antes a la papelera: ' + n);
  return n;
}
