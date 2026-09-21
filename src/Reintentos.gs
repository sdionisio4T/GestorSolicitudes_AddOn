/**
 * Reintentos.gs — reintento automático en segundo
 * plano de copias que la fase 1 (add-on de Gmail) no pudo terminar por
 * tiempo agotado o error temporal.
 *
 * Diseño: en vez de una Web App con doPost (que bloquearía al add-on
 * porque UrlFetchApp es sincrónico), usamos un trigger one-shot con
 * ScriptApp.newTrigger().timeBased().after(). El trigger corre en un
 * contexto propio, bajo el permiso del usuario que lo creó, con hasta 6
 * min de ejecución (30 min en Workspace). Sin deploys manuales, sin URL
 * que mantener, sin scope externo.
 *
 * Flujo:
 * 1. SheetWriter.onEnviar detecta fallos reintentables tras la copia
 *    inicial y llama a programarReintentoCopia(sobre).
 * 2. Se guarda el "sobre" (URLs pendientes + contexto) en UserProperties
 *    bajo la clave PENDIENTE_{envioId} y se programa el trigger.
 * 3. ~1-15 s después, Google levanta reintentarCopiaPendiente() en un
 *    contexto nuevo. Procesa TODOS los sobres pendientes del usuario
 *    (no solo el propio) para amortizar cold starts.
 * 4. Cada sobre se reintenta hasta 3 veces con backoff, saltando
 *    archivos que ya existen en la carpeta destino (idempotencia).
 * 5. Al terminar, actualiza Estado Copia (L) y Drive (C) en el Sheet,
 *    borra el sobre y limpia el trigger consumido.
 */

var REINTENTOS_CONFIG = {
  PREFIJO_SOBRE: 'PENDIENTE_',
  // 1 intento largo por trigger. Si al final quedan URLs reintentables, el
  // propio trigger reprograma otro. Máximo N re-lanzamientos por sobre.
  MAX_RELANZAMIENTOS: 10,
  PRESUPUESTO_POR_TRIGGER_MS: 300000, // 5 min de copia por trigger (bien dentro de los 6 min Workspace)
  EDAD_MAX_MS: 2 * 60 * 60 * 1000,    // sobres de más de 2 h se descartan (10 relanzamientos pueden tardar ~1 h)
  DELAY_TRIGGER_MS: 1000,             // mínimo que Apps Script acepta
  MAX_TRIGGERS_ACTIVOS: 15,           // tope conservador antes del límite duro de 20 de Google (por script por usuario)

  // ── Sobres TERMINADO_ ────────────────────────────────────────────
  // Cuando un envío termina con URLs que fallaron por 'permiso', el
  // sobre se guarda bajo esta clave para que el usuario pueda:
  //  a) verlos en la lista "Esperando acceso" del add-on.
  //  b) apretar "Reintentar copia" una vez que le dieron acceso.
  // Se limpian solos a los 30 días si el usuario nunca reintentó.
  TERMINADO_PREFIJO: 'TERMINADO_',
  TERMINADO_EDAD_MAX_MS: 30 * 24 * 60 * 60 * 1000
};

// ── Programación (llamada desde SheetWriter.onEnviar) ─────────────────

/**
 * Guarda el sobre en UserProperties y programa un trigger para que
 * reintentarCopiaPendiente corra en segundo plano.
 *
 * Sobre esperado:
 * {
 *   envioId: 'env_abc123',
 *   servicioNombre: '...',
 *   numeroCaso: '...',
 *   carpetaDestinoId: '...',
 *   urlsPendientes: ['https://drive...', ...],
 *   copiadosPrevios: N,
 *   creadoEn: <timestamp ms>
 * }
 *
 * Retorna true si se programó, false si se descartó por límite o input inválido.
 */
