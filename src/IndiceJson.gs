/**
 * IndiceJson.gs: índice de los .json guardados bajo la carpeta raíz.
 *
 * Recorre la carpeta raíz configurada, una carpeta por consulta (la consulta
 * agrupada por padres pierde archivos sin avisar en carpetas de otros), y
 * escribe en la pestaña "Índice JSON" una fila por cada .json con su
 * servicio, caso, ambiente, componente, estado y link.
 *
 * El trabajo se hace por partes que guardan su avance en una pestaña oculta
 * del mismo Sheet. El botón del panel solo prepara y programa un activador
 * .after(), como los reintentos de copia; cada parte corre hasta 5 min y
 * programa la siguiente. Mientras corre, la pestaña "Índice JSON" muestra
 * el avance. Si el activador no corre, el panel ofrece avanzar desde ahí.
 *
 * Para las filas sin copia en nuestra raíz, abre los originales de sus
 * columnas C y D (una carpeta por consulta) y registra sus .json con origen
 * "Original"; los links sin acceso van a la pestaña "Índice JSON (sin
 * acceso)". Se enlaza, nunca se copia.
 *
 * Al final llena la columna N (Archivos JSON) de la pestaña de solicitudes,
 * solo en filas con la N vacía y con un cruce seguro (por carpeta, por ruta
 * o por link original), revisando cada fila justo antes de escribir.
 */

var INDICE_CONFIG = {
  PESTANA: 'Índice JSON',
  PESTANA_AVANCE: 'Índice JSON (avance)',
  PESTANA_SIN_ACCESO: 'Índice JSON (sin acceso)',
  // Una parte del activador: 5 min, igual que los reintentos de copia (la
  // ejecución tiene 6). Y una parte de respaldo desde el panel, que solo
  // se usa si el activador no corre (una acción de tarjeta tiene 30 s).
  PRESUPUESTO_ACTIVADOR_MS: 5 * 60 * 1000,
  PRESUPUESTO_BOTON_MS: 15000,
  // Tiempo mínimo que debe quedar para empezar a escribir la pestaña.
  MARGEN_ESCRITURA_MS: 60000,
  MARGEN_ESCRITURA_BOTON_MS: 8000,
  // Tiempo que se reserva para no empezar otra consulta al final de la parte.
  MARGEN_CONSULTA_MS: 3000,
  MAX_PARTES: 60,
  MAX_HISTORIAL: 8,
  MAX_LINEAS_N: 6,
  // Filas de la columna N que se escriben con el lock tomado; entre un
  // bloque y otro se suelta para no frenar los envíos de los demás.
  BLOQUE_N: 40,
  // Cada cuánto se guardan los contadores durante una parte larga, para
  // que "Ver avance" muestre números que se mueven.
  GUARDAR_CONTADORES_MS: 20000,
  // Si la parte programada no arrancó en este tiempo, el panel lo avisa.
  ESPERA_ACTIVADOR_MS: 90000,
  TAMANO_TROZO: 45000,
  HANDLER_ACTIVADOR: 'continuarIndiceJson',
  CARPETA_MIME: 'application/vnd.google-apps.folder',
  CARPETA_CAPA: 'SERVICIOS CAPA'
};

var INDICE_ENCABEZADOS = [
  'Servicio', 'Caso', 'Origen', 'Carpeta del envío', 'Rama', 'Ruta dentro del caso',
  'Archivo', 'Modificado', 'Ambiente', 'Componente', 'Estado', 'Fila(s)',
  'Cruce', 'URL'
];

var INDICE_ENCABEZADOS_SIN_ACCESO = [
  'Fila', 'Caso', 'Servicio', 'Componente', 'Estado', 'Link sin acceso'
];

var INDICE_REGEX_URL_DRIVE = /https?:\/\/(?:drive|docs)\.google\.com\/[^\s<>"]+/gi;

// ── Funciones puras (sin servicios de Google) ─────────────────────────

/**
 * Misma limpieza que se aplica al nombre del servicio al crear su carpeta.
 */
function indiceLimpiarServicio_(servicio) {
  return (String(servicio || '(sin servicio)')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()) || '(sin servicio)';
}

/**
 * Interpreta los nombres de carpeta desde la raíz con las tres estructuras
 * que conviven: Servicio/Caso, SERVICIOS CAPA/[APIM/]Servicio/Caso y
 * [APIM/]Servicio/Caso. Devuelve null si la ruta no llega al nivel del caso.
 */
function indiceClasificarRuta_(segmentos) {
  var i = 0;
  if (segmentos[i] === INDICE_CONFIG.CARPETA_CAPA) i++;
  var rama = 'General';
  if (segmentos[i] === CONFIG.CARPETA_APIM) {
    rama = 'APIM';
    i++;
  }
  if (segmentos.length - i < 2) return null;
  var carpetaEnvio = segmentos[i + 1];
  return {
    rama: rama,
    servicio: segmentos[i],
    carpetaEnvio: carpetaEnvio,
    caso: carpetaEnvio.replace(/_\d+$/, ''),
    resto: segmentos.slice(i + 2).join('/')
  };
}

/**
 * Cadena de carpetas desde el primer nivel bajo la raíz hasta `carpetaId`
 * (incluida), como [{ id, nombre }]. Null si no cuelga de la raíz.
 * `carpetas` es { id: [nombre, idPadre] }.
 */
function indiceCadena_(carpetaId, raizId, carpetas) {
  var cadena = [];
  var actual = carpetaId;
  var vueltas = 0;
  while (actual && vueltas < 60) {
    if (actual === raizId) return cadena.reverse();
    var info = carpetas[actual];
    if (!info) return null;
    cadena.push({ id: actual, nombre: info[0] });
    actual = info[1];
    vueltas++;
  }
  return null;
}

function indiceUnicos_(lista) {
  var vistos = {};
  var res = [];
  lista.forEach(function(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || vistos[s]) return;
    vistos[s] = true;
    res.push(s);
  });
  return res;
}

/**
 * Clave de cruce por ruta de una fila: rama (por su componente), servicio
 * limpio y caso. Es la misma forma en que el envío arma sus carpetas.
 */
function indiceClaveFila_(f) {
  var rama = esComponenteAPIM(String(f.componente || '').trim()) ? 'APIM' : 'General';
  return rama + '|' + indiceLimpiarServicio_(f.servicio) + '|' + String(f.caso).trim();
}

/**
 * Carpetas de envío de nuestra raíz por clave de ruta, tengan o no .json.
 * Sirve para saber si una fila tiene copia y para detectar Caso_N.
 */
function indiceEnviosPorClave_(datos) {
  var envios = {};
  Object.keys(datos.carpetas).forEach(function(id) {
    var cadena = indiceCadena_(id, datos.raizId, datos.carpetas);
    if (!cadena) return;
    var ruta = indiceClasificarRuta_(cadena.map(function(c) { return c.nombre; }));
    if (!ruta || ruta.resto !== '') return;
    var clave = ruta.rama + '|' + ruta.servicio + '|' + ruta.caso;
    if (!envios[clave]) envios[clave] = {};
    envios[clave][ruta.carpetaEnvio] = true;
  });
  return envios;
}

/**
 * Links a originales que hay que revisar: los de las columnas C y D de las
 * filas que NO tienen copia en nuestra raíz (ni por su link ni por ruta).
 * Una fila con copia nunca va a sus originales.
 *
 * Devuelve { ids: [id], porId: { id: [filas] } }. El mismo link en varias
 * filas se revisa una sola vez y el resultado va a todas.
 */
function indiceOriginalesPorRevisar_(datos, filasSheet) {
  var envios = indiceEnviosPorClave_(datos);
  var propios = {};
  propios[datos.raizId] = true;
  (datos.jsons || []).forEach(function(j) { propios[j[0]] = true; });

  var ids = [];
  var porId = {};
  filasSheet.forEach(function(f) {
    var links = f.ids || [];
    var conCopia = links.some(function(id) { return datos.carpetas[id] || id === datos.raizId; }) ||
      !!envios[indiceClaveFila_(f)];
    if (conCopia) return;
    links.forEach(function(id) {
      if (propios[id] || datos.carpetas[id]) return;
      if (!porId[id]) {
        porId[id] = [];
        ids.push(id);
      }
      porId[id].push(f);
    });
  });
  return { ids: ids, porId: porId };
}

/**
 * De qué links originales sale un .json encontrado en originales: el link
 * al propio archivo y las carpetas enlazadas que lo contienen. También
 * devuelve la más cercana y la ruta desde ella.
 *
 * O: { estados: { id: 'carpeta' | 'json' | 'sin_acceso' | 'otro' },
 *      carpetas: { id: [nombre, padre o null] } }
 */
function indiceOrigenDeJson_(j, O) {
  var origenes = [];
  var ruta = [];
  var cercano = null;
  if (O.estados[j[0]] === 'json') origenes.push(j[0]);
  var p = j[2];
  var vueltas = 0;
  while (p && O.carpetas[p] && vueltas < 60) {
    if (O.estados[p] === 'carpeta') {
      origenes.push(p);
      if (!cercano) cercano = p;
    }
    if (!cercano) ruta.unshift(O.carpetas[p][0]);
    p = O.carpetas[p][1];
    vueltas++;
  }
  return { origenes: origenes, cercano: cercano, ruta: ruta };
}

