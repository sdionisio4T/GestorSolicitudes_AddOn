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
 * Solo escribe en sus dos pestañas; no toca la pestaña de solicitudes.
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

// ── Avance por partes ─────────────────────────────────────────────────

/**
 * Hace una parte del índice dentro del presupuesto. Devuelve el resumen,
 * con `ocupado: true` si otra ejecución tiene el turno.
 */
function avanzarIndiceJson_(sheetId, presupuestoMs) {
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
        errores: 0
      };
      trabajo = { cola: [raizId], carpetas: {}, jsons: [] };
    }
    resumen.ocupadoHasta = Date.now() + presupuestoMs + 60000;
    resumen.ultimoError = '';
    if (empezar) {
      indiceGuardarTodo_(hoja, resumen, trabajo);
    } else {
      indiceGuardarResumen_(hoja, resumen);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  resumen.parte++;
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
    }
    resumen.carpetasPendientes = trabajo.cola.length;
    resumen.jsonsEncontrados = trabajo.jsons.length;
    if (resumen.etapa === 'recorrer' && trabajo.cola.length === 0) {
      resumen.etapa = 'escribir';
    }

    if (resumen.etapa === 'escribir' && quedaMs() > INDICE_CONFIG.MARGEN_ESCRITURA_MS) {
      var filasSheet = indiceLeerFilasSheet_(ss);
      var filas = indiceArmarFilas_({
        raizId: raizId,
        carpetas: trabajo.carpetas,
        jsons: trabajo.jsons
      }, filasSheet);
      indiceEscribirPestana_(ss, filas);
      resumen.etapa = 'terminado';
      resumen.terminadoEn = Date.now();
      resumen.filasIndice = filas.length;
      resumen.sinFila = filas.filter(function(f) { return f.cruce === 'sin fila'; }).length;
      resumen.ocupadoHasta = 0;
      indiceGuardarTodo_(hoja, resumen, null);
    } else {
      resumen.ocupadoHasta = 0;
      indiceGuardarTodo_(hoja, resumen, trabajo);
    }
  } catch (err) {
    console.error('[Indice] Error en la parte ' + resumen.parte + ': ' + err.message);
    resumen.ultimoError = String(err.message || err).substring(0, 300);
    resumen.ocupadoHasta = 0;
    indiceGuardarTodo_(hoja, resumen, trabajo);
    return { error: resumen.ultimoError, resumen: resumen };
  }

  console.log('[Indice] Parte ' + resumen.parte + ': ' + resumen.carpetasRevisadas +
    ' carpetas, ' + resumen.jsonsEncontrados + ' JSON, etapa ' + resumen.etapa);
  return { resumen: resumen };
}

function hayActivadorIndiceJson_() {
  try {
    return ScriptApp.getProjectTriggers().some(function(t) {
      return t.getHandlerFunction() === INDICE_CONFIG.HANDLER_ACTIVADOR;
    });
  } catch (err) {
    return false;
  }
}

/**
 * Programa la siguiente parte en segundo plano. Devuelve false si no se
 * pudo (sin cupo de activadores): el botón sigue sirviendo para avanzar.
 */
function programarIndiceJson_() {
  if (hayActivadorIndiceJson_()) return true;
  if (contarTriggersActivos() >= REINTENTOS_CONFIG.MAX_TRIGGERS_ACTIVOS) return false;
  try {
    ScriptApp.newTrigger(INDICE_CONFIG.HANDLER_ACTIVADOR)
      .timeBased()
      .after(REINTENTOS_CONFIG.DELAY_TRIGGER_MS)
      .create();
    return true;
  } catch (err) {
    console.warn('[Indice] No se pudo crear el activador: ' + err.message);
    return false;
  }
}

/**
 * Handler del activador: borra el propio, hace una parte larga y, si
 * queda trabajo, programa otra.
 */
function continuarIndiceJson() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === INDICE_CONFIG.HANDLER_ACTIVADOR) {
      try { ScriptApp.deleteTrigger(t); } catch (err) { /* ya no existe */ }
    }
  });

  var sheetId = PropertiesService.getUserProperties().getProperty('INDICE_SHEET_ID') || obtenerSheetId();
  if (!sheetId) return;

  var res = avanzarIndiceJson_(sheetId, INDICE_CONFIG.PRESUPUESTO_ACTIVADOR_MS);
  if (res.ocupado || res.error) return;
  var r = res.resumen;
  if (r.etapa !== 'terminado' && r.parte < INDICE_CONFIG.MAX_PARTES) {
    programarIndiceJson_();
  }
}

// ── Panel ─────────────────────────────────────────────────────────────