function programarReintentoCopia(sobre) {
  if (!sobre || !sobre.envioId || !sobre.carpetaDestinoId ||
      !sobre.urlsPendientes || sobre.urlsPendientes.length === 0) {
    console.log('[Reintento] Sobre inválido — no se programa');
    return false;
  }

  var props = PropertiesService.getUserProperties();
  // Inicializar contador de relanzamientos si no viene
  if (typeof sobre.relanzamientos !== 'number') sobre.relanzamientos = 0;
  props.setProperty(
    REINTENTOS_CONFIG.PREFIJO_SOBRE + sobre.envioId,
    JSON.stringify(sobre)
  );

  var creado = crearTriggerReintento();
  if (creado.ok && creado.motivo === 'ya_hay_uno') {
    console.log('[Reintento] Sobre ' + sobre.envioId + ' guardado — usa trigger de reintento ya pendiente (skip redundante)');
    return true;
  }
  if (!creado.ok && creado.motivo === 'saturado') {
    console.log('[Reintento] Sobre guardado pero no se programa trigger nuevo (ya hay ' + creado.triggersActivos + ' triggers time-based en total)');
    return true;
  }
  if (!creado.ok) {
    console.error('[Reintento] No se pudo crear trigger: ' + creado.error);
    return false;
  }

  console.log('[Reintento] Programado para envío ' + sobre.envioId + ' — ' + sobre.urlsPendientes.length + ' URL(s) pendientes');
  return true;
}

/**
 * Crea el trigger one-shot que ejecutará reintentarCopiaPendiente.
 * Retorna { ok, motivo, triggersActivos, error }.
 *
 * Optimización clave: si YA hay un trigger de reintento pendiente,
 * NO crea uno nuevo — porque reintentarCopiaPendiente hace un barrido
 * de todos los sobres, así que un solo trigger alcanza para procesar
 * cualquier cantidad de sobres pendientes. Crear varios era la causa
 * raíz del bug de "too many time-based triggers".
 */
function crearTriggerReintento() {
  // Skip redundante: si ya hay un reintento programado, este sobre lo
  // agarra en el próximo barrido. Ahorra cuota de triggers.
  if (hayTriggerReintentoPendiente()) {
    return { ok: true, motivo: 'ya_hay_uno' };
  }

  // Tope global: contra el límite duro de 20 de Google (todos los
  // triggers time-based del proyecto, no solo los de reintento).
  var triggersActivos = contarTriggersActivos();
  if (triggersActivos >= REINTENTOS_CONFIG.MAX_TRIGGERS_ACTIVOS) {
    return { ok: false, motivo: 'saturado', triggersActivos: triggersActivos };
  }
  try {
    ScriptApp.newTrigger('reintentarCopiaPendiente')
      .timeBased()
      .after(REINTENTOS_CONFIG.DELAY_TRIGGER_MS)
      .create();
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: 'error', error: err.message };
  }
}

/**
 * Cuenta TODOS los triggers time-based del proyecto — no solo los de
 * reintentarCopiaPendiente. El límite duro de Google (20 por usuario
 * por script) no discrimina por handler, así que el guard-rail interno
 * tiene que medir contra la misma vara.
 */
function contarTriggersActivos() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    var n = 0;
    for (var i = 0; i < triggers.length; i++) {
      // Solo triggers time-based cuentan contra el límite de 20.
      // getEventType() devuelve TRIGGER_TYPE.CLOCK para los .timeBased().
      if (triggers[i].getEventType() === ScriptApp.EventType.CLOCK) {
        n++;
      }
    }
    return n;
  } catch (err) {
    return 0;
  }
}

/**
 * ¿Ya hay un trigger de reintentarCopiaPendiente pendiente de ejecutar?
 * Si sí, no vale la pena crear otro — el existente va a barrer todos
 * los sobres cuando dispare.
 */
function hayTriggerReintentoPendiente() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'reintentarCopiaPendiente') {
        return true;
      }
    }
    return false;
  } catch (err) {
    return false;
  }
}

// ── Ejecución del trigger ─────────────────────────────────────────────

/**
 * Handler del trigger. Corre en un contexto nuevo bajo el permiso del
 * usuario que creó el trigger. Levanta TODOS los sobres pendientes del
 * usuario (no solo uno) — así un trigger amortiza el cold start si hay
 * varios envíos fallidos acumulados.
 */