/**
 * Filas del índice para los .json encontrados en originales. Servicio,
 * caso, ambiente, componente y estado salen de las filas que los enlazan.
 */
function indiceArmarFilasOriginales_(datos, filasSheet) {
  var O = datos.originales;
  var rev = indiceOriginalesPorRevisar_(datos, filasSheet);
  var salida = [];
  (O.jsons || []).forEach(function(j) {
    var info = indiceOrigenDeJson_(j, O);
    var vistas = {};
    var filas = [];
    info.origenes.forEach(function(o) {
      (rev.porId[o] || []).forEach(function(f) {
        if (vistas[f.fila]) return;
        vistas[f.fila] = true;
        filas.push(f);
      });
    });
    if (filas.length === 0) return;
    filas.sort(function(a, b) { return a.fila - b.fila; });

    salida.push({
      servicio: indiceUnicos_(filas.map(function(f) { return f.servicio; })).join(' / ') || '(sin servicio)',
      caso: indiceUnicos_(filas.map(function(f) { return f.caso; })).join(' / '),
      carpetaEnvio: info.cercano ? O.carpetas[info.cercano][0] : '',
      rama: '',
      resto: info.ruta.join('/'),
      archivo: j[1],
      id: j[0],
      url: 'https://drive.google.com/file/d/' + j[0] + '/view',
      modificado: j[3] || '',
      ambiente: indiceUnicos_(filas.map(function(f) { return f.ambiente; })).join(' / '),
      componente: indiceUnicos_(filas.map(function(f) { return f.componente; })).join(' / '),
      estado: indiceUnicos_(filas.map(function(f) { return f.estado; })).join(' / '),
      filas: filas.map(function(f) { return f.fila; }).join(', '),
      numerosFila: filas.map(function(f) { return f.fila; }),
      cruce: 'por link original',
      origen: 'Original'
    });
  });
  return salida;
}

/**
 * Filas sin copia con algún link original al que no hay acceso (o que fue
 * borrado), una entrada por fila y link, ordenadas por fila.
 */
function indiceFilasSinAcceso_(datos, filasSheet) {
  var O = datos.originales;
  if (!O) return [];
  var rev = indiceOriginalesPorRevisar_(datos, filasSheet);
  var lista = [];
  rev.ids.forEach(function(id) {
    if (O.estados[id] !== 'sin_acceso') return;
    rev.porId[id].forEach(function(f) {
      lista.push({
        fila: f.fila,
        caso: f.caso,
        servicio: f.servicio,
        componente: f.componente,
        estado: f.estado,
        id: id,
        url: 'https://drive.google.com/open?id=' + id
      });
    });
  });
  lista.sort(function(a, b) { return a.fila - b.fila; });
  return lista;
}

/**
 * Cruza los .json encontrados con las filas del Sheet y devuelve las filas
 * del índice, ordenadas por servicio y, dentro del servicio, del caso más
 * reciente al más viejo.
 *
 * datos: { raizId, carpetas: { id: [nombre, padre] },
 *          jsons: [[id, nombre, padre, modificadoIso]],
 *          originales (opcional): { estados, carpetas, jsons } }
 * filasSheet: [{ fila, caso, servicio, componente, ambiente, estado, ids }]
 *
 * Reglas de cruce:
 *   por carpeta: un link de la fila (columna C o D) apunta a una carpeta
 *                que contiene al .json.
 *   por ruta:    misma rama, servicio y caso que la ruta del .json.
 *   ambiguo:     por ruta, pero el caso tiene varias carpetas de envío
 *                (Caso, Caso_2...).
 *   sin fila:    ninguna fila coincide; el .json queda en el índice igual.
 *   por link original: el .json está en un original enlazado por una fila
 *                que no tiene copia en nuestra raíz.
 * Cada fila del Sheet se cruza por su cuenta: un mismo .json puede quedar
 * asociado a varias filas.
 */
function indiceArmarFilas_(datos, filasSheet) {
  var carpetas = datos.carpetas;

  var filasPorCarpeta = {};
  var filasPorRuta = {};
  filasSheet.forEach(function(f) {
    (f.ids || []).forEach(function(id) {
      if (!carpetas[id]) return;
      if (!filasPorCarpeta[id]) filasPorCarpeta[id] = [];
      filasPorCarpeta[id].push(f);
    });
    var clave = indiceClaveFila_(f);
    if (!filasPorRuta[clave]) filasPorRuta[clave] = [];
    filasPorRuta[clave].push(f);
  });

  var enviosPorClave = indiceEnviosPorClave_(datos);

  var salida = [];
  datos.jsons.forEach(function(j) {
    var cadena = indiceCadena_(j[2], datos.raizId, carpetas);
    if (!cadena) return;
    var nombres = cadena.map(function(c) { return c.nombre; });
    var ruta = indiceClasificarRuta_(nombres);

    var filas = null;
    var cruce = 'sin fila';
    for (var k = cadena.length - 1; k >= 0; k--) {
      if (filasPorCarpeta[cadena[k].id]) {
        filas = filasPorCarpeta[cadena[k].id];
        cruce = 'por carpeta';
        break;
      }
    }
    if (!filas && ruta) {
      var clave = ruta.rama + '|' + ruta.servicio + '|' + ruta.caso;
      if (filasPorRuta[clave]) {
        filas = filasPorRuta[clave];
        var envios = enviosPorClave[clave] ? Object.keys(enviosPorClave[clave]).length : 1;
        cruce = envios > 1 ? 'ambiguo' : 'por ruta';
      }
    }
    filas = filas || [];

    salida.push({
      servicio: ruta ? ruta.servicio : '(otra ubicación)',
      caso: ruta ? ruta.caso : '',
      carpetaEnvio: ruta ? ruta.carpetaEnvio : '',
      rama: ruta ? ruta.rama : '',
      resto: ruta ? ruta.resto : nombres.join('/'),
      archivo: j[1],
      id: j[0],
      url: 'https://drive.google.com/file/d/' + j[0] + '/view',
      modificado: j[3] || '',
      ambiente: indiceUnicos_(filas.map(function(f) { return f.ambiente; })).join(' / '),
      componente: indiceUnicos_(filas.map(function(f) { return f.componente; })).join(' / '),
      estado: indiceUnicos_(filas.map(function(f) { return f.estado; })).join(' / '),
      filas: filas.map(function(f) { return f.fila; }).join(', '),
      numerosFila: filas.map(function(f) { return f.fila; }),
      cruce: cruce,
      origen: 'Copia'
    });
  });

  if (datos.originales) {
    indiceArmarFilasOriginales_(datos, filasSheet).forEach(function(f) { salida.push(f); });
  }

  salida.sort(function(a, b) {
    var s = a.servicio.toLowerCase().localeCompare(b.servicio.toLowerCase());
    if (s !== 0) return s;
    var ca = parseInt(a.caso, 10);
    var cb = parseInt(b.caso, 10);
    var na = isNaN(ca);
    var nb = isNaN(cb);
    if (na !== nb) return na ? 1 : -1;
    if (!na && ca !== cb) return cb - ca;
    var e = a.carpetaEnvio.localeCompare(b.carpetaEnvio);
    if (e !== 0) return e;
    var r = a.resto.localeCompare(b.resto);
    if (r !== 0) return r;
    return a.archivo.localeCompare(b.archivo);
  });
  return salida;
}

/**
 * IDs de Drive de una celda: textos con hipervínculo y URLs pegadas como
 * texto plano, sin repetir.
 */
function indiceIdsDeCelda_(rich) {
  var vistos = {};
  var ids = [];
  function agregar(url) {
    var parsed = parsearIdDrive(url);
    if (!parsed || vistos[parsed.id]) return;
    vistos[parsed.id] = true;
    ids.push(parsed.id);
  }
  rich.getRuns().forEach(function(run) {
    var url = run.getLinkUrl();
    if (url) agregar(url);
  });
  (rich.getText().match(INDICE_REGEX_URL_DRIVE) || []).forEach(agregar);
  return ids;
}

var INDICE_CRUCES_SEGUROS = ['por carpeta', 'por ruta', 'por link original'];

/**
 * Decide qué filas reciben JSON en la columna N. Solo cuentan los cruces
 * seguros (por carpeta, por ruta o por link original); las filas que solo
 * tienen cruces ambiguos se dejan sin tocar. Si la N ya tiene algo se
 * decide al escribir, no acá.
 *
 * filasSinAcceso: { fila: true } de las filas con algún original sin acceso.
 *
 * Devuelve { objetivos: [{ fila, caso, servicio, urls }], ambiguas,
 * sinAcceso, sinJson }, con los objetivos ordenados por número de fila.
 */
