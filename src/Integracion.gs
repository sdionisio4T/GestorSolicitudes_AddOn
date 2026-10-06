/**
 * Integracion.gs — Prueba de integración real del envío (ENVIAR AL SHEET).
 *
 * Recorre el mismo camino que onEnviar (parseo del formulario, escritura
 * de filas, copia por grupo, actualización de columnas C, K, M y N) contra
 * un Sheet y una carpeta de PRUEBA, nunca contra los configurados por el
 * usuario. Al final borra las filas y manda a la papelera las carpetas que
 * creó, pase o falle.
 *
 * Cómo correr:
 *   1. En Propiedades del script (Configuración del proyecto) definir:
 *        TEST_SHEET_ID    ID del Sheet de prueba
 *        TEST_SHEET_TAB   Pestaña donde escribir las filas
 *        TEST_CARPETA_ID  Carpeta raíz de prueba (destino de las copias)
 *        TEST_ORIGEN_URL  URL de una carpeta de Drive con al menos un .json
 *                         (la que se "adjunta" en el envío de prueba)
 *   2. En el editor, seleccionar `correrIntegracion` y Ejecutar.
 *   3. La consola muestra ✅ o ❌ por cada revisión y un total al final.
 *      Si algo falla, la ejecución termina en rojo.
 *
 * Durante la prueba se reemplazan por un momento obtenerSheetId,
 * obtenerSheetTab y obtenerCarpetaRaizId para apuntar a los recursos de
 * prueba, y programarReintentoCopia / guardarSobreTerminadoConPermiso para
 * que no queden reintentos ni sobres guardados. Todo se restaura al final.
 */

