/**
 * IndiceJson.gs: índice de los .json guardados bajo la carpeta raíz.
 *
 * Recorre la carpeta raíz configurada, una carpeta por consulta (la consulta
 * agrupada por padres pierde archivos sin avisar en carpetas de otros), y
 * escribe en la pestaña "Índice JSON" una fila por cada .json con su
 * servicio, caso, ambiente, componente, estado y link.
 *
 * El trabajo se hace por partes que guardan su avance en una pestaña oculta
 * del mismo Sheet. El botón del panel hace una parte corta (una acción de
 * tarjeta tiene 30 s) y programa un activador .after() que sigue en segundo
 * plano. Si el activador no corre, volver a presionar el botón continúa
 * desde donde quedó.
 *
 * Al final llena la columna N (Archivos JSON) de la pestaña de solicitudes,
 * solo en filas con la N vacía y con un cruce seguro (por carpeta o por
 * ruta), revisando cada fila justo antes de escribir.
 */

var INDICE_CONFIG = {
  PESTANA: 'Índice JSON',
  PESTANA_AVANCE: 'Índice JSON (avance)',
  PRESUPUESTO_BOTON_MS: 15000,
  PRESUPUESTO_ACTIVADOR_MS: 4.5 * 60 * 1000,
  // Tiempo mínimo que debe quedar para empezar a escribir la pestaña.
  MARGEN_ESCRITURA_MS: 8000,
  // Tiempo que se reserva para no empezar otra consulta al final de la parte.
  MARGEN_CONSULTA_MS: 3000,
  // Un avance que no termina en este tiempo se considera abandonado y se
  // empieza de cero.
  EDAD_MAX_MS: 6 * 60 * 60 * 1000,
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
  'Servicio', 'Caso', 'Carpeta del envío', 'Rama', 'Ruta dentro del caso',
  'Archivo', 'Modificado', 'Ambiente', 'Componente', 'Estado', 'Fila(s)',
  'Cruce', 'URL'
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
 * Cruza los .json encontrados con las filas del Sheet y devuelve las filas
 * del índice, ordenadas por servicio y, dentro del servicio, del caso más
 * reciente al más viejo.
 *
 * datos: { raizId, carpetas: { id: [nombre, padre] },
 *          jsons: [[id, nombre, padre, modificadoIso]] }
 * filasSheet: [{ fila, caso, servicio, componente, ambiente, estado, ids }]
 *
 * Reglas de cruce:
 *   por carpeta: un link de la fila (columna C o D) apunta a una carpeta
 *                que contiene al .json.
 *   por ruta:    misma rama, servicio y caso que la ruta del .json.
 *   ambiguo:     por ruta, pero el caso tiene varias carpetas de envío
 *                (Caso, Caso_2...).
 *   sin fila:    ninguna fila coincide; el .json queda en el índice igual.
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
    var rama = esComponenteAPIM(String(f.componente || '').trim()) ? 'APIM' : 'General';
    var clave = rama + '|' + indiceLimpiarServicio_(f.servicio) + '|' + String(f.caso).trim();
    if (!filasPorRuta[clave]) filasPorRuta[clave] = [];
    filasPorRuta[clave].push(f);
  });

  // Carpetas de envío por caso, tengan o no .json, para detectar Caso_N.
  var enviosPorClave = {};
  Object.keys(carpetas).forEach(function(id) {
    var cadena = indiceCadena_(id, datos.raizId, carpetas);
    if (!cadena) return;
    var ruta = indiceClasificarRuta_(cadena.map(function(c) { return c.nombre; }));
    if (!ruta || ruta.resto !== '') return;
    var clave = ruta.rama + '|' + ruta.servicio + '|' + ruta.caso;
    if (!enviosPorClave[clave]) enviosPorClave[clave] = {};
    enviosPorClave[clave][ruta.carpetaEnvio] = true;
  });

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
      cruce: cruce
    });
  });

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

/**
 * Decide qué filas reciben JSON en la columna N. Solo cuentan los cruces
 * "por carpeta" y "por ruta"; las filas que solo tienen cruces ambiguos se
 * dejan sin tocar. Si la N ya tiene algo se decide al escribir, no acá.
 *
 * Devuelve { objetivos: [{ fila, caso, servicio, urls }], ambiguas, sinJson },
 * con los objetivos ordenados por número de fila.
 */