function indicePlanColumnaN_(filasIndice, filasSheet, filasSinAcceso) {
  filasSinAcceso = filasSinAcceso || {};
  var porFila = {};
  var ambiguas = {};
  filasIndice.forEach(function(f) {
    (f.numerosFila || []).forEach(function(n) {
      if (f.cruce === 'ambiguo') {
        ambiguas[n] = true;
        return;
      }
      if (INDICE_CRUCES_SEGUROS.indexOf(f.cruce) === -1) return;
      if (!porFila[n]) porFila[n] = [];
      if (porFila[n].indexOf(f.url) === -1) porFila[n].push(f.url);
    });
  });

  var plan = { objetivos: [], ambiguas: 0, sinAcceso: 0, sinJson: 0 };
  filasSheet.forEach(function(f) {
    if (porFila[f.fila]) {
      plan.objetivos.push({ fila: f.fila, caso: f.caso, servicio: f.servicio, urls: porFila[f.fila] });
    } else if (ambiguas[f.fila]) {
      plan.ambiguas++;
    } else if (filasSinAcceso[f.fila]) {
      plan.sinAcceso++;
    } else {
      plan.sinJson++;
    }
  });
  plan.objetivos.sort(function(a, b) { return a.fila - b.fila; });
  return plan;
}

/**
 * Texto de la columna N con el mismo formato que deja el envío (una URL
 * por línea), con un tope de líneas.
 */
function indiceTextoColumnaN_(urls) {
  var max = INDICE_CONFIG.MAX_LINEAS_N;
  if (urls.length <= max) return urls.join('\n');
  return urls.slice(0, max).join('\n') + '\ny ' + (urls.length - max) +
    ' más en la pestaña ' + INDICE_CONFIG.PESTANA;
}

function indiceTrocear_(texto, tamano) {
  var trozos = [];
  for (var i = 0; i < texto.length; i += tamano) {
    trozos.push(texto.substring(i, i + tamano));
  }
  return trozos;
}

// ── Avance guardado en la pestaña oculta ──────────────────────────────
//
// A1 guarda el resumen (etapa, parte, contadores) y de A2 en adelante va,
// en trozos, el trabajo pendiente: cola de carpetas, carpetas vistas y
// .json encontrados. Una propiedad no alcanza: tiene tope de 9 KB.

function indicePestanaAvance_(ss) {
  var hoja = ss.getSheetByName(INDICE_CONFIG.PESTANA_AVANCE);
  if (!hoja) {
    hoja = ss.insertSheet(INDICE_CONFIG.PESTANA_AVANCE);
    hoja.getRange('A:A').setNumberFormat('@');
    hoja.hideSheet();
  }
  return hoja;
}

function indiceLeerResumen_(hoja) {
  var texto = String(hoja.getRange(1, 1).getValue() || '');
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch (err) {
    console.warn('[Indice] Resumen ilegible, se empieza de cero');
    return null;
  }
}

function indiceGuardarResumen_(hoja, resumen) {
  hoja.getRange(1, 1).setValue(JSON.stringify(resumen));
}

function indiceLeerTrabajo_(hoja) {
  var ultima = hoja.getLastRow();
  if (ultima < 2) return null;
  var valores = hoja.getRange(2, 1, ultima - 1, 1).getValues();
  var texto = valores.map(function(v) { return String(v[0] || ''); }).join('');
  if (!texto) return null;
  return JSON.parse(texto);
}

function indiceGuardarTodo_(hoja, resumen, trabajo) {
  var filas = [[JSON.stringify(resumen)]];
  if (trabajo) {
    indiceTrocear_(JSON.stringify(trabajo), INDICE_CONFIG.TAMANO_TROZO).forEach(function(t) {
      filas.push([t]);
    });
  }
  hoja.clearContents();
  hoja.getRange(1, 1, filas.length, 1).setValues(filas);
}

/**
 * Estado del índice para mostrar en el panel. Null si nunca se creó o no
 * se puede leer.
 */
function leerEstadoIndiceJson_() {
  var sheetId = obtenerSheetId();
  if (!sheetId) return null;
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var hoja = ss.getSheetByName(INDICE_CONFIG.PESTANA_AVANCE);
    var resumen = hoja ? indiceLeerResumen_(hoja) : null;
    if (!resumen) return null;
    var pestana = ss.getSheetByName(INDICE_CONFIG.PESTANA);
    resumen.urlPestana = pestana ? ss.getUrl() + '#gid=' + pestana.getSheetId() : '';
    return resumen;
  } catch (err) {
    console.warn('[Indice] No se pudo leer el estado: ' + err.message);
    return null;
  }
}

// ── Recorrido de Drive ────────────────────────────────────────────────

/**
 * Hijos de una carpeta, una carpeta por consulta. `driveId` es la unidad
 * compartida de nuestra raíz; `todasLasUnidades` se usa para carpetas de
 * otras personas, que pueden estar en cualquier unidad.
 */
function indiceListarHijos_(carpetaId, driveId, todasLasUnidades) {
  var params = {
    q: "'" + carpetaId + "' in parents and trashed = false",
    fields: 'nextPageToken,files(id,name,mimeType,modifiedTime)',
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  };
  if (todasLasUnidades) {
    params.corpora = 'allDrives';
  } else if (driveId) {
    params.corpora = 'drive';
    params.driveId = driveId;
  } else {
    params.corpora = 'user';
  }
  var hijos = [];
  var token = null;
  do {
    if (token) params.pageToken = token;
    var resp = Drive.Files.list(params);
    hijos = hijos.concat(resp.files || []);
    token = resp.nextPageToken;
  } while (token);
  return hijos;
}

/**
 * Un paso del recorrido de originales: primero abre cada link pendiente
 * (carpeta, .json suelto, otro archivo o sin acceso) y después recorre las
 * carpetas con acceso, una por consulta. Devuelve false si Drive pidió
 * esperar; el paso queda para la próxima parte.
 */
function indiceAvanzarOriginal_(O, cuenta) {
  function agregarJson(id, nombre, padre, modificado) {
    if (O.posJson[id] !== undefined) {
      if (padre && !O.jsons[O.posJson[id]][2]) O.jsons[O.posJson[id]][2] = padre;
      return;
    }
    O.posJson[id] = O.jsons.length;
    O.jsons.push([id, nombre, padre, modificado || '']);
    cuenta.jsons++;
  }

  if (O.pendientes.length > 0) {
    var id = O.pendientes.shift();
    var f;
    try {
      f = Drive.Files.get(id, { fields: 'id,name,mimeType,modifiedTime', supportsAllDrives: true });
    } catch (err) {
      if (indiceEsLimiteDeCuota_(err)) {
        O.pendientes.unshift(id);
        return false;
      }
      O.estados[id] = 'sin_acceso';
      cuenta.revisados++;
      cuenta.sinAcceso++;
      return true;
    }
    cuenta.revisados++;
    cuenta.conAcceso++;
    if (f.mimeType === INDICE_CONFIG.CARPETA_MIME) {
      O.estados[id] = 'carpeta';
      if (!O.carpetas[id]) {
        O.carpetas[id] = [f.name, null];
        O.cola.push(id);
      }
    } else if (/\.json$/i.test(f.name || '')) {
      O.estados[id] = 'json';
      agregarJson(id, f.name, '', f.modifiedTime);
    } else {
      O.estados[id] = 'otro';
    }
    return true;
  }

  if (O.cola.length > 0) {
    var carpetaId = O.cola.shift();
    var hijos;
    try {
      hijos = indiceListarHijos_(carpetaId, null, true);
    } catch (err) {
      if (indiceEsLimiteDeCuota_(err)) {
        O.cola.unshift(carpetaId);
        return false;
      }
      console.warn('[Indice] No se pudo listar una carpeta original: ' + err.message);
      return true;
    }
    hijos.forEach(function(h) {
      if (h.mimeType === INDICE_CONFIG.CARPETA_MIME) {
        if (!O.carpetas[h.id]) {
          O.carpetas[h.id] = [h.name, carpetaId];
          O.cola.push(h.id);
        } else if (O.carpetas[h.id][1] === null) {
          // Otro link apuntaba directo a esta subcarpeta: se engancha a su padre.
          O.carpetas[h.id][1] = carpetaId;
        }
      } else if (/\.json$/i.test(h.name || '')) {
        agregarJson(h.id, h.name, carpetaId, h.modifiedTime);
      }
    });
    cuenta.carpetas++;
  }
  return true;
}

function indiceEsLimiteDeCuota_(err) {
  var msg = String(err && err.message || '');
  return /rate limit|quota|429|userRateLimitExceeded|backendError/i.test(msg);
}

// ── Lectura del Sheet y escritura de la pestaña ───────────────────────