function esHostSheets_(e) {
  return !!(e && e.commonEventObject && e.commonEventObject.hostApp === 'SHEETS');
}

function formatearFechaIndice_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

/**
 * Sección "Índice de JSON" del panel de Sheets.
 */
function seccionIndiceJson_() {
  var r = leerEstadoIndiceJson_();
  var seccion = CardService.newCardSection().setHeader('🗂️ Índice de JSON');

  var texto;
  var textoBoton = '🗂️ Actualizar índice';
  if (!r) {
    texto = 'Todavía no hay índice. Al presionar el botón se crea la pestaña "' +
      INDICE_CONFIG.PESTANA + '" con todos los .json de la carpeta raíz.';
    textoBoton = '🗂️ Crear índice';
  } else if (r.etapa === 'terminado') {
    texto = '✅ Actualizado el ' + formatearFechaIndice_(r.terminadoEn) + '<br>' +
      r.filasIndice + ' JSON en ' + r.carpetasRevisadas + ' carpetas' +
      (r.sinFila ? '<br>' + r.sinFila + ' sin fila en el Sheet' : '') +
      (r.errores ? '<br>' + r.errores + ' carpeta(s) no se pudieron leer' : '');
  } else {
    var enCurso = r.ocupadoHasta && r.ocupadoHasta > Date.now();
    texto = '⏳ Actualizando: parte ' + r.parte + '<br>' +
      r.carpetasRevisadas + ' carpetas revisadas, ' + (r.jsonsEncontrados || 0) + ' JSON encontrados' +
      (r.etapa === 'escribir'
        ? '<br>Falta escribir la pestaña.'
        : '<br>Faltan ' + (r.carpetasPendientes || 0) + ' carpetas por revisar (y las que aparezcan dentro).') +
      '<br><i>' + (enCurso
        ? 'Sigue en segundo plano. Usa "Ver avance" para refrescar.'
        : 'Si no avanza, presiona "Continuar".') + '</i>';
    textoBoton = '▶️ Continuar';
  }
  if (r && r.ultimoError) {
    texto += '<br><font color="#d93025">Último error: ' + escaparHtml(r.ultimoError) + '</font>';
  }
  seccion.addWidget(CardService.newTextParagraph().setText(texto));

  var botones = CardService.newButtonSet().addButton(
    CardService.newTextButton()
      .setText(textoBoton)
      .setOnClickAction(CardService.newAction().setFunctionName('onActualizarIndiceJson'))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setBackgroundColor('#1a73e8')
  );
  if (r && r.etapa !== 'terminado') {
    botones.addButton(
      CardService.newTextButton()
        .setText('🔄 Ver avance')
        .setOnClickAction(CardService.newAction().setFunctionName('onActualizarListaEnvios'))
    );
  }
  if (r && r.urlPestana) {
    botones.addButton(
      CardService.newTextButton()
        .setText('Abrir pestaña')
        .setOpenLink(CardService.newOpenLink().setUrl(r.urlPestana))
    );
  }
  seccion.addWidget(botones);
  return seccion;
}

/**
 * Callback del botón "Actualizar índice" del panel de Sheets.
 */
function onActualizarIndiceJson(e) {
  var aviso;
  try {
    var motivo = motivoConfigInvalida();
    if (motivo) throw new Error(motivo);
    var sheetId = obtenerSheetId();
    PropertiesService.getUserProperties().setProperty('INDICE_SHEET_ID', sheetId);

    var res = avanzarIndiceJson_(sheetId, INDICE_CONFIG.PRESUPUESTO_BOTON_MS);
    var r = res.resumen || {};
    if (res.ocupado) {
      aviso = 'El índice ya se está actualizando (parte ' + (r.parte || 1) + '). Espera unos segundos y usa "Ver avance".';
    } else if (res.error) {
      aviso = 'No se pudo avanzar el índice: ' + res.error;
    } else if (r.etapa === 'terminado') {
      aviso = 'Índice actualizado: ' + r.filasIndice + ' JSON.';
    } else if (programarIndiceJson_()) {
      aviso = 'Indexando: parte ' + r.parte + ' lista. Sigue en segundo plano.';
    } else {
      aviso = 'Indexando: parte ' + r.parte + ' lista. Presiona "Continuar" para seguir.';
    }
  } catch (err) {
    console.error('[Indice] ' + err.message);
    aviso = 'No se pudo actualizar el índice: ' + err.message;
  }

  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildListaEnviosEnCursoCard({ conIndice: true }))
    )
    .setNotification(CardService.newNotification().setText(aviso))
    .build();
}