function reintentarCopiaPendiente(e) {
  console.log('[Reintento] Trigger disparado');

  limpiarTerminadosExpirados_();

  var props = PropertiesService.getUserProperties();
  var todas = props.getProperties();
  var claves = [];
  for (var k in todas) {
    if (todas.hasOwnProperty(k) && k.indexOf(REINTENTOS_CONFIG.PREFIJO_SOBRE) === 0) {
      claves.push(k);
    }
  }

  console.log('[Reintento] Sobres pendientes: ' + claves.length);

  claves.forEach(function(clave) {
    var sobre;
    try {
      sobre = JSON.parse(todas[clave]);
    } catch (errParse) {
      console.error('[Reintento] Sobre corrupto ' + clave + ': ' + errParse.message + ' — se descarta');
      props.deleteProperty(clave);
      return;
    }

    try {
      var resultado = procesarSobre(sobre);
      // Si el sobre se re-programó (aún quedan pendientes y no llegamos al
      // tope), procesarSobre ya guardó la versión actualizada y creó otro
      // trigger — NO borrar el sobre. Solo borrar cuando el envío quedó
      // resuelto (todo OK, o fallos definitivos, o tope alcanzado).
      if (!resultado || !resultado.reprogramado) {
        props.deleteProperty(clave);
      }
    } catch (errProc) {
      console.error('[Reintento] Error procesando ' + clave + ': ' + errProc.message);
      try {
        var sheet = obtenerSheetDelSobre_(sobre);
        actualizarSheetPorEnvioId(sheet, sobre.envioId,
          'Error en reintento: ' + errProc.message, null);
      } catch (errUpd) {
        console.error('[Reintento] Tampoco se pudo actualizar Sheet: ' + errUpd.message);
      }
      props.deleteProperty(clave);
    }
  });

  limpiarTriggerActual(e);
  reprogramarSiHaySobres_();
}

/**
 * Al final del barrido: si quedaron sobres pendientes (porque procesarSobre
 * los reprogramó), crear UN solo trigger para el próximo barrido. Si no
 * quedaron, limpiar cualquier trigger huérfano que haya sobrevivido.
 *
 * Esto reemplaza la creación de triggers desde procesarSobre — así
 * garantizamos un único trigger por batch, no uno por sobre reprogramado.
 * Se ejecuta DESPUÉS de limpiarTriggerActual(e) para que la cuenta de
 * triggers no incluya al trigger que está terminando.
 */
function reprogramarSiHaySobres_() {
  try {
    var props = PropertiesService.getUserProperties();
    var todas = props.getProperties();
    var haySobres = false;
    for (var k in todas) {
      if (todas.hasOwnProperty(k) && k.indexOf(REINTENTOS_CONFIG.PREFIJO_SOBRE) === 0) {
        haySobres = true;
        break;
      }
    }

    if (haySobres) {
      var creado = crearTriggerReintento();
      if (creado.ok && creado.motivo !== 'ya_hay_uno') {
        console.log('[Reintento] Trigger de barrido siguiente programado');
      } else if (!creado.ok) {
        console.error('[Reintento] No se pudo programar barrido siguiente: ' + (creado.error || creado.motivo));
      }
    } else {
      limpiarTriggersHuerfanos_();
    }
  } catch (err) {
    console.log('[Reintento] reprogramarSiHaySobres_ falló: ' + err.message);
  }
}

/**
 * Si al terminar el barrido no quedan sobres pendientes, cualquier
 * trigger de reintentarCopiaPendiente aún registrado es huérfano
 * (fue creado por una programación redundante que no tiene trabajo
 * que hacer). Los borramos para no seguir gastando cuota de triggers.
 */