function indiceLeerFilasSheet_(ss) {
  var hoja = ss.getSheetByName(obtenerSheetTab());
  if (!hoja) throw new Error('No existe la pestaña de solicitudes configurada.');
  var ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  var n = ultima - 1;
  var valores = hoja.getRange(2, 1, n, SHEET_NUM_COLS).getValues();
  var richC = hoja.getRange(2, SHEET_COLS.DRIVE, n, 1).getRichTextValues();
  var richD = hoja.getRange(2, SHEET_COLS.REPOSITORIO, n, 1).getRichTextValues();
  var filas = [];
  for (var i = 0; i < n; i++) {
    var v = valores[i];
    var caso = String(v[SHEET_COLS.NUMERO_CASO - 1] || '').trim();
    if (!caso) continue;
    filas.push({
      fila: i + 2,
      caso: caso,
      servicio: String(v[SHEET_COLS.SERVICIO - 1] || ''),
      componente: String(v[SHEET_COLS.COMPONENTE - 1] || ''),
      ambiente: String(v[SHEET_COLS.AMBIENTE - 1] || ''),
      estado: String(v[SHEET_COLS.ESTADO - 1] || ''),
      ids: indiceIdsDeCelda_(richC[i][0]).concat(indiceIdsDeCelda_(richD[i][0]))
    });
  }
  return filas;
}

/**
 * Escribe la pestaña del índice. No la borra ni la reemplaza (eso rompería
 * fórmulas o filtros que apunten a ella): limpia su contenido y escribe.
 */
function indiceEscribirPestana_(ss, filas) {
  var hoja = ss.getSheetByName(INDICE_CONFIG.PESTANA);
  if (!hoja) hoja = ss.insertSheet(INDICE_CONFIG.PESTANA);

  var filtro = hoja.getFilter();
  if (filtro) filtro.remove();
  hoja.clearContents();

  var nCols = INDICE_ENCABEZADOS.length;
  var encabezado = hoja.getRange(1, 1, 1, nCols);
  encabezado.setValues([INDICE_ENCABEZADOS]).setFontWeight('bold');
  hoja.setFrozenRows(1);

  if (filas.length === 0) {
    hoja.getRange(2, 1).setValue('No se encontraron archivos .json bajo la carpeta raíz.');
    return;
  }

  var valores = filas.map(function(f) {
    return [
      sanitizarParaSheet(f.servicio),
      sanitizarParaSheet(f.caso),
      f.origen || 'Copia',
      sanitizarParaSheet(f.carpetaEnvio),
      f.rama,
      sanitizarParaSheet(f.resto),
      '',
      f.modificado ? new Date(f.modificado) : '',
      sanitizarParaSheet(f.ambiente),
      sanitizarParaSheet(f.componente),
      sanitizarParaSheet(f.estado),
      f.filas,
      f.cruce,
      f.url
    ];
  });
  hoja.getRange(2, 1, filas.length, nCols).setValues(valores);

  var colArchivo = INDICE_ENCABEZADOS.indexOf('Archivo') + 1;
  var links = filas.map(function(f) {
    return [SpreadsheetApp.newRichTextValue().setText(f.archivo).setLinkUrl(f.url).build()];
  });
  hoja.getRange(2, colArchivo, filas.length, 1).setRichTextValues(links);
  hoja.getRange(2, INDICE_ENCABEZADOS.indexOf('Modificado') + 1, filas.length, 1)
    .setNumberFormat('dd/mm/yyyy hh:mm');

  hoja.getRange(1, 1, filas.length + 1, nCols).createFilter();
}

/**
 * Pestaña con las filas sin copia cuyo original no se pudo abrir (sin
 * acceso o borrado), para pedir acceso al dueño. Se limpia y se reescribe.
 */
function indiceEscribirSinAcceso_(ss, lista) {
  var hoja = ss.getSheetByName(INDICE_CONFIG.PESTANA_SIN_ACCESO) ||
    ss.insertSheet(INDICE_CONFIG.PESTANA_SIN_ACCESO);
  var filtro = hoja.getFilter();
  if (filtro) filtro.remove();
  hoja.clearContents();

  var nCols = INDICE_ENCABEZADOS_SIN_ACCESO.length;
  hoja.getRange(1, 1, 1, nCols).setValues([INDICE_ENCABEZADOS_SIN_ACCESO]).setFontWeight('bold');
  hoja.setFrozenRows(1);
  if (lista.length === 0) {
    hoja.getRange(2, 1).setValue('Todas las filas sin copia tienen acceso a sus originales.');
    return;
  }

  hoja.getRange(2, 1, lista.length, nCols).setValues(lista.map(function(s) {
    return [s.fila, sanitizarParaSheet(s.caso), sanitizarParaSheet(s.servicio),
      sanitizarParaSheet(s.componente), sanitizarParaSheet(s.estado), ''];
  }));
  hoja.getRange(2, nCols, lista.length, 1).setRichTextValues(lista.map(function(s) {
    return [SpreadsheetApp.newRichTextValue().setText(s.url).setLinkUrl(s.url).build()];
  }));
  hoja.getRange(1, 1, lista.length + 1, nCols).createFilter();
}

/**
 * Escribe un bloque de la columna N con el lock tomado. Antes de escribir
 * vuelve a leer cada fila: si cambió de caso o servicio (alguien ordenó o
 * insertó filas) se salta, y si la N ya tiene algo no se toca.
 * Devuelve false si no consiguió el lock; el bloque queda para después.
 */
function indiceEscribirBloqueN_(ss, bloque, cuenta) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return false;
  try {
    var hoja = ss.getSheetByName(obtenerSheetTab());
    if (!hoja) throw new Error('No existe la pestaña de solicitudes configurada.');
    var ultima = hoja.getLastRow();
    var desde = bloque[0].fila;
    var hasta = Math.min(bloque[bloque.length - 1].fila, ultima);

    var datos = [];
    var columnaN = [];
    if (hasta >= desde) {
      var n = hasta - desde + 1;
      datos = hoja.getRange(desde, SHEET_COLS.NUMERO_CASO, n, 2).getValues();
      columnaN = hoja.getRange(desde, SHEET_COLS.ARCHIVOS_JSON, n, 1).getValues();
    }

    var escribir = [];
    bloque.forEach(function(t) {
      var i = t.fila - desde;
      if (t.fila > hasta ||
          String(datos[i][0] || '').trim() !== t.caso ||
          String(datos[i][1] || '') !== t.servicio) {
        cuenta.cambiaron++;
      } else if (String(columnaN[i][0] || '').trim() !== '') {
        cuenta.yaTenian++;
      } else {
        escribir.push(t);
      }
    });
    if (escribir.length === 0) return true;

    var celdaHeader = hoja.getRange(1, SHEET_COLS.ARCHIVOS_JSON);
    if (String(hoja.getRange(1, 1).getValue()).trim() !== '' &&
        String(celdaHeader.getValue()).trim() === '') {
      celdaHeader.setValue(SHEET_HEADERS[SHEET_COLS.ARCHIVOS_JSON - 1]).setFontWeight('bold');
    }

    // Filas seguidas se escriben juntas.
    var tramo = [];
    function escribirTramo() {
      if (tramo.length === 0) return;
      hoja.getRange(tramo[0].fila, SHEET_COLS.ARCHIVOS_JSON, tramo.length, 1)
        .setRichTextValues(tramo.map(function(t) {
          return [construirCeldaConEnlaces(indiceTextoColumnaN_(t.urls))];
        }));
      cuenta.llenadas += tramo.length;
      tramo = [];
    }
    escribir.forEach(function(t) {
      if (tramo.length > 0 && t.fila !== tramo[tramo.length - 1].fila + 1) escribirTramo();
      tramo.push(t);
    });
    escribirTramo();
    SpreadsheetApp.flush();
    return true;
  } finally {
    lock.releaseLock();
  }
}

// ── Avance por partes ─────────────────────────────────────────────────
//
// Mismo esquema que Reintentos.gs: la acción del panel solo prepara y
// programa un activador .after(); el trabajo pesado lo hace el activador,
// que tiene minutos y no los 30 s de una acción de tarjeta. Cada parte
// borra su propio activador al empezar y, si queda trabajo, programa el
// siguiente al terminar.

/**
 * Empieza un índice (nuevo o actualización) y deja el trabajo listo para
 * la primera parte. La pestaña no se borra: si ya tiene datos, se quedan
 * visibles hasta que la última parte los reemplaza.
 * Devuelve { ocupado } si hay una parte corriendo.
 */