function correrIntegracion() {
  var cfg = leerConfigIntegracion_();
  var marca = new Date().getTime().toString(36).toUpperCase();
  var servicio = 'ZZ-INTEGRACION-' + marca;
  // Sin ceros a la izquierda: Sheets guardaría '0000' como el número 0.
  var numeroCaso = '9999';

  var revisiones = { ok: 0, fallos: [] };
  function revisar(condicion, descripcion) {
    if (condicion) {
      console.log('✅ ' + descripcion);
      revisiones.ok++;
    } else {
      console.error('❌ ' + descripcion);
      revisiones.fallos.push(descripcion);
    }
  }

  var sheet = SpreadsheetApp.openById(cfg.sheetId).getSheetByName(cfg.sheetTab);
  if (!sheet) throw new Error('No existe la pestaña "' + cfg.sheetTab + '" en el Sheet de prueba.');
  var raiz = DriveApp.getFolderById(cfg.carpetaId);
  var apimExistia = raiz.getFoldersByName(CONFIG.CARPETA_APIM).hasNext();

  var llamadasReintento = [];
  var restaurar = reemplazarGlobalesIntegracion_({
    obtenerSheetId: function() { return cfg.sheetId; },
    obtenerSheetTab: function() { return cfg.sheetTab; },
    obtenerCarpetaRaizId: function() { return cfg.carpetaId; },
    programarReintentoCopia: function(sobre) {
      llamadasReintento.push('reintento ' + sobre.envioId);
      return false;
    },
    guardarSobreTerminadoConPermiso: function(info) {
      llamadasReintento.push('sobre terminado ' + info.envioId);
    }
  });

  var envioId = '';
  var startRow = 0;

  try {
    console.log('════════════════════════════════════');
    console.log('Integración: envío mixto ESB + API');
    console.log('════════════════════════════════════');

    var input = parsearFormulario_(eventoFormularioIntegracion_({
      numeroCaso: [numeroCaso],
      servicioDesplegar: [servicio],
      correoSolicitante: ['integracion@ejemplo.com'],
      driveDocumentacion: [cfg.origenUrl],
      repositorio: ['https://github.com/ejemplo/integracion'],
      ambiente: ['Pruebas'],
      componente: ['ESB', 'API'],
      estado: ['PENDIENTE'],
      observaciones: ['Prueba de integración, se borra sola']
    }));

    revisar(validarInputPreConfig_(input) === null && validarInputPostConfig_(input) === null,
            'el formulario de prueba pasa las validaciones');

    // ── Envío ──
    var escritura = escribirFilasAlSheet_(input);
    envioId = escritura.envioId;
    startRow = escritura.startRow;

    var copia = copiarArchivosPorGrupo_(input, envioId);
    procesarResultadosPorGrupo_(input, copia.resultadosPorGrupo, copia.urlsACopiar);
    consolidarYActualizarSheet_(input, {
      sheet: escritura.sheet,
      envioId: envioId,
      startRow: startRow,
      filasCreadas: escritura.filasCreadas,
      driveDocumentacion: input.driveDocumentacion,
      estadoOriginal: input.estado,
      observacionesOriginal: input.observaciones
    }, copia.resultadosPorGrupo, copia.urlsACopiar);
    SpreadsheetApp.flush();

    // ── Filas ──
    revisar(escritura.filasCreadas === 2, 'se crea una fila por componente (2)');

    var filas = sheet.getRange(startRow, 1, 2, SHEET_NUM_COLS).getValues();
    var filaPorComp = {};
    filas.forEach(function(f, i) { filaPorComp[f[SHEET_COLS.COMPONENTE - 1]] = { valores: f, row: startRow + i }; });
    var esb = filaPorComp.ESB;
    var api = filaPorComp.API;
    revisar(esb && api, 'hay una fila ESB y una fila API');

    if (esb && api) {
      [esb, api].forEach(function(f) {
        var v = f.valores;
        var comp = v[SHEET_COLS.COMPONENTE - 1];
        var leidos = [v[SHEET_COLS.NUMERO_CASO - 1], v[SHEET_COLS.SERVICIO - 1], v[SHEET_COLS.AMBIENTE - 1]];
        revisar(String(leidos[0]) === numeroCaso && leidos[1] === servicio && leidos[2] === 'Pruebas',
                comp + ': caso, servicio y ambiente correctos (leído: ' + leidos.join(' | ') + ')');
        revisar(String(v[SHEET_COLS.ESTADO - 1]).indexOf('PENDIENTE') === 0,
                comp + ': columna Estado empieza con PENDIENTE');
        revisar(v[SHEET_COLS.CORREO_SOLICITANTE - 1] === 'integracion@ejemplo.com',
                comp + ': correo solicitante correcto');
        revisar(String(v[SHEET_COLS.ESTADO_COPIA - 1]).indexOf('Completado') === 0,
                comp + ': Estado Copia es "Completado" (fue: "' + v[SHEET_COLS.ESTADO_COPIA - 1] + '")');
      });

      // ── ID de envío (columna M) ──
      revisar(esb.valores[SHEET_COLS.ID_ENVIO - 1] === envioId,
              'ESB: ID de envío es env_X (' + envioId + ')');
      revisar(api.valores[SHEET_COLS.ID_ENVIO - 1] === envioId + '_apim',
              'API: ID de envío es env_X_apim');

      // ── Carpetas (columna C) ──
      var carpetaStd = buscarCarpetaCaso_(raiz, [servicio], numeroCaso);
      var carpetaApim = buscarCarpetaCaso_(raiz, [CONFIG.CARPETA_APIM, servicio], numeroCaso);
      revisar(carpetaStd !== null, 'existe <raíz>/' + servicio + '/' + numeroCaso);
      revisar(carpetaApim !== null, 'existe <raíz>/APIM/' + servicio + '/' + numeroCaso);

      var linkC_esb = linkDeCelda_(sheet.getRange(esb.row, SHEET_COLS.DRIVE));
      var linkC_api = linkDeCelda_(sheet.getRange(api.row, SHEET_COLS.DRIVE));
      if (carpetaStd) {
        revisar(linkC_esb.indexOf(carpetaStd.getId()) !== -1, 'ESB: columna C apunta a su carpeta');
      }
      if (carpetaApim) {
        revisar(linkC_api.indexOf(carpetaApim.getId()) !== -1, 'API: columna C apunta a la carpeta APIM');
      }

      // ── Archivos copiados y columna N ──
      [{ nombre: 'ESB', fila: esb, carpeta: carpetaStd }, { nombre: 'API', fila: api, carpeta: carpetaApim }]
        .forEach(function(g) {
          if (!g.carpeta) return;
          var jsonEnCarpeta = listarJsonRecursivo_(g.carpeta);
          revisar(jsonEnCarpeta.length > 0,
                  g.nombre + ': la carpeta copiada tiene .json (' + jsonEnCarpeta.length + ')');
          var linksN = linksDeCelda_(sheet.getRange(g.fila.row, SHEET_COLS.ARCHIVOS_JSON));
          revisar(linksN.length === jsonEnCarpeta.length,
                  g.nombre + ': columna N tiene un link por .json (' + linksN.length + ' de ' + jsonEnCarpeta.length + ')');
          var idsCarpeta = jsonEnCarpeta.map(function(a) { return a.getId(); });
          revisar(linksN.every(function(u) {
            return idsCarpeta.some(function(id) { return u.indexOf(id) !== -1; });
          }), g.nombre + ': los links de la columna N apuntan a las copias de su carpeta');
        });
    }

    revisar(llamadasReintento.length === 0,
            'no se programaron reintentos ni sobres' +
            (llamadasReintento.length ? ' (hubo: ' + llamadasReintento.join(', ') + ')' : ''));

    // ── Doble clic ──
    console.log('════════════════════════════════════');
    console.log('Integración: mismo envío dos veces');
    console.log('════════════════════════════════════');
    var dc = chequearDobleClic_(input);
    marcarDobleClic_(dc.firma);
    var filasAntes = sheet.getLastRow();
    var segundo = chequearDobleClic_(input);
    revisar(segundo.respuesta !== null, 'el segundo envío igual se detecta como doble clic');
    revisar(sheet.getLastRow() === filasAntes, 'el segundo envío no agrega filas');
    CacheService.getUserCache().remove(dc.firma);

  } finally {
    restaurar();
    limpiarIntegracion_(sheet, startRow, envioId, raiz, servicio, apimExistia);
  }

  console.log('════════════════════════════════════');
  console.log('Total: ' + revisiones.ok + ' OK, ' + revisiones.fallos.length + ' fallaron');
  console.log('════════════════════════════════════');
  if (revisiones.fallos.length > 0) {
    throw new Error('Fallaron ' + revisiones.fallos.length + ' revisión(es):\n' + revisiones.fallos.join('\n'));
  }
  return revisiones;
}