function limpiarTriggersHuerfanos_() {
  try {
    var props = PropertiesService.getUserProperties();
    var todas = props.getProperties();
    for (var k in todas) {
      if (todas.hasOwnProperty(k) && k.indexOf(REINTENTOS_CONFIG.PREFIJO_SOBRE) === 0) {
        // Todavía hay al menos un sobre pendiente — nada que limpiar.
        return;
      }
    }

    var triggers = ScriptApp.getProjectTriggers();
    var borrados = 0;
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'reintentarCopiaPendiente') {
        try {
          ScriptApp.deleteTrigger(triggers[i]);
          borrados++;
        } catch (errDel) {
          // no crítico
        }
      }
    }
    if (borrados > 0) {
      console.log('[Reintento] Limpieza de huérfanos: ' + borrados + ' trigger(s) borrado(s)');
    }
  } catch (err) {
    console.log('[Reintento] limpiarTriggersHuerfanos_ falló: ' + err.message);
  }
}

/**
 * Ejecuta 1 pasada de copia (hasta 5 min) sobre el sobre. Si al final aún
 * quedan URLs reintentables Y no se alcanzó el tope de relanzamientos,
 * actualiza el sobre, escribe progreso en L y programa el próximo trigger.
 * Si el envío quedó resuelto (todo OK, solo fallos definitivos, o tope
 * alcanzado), escribe estado final en L (y C si aplica) y retorna.
 *
 * Retorna { reprogramado: bool }. Cuando reprogramado=true, el caller NO
 * debe borrar el sobre (procesarSobre ya guardó la versión actualizada).
 */