function iniciarIndiceJson_(ss) {
  var raizId = obtenerCarpetaRaizId();
  if (!raizId) throw new Error('No hay carpeta raíz configurada.');
  var raiz = Drive.Files.get(raizId, { fields: 'id,driveId', supportsAllDrives: true });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ocupado: true };
  try {
    var hoja = indicePestanaAvance_(ss);
    var anterior = indiceLeerResumen_(hoja);
    if (anterior && anterior.ocupadoHasta > Date.now()) {
      return { ocupado: true, resumen: anterior };
    }

    if (!ss.getSheetByName(INDICE_CONFIG.PESTANA)) ss.insertSheet(INDICE_CONFIG.PESTANA);

    var resumen = {
      etapa: 'recorrer',
      raizId: raizId,
      driveId: raiz.driveId || '',
      iniciadoEn: Date.now(),
      parte: 0,
      carpetasRevisadas: 0,
      jsonsEncontrados: 0,
      carpetasPendientes: 1,
      errores: 0,
      historial: []
    };
    indiceGuardarTodo_(hoja, resumen, { cola: [raizId], carpetas: {}, jsons: [] });
    SpreadsheetApp.flush();
    return { resumen: resumen, hoja: hoja };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hace una parte del índice dentro del presupuesto.
 *
 * opciones.origen: 'automática' (activador) o 'botón' (respaldo desde el
 *   panel), para el historial.
 * opciones.programarSiguiente: si queda trabajo, programa la parte
 *   siguiente al terminar.
 * opciones.margenEscrituraMs: tiempo mínimo que debe quedar para escribir
 *   la pestaña en esta parte.
 *
 * Devuelve { resumen }, { ocupado } si otra parte tiene el turno, o
 * { sinTrabajo } si no hay un índice a medias.
 */
function avanzarIndiceJson_(sheetId, presupuestoMs, opciones) {
  opciones = opciones || {};
  var inicio = Date.now();
  var ss = SpreadsheetApp.openById(sheetId);
  var hoja = indicePestanaAvance_(ss);
  var margenEscritura = opciones.margenEscrituraMs || INDICE_CONFIG.MARGEN_ESCRITURA_MS;

  // Turno: solo una parte a la vez, aunque la lancen dos personas.
  var resumen;
  var trabajo;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ocupado: true, resumen: indiceLeerResumen_(hoja) };
  }
  try {
    resumen = indiceLeerResumen_(hoja);
    if (!resumen || resumen.etapa === 'terminado') return { sinTrabajo: true, resumen: resumen };
    if (resumen.ocupadoHasta > Date.now()) return { ocupado: true, resumen: resumen };
    var problema = '';
    if (resumen.raizId !== obtenerCarpetaRaizId()) {
      problema = 'La carpeta raíz cambió desde que empezó el índice. Presiona "Empezar de cero".';
    } else {
      trabajo = indiceLeerTrabajo_(hoja);
      if (!trabajo) problema = 'Se perdió el avance guardado. Presiona "Empezar de cero".';
    }
    if (problema) {
      resumen.ultimoError = problema;
      resumen.activador = null;
      indiceGuardarResumen_(hoja, resumen);
      return { error: problema, resumen: resumen };
    }

    resumen.parte++;
    resumen.ocupadoHasta = Date.now() + presupuestoMs + 60000;
    resumen.parteEnCurso = { n: resumen.parte, origen: opciones.origen || 'botón', inicio: inicio };
    resumen.ultimoError = '';
    if (opciones.origen === 'automática' && resumen.activador) {
      resumen.activador.corrioEn = inicio;
    }
    indiceGuardarResumen_(hoja, resumen);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  indiceMostrarAvance_(ss, resumen);

  var carpetasAntes = resumen.carpetasRevisadas;
  var jsonsAntes = resumen.jsonsEncontrados || 0;
  var ultimoGuardado = Date.now();
  function quedaMs() { return presupuestoMs - (Date.now() - inicio); }

  try {
    while (resumen.etapa === 'recorrer' && trabajo.cola.length > 0 &&
           quedaMs() > INDICE_CONFIG.MARGEN_CONSULTA_MS) {
      var carpetaId = trabajo.cola.shift();
      var hijos;
      try {
        hijos = indiceListarHijos_(carpetaId, resumen.driveId);
      } catch (err) {
        if (indiceEsLimiteDeCuota_(err)) {
          trabajo.cola.unshift(carpetaId);
          console.warn('[Indice] Límite de Drive, se sigue en la próxima parte');
          break;
        }
        resumen.errores++;
        console.warn('[Indice] No se pudo listar una carpeta: ' + err.message);
        continue;
      }
      hijos.forEach(function(h) {
        if (h.mimeType === INDICE_CONFIG.CARPETA_MIME) {
          trabajo.carpetas[h.id] = [h.name, carpetaId];
          trabajo.cola.push(h.id);
        } else if (/\.json$/i.test(h.name || '')) {
          trabajo.jsons.push([h.id, h.name, carpetaId, h.modifiedTime || '']);
        }
      });
      resumen.carpetasRevisadas++;

      // Contadores a la vista (tarjeta y pestaña) mientras corre la parte.
      if (Date.now() - ultimoGuardado > INDICE_CONFIG.GUARDAR_CONTADORES_MS) {
        resumen.carpetasPendientes = trabajo.cola.length;
        resumen.jsonsEncontrados = trabajo.jsons.length;
        indiceGuardarResumen_(hoja, resumen);
        indiceMostrarAvance_(ss, resumen);
        SpreadsheetApp.flush();
        ultimoGuardado = Date.now();
      }
    }
    if (resumen.etapa === 'recorrer') {
      resumen.carpetasPendientes = trabajo.cola.length;
      resumen.jsonsEncontrados = trabajo.jsons.length;
      if (trabajo.cola.length === 0) resumen.etapa = 'preparar';
    }

    // Filas sin copia: qué links originales hay que revisar.
    if (resumen.etapa === 'preparar' && quedaMs() > INDICE_CONFIG.MARGEN_CONSULTA_MS) {
      var porRevisar = indiceOriginalesPorRevisar_({
        raizId: resumen.raizId,
        carpetas: trabajo.carpetas,
        jsons: trabajo.jsons
      }, indiceLeerFilasSheet_(ss));
      trabajo.originales = {
        pendientes: porRevisar.ids,
        cola: [],
        estados: {},
        carpetas: {},
        jsons: [],
        posJson: {}
      };
      resumen.originales = {
        links: porRevisar.ids.length,
        revisados: 0,
        conAcceso: 0,
        sinAcceso: 0,
        carpetas: 0,
        jsons: 0
      };
      resumen.etapa = 'originales';
    }

    while (resumen.etapa === 'originales' && quedaMs() > INDICE_CONFIG.MARGEN_CONSULTA_MS) {
      if (!indiceAvanzarOriginal_(trabajo.originales, resumen.originales)) break;
      if (trabajo.originales.pendientes.length === 0 && trabajo.originales.cola.length === 0) {
        resumen.etapa = 'escribir';
      }
      if (Date.now() - ultimoGuardado > INDICE_CONFIG.GUARDAR_CONTADORES_MS) {
        indiceGuardarResumen_(hoja, resumen);
        indiceMostrarAvance_(ss, resumen);
        SpreadsheetApp.flush();
        ultimoGuardado = Date.now();
      }
    }

    if (resumen.etapa === 'escribir' && quedaMs() > margenEscritura) {
      var filasSheet = indiceLeerFilasSheet_(ss);
      var datos = {
        raizId: resumen.raizId,
        carpetas: trabajo.carpetas,
        jsons: trabajo.jsons,
        originales: trabajo.originales
      };
      var filas = indiceArmarFilas_(datos, filasSheet);
      indiceEscribirPestana_(ss, filas);
      resumen.filasIndice = filas.length;
      resumen.sinFila = filas.filter(function(f) { return f.cruce === 'sin fila'; }).length;

      var filasSinAcceso = {};
      if (trabajo.originales) {
        var sinAcceso = indiceFilasSinAcceso_(datos, filasSheet);
        indiceEscribirSinAcceso_(ss, sinAcceso);
        sinAcceso.forEach(function(s) { filasSinAcceso[s.fila] = true; });
        var filasConOriginal = {};
        filas.forEach(function(f) {
          if (f.origen !== 'Original') return;
          f.numerosFila.forEach(function(n) { filasConOriginal[n] = true; });
        });
        resumen.originales.filasConJson = Object.keys(filasConOriginal).length;
        resumen.originales.filasSinAcceso = Object.keys(filasSinAcceso).length;
      }

      // Lo que sigue solo necesita las filas a llenar; el árbol ya no.
      var plan = indicePlanColumnaN_(filas, filasSheet, filasSinAcceso);
      trabajo = { pendientesN: plan.objetivos };
      resumen.columnaN = {
        objetivo: plan.objetivos.length,
        llenadas: 0,
        yaTenian: 0,
        cambiaron: 0,
        ambiguas: plan.ambiguas,
        sinAcceso: plan.sinAcceso,
        sinJson: plan.sinJson
      };
      resumen.etapa = 'columnaN';
    }

    while (resumen.etapa === 'columnaN' && trabajo.pendientesN.length > 0 &&
           quedaMs() > INDICE_CONFIG.MARGEN_CONSULTA_MS) {
      var bloque = trabajo.pendientesN.slice(0, INDICE_CONFIG.BLOQUE_N);
      if (!indiceEscribirBloqueN_(ss, bloque, resumen.columnaN)) {
        console.warn('[Indice] Sheet ocupado, la columna N sigue en la próxima parte');
        break;
      }
      trabajo.pendientesN = trabajo.pendientesN.slice(bloque.length);
    }

    var terminado = resumen.etapa === 'columnaN' && trabajo.pendientesN.length === 0;
    if (terminado) {
      resumen.etapa = 'terminado';
      resumen.terminadoEn = Date.now();
    }

    indiceAnotarParte_(resumen, inicio, carpetasAntes, jsonsAntes, opciones.origen);
    resumen.activador = null;
    resumen.ocupadoHasta = 0;
    resumen.parteEnCurso = null;
    indiceGuardarTodo_(hoja, resumen, terminado ? null : trabajo);
    SpreadsheetApp.flush();

    if (!terminado && opciones.programarSiguiente) {
      if (resumen.parte < INDICE_CONFIG.MAX_PARTES) {
        indiceProgramarParte_(ss, hoja, resumen);
      } else {
        resumen.ultimoError = 'Se llegó al tope de ' + INDICE_CONFIG.MAX_PARTES + ' partes.';
        indiceGuardarResumen_(hoja, resumen);
      }
    }
    indiceMostrarAvance_(ss, resumen);
  } catch (err) {
    console.error('[Indice] Error en la parte ' + resumen.parte + ': ' + err.message);
    resumen.ultimoError = String(err.message || err).substring(0, 300);
    indiceAnotarParte_(resumen, inicio, carpetasAntes, jsonsAntes, opciones.origen);
    resumen.activador = null;
    resumen.ocupadoHasta = 0;
    resumen.parteEnCurso = null;
    indiceGuardarTodo_(hoja, resumen, trabajo);
    indiceMostrarAvance_(ss, resumen);
    return { error: resumen.ultimoError, resumen: resumen };
  }

  console.log('[Indice] Parte ' + resumen.parte + ' (' + (opciones.origen || 'botón') + '): ' +
    resumen.carpetasRevisadas + ' carpetas, ' + resumen.jsonsEncontrados + ' JSON, etapa ' +
    resumen.etapa + (resumen.activador ? ', siguiente: ' + resumen.activador.estado : ''));
  return { resumen: resumen };
}