function leerConfigIntegracion_() {
  var p = PropertiesService.getScriptProperties();
  var cfg = {
    sheetId: p.getProperty('TEST_SHEET_ID'),
    sheetTab: p.getProperty('TEST_SHEET_TAB'),
    carpetaId: p.getProperty('TEST_CARPETA_ID'),
    origenUrl: p.getProperty('TEST_ORIGEN_URL')
  };
  var faltan = Object.keys(cfg).filter(function(k) { return !cfg[k]; });
  if (faltan.length > 0) {
    throw new Error('Faltan propiedades del script: TEST_SHEET_ID, TEST_SHEET_TAB, TEST_CARPETA_ID y TEST_ORIGEN_URL.');
  }
  if (cfg.sheetId === obtenerSheetId()) {
    throw new Error('TEST_SHEET_ID es el mismo Sheet configurado en el add-on. Usa un Sheet de prueba.');
  }
  var carpetaAddOn = obtenerCarpetaRaizId();
  console.log('[Integración] Carpeta de prueba (TEST_CARPETA_ID): ' + describirCarpeta_(cfg.carpetaId));
  console.log('[Integración] Carpeta raíz del add-on (⚙ Configuración): ' + describirCarpeta_(carpetaAddOn));
  if (cfg.carpetaId === carpetaAddOn) {
    throw new Error('TEST_CARPETA_ID es la misma carpeta raíz configurada en el add-on. Usa una carpeta de prueba.');
  }

  var origen = parsearIdDrive(cfg.origenUrl);
  if (!origen) throw new Error('TEST_ORIGEN_URL no es un link de Drive válido.');
  console.log('[Integración] Origen a copiar (TEST_ORIGEN_URL): ' + describirCarpeta_(origen.id));
  if (origen.tipo === 'carpeta' && carpetaContieneA_(origen.id, cfg.carpetaId)) {
    throw new Error('TEST_ORIGEN_URL es la carpeta de prueba o una carpeta que la contiene: la prueba se copiaría a sí misma. ' +
                    'Usa una carpeta pequeña fuera de TEST_CARPETA_ID.');
  }
  return cfg;
}

/**
 * true si `contenedorId` es `carpetaId` o alguna de sus carpetas de arriba.
 */
function carpetaContieneA_(contenedorId, carpetaId) {
  var pendientes = [DriveApp.getFolderById(carpetaId)];
  var vistos = {};
  while (pendientes.length > 0) {
    var c = pendientes.pop();
    if (vistos[c.getId()]) continue;
    vistos[c.getId()] = true;
    if (c.getId() === contenedorId) return true;
    var padres = c.getParents();
    while (padres.hasNext()) pendientes.push(padres.next());
  }
  return false;
}