function procesarSobre(sobre) {
  var ahora = new Date().getTime();
  if (sobre.creadoEn && (ahora - sobre.creadoEn) > REINTENTOS_CONFIG.EDAD_MAX_MS) {
    console.log('[Reintento] Sobre ' + sobre.envioId + ' expirado (>' +
                (REINTENTOS_CONFIG.EDAD_MAX_MS / 60000) + ' min) — descartado');
    return { reprogramado: false };
  }

  var sheet = obtenerSheetDelSobre_(sobre);

  var carpetaDestino;
  try {
    carpetaDestino = DriveApp.getFolderById(sobre.carpetaDestinoId);
  } catch (errCarp) {
    console.error('[Reintento] Carpeta destino no accesible para envío ' +
                  sobre.envioId + ': ' + errCarp.message);
    actualizarSheetPorEnvioId(sheet, sobre.envioId,
      'Error: carpeta destino no accesible (' + errCarp.message + ')', null);
    return { reprogramado: false };
  }

  var relanzamiento = (sobre.relanzamientos || 0) + 1;
  var urlsAIntentar = (sobre.urlsPendientes || []).slice();
  var copiadosAcum = sobre.copiadosPrevios || 0;
  // Cache de carpetas para esta pasada: evita duplicaciones dentro del
  // mismo intento por consistencia eventual de Drive.
  var cacheCarpetas = {};

  console.log('[Reintento] Envío ' + sobre.envioId + ' — trigger ' +
              relanzamiento + '/' + REINTENTOS_CONFIG.MAX_RELANZAMIENTOS +
              ' con ' + urlsAIntentar.length + ' URL(s)');

  var res;
  try {
    res = copiarUrlsADestino(
      urlsAIntentar,
      carpetaDestino,
      REINTENTOS_CONFIG.PRESUPUESTO_POR_TRIGGER_MS,
      { saltarSiExiste: true, cacheCarpetas: cacheCarpetas }
    );
  } catch (errIntento) {
    // INTERNAL u otro error no atrapable de Google. Marcamos todas las
    // URLs como fallo temporal para que el próximo trigger las reintente.
    console.error('[Reintento] Trigger ' + relanzamiento + ' abortado: ' + errIntento.message);
    res = {
      copiados: 0,
      saltados: 0,
      totalIntentados: 0,
      fallos: urlsAIntentar.map(function(u) {
        return { url: u, motivo: 'temporal', mensaje: errIntento.message };
      }),
      tiempoAgotado: false
    };
  }

  copiadosAcum += res.copiados;

  // URLs pendientes para el próximo trigger: solo las reintentables.
  var setReintentables = {};
  (res.fallos || []).forEach(function(f) {
    if ((f.motivo === 'temporal' || f.motivo === 'tiempo') && f.url) {
      setReintentables[f.url] = true;
    }
  });
  var urlsSiguientes = Object.keys(setReintentables);

  // Fallos definitivos (permiso / invalido) — se muestran en L al final.
  var fallosDefinitivos = (res.fallos || []).filter(function(f) {
    return f.motivo !== 'temporal' && f.motivo !== 'tiempo';
  });

  // ¿Reprogramar u dar por terminado?
  var hayMasParaReintentar = urlsSiguientes.length > 0;
  var quedaCupo = relanzamiento < REINTENTOS_CONFIG.MAX_RELANZAMIENTOS;

  if (hayMasParaReintentar && quedaCupo) {
    // Guardar sobre actualizado y programar próximo trigger.
    sobre.urlsPendientes = urlsSiguientes;
    sobre.copiadosPrevios = copiadosAcum;
    sobre.relanzamientos = relanzamiento;
    PropertiesService.getUserProperties().setProperty(
      REINTENTOS_CONFIG.PREFIJO_SOBRE + sobre.envioId,
      JSON.stringify(sobre)
    );

    var pendientesAhora = urlsSiguientes.length;
    var textoProgreso = 'Reintentando (ronda ' + relanzamiento + ' de ' +
      REINTENTOS_CONFIG.MAX_RELANZAMIENTOS + '). Ya copió ' +
      copiadosAcum + ' archivo' + (copiadosAcum === 1 ? '' : 's') + '. ' +
      'Quedan ' + pendientesAhora + ' enlace' + (pendientesAhora === 1 ? '' : 's') + ' por copiar.';
    actualizarSheetPorEnvioId(sheet, sobre.envioId, textoProgreso, null);

    // NOTA: NO creamos el trigger acá. El barrido en reintentarCopiaPendiente
    // se encarga al final vía reprogramarSiHaySobres_() — así garantizamos
    // un único trigger por batch de sobres, no uno por sobre.

    console.log('[Reintento] Envío ' + sobre.envioId + ' — reprogramado (' +
                urlsSiguientes.length + ' URL(s) pendientes, ' +
                copiadosAcum + ' copiados hasta ahora)');
    return { reprogramado: true };
  }

  // Estado final: todo OK, solo definitivos, o tope alcanzado.
  var textoL;
  var todosLosFallos = fallosDefinitivos.slice();
  if (!quedaCupo && hayMasParaReintentar) {
    // Se llegó al tope y aún había reintentables → los marcamos como
    // "tiempo" en el estado final para que el resumen tenga sentido.
    urlsSiguientes.forEach(function(u) {
      todosLosFallos.push({ url: u, motivo: 'tiempo', mensaje: 'Tope de relanzamientos alcanzado' });
    });
  }

  var todoOk = todosLosFallos.length === 0;
  if (todoOk) {
    textoL = 'Completado (' + copiadosAcum + ' archivo' + (copiadosAcum === 1 ? '' : 's') + ')';
  } else if (copiadosAcum > 0) {
    textoL = 'Parcial: ' + copiadosAcum + ' copiado' + (copiadosAcum === 1 ? '' : 's') +
             '. Motivos: ' + resumirMotivos(todosLosFallos) + '.';
  } else {
    textoL = 'Sin copiar: ' + resumirMotivos(todosLosFallos) + '.';
  }

  actualizarSheetPorEnvioId(sheet, sobre.envioId, textoL, todoOk ? carpetaDestino : null);

  // Si quedaron URLs con motivo 'permiso' — combinando las que ya venían
  // de la fase 1 (sobre.urlsPermisoPreexistentes) y las nuevas descubiertas
  // durante los reintentos — guardamos un sobre TERMINADO para que el
  // usuario pueda reintentar manualmente desde el add-on una vez que le
  // den acceso.
  var urlsPermisoNuevas = fallosDefinitivos
    .filter(function(f) { return f.motivo === 'permiso' && f.url; })
    .map(function(f) { return f.url; });
  var urlsPermisoTotales = (sobre.urlsPermisoPreexistentes || []).concat(urlsPermisoNuevas);
  if (urlsPermisoTotales.length > 0) {
    guardarSobreTerminadoConPermiso({
      envioId: sobre.envioId,
      servicioNombre: sobre.servicioNombre,
      numeroCaso: sobre.numeroCaso,
      carpetaDestinoId: sobre.carpetaDestinoId
    }, urlsPermisoTotales, copiadosAcum, false);
  }

  console.log('[Reintento] Envío ' + sobre.envioId + ' resuelto — ' + textoL);
  return { reprogramado: false };
}