function indiceAnotarParte_(resumen, inicio, carpetasAntes, jsonsAntes, origen) {
  var historial = resumen.historial || [];
  historial.unshift({
    n: resumen.parte,
    origen: origen || 'botón',
    inicio: inicio,
    ms: Date.now() - inicio,
    carpetas: resumen.carpetasRevisadas - carpetasAntes,
    jsons: (resumen.jsonsEncontrados || 0) - jsonsAntes
  });
  resumen.historial = historial.slice(0, INDICE_CONFIG.MAX_HISTORIAL);
}

/**
 * Mientras se recorren las carpetas, la pestaña del índice muestra el
 * avance. Sheets la refresca sola, sin recargar. Si la pestaña ya tiene
 * datos de un índice anterior, el avance va en una columna a la derecha
 * para no taparlos; si está vacía, va arriba. Al escribir el índice nuevo
 * se borra junto con lo demás.
 */
var INDICE_ETAPAS_CON_AVANCE = ['recorrer', 'preparar', 'originales', 'escribir'];

/**
 * Una línea con lo que lleva hecho la etapa actual, para la pestaña y la
 * tarjeta.
 */
function indiceTextoEtapa_(r) {
  var copias = r.carpetasRevisadas + ' carpetas propias revisadas · ' + (r.jsonsEncontrados || 0) + ' JSON';
  var o = r.originales;
  switch (r.etapa) {
    case 'recorrer':
      return copias + ' · faltan ' + (r.carpetasPendientes || 0) + ' carpetas (más las que aparezcan dentro)';
    case 'preparar':
      return copias + '. Buscando las filas sin copia para revisar sus originales.';
    case 'originales':
      return copias + '. Originales: ' + o.revisados + ' de ' + o.links + ' links revisados (' +
        o.conAcceso + ' con acceso, ' + o.sinAcceso + ' sin acceso) · ' + o.carpetas +
        ' carpetas recorridas · ' + o.jsons + ' JSON';
    case 'escribir':
      return copias + (o ? ' · ' + o.jsons + ' JSON en originales' : '') + '. Falta escribir el índice.';
    case 'columnaN':
      return 'Pestaña lista. Llenando la columna N: ' + indiceFilasRevisadasN_(r.columnaN) + ' de ' +
        r.columnaN.objetivo + ' filas revisadas.';
    default:
      return '';
  }
}

function indiceMostrarAvance_(ss, resumen) {
  if (!resumen || INDICE_ETAPAS_CON_AVANCE.indexOf(resumen.etapa) === -1) return;
  try {
    var pestana = ss.getSheetByName(INDICE_CONFIG.PESTANA) || ss.insertSheet(INDICE_CONFIG.PESTANA);
    var ahora = Date.now();
    var estado;
    if (resumen.ultimoError) {
      estado = '⚠️ Se detuvo por un error: ' + resumen.ultimoError;
    } else if (resumen.ocupadoHasta > ahora && resumen.parteEnCurso) {
      estado = '⏳ Trabajando: parte ' + resumen.parteEnCurso.n + ' (' + resumen.parteEnCurso.origen +
        '), empezó a las ' + formatearHoraIndice_(resumen.parteEnCurso.inicio);
    } else if (resumen.activador && resumen.activador.estado === 'programado') {
      estado = '⏱️ Parte ' + (resumen.parte + 1) + ' programada a las ' +
        formatearHoraIndice_(resumen.activador.en) + '; arranca sola en unos segundos.';
    } else if (resumen.activador) {
      estado = '⚠️ No se pudo programar la parte siguiente: ' +
        (resumen.activador.detalle || resumen.activador.estado) + '. Continúa desde el panel.';
    } else {
      estado = '⏸️ En pausa. Continúa desde el panel del add-on.';
    }
    var avance = indiceTextoEtapa_(resumen);
    var conDatos = String(pestana.getRange(1, 1).getValue()) === INDICE_ENCABEZADOS[0];
    var columna = conDatos ? INDICE_ENCABEZADOS.length + 2 : 1;
    pestana.getRange(1, columna, 4, 1).setValues([
      [conDatos
        ? 'Actualizando el índice. Los datos de la izquierda son del índice anterior y se reemplazan al terminar.'
        : 'Índice de JSON: creando. Los datos aparecen aquí al terminar.'],
      [estado],
      [avance],
      ['Última actualización: ' + formatearHoraIndice_(ahora)]
    ]);
    pestana.getRange(1, columna).setFontWeight('bold');
  } catch (err) {
    console.warn('[Indice] No se pudo mostrar el avance en la pestaña: ' + err.message);
  }
}

/**
 * Activadores de tiempo del usuario en este proyecto, por tipo. Sirve para
 * ver en el panel si el del índice existe y cuánto cupo queda.
 */
function indiceContarActivadores_() {
  var res = { indice: 0, reintentos: 0, total: 0 };
  try {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getEventType() !== ScriptApp.EventType.CLOCK) return;
      res.total++;
      if (t.getHandlerFunction() === INDICE_CONFIG.HANDLER_ACTIVADOR) res.indice++;
      if (t.getHandlerFunction() === 'reintentarCopiaPendiente') res.reintentos++;
    });
  } catch (err) {
    res.error = err.message;
  }
  return res;
}

/**
 * Programa la parte siguiente. El estado se guarda antes de crear el
 * activador, para que la parte nueva no lea un resumen viejo; si la
 * creación falla, se anota el error exacto (los activadores de un add-on
 * no avisan por correo cuando fallan).
 */
function indiceProgramarParte_(ss, hoja, resumen) {
  var activos = contarTriggersActivos();
  if (activos >= REINTENTOS_CONFIG.MAX_TRIGGERS_ACTIVOS) {
    resumen.activador = {
      estado: 'sin_cupo',
      en: Date.now(),
      detalle: 'ya hay ' + activos + ' activadores de tiempo en uso (tope ' +
        REINTENTOS_CONFIG.MAX_TRIGGERS_ACTIVOS + ')'
    };
    indiceGuardarResumen_(hoja, resumen);
    return resumen.activador;
  }

  resumen.activador = { estado: 'programado', en: Date.now() };
  indiceGuardarResumen_(hoja, resumen);
  SpreadsheetApp.flush();
  try {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === INDICE_CONFIG.HANDLER_ACTIVADOR) ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger(INDICE_CONFIG.HANDLER_ACTIVADOR)
      .timeBased()
      .after(REINTENTOS_CONFIG.DELAY_TRIGGER_MS)
      .create();
    console.log('[Indice] Parte ' + (resumen.parte + 1) + ' programada');
  } catch (err) {
    console.error('[Indice] No se pudo crear el activador: ' + err.message);
    resumen.activador = {
      estado: 'error',
      en: Date.now(),
      detalle: String(err.message || err).substring(0, 200)
    };
    indiceGuardarResumen_(hoja, resumen);
  }
  return resumen.activador;
}

/**
 * Handler del activador. Como en los reintentos, borra su propio activador
 * (aquí al empezar, para que una parte que se corta por tiempo no deje uno
 * viejo listado), hace una parte larga y programa la siguiente si falta.
 */