function describirCarpeta_(id) {
  if (!id) return '(sin configurar)';
  try {
    return 'carpeta "' + DriveApp.getFolderById(id).getName() + '" (' + id + ')';
  } catch (eCarpeta) {
    try {
      return 'archivo "' + DriveApp.getFileById(id).getName() + '" (' + id + ')';
    } catch (eArchivo) {
      return '(sin acceso) (' + id + ')';
    }
  }
}

/**
 * Arma un evento con la misma forma que el que recibe onEnviar, para
 * pasar por parsearFormulario_ sin abrir Gmail.
 */
function eventoFormularioIntegracion_(campos) {
  var formInputs = {};
  Object.keys(campos).forEach(function(k) {
    formInputs[k] = { stringInputs: { value: campos[k] } };
  });
  return { parameters: {}, commonEventObject: { formInputs: formInputs } };
}

/**
 * Reemplaza funciones globales por las dadas y devuelve una función que
 * deja las originales.
 */
function reemplazarGlobalesIntegracion_(reemplazos) {
  var global = (function() { return this; })() || globalThis;
  var originales = {};
  Object.keys(reemplazos).forEach(function(nombre) {
    originales[nombre] = global[nombre];
    global[nombre] = reemplazos[nombre];
  });
  return function() {
    Object.keys(originales).forEach(function(nombre) {
      global[nombre] = originales[nombre];
    });
  };
}

function buscarCarpetaCaso_(raiz, ruta, numeroCaso) {
  var actual = raiz;
  for (var i = 0; i < ruta.length; i++) {
    var it = actual.getFoldersByName(ruta[i]);
    if (!it.hasNext()) return null;
    actual = it.next();
  }
  var casos = actual.getFoldersByName(numeroCaso);
  return casos.hasNext() ? casos.next() : null;
}

function listarJsonRecursivo_(carpeta) {
  var encontrados = [];
  var archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    var a = archivos.next();
    if (/\.json$/i.test(a.getName())) encontrados.push(a);
  }
  var subcarpetas = carpeta.getFolders();
  while (subcarpetas.hasNext()) {
    encontrados = encontrados.concat(listarJsonRecursivo_(subcarpetas.next()));
  }
  return encontrados;
}

function linksDeCelda_(rango) {
  var rich = rango.getRichTextValue();
  if (!rich) return [];
  var links = [];
  rich.getRuns().forEach(function(r) {
    var u = r.getLinkUrl();
    if (u && links.indexOf(u) === -1) links.push(u);
  });
  return links;
}

function linkDeCelda_(rango) {
  return linksDeCelda_(rango).join(' ');
}

/**
 * Borra las filas del envío de prueba (por ID en la columna M, de abajo
 * hacia arriba) y manda a la papelera las carpetas del servicio de prueba.
 * La carpeta APIM solo se manda a la papelera si la creó la prueba.
 */
function limpiarIntegracion_(sheet, startRow, envioId, raiz, servicio, apimExistia) {
  try {
    if (envioId && startRow > 0) {
      var ultima = sheet.getLastRow();
      for (var row = ultima; row >= startRow; row--) {
        var id = String(sheet.getRange(row, SHEET_COLS.ID_ENVIO).getValue());
        if (id === envioId || id === envioId + '_apim') sheet.deleteRow(row);
      }
    }
  } catch (errFilas) {
    console.error('[Integración] No se pudieron borrar las filas de prueba: ' + errFilas.message);
  }

  try {
    var std = raiz.getFoldersByName(servicio);
    while (std.hasNext()) std.next().setTrashed(true);
    var apims = raiz.getFoldersByName(CONFIG.CARPETA_APIM);
    while (apims.hasNext()) {
      var apim = apims.next();
      var srv = apim.getFoldersByName(servicio);
      while (srv.hasNext()) srv.next().setTrashed(true);
      if (!apimExistia) apim.setTrashed(true);
    }
  } catch (errCarpetas) {
    console.error('[Integración] No se pudieron mandar a la papelera las carpetas de prueba: ' + errCarpetas.message);
  }
  console.log('[Integración] Limpieza terminada (filas borradas, carpetas en la papelera).');
}