// ── Utilidades ────────────────────────────────────────────────────────

/**
 * Busca las filas del Sheet cuyo ID Envío (columna M = índice 13, oculta)
 * coincide con envioId y les actualiza K (Estado Copia, col 11). Si
 * carpetaSiOk se proveé, además sobrescribe C (Drive, col 3) con el
 * hipervínculo "Ver carpeta copiada" (mismo patrón que fase 1 con éxito
 * total).
 */
function actualizarSheetPorEnvioId(sheet, envioId, textoL, carpetaSiOk) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    console.error('[Reintento] Sheet vacío al buscar envío ' + envioId);
    return;
  }

  var idsEnvio = sheet.getRange(1, SHEET_COLS.ID_ENVIO, lastRow, 1).getValues();
  var filasMatch = [];
  for (var i = 0; i < idsEnvio.length; i++) {
    if (idsEnvio[i][0] === envioId) {
      filasMatch.push(i + 1); // 1-indexed
    }
  }

  if (filasMatch.length === 0) {
    console.error('[Reintento] No se encontraron filas con ID Envío ' + envioId);
    return;
  }

  // Sanitizamos porque textoL incluye e.message de Google (via
  // resumirMotivos → fallos → mensaje). Google no debería mandar un
  // error que empiece con "=" pero mejor no depender de eso.
  var textoLSeguro = sanitizarParaSheet(textoL);
  filasMatch.forEach(function(rowIdx) {
    sheet.getRange(rowIdx, SHEET_COLS.ESTADO_COPIA).setValue(textoLSeguro);
  });

  if (carpetaSiOk) {
    var rich = SpreadsheetApp.newRichTextValue()
      .setText('Ver carpeta copiada')
      .setLinkUrl(carpetaSiOk.getUrl())
      .build();
    filasMatch.forEach(function(rowIdx) {
      sheet.getRange(rowIdx, SHEET_COLS.DRIVE).setRichTextValue(rich);
    });
  }
}

/**
 * Borra el trigger one-shot que acaba de invocar esta función. Google
 * suele borrar los .after() automáticamente al ejecutarse, pero hay
 * casos donde queda huérfano — mejor limpiarlo explícitamente. Usamos
 * triggerUid del event object para borrar SOLO el propio, sin tocar
 * otros triggers que puedan estar pendientes de otros ENVIAR.
 */
function limpiarTriggerActual(e) {
  var uid = e && e.triggerUid;
  if (!uid) return;
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getUniqueId() === uid) {
        ScriptApp.deleteTrigger(triggers[i]);
        return;
      }
    }
  } catch (err) {
    // No crítico: si Apps Script no deja borrarlo, queda de basura y se
    // recolecta solo. Solo loggear.
    console.log('[Reintento] No se pudo limpiar trigger propio: ' + err.message);
  }
}

/**
 * Cuenta sobres propios (pendientes + terminados) del usuario. Se usa
 * en la card de "Cambiar Sheet" para avisar que hay envíos apuntando
 * al Sheet actual antes de que el usuario lo cambie.
 * Devuelve { pendientes, terminados, total }.
 */
function contarSobresPropios_() {
  var todas = PropertiesService.getUserProperties().getProperties();
  var p = 0, t = 0;
  for (var k in todas) {
    if (!todas.hasOwnProperty(k)) continue;
    if (k.indexOf(REINTENTOS_CONFIG.PREFIJO_SOBRE) === 0) p++;
    else if (k.indexOf(REINTENTOS_CONFIG.TERMINADO_PREFIJO) === 0) t++;
  }
  return { pendientes: p, terminados: t, total: p + t };
}