function continuarIndiceJson(e) {
  console.log('[Indice] Activador disparado');
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var propio = e && e.triggerUid
      ? t.getUniqueId() === e.triggerUid
      : t.getHandlerFunction() === INDICE_CONFIG.HANDLER_ACTIVADOR;
    if (propio) {
      try { ScriptApp.deleteTrigger(t); } catch (err) { /* ya no existe */ }
    }
  });

  var sheetId = PropertiesService.getUserProperties().getProperty('INDICE_SHEET_ID') || obtenerSheetId();
  if (!sheetId) {
    console.warn('[Indice] Sin Sheet configurado, no se sigue');
    return;
  }

  var res = avanzarIndiceJson_(sheetId, INDICE_CONFIG.PRESUPUESTO_ACTIVADOR_MS, {
    origen: 'automática',
    programarSiguiente: true
  });
  if (res.ocupado) console.log('[Indice] Otra parte está corriendo; esta termina sin hacer nada');
  if (res.sinTrabajo) console.log('[Indice] No hay un índice a medias; nada que hacer');
}

// ── Panel ─────────────────────────────────────────────────────────────

function formatearFechaIndice_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

function formatearHoraIndice_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'HH:mm:ss');
}

function formatearDuracionIndice_(ms) {
  var s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
}

function indiceFilasRevisadasN_(c) {
  return c ? c.llenadas + c.yaTenian + c.cambiaron : 0;
}

/**
 * Una línea de estado para el menú del panel.
 */
function textoCortoIndiceJson_() {
  var r = leerEstadoIndiceJson_();
  if (!r) return 'Todavía no se ha creado.';
  if (r.etapa === 'terminado') {
    return '✅ ' + r.filasIndice + ' JSON · actualizado el ' + formatearFechaIndice_(r.terminadoEn) +
      (r.columnaN ? '<br>' + r.columnaN.llenadas + ' fila(s) llenadas en la columna N' : '');
  }
  if (r.ocupadoHasta > Date.now()) {
    return '⏳ Actualizando: parte ' + r.parte + ', ' + r.carpetasRevisadas + ' carpetas revisadas';
  }
  if (r.activador && r.activador.estado === 'programado' && !r.activador.corrioEn) {
    return '⏱️ Parte ' + (r.parte + 1) + ' programada, ' + r.carpetasRevisadas + ' carpetas revisadas';
  }
  return '⏸️ A medias: ' + r.carpetasRevisadas + ' carpetas revisadas. Entra para continuar.';
}

/**
 * ¿La parte siguiente debería estar corriendo y no lo está? En ese caso
 * se ofrece avanzar desde el panel.
 */
function indiceActivadorConProblema_(r, ahora) {
  if (!r.activador) return true;
  if (r.activador.estado !== 'programado') return true;
  if (r.activador.corrioEn) return true;
  return ahora - r.activador.en > INDICE_CONFIG.ESPERA_ACTIVADOR_MS;
}

/**
 * Tarjeta del índice: estado, qué está corriendo ahora, si la parte
 * siguiente arranca sola, el historial de partes y los activadores.
 */
function buildIndiceJsonCard_() {
  var r = leerEstadoIndiceJson_();
  var ahora = Date.now();
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Índice de JSON')
        .setSubtitle('Pestaña "' + INDICE_CONFIG.PESTANA + '" del Sheet configurado')
    );

  var estado = CardService.newCardSection();
  var ocupado = !!(r && r.ocupadoHasta > ahora);
  var botones = CardService.newButtonSet();

  function boton(texto, funcion, principal) {
    var b = CardService.newTextButton()
      .setText(texto)
      .setOnClickAction(CardService.newAction().setFunctionName(funcion));
    if (principal) {
      b.setTextButtonStyle(CardService.TextButtonStyle.FILLED).setBackgroundColor('#1a73e8');
    }
    botones.addButton(b);
  }

  if (!r) {
    estado.addWidget(CardService.newTextParagraph().setText(
      'Todavía no hay índice. Al presionar el botón se crea la pestaña "' + INDICE_CONFIG.PESTANA +
      '" y el trabajo sigue solo en segundo plano: recorre la carpeta raíz, escribe una fila por cada .json ' +
      '(servicio, caso, ambiente, componente, estado y link) y llena la columna N de las filas que la tengan vacía.<br>' +
      '<i>El avance se ve en la misma pestaña mientras corre.</i>'
    ));
    boton('🗂️ Crear índice', 'onIniciarIndiceJson', true);
  } else if (r.etapa === 'terminado') {
    estado.addWidget(CardService.newTextParagraph().setText(
      '✅ <b>Actualizado el ' + formatearFechaIndice_(r.terminadoEn) + '</b><br>' +
      r.filasIndice + ' JSON en ' + r.carpetasRevisadas + ' carpetas, en ' + r.parte +
      ' parte' + (r.parte === 1 ? '' : 's') +
      (r.sinFila ? '<br>' + r.sinFila + ' JSON sin fila en el Sheet' : '') +
      (r.errores ? '<br>' + r.errores + ' carpeta(s) no se pudieron leer' : '')
    ));
    if (r.originales) {
      var o = r.originales;
      estado.addWidget(CardService.newTextParagraph().setText(
        '<b>Originales (filas sin copia)</b><br>' +
        o.links + ' links revisados: ' + o.conAcceso + ' con acceso, ' + o.sinAcceso + ' sin acceso o borrados<br>' +
        o.jsons + ' JSON en originales, para ' + (o.filasConJson || 0) + ' fila(s)' +
        (o.filasSinAcceso
          ? '<br>🔒 ' + o.filasSinAcceso + ' fila(s) con originales sin acceso: ver la pestaña "' +
            INDICE_CONFIG.PESTANA_SIN_ACCESO + '"'
          : '')
      ));
    }
    if (r.columnaN) {
      var c = r.columnaN;
      estado.addWidget(CardService.newTextParagraph().setText(
        '<b>Columna N (Archivos JSON)</b><br>' +
        '✏️ ' + c.llenadas + ' fila(s) llenadas ahora<br>' +
        '✔️ ' + c.yaTenian + ' ya tenían JSON (no se tocaron)' +
        (c.cambiaron ? '<br>↕️ ' + c.cambiaron + ' se saltaron porque la fila cambió mientras corría' : '') +
        (c.ambiguas ? '<br>❔ ' + c.ambiguas + ' con varias carpetas del mismo caso (ambiguas, sin tocar)' : '') +
        (c.sinAcceso !== undefined
          ? '<br>🔒 ' + c.sinAcceso + ' sin JSON porque su original no tiene acceso' +
            '<br>➖ ' + c.sinJson + ' sin JSON ni en la copia ni en el original'
          : '<br>➖ ' + c.sinJson + ' sin JSON en nuestras carpetas (copiadas sin JSON o solo con originales)')
      ));
    }
    estado.addWidget(CardService.newTextParagraph().setText(
      '<i>"Actualizar" usa la misma pestaña: los datos actuales se ven mientras corre y se reemplazan al terminar. ' +
      '"Empezar de cero" solo borra la pestaña y el avance.</i>'
    ));
    boton('🔄 Actualizar índice', 'onIniciarIndiceJson', true);
    boton('🗑️ Empezar de cero', 'onEmpezarDeCeroIndiceJson', false);
  } else {
    var lineas = [];
    if (ocupado && r.parteEnCurso) {
      lineas.push('⏳ <b>Trabajando ahora: parte ' + r.parteEnCurso.n + ' (' + r.parteEnCurso.origen +
        ')</b>, empezó a las ' + formatearHoraIndice_(r.parteEnCurso.inicio) +
        ' (hace ' + formatearDuracionIndice_(ahora - r.parteEnCurso.inicio) + ').');
      lineas.push('<i>Mientras corre no se puede empezar de cero: se podrá cuando termine esta parte, a más tardar a las ' +
        formatearHoraIndice_(r.ocupadoHasta) + ', aunque la parte se haya caído.</i>');
    } else if (r.activador && r.activador.corrioEn) {
      lineas.push('<font color="#d93025">⚠️ <b>La parte automática empezó a las ' +
        formatearHoraIndice_(r.activador.corrioEn) + ' pero no terminó bien.</b> Continúa; sigue desde lo último guardado.</font>');
    } else if (r.activador && r.activador.estado === 'programado') {
      var espera = ahora - r.activador.en;
      if (espera < INDICE_CONFIG.ESPERA_ACTIVADOR_MS) {
        lineas.push('⏱️ <b>La parte ' + (r.parte + 1) + ' arranca sola en unos segundos</b> (programada a las ' +
          formatearHoraIndice_(r.activador.en) + ').');
      } else {
        lineas.push('<font color="#d93025">⚠️ <b>La parte ' + (r.parte + 1) + ' se programó a las ' +
          formatearHoraIndice_(r.activador.en) + ' y Google no la ha corrido</b> (hace ' +
          formatearDuracionIndice_(espera) + '). Usa "Avanzar desde aquí".</font>');
      }
    } else if (r.activador) {
      lineas.push('<font color="#d93025">⚠️ <b>No se pudo programar la parte siguiente</b>: ' +
        escaparHtml(r.activador.detalle || r.activador.estado) + '</font>');
    } else {
      lineas.push('⏸️ <b>En pausa.</b> Presiona "Continuar".');
    }
    lineas.push(escaparHtml(indiceTextoEtapa_(r)));
    lineas.push('<i>El avance también se ve en la pestaña "' + INDICE_CONFIG.PESTANA +
      '". Esta tarjeta no se refresca sola: usa "Ver avance".</i>');
    estado.addWidget(CardService.newTextParagraph().setText(lineas.join('<br>')));

    if (!ocupado) {
      boton('▶️ Continuar', 'onContinuarIndiceJson', true);
    }
    boton('🔄 Ver avance', 'onVerAvanceIndiceJson', false);
    boton('🗑️ Empezar de cero', 'onEmpezarDeCeroIndiceJson', false);
    if (!ocupado && indiceActivadorConProblema_(r, ahora)) {
      boton('⚙️ Avanzar desde aquí', 'onAvanzarAquiIndiceJson', false);
    }
  }
  if (r && r.ultimoError) {
    estado.addWidget(CardService.newTextParagraph().setText(
      '<font color="#d93025">Último error: ' + escaparHtml(r.ultimoError) + '</font>'
    ));
  }
  if (r && r.urlPestana) {
    botones.addButton(
      CardService.newTextButton()
        .setText('Abrir pestaña')
        .setOpenLink(CardService.newOpenLink().setUrl(r.urlPestana))
    );
  }
  estado.addWidget(botones);
  card.addSection(estado);

  if (r && r.historial && r.historial.length > 0) {
    var partes = r.historial.map(function(p) {
      return 'Parte ' + p.n + ' · ' + p.origen + ' · ' + formatearHoraIndice_(p.inicio) +
        ' · ' + formatearDuracionIndice_(p.ms) + ' · +' + p.carpetas + ' carpetas, +' + p.jsons + ' JSON';
    });
    card.addSection(
      CardService.newCardSection()
        .setHeader('Partes (la más reciente arriba)')
        .addWidget(CardService.newTextParagraph().setText(partes.join('<br>')))
    );
  }

  var act = indiceContarActivadores_();
  card.addSection(
    CardService.newCardSection()
      .setHeader('Activadores')
      .setCollapsible(true)
      .addWidget(CardService.newTextParagraph().setText(
        act.error
          ? 'No se pudieron leer: ' + escaparHtml(act.error)
          : 'Del índice: ' + act.indice + ' · de reintentos: ' + act.reintentos +
            ' · de tiempo en total: ' + act.total + ' (tope ' + REINTENTOS_CONFIG.MAX_TRIGGERS_ACTIVOS + ')<br>' +
            '<i>También se ven en script.google.com → Mis activadores.</i>'
      ))
  );

  return card.build();
}