function indicePlanColumnaN_(filasIndice, filasSheet) {
  var porFila = {};
  var ambiguas = {};
  filasIndice.forEach(function(f) {
    (f.numerosFila || []).forEach(function(n) {
      if (f.cruce === 'ambiguo') {
        ambiguas[n] = true;
        return;
      }
      if (f.cruce !== 'por carpeta' && f.cruce !== 'por ruta') return;
      if (!porFila[n]) porFila[n] = [];
      if (porFila[n].indexOf(f.url) === -1) porFila[n].push(f.url);
    });
  });

  var plan = { objetivos: [], ambiguas: 0, sinJson: 0 };
  filasSheet.forEach(function(f) {
    if (porFila[f.fila]) {
      plan.objetivos.push({ fila: f.fila, caso: f.caso, servicio: f.servicio, urls: porFila[f.fila] });
    } else if (ambiguas[f.fila]) {
      plan.ambiguas++;
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

function indiceListarHijos_(carpetaId, driveId) {
  var params = {
    q: "'" + carpetaId + "' in parents and trashed = false",
    fields: 'nextPageToken,files(id,name,mimeType,modifiedTime)',
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  };
  if (driveId) {
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

  var links = filas.map(function(f) {
    return [SpreadsheetApp.newRichTextValue().setText(f.archivo).setLinkUrl(f.url).build()];
  });
  hoja.getRange(2, 6, filas.length, 1).setRichTextValues(links);
  hoja.getRange(2, 7, filas.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');

  hoja.getRange(1, 1, filas.length + 1, nCols).createFilter();
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

/**
 * Hace una parte del índice dentro del presupuesto. Devuelve el resumen,
 * con `ocupado: true` si otra ejecución tiene el turno.
 *
 * opciones.origen: 'botón' o 'automática', para el historial del panel.
 * opciones.programarSiguiente: si queda trabajo, deja programada la parte
 * siguiente. El estado del activador se anota en el resumen antes de
 * crearlo, para que la parte nueva no encuentre un resumen viejo.
 */
function avanzarIndiceJson_(sheetId, presupuestoMs, opciones) {
  opciones = opciones || {};
  var inicio = Date.now();
  var ss = SpreadsheetApp.openById(sheetId);
  var hoja = indicePestanaAvance_(ss);
  var raizId = obtenerCarpetaRaizId();
  if (!raizId) throw new Error('No hay carpeta raíz configurada.');

  // Turno: solo una ejecución a la vez, aunque la lancen dos personas.
  var resumen;
  var trabajo = null;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ocupado: true, resumen: indiceLeerResumen_(hoja) };
  }
  try {
    resumen = indiceLeerResumen_(hoja);
    if (resumen && resumen.ocupadoHasta > Date.now()) {
      return { ocupado: true, resumen: resumen };
    }
    var empezar = !resumen ||
      resumen.etapa === 'terminado' ||
      resumen.raizId !== raizId ||
      (Date.now() - resumen.iniciadoEn) > INDICE_CONFIG.EDAD_MAX_MS;
    if (!empezar) {
      trabajo = indiceLeerTrabajo_(hoja);
      if (!trabajo) empezar = true;
    }
    if (empezar) {
      var raiz = Drive.Files.get(raizId, { fields: 'id,driveId', supportsAllDrives: true });
      resumen = {
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
      trabajo = { cola: [raizId], carpetas: {}, jsons: [] };
    }
    resumen.parte++;
    resumen.ocupadoHasta = Date.now() + presupuestoMs + 60000;
    resumen.parteEnCurso = { n: resumen.parte, origen: opciones.origen || 'botón', inicio: inicio };
    resumen.ultimoError = '';
    if (opciones.origen === 'automática' && resumen.activador) {
      resumen.activador.corrioEn = inicio;
    }
    if (empezar) {
      indiceGuardarTodo_(hoja, resumen, trabajo);
    } else {
      indiceGuardarResumen_(hoja, resumen);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

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

      // Contadores a la vista mientras corre una parte larga.
      if (Date.now() - ultimoGuardado > INDICE_CONFIG.GUARDAR_CONTADORES_MS) {
        resumen.carpetasPendientes = trabajo.cola.length;
        resumen.jsonsEncontrados = trabajo.jsons.length;
        indiceGuardarResumen_(hoja, resumen);
        SpreadsheetApp.flush();
        ultimoGuardado = Date.now();
      }
    }
    if (resumen.etapa === 'recorrer') {
      resumen.carpetasPendientes = trabajo.cola.length;
      resumen.jsonsEncontrados = trabajo.jsons.length;
      if (trabajo.cola.length === 0) resumen.etapa = 'escribir';
    }

    if (resumen.etapa === 'escribir' && quedaMs() > INDICE_CONFIG.MARGEN_ESCRITURA_MS) {
      var filasSheet = indiceLeerFilasSheet_(ss);
      var filas = indiceArmarFilas_({
        raizId: raizId,
        carpetas: trabajo.carpetas,
        jsons: trabajo.jsons
      }, filasSheet);
      indiceEscribirPestana_(ss, filas);
      resumen.filasIndice = filas.length;
      resumen.sinFila = filas.filter(function(f) { return f.cruce === 'sin fila'; }).length;

      // Lo que sigue solo necesita las filas a llenar; el árbol ya no.
      var plan = indicePlanColumnaN_(filas, filasSheet);
      trabajo = { pendientesN: plan.objetivos };
      resumen.columnaN = {
        objetivo: plan.objetivos.length,
        llenadas: 0,
        yaTenian: 0,
        cambiaron: 0,
        ambiguas: plan.ambiguas,
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

    var terminado = false;
    if (resumen.etapa === 'columnaN' && trabajo.pendientesN.length === 0) {
      resumen.etapa = 'terminado';
      resumen.terminadoEn = Date.now();
      terminado = true;
    }

    indiceAnotarParte_(resumen, inicio, carpetasAntes, jsonsAntes, opciones.origen);
    var crearActivador = !terminado && opciones.programarSiguiente &&
      resumen.parte < INDICE_CONFIG.MAX_PARTES;
    resumen.activador = crearActivador ? indiceRevisarCupo_() : null;
    resumen.ocupadoHasta = 0;
    resumen.parteEnCurso = null;
    indiceGuardarTodo_(hoja, resumen, terminado ? null : trabajo);
    SpreadsheetApp.flush();

    if (crearActivador && resumen.activador.estado === 'programado') {
      var creado = indiceCrearActivador_();
      if (!creado.ok) {
        resumen.activador = { estado: 'error', en: Date.now(), detalle: creado.error };
        indiceGuardarResumen_(hoja, resumen);
      }
    }
  } catch (err) {
    console.error('[Indice] Error en la parte ' + resumen.parte + ': ' + err.message);
    resumen.ultimoError = String(err.message || err).substring(0, 300);
    indiceAnotarParte_(resumen, inicio, carpetasAntes, jsonsAntes, opciones.origen);
    resumen.activador = null;
    resumen.ocupadoHasta = 0;
    resumen.parteEnCurso = null;
    indiceGuardarTodo_(hoja, resumen, trabajo);
    return { error: resumen.ultimoError, resumen: resumen };
  }

  console.log('[Indice] Parte ' + resumen.parte + ' (' + (opciones.origen || 'botón') + '): ' +
    resumen.carpetasRevisadas + ' carpetas, ' + resumen.jsonsEncontrados + ' JSON, etapa ' +
    resumen.etapa + (resumen.activador ? ', activador ' + resumen.activador.estado : ''));
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
 * Decide si se puede programar la parte siguiente, sin crearla todavía.
 */
function indiceRevisarCupo_() {
  var activos = contarTriggersActivos();
  if (activos >= REINTENTOS_CONFIG.MAX_TRIGGERS_ACTIVOS) {
    return {
      estado: 'sin_cupo',
      en: Date.now(),
      detalle: 'ya hay ' + activos + ' activadores de tiempo en uso'
    };
  }
  return { estado: 'programado', en: Date.now() };
}

function indiceCrearActivador_() {
  try {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === INDICE_CONFIG.HANDLER_ACTIVADOR) ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger(INDICE_CONFIG.HANDLER_ACTIVADOR)
      .timeBased()
      .after(REINTENTOS_CONFIG.DELAY_TRIGGER_MS)
      .create();
    return { ok: true };
  } catch (err) {
    console.warn('[Indice] No se pudo crear el activador: ' + err.message);
    return { ok: false, error: String(err.message || err).substring(0, 200) };
  }
}

/**
 * Handler del activador: borra el propio, hace una parte larga y deja
 * programada la siguiente si queda trabajo.
 */
function continuarIndiceJson() {
  console.log('[Indice] Activador disparado');
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === INDICE_CONFIG.HANDLER_ACTIVADOR) {
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
  return '⏸️ A medias: ' + r.carpetasRevisadas + ' carpetas revisadas. Entra para continuar.';
}

/**
 * Tarjeta del índice: estado, qué está corriendo ahora, si la parte
 * siguiente arranca sola y el historial de partes.
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
  var textoBoton = '🗂️ Actualizar índice';
  var ocupado = !!(r && r.ocupadoHasta > ahora);

  if (!r) {
    estado.addWidget(CardService.newTextParagraph().setText(
      'Todavía no hay índice. Al presionar el botón se recorre la carpeta raíz y se crea la pestaña "' +
      INDICE_CONFIG.PESTANA + '" con una fila por cada .json, con su servicio, caso, ambiente, componente, estado y link. ' +
      'Después llena la columna N de las filas que la tengan vacía.'
    ));
    textoBoton = '🗂️ Crear índice';
  } else if (r.etapa === 'terminado') {
    estado.addWidget(CardService.newTextParagraph().setText(
      '✅ <b>Actualizado el ' + formatearFechaIndice_(r.terminadoEn) + '</b><br>' +
      r.filasIndice + ' JSON en ' + r.carpetasRevisadas + ' carpetas, en ' + r.parte +
      ' parte' + (r.parte === 1 ? '' : 's') +
      (r.sinFila ? '<br>' + r.sinFila + ' JSON sin fila en el Sheet' : '') +
      (r.errores ? '<br>' + r.errores + ' carpeta(s) no se pudieron leer' : '')
    ));
    if (r.columnaN) {
      var c = r.columnaN;
      estado.addWidget(CardService.newTextParagraph().setText(
        '<b>Columna N (Archivos JSON)</b><br>' +
        '✏️ ' + c.llenadas + ' fila(s) llenadas ahora<br>' +
        '✔️ ' + c.yaTenian + ' ya tenían JSON (no se tocaron)' +
        (c.cambiaron ? '<br>↕️ ' + c.cambiaron + ' se saltaron porque la fila cambió mientras corría' : '') +
        (c.ambiguas ? '<br>❔ ' + c.ambiguas + ' con varias carpetas del mismo caso (ambiguas, sin tocar)' : '') +
        '<br>➖ ' + c.sinJson + ' sin JSON en nuestras carpetas (copiadas sin JSON o solo con originales)'
      ));
    }
  } else {
    var lineas = [
      '<b>' + r.carpetasRevisadas + '</b> carpetas revisadas · <b>' + (r.jsonsEncontrados || 0) + '</b> JSON encontrados',
      r.etapa === 'escribir'
        ? 'Ya se revisaron todas las carpetas; falta escribir la pestaña.'
        : r.etapa === 'columnaN'
          ? 'Pestaña lista. Llenando la columna N: ' + indiceFilasRevisadasN_(r.columnaN) + ' de ' +
            r.columnaN.objetivo + ' filas revisadas.'
          : 'Faltan ' + (r.carpetasPendientes || 0) + ' carpetas por revisar (más las que aparezcan dentro).'
    ];
    if (ocupado && r.parteEnCurso) {
      lineas.unshift('⏳ <b>Trabajando ahora: parte ' + r.parteEnCurso.n + ' (' + r.parteEnCurso.origen +
        ')</b>, empezó a las ' + formatearHoraIndice_(r.parteEnCurso.inicio) +
        ' (hace ' + formatearDuracionIndice_(ahora - r.parteEnCurso.inicio) + ')');
    } else if (r.activador && r.activador.corrioEn) {
      lineas.unshift('<font color="#d93025">⚠️ <b>La parte automática empezó a las ' +
        formatearHoraIndice_(r.activador.corrioEn) + ' pero no terminó bien.</b> Presiona "Continuar"; sigue desde lo último guardado.</font>');
    } else if (r.activador && r.activador.estado === 'programado') {
      var espera = ahora - r.activador.en;
      if (espera < INDICE_CONFIG.ESPERA_ACTIVADOR_MS) {
        lineas.unshift('⏱️ <b>La parte ' + (r.parte + 1) + ' arranca sola en unos segundos</b> (programada a las ' +
          formatearHoraIndice_(r.activador.en) + ').');
      } else {
        lineas.unshift('<font color="#d93025">⚠️ <b>La parte ' + (r.parte + 1) + ' se programó a las ' +
          formatearHoraIndice_(r.activador.en) + ' y Google no la ha corrido</b> (hace ' +
          formatearDuracionIndice_(espera) + '). Presiona "Continuar".</font>');
      }
    } else if (r.activador && r.activador.estado !== 'programado') {
      lineas.unshift('<font color="#d93025">⚠️ <b>No se pudo programar la parte siguiente</b>: ' +
        escaparHtml(r.activador.detalle || r.activador.estado) + '. Presiona "Continuar".</font>');
    } else {
      lineas.unshift('⏸️ <b>En pausa.</b> Presiona "Continuar" para seguir.');
    }
    lineas.push('<i>Esta tarjeta no se refresca sola: usa "Ver avance".</i>');
    estado.addWidget(CardService.newTextParagraph().setText(lineas.join('<br>')));
    textoBoton = '▶️ Continuar';
  }
  if (r && r.ultimoError) {
    estado.addWidget(CardService.newTextParagraph().setText(
      '<font color="#d93025">Último error: ' + escaparHtml(r.ultimoError) + '</font>'
    ));
  }

  var botones = CardService.newButtonSet();
  if (!ocupado) {
    botones.addButton(
      CardService.newTextButton()
        .setText(textoBoton)
        .setOnClickAction(CardService.newAction().setFunctionName('onActualizarIndiceJson'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor('#1a73e8')
    );
  }
  if (r && r.etapa !== 'terminado') {
    botones.addButton(
      CardService.newTextButton()
        .setText('🔄 Ver avance')
        .setOnClickAction(CardService.newAction().setFunctionName('onVerAvanceIndiceJson'))
    );
  }
  if (r && r.urlPestana) {
    botones.addButton(
      CardService.newTextButton()
        .setText('Abrir pestaña')
        .setOpenLink(CardService.newOpenLink().setUrl(r.urlPestana))
    );
  }
  if (r && r.etapa !== 'terminado' && !ocupado) {
    botones.addButton(
      CardService.newTextButton()
        .setText('🗑️ Empezar de cero')
        .setOnClickAction(CardService.newAction().setFunctionName('onReiniciarIndiceJson'))
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
        .setCollapsible(true)
        .setNumUncollapsibleWidgets(1)
        .addWidget(CardService.newTextParagraph().setText(partes.join('<br>')))
    );
  }

  return card.build();
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
 * Descarta el avance a medias y el activador pendiente. La pestaña del
 * índice anterior no se toca; se reemplaza al terminar el próximo.
 */
function onReiniciarIndiceJson(e) {
  var aviso;
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) throw new Error('el Sheet está ocupado, intenta en unos segundos.');
    var ss = SpreadsheetApp.openById(obtenerSheetId());
    var hoja = ss.getSheetByName(INDICE_CONFIG.PESTANA_AVANCE);
    var r = hoja ? indiceLeerResumen_(hoja) : null;
    if (r && r.ocupadoHasta > Date.now()) {
      aviso = 'Hay una parte corriendo. Espera a que termine y vuelve a intentar.';
    } else {
      if (hoja) hoja.clearContents();
      ScriptApp.getProjectTriggers().forEach(function(t) {
        if (t.getHandlerFunction() === INDICE_CONFIG.HANDLER_ACTIVADOR) ScriptApp.deleteTrigger(t);
      });
      aviso = 'Avance descartado. El próximo "Crear índice" empieza de cero.';
    }
  } catch (err) {
    console.error('[Indice] ' + err.message);
    aviso = 'No se pudo descartar el avance: ' + err.message;
  } finally {
    lock.releaseLock();
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildIndiceJsonCard_()))
    .setNotification(CardService.newNotification().setText(aviso))
    .build();
}

/**
 * Botón "Crear / Actualizar / Continuar" de la tarjeta del índice.
 */
function onActualizarIndiceJson(e) {
  var aviso;
  try {
    var motivo = motivoConfigInvalida();
    if (motivo) throw new Error(motivo);
    var sheetId = obtenerSheetId();
    PropertiesService.getUserProperties().setProperty('INDICE_SHEET_ID', sheetId);

    var res = avanzarIndiceJson_(sheetId, INDICE_CONFIG.PRESUPUESTO_BOTON_MS, {
      origen: 'botón',
      programarSiguiente: true
    });
    var r = res.resumen || {};
    if (res.ocupado) {
      aviso = 'Ya hay una parte corriendo. Usa "Ver avance" en unos segundos.';
    } else if (res.error) {
      aviso = 'No se pudo avanzar el índice: ' + res.error;
    } else if (r.etapa === 'terminado') {
      aviso = 'Índice actualizado: ' + r.filasIndice + ' JSON; ' +
        r.columnaN.llenadas + ' fila(s) llenadas en la columna N.';
    } else if (r.activador && r.activador.estado === 'programado') {
      aviso = 'Parte ' + r.parte + ' lista. La siguiente arranca sola en unos segundos.';
    } else {
      aviso = 'Parte ' + r.parte + ' lista. Presiona "Continuar" para seguir.';
    }
  } catch (err) {
    console.error('[Indice] ' + err.message);
    aviso = 'No se pudo actualizar el índice: ' + err.message;
  }

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildIndiceJsonCard_()))
    .setNotification(CardService.newNotification().setText(aviso))
    .build();
}