/**
 * Devuelve el Sheet donde vive la fila del envío. Preferimos el par
 * (sheetId, sheetTab) del sobre para que el reintento siempre escriba
 * en el Sheet original, aunque el usuario haya cambiado la config
 * después. Sobres viejos sin esos campos caen al Sheet configurado
 * actual (comportamiento previo).
 */
function obtenerSheetDelSobre_(sobre) {
  if (sobre && sobre.sheetId && sobre.sheetTab) {
    try {
      var ss = SpreadsheetApp.openById(sobre.sheetId);
      var s = ss.getSheetByName(sobre.sheetTab);
      if (s) return s;
      console.warn('[Reintento] Pestaña "' + sobre.sheetTab + '" no existe en el Sheet del sobre — cayendo al Sheet actual');
    } catch (err) {
      console.warn('[Reintento] Sheet del sobre no accesible (' + err.message + ') — cayendo al Sheet actual');
    }
  }
  return obtenerSheet();
}

// ── Utilidad manual (correr desde el editor de Apps Script) ───────────

/**
 * Limpieza a mano: borra TODOS los sobres pendientes del usuario y todos
 * los triggers colgados de reintentarCopiaPendiente. Útil cuando algo
 * quedó atascado por un error INTERNAL previo o durante iteraciones de
 * desarrollo. Se ejecuta desde el editor de Apps Script:
 * seleccionar la función 'limpiarSobresPendientes' y darle "Ejecutar".
 */
function limpiarSobresPendientes() {
  var props = PropertiesService.getUserProperties();
  var todas = props.getProperties();
  var borrados = 0;
  for (var k in todas) {
    if (todas.hasOwnProperty(k) && k.indexOf(REINTENTOS_CONFIG.PREFIJO_SOBRE) === 0) {
      props.deleteProperty(k);
      borrados++;
    }
  }

  var triggers = ScriptApp.getProjectTriggers();
  var triggersBorrados = 0;
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'reintentarCopiaPendiente') {
      try {
        ScriptApp.deleteTrigger(t);
        triggersBorrados++;
      } catch (err) {}
    }
  });

  console.log('[Limpieza] Sobres borrados: ' + borrados + ' | Triggers borrados: ' + triggersBorrados);
  return { sobres: borrados, triggers: triggersBorrados };
}

// ── Sobres TERMINADO ─────────────────────────────────────────────────
//
// Cuando un envío termina y quedaron URLs con motivo 'permiso' (o el
// fallo fue la propia carpeta destino), guardamos un sobre TERMINADO
// para que el usuario pueda reintentar manualmente desde el add-on una
// vez que le den acceso. Los sobres TERMINADO se limpian solos a los
// 7 días si nunca se reintentaron.

/**
 * Guarda (o mergea con uno existente) un sobre TERMINADO_{envioId}
 * con las URLs que fallaron por permiso.
 *
 * info debe traer: envioId (obligatorio), servicioNombre, numeroCaso,
 * carpetaDestinoId. urlsSinAcceso es un array de URLs. copiadosFinales
 * es el total copiado del envío (fase 1 + reintentos). esCarpetaDestino
 * marca el caso especial en que el fallo fue preparar la carpeta raíz
 * destino, no un enlace del correo — en ese caso el botón "Reintentar
 * copia" NO aparece; en su lugar se le pide al usuario cambiar la
 * carpeta raíz desde la config.
 *
 * Merge: si ya había un sobre TERMINADO para este envioId (por ejemplo
 * fase 1 lo guardó y luego el reintento lo re-guarda con más URLs
 * definitivas descubiertas en la ronda), se unen las URLs sin duplicar
 * y se conserva el copiadosFinales más alto.
 *
 * Retorna true si guardó algo, false si no había nada que guardar.
 */