function respuestaIndiceJson_(aviso) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildIndiceJsonCard_()))
    .setNotification(CardService.newNotification().setText(aviso))
    .build();
}

/**
 * Botón "Índice de JSON" del menú del panel.
 */
function onAbrirIndiceJson(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildIndiceJsonCard_()))
    .build();
}

function onVerAvanceIndiceJson(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildIndiceJsonCard_()))
    .build();
}

/**
 * "Crear índice" y "Actualizar índice": programa la primera parte sobre la
 * misma pestaña, sin borrarla. No recorre nada aquí.
 */
function onIniciarIndiceJson(e) {
  var aviso;
  try {
    var motivo = motivoConfigInvalida();
    if (motivo) throw new Error(motivo);
    var sheetId = obtenerSheetId();
    PropertiesService.getUserProperties().setProperty('INDICE_SHEET_ID', sheetId);
    var ss = SpreadsheetApp.openById(sheetId);

    var ini = iniciarIndiceJson_(ss);
    if (ini.ocupado) {
      aviso = 'Hay una parte corriendo.' + indiceTextoEspera_(ini.resumen);
    } else {
      var act = indiceProgramarParte_(ss, ini.hoja, ini.resumen);
      indiceMostrarAvance_(ss, ini.resumen);
      aviso = act.estado === 'programado'
        ? 'Índice programado: arranca solo en unos segundos. El avance se ve en la pestaña ' + INDICE_CONFIG.PESTANA + '.'
        : 'No se pudo programar el índice: ' + (act.detalle || act.estado);
    }
  } catch (err) {
    console.error('[Indice] ' + err.message);
    aviso = 'No se pudo crear el índice: ' + err.message;
  }
  return respuestaIndiceJson_(aviso);
}

function indiceTextoEspera_(resumen) {
  return resumen && resumen.ocupadoHasta
    ? ' Se podrá a más tardar a las ' + formatearHoraIndice_(resumen.ocupadoHasta) + '.'
    : ' Intenta en unos segundos.';
}

/**
 * "Empezar de cero": solo borra. Quita la pestaña del índice, el avance
 * guardado y el activador pendiente; no arranca nada. La columna N de la
 * pestaña de solicitudes no se toca.
 */
function onEmpezarDeCeroIndiceJson(e) {
  var aviso;
  var lock = LockService.getScriptLock();
  var conLock = false;
  try {
    conLock = lock.tryLock(10000);
    if (!conLock) throw new Error('el Sheet está ocupado, intenta en unos segundos.');
    var ss = SpreadsheetApp.openById(obtenerSheetId());
    var hoja = ss.getSheetByName(INDICE_CONFIG.PESTANA_AVANCE);
    var r = hoja ? indiceLeerResumen_(hoja) : null;
    if (r && r.ocupadoHasta > Date.now()) {
      aviso = 'Hay una parte corriendo; no se puede borrar todavía.' + indiceTextoEspera_(r);
    } else {
      [INDICE_CONFIG.PESTANA, INDICE_CONFIG.PESTANA_SIN_ACCESO].forEach(function(nombre) {
        var pestana = ss.getSheetByName(nombre);
        if (pestana) ss.deleteSheet(pestana);
      });
      if (hoja) hoja.clearContents();
      ScriptApp.getProjectTriggers().forEach(function(t) {
        if (t.getHandlerFunction() === INDICE_CONFIG.HANDLER_ACTIVADOR) ScriptApp.deleteTrigger(t);
      });
      aviso = 'Índice borrado. Presiona "Crear índice" cuando quieras empezar.';
    }
  } catch (err) {
    console.error('[Indice] ' + err.message);
    aviso = 'No se pudo borrar el índice: ' + err.message;
  } finally {
    if (conLock) lock.releaseLock();
  }
  return respuestaIndiceJson_(aviso);
}

/**
 * "Continuar": vuelve a programar la parte siguiente sin hacer trabajo aquí.
 */
function onContinuarIndiceJson(e) {
  var aviso;
  try {
    var ss = SpreadsheetApp.openById(obtenerSheetId());
    var hoja = indicePestanaAvance_(ss);
    var r = indiceLeerResumen_(hoja);
    if (!r || r.etapa === 'terminado') {
      aviso = 'No hay un índice a medias.';
    } else if (r.ocupadoHasta > Date.now()) {
      aviso = 'Ya hay una parte corriendo.';
    } else {
      r.ultimoError = '';
      var act = indiceProgramarParte_(ss, hoja, r);
      indiceMostrarAvance_(ss, r);
      aviso = act.estado === 'programado'
        ? 'Parte ' + (r.parte + 1) + ' programada: arranca sola en unos segundos.'
        : 'No se pudo programar: ' + (act.detalle || act.estado);
    }
  } catch (err) {
    console.error('[Indice] ' + err.message);
    aviso = 'No se pudo continuar: ' + err.message;
  }
  return respuestaIndiceJson_(aviso);
}

/**
 * Respaldo si el activador no corre: hace una parte corta desde el panel
 * (una acción de tarjeta tiene 30 s) y no programa la siguiente.
 */
function onAvanzarAquiIndiceJson(e) {
  var aviso;
  try {
    var res = avanzarIndiceJson_(obtenerSheetId(), INDICE_CONFIG.PRESUPUESTO_BOTON_MS, {
      origen: 'botón',
      programarSiguiente: false,
      margenEscrituraMs: INDICE_CONFIG.MARGEN_ESCRITURA_BOTON_MS
    });
    var r = res.resumen || {};
    if (res.ocupado) aviso = 'Ya hay una parte corriendo.';
    else if (res.sinTrabajo) aviso = 'No hay un índice a medias.';
    else if (res.error) aviso = 'No se pudo avanzar: ' + res.error;
    else if (r.etapa === 'terminado') aviso = 'Índice terminado: ' + r.filasIndice + ' JSON.';
    else aviso = 'Parte ' + r.parte + ' lista. Presiona otra vez para seguir.';
  } catch (err) {
    console.error('[Indice] ' + err.message);
    aviso = 'No se pudo avanzar: ' + err.message;
  }
  return respuestaIndiceJson_(aviso);
}

// Nombres de botones de versiones anteriores. Una tarjeta que quedó
// abierta en el panel sigue llamándolos hasta que se vuelve a abrir.
function onReiniciarIndiceJson(e) {
  return onEmpezarDeCeroIndiceJson(e);
}

function onActualizarIndiceJson(e) {
  var r = leerEstadoIndiceJson_();
  return r && r.etapa !== 'terminado' ? onContinuarIndiceJson(e) : onIniciarIndiceJson(e);
}