function guardarSobreTerminadoConPermiso(info, urlsSinAcceso, copiadosFinales, esCarpetaDestino) {
  if (!info || !info.envioId) return false;
  var hayUrls = urlsSinAcceso && urlsSinAcceso.length > 0;
  if (!hayUrls && !esCarpetaDestino) return false;

  var props = PropertiesService.getUserProperties();
  var clave = REINTENTOS_CONFIG.TERMINADO_PREFIJO + info.envioId;

  var existente = null;
  try {
    var raw = props.getProperty(clave);
    if (raw) existente = JSON.parse(raw);
  } catch (e) {
    // sobre corrupto — lo sobrescribimos
  }

  var setUrls = {};
  if (existente && existente.urlsPermiso) {
    existente.urlsPermiso.forEach(function(u) { if (u) setUrls[u] = true; });
  }
  (urlsSinAcceso || []).forEach(function(u) { if (u) setUrls[u] = true; });

  var terminado = {
    envioId: info.envioId,
    servicioNombre: info.servicioNombre || (existente && existente.servicioNombre) || '',
    numeroCaso: info.numeroCaso || (existente && existente.numeroCaso) || '',
    carpetaDestinoId: info.carpetaDestinoId || (existente && existente.carpetaDestinoId) || '',
    urlsPermiso: Object.keys(setUrls),
    copiadosFinales: Math.max(copiadosFinales || 0, (existente && existente.copiadosFinales) || 0),
    esCarpetaDestino: !!esCarpetaDestino || !!(existente && existente.esCarpetaDestino),
    terminadoEn: new Date().getTime(),
    // Sheet donde vive la fila del envío. Se conserva del sobre existente
    // si el nuevo call no lo pasó, para no perderlo en merges.
    sheetId: info.sheetId || (existente && existente.sheetId) || '',
    sheetTab: info.sheetTab || (existente && existente.sheetTab) || ''
  };

  try {
    props.setProperty(clave, JSON.stringify(terminado));
    console.log('[Terminado] Guardado sobre para caso ' + redactCaso_(terminado.numeroCaso) + ' (' + terminado.envioId + '): ' + terminado.urlsPermiso.length + ' URL(s) esperando acceso');
    return true;
  } catch (err) {
    console.error('[Terminado] No se pudo guardar sobre: ' + err.message);
    return false;
  }
}

/**
 * Barre los sobres TERMINADO expirados (más de TERMINADO_EDAD_MAX_MS).
 * Se llama al inicio de reintentarCopiaPendiente para aprovechar que
 * ese handler corre seguido cuando hay actividad. La limpieza just-in-time
 * de leerSobreTerminado / listarTodosTerminados sigue vigente para el
 * caso de un usuario que solo abre la lista sin disparar reintentos.
 */
function limpiarTerminadosExpirados_() {
  var props = PropertiesService.getUserProperties();
  var todas = props.getProperties();
  var ahora = new Date().getTime();
  var borrados = 0;
  for (var k in todas) {
    if (!todas.hasOwnProperty(k)) continue;
    if (k.indexOf(REINTENTOS_CONFIG.TERMINADO_PREFIJO) !== 0) continue;
    try {
      var t = JSON.parse(todas[k]);
      if (t.terminadoEn && (ahora - t.terminadoEn) > REINTENTOS_CONFIG.TERMINADO_EDAD_MAX_MS) {
        props.deleteProperty(k);
        borrados++;
      }
    } catch (err) {
      // Sobre corrupto: se descarta para no dejarlo trabado.
      props.deleteProperty(k);
      borrados++;
    }
  }
  if (borrados > 0) {
    console.log('[Cleanup] Borrados ' + borrados + ' sobre(s) TERMINADO expirado(s)');
  }
  return borrados;
}

/**
 * Utilidad manual: borra todos los sobres TERMINADO. Sirve durante
 * desarrollo o si el usuario quiere "limpiar la lista" de pendientes
 * de acceso. Se corre desde el editor de Apps Script.
 */
function limpiarSobresTerminados() {
  var props = PropertiesService.getUserProperties();
  var todas = props.getProperties();
  var borrados = 0;
  for (var k in todas) {
    if (todas.hasOwnProperty(k) && k.indexOf(REINTENTOS_CONFIG.TERMINADO_PREFIJO) === 0) {
      props.deleteProperty(k);
      borrados++;
    }
  }
  console.log('[Limpieza] Sobres TERMINADO borrados: ' + borrados);
  return { terminados: borrados };
}
