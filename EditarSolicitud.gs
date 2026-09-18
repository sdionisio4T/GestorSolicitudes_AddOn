/**
 * EditarSolicitud.gs — Permite editar solicitudes ya enviadas sin generar
 * un envío nuevo. Localiza las filas del envío por su envioId (col M
 * oculta) y sobrescribe los datos in-place. No toca archivos de Drive,
 * ni Fecha, ni Estado Copia, ni el ID Envío. Cantidad de componentes fija.
 *
 * Entradas:
 *   - Homepage → "Editor de solicitudes" → lista de envíos con Estado
 *     PENDIENTE o NO APROBADO de los últimos EDITABLES_CONFIG.DIAS_ATRAS
 *     días (por fecha del envío, col J).
 *   - EstadoCard → botón "Editar solicitud" cuando no hay copia en curso.
 */

var EDITABLES_CONFIG = {
  DIAS_ATRAS: 30,
  ESTADOS_EDITABLES: ['PENDIENTE', 'NO APROBADO', 'APROBADO']
};

// ── Parseo del contenido de la celda Estado (col H) ─────────────────────

/**
 * "APROBADO - obs" → { estado: 'APROBADO', observaciones: 'obs' }.
 * "PENDIENTE"     → { estado: 'PENDIENTE', observaciones: '' }.
 * Si no matchea un estado conocido, cae a PENDIENTE y deja todo el texto
 * como observaciones para no perderlo.
 */
function parsearEstadoCelda(valor) {
  var s = String(valor || '').trim();
  if (s.charAt(0) === "'") s = s.slice(1);
  var m = s.match(/^\s*(NO APROBADO|APROBADO|PENDIENTE)\s*(?:-\s*(.*))?$/i);
  if (!m) {
    return { estado: CONFIG.ESTADO_DEFECTO, observaciones: s };
  }
  return {
    estado: m[1].toUpperCase(),
    observaciones: (m[2] || '').trim()
  };
}

// ── Lectura del Sheet ───────────────────────────────────────────────────

/**
 * Devuelve los envíos con Estado editable de los últimos DIAS_ATRAS días,
 * agrupados por envioId (col M). Un envío con N filas aparece como UN
 * elemento con componentes = [c1, c2, ...] y filasRow = [r1, r2, ...].
 * Ordenados por fecha descendente.
 */
function listarSolicitudesEditables() {
  try {
    var sheet = obtenerSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var numRows = lastRow - 1;
    var datos = sheet.getRange(2, 1, numRows, SHEET_COLS.ID_ENVIO).getValues();

    var limite = new Date();
    limite.setDate(limite.getDate() - EDITABLES_CONFIG.DIAS_ATRAS);
    limite.setHours(0, 0, 0, 0);

    var porEnvio = {};

    for (var i = 0; i < datos.length; i++) {
      var fila = datos[i];
      var envioId = fila[SHEET_COLS.ID_ENVIO - 1];
      if (!envioId) continue;

      var fecha = parsearFechaCelda(fila[SHEET_COLS.FECHA - 1]);
      if (!fecha || fecha < limite) continue;

      var estadoParsed = parsearEstadoCelda(fila[SHEET_COLS.ESTADO - 1]);
      if (EDITABLES_CONFIG.ESTADOS_EDITABLES.indexOf(estadoParsed.estado) === -1) continue;

      var filaSheet = i + 2;
      var key = String(envioId);

      if (!porEnvio[key]) {
        porEnvio[key] = {
          envioId: envioId,
          numeroCaso: String(fila[SHEET_COLS.NUMERO_CASO - 1] || ''),
          servicio: String(fila[SHEET_COLS.SERVICIO - 1] || ''),
          fecha: fecha,
          estado: estadoParsed.estado,
          observaciones: estadoParsed.observaciones,
          ambiente: String(fila[SHEET_COLS.AMBIENTE - 1] || ''),
          componentes: [],
          correoSolicitante: String(fila[SHEET_COLS.CORREO_SOLICITANTE - 1] || ''),
          filasRow: []
        };
      }
      var comp = String(fila[SHEET_COLS.COMPONENTE - 1] || '');
      if (comp && porEnvio[key].componentes.indexOf(comp) === -1) {
        porEnvio[key].componentes.push(comp);
      }
      porEnvio[key].filasRow.push(filaSheet);
    }

    var lista = [];
    for (var k in porEnvio) {
      if (porEnvio.hasOwnProperty(k)) lista.push(porEnvio[k]);
    }
    lista.sort(function(a, b) { return b.fecha.getTime() - a.fecha.getTime(); });
    return lista;
  } catch (err) {
    console.error('[Editar] listarSolicitudesEditables: ' + err.message);
    return [];
  }
}

/**
 * Devuelve los envíos editables (PENDIENTE / NO APROBADO, últimos
 * EDITABLES_CONFIG.DIAS_ATRAS días) cuyo numeroCaso coincide con el
 * pasado. Se usa desde onGmailMessageOpen para saber si el caso del
 * correo ya tiene solicitudes editables y ofrecer editar en lugar de
 * crear una fila nueva.
 */
function listarEditablesPorCaso(numeroCaso) {
  if (!numeroCaso) return [];
  return listarSolicitudesEditables().filter(function(item) {
    return String(item.numeroCaso) === String(numeroCaso);
  });
}

/**
 * Devuelve las filas "manuales" del Sheet para el caso dado: filas cuyo
 * numeroCaso coincide pero que NO tienen envioId (col M vacía). Son
 * filas que alguien escribió a mano directo en el Sheet sin pasar por
 * el add-on. Sin filtro por fecha — un duplicado es duplicado igual.
 * Se usa para avisar al usuario antes de que registre otra fila.
 */
function listarFilasManualesPorCaso(numeroCaso) {
  if (!numeroCaso) return [];
  try {
    var sheet = obtenerSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var datos = sheet.getRange(2, 1, lastRow - 1, SHEET_COLS.ID_ENVIO).getValues();
    var manuales = [];
    var casoBuscado = String(numeroCaso);

    for (var i = 0; i < datos.length; i++) {
      var fila = datos[i];
      if (fila[SHEET_COLS.ID_ENVIO - 1]) continue; // tiene envioId → no es manual
      if (String(fila[SHEET_COLS.NUMERO_CASO - 1] || '') !== casoBuscado) continue;

      var estadoParsed = parsearEstadoCelda(fila[SHEET_COLS.ESTADO - 1]);
      manuales.push({
        filaSheet: i + 2,
        ambiente: String(fila[SHEET_COLS.AMBIENTE - 1] || ''),
        componente: String(fila[SHEET_COLS.COMPONENTE - 1] || ''),
        estado: estadoParsed.estado,
        fecha: parsearFechaCelda(fila[SHEET_COLS.FECHA - 1])
      });
    }
    return manuales;
  } catch (err) {
    console.error('[Editar] listarFilasManualesPorCaso: ' + err.message);
    return [];
  }
}

/**
 * Lee una solicitud por envioId sin filtrar por estado ni por fecha.
 * Se usa desde el botón "Editar" de la EstadoCard (donde el usuario
 * eligió el envío puntualmente). Retorna null si no se encuentra.
 */
function leerSolicitudPorEnvioId(envioId) {
  if (!envioId) return null;
  try {
    var sheet = obtenerSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;

    var todo = sheet.getRange(2, 1, lastRow - 1, SHEET_COLS.ID_ENVIO).getValues();
    var filasRow = [];
    var componentes = [];
    var fila1 = null;

    for (var i = 0; i < todo.length; i++) {
      if (todo[i][SHEET_COLS.ID_ENVIO - 1] === envioId) {
        filasRow.push(i + 2);
        if (!fila1) fila1 = todo[i];
        var comp = String(todo[i][SHEET_COLS.COMPONENTE - 1] || '');
        if (comp && componentes.indexOf(comp) === -1) componentes.push(comp);
      }
    }
    if (filasRow.length === 0 || !fila1) return null;
    // Si el envio original quedo sin componente (col G vacia), devolvemos
    // [''] como placeholder para que el helper de copia lo trate como
    // grupo estandar (esComponenteAPIM('') === false) y copie a
    // [raiz]/<Servicio>/<Caso>. Si dejaramos [], grupos queda vacio y no
    // se copia nada.
    if (componentes.length === 0) componentes = [''];

    var estadoParsed = parsearEstadoCelda(fila1[SHEET_COLS.ESTADO - 1]);
    var fechaRaw = fila1[SHEET_COLS.FECHA - 1];

    // Repositorio y Sonar: preferimos el link del RichText si existe (así
    // no perdemos hipervínculos que el usuario pegó como texto plano).
    var repositorioTexto = leerLinkODeTexto(sheet, filasRow[0], SHEET_COLS.REPOSITORIO, fila1);
    var sonarTexto = leerLinkODeTexto(sheet, filasRow[0], SHEET_COLS.SONAR, fila1);

    return {
      envioId: envioId,
      numeroCaso: String(fila1[SHEET_COLS.NUMERO_CASO - 1] || ''),
      servicio: String(fila1[SHEET_COLS.SERVICIO - 1] || ''),
      repositorio: repositorioTexto,
      sonar: sonarTexto,
      artefactos: String(fila1[SHEET_COLS.ARTEFACTOS - 1] || ''),
      fecha: (fechaRaw instanceof Date) ? fechaRaw : null,
      estado: estadoParsed.estado,
      observaciones: estadoParsed.observaciones,
      ambiente: String(fila1[SHEET_COLS.AMBIENTE - 1] || ''),
      componentes: componentes,
      correoSolicitante: String(fila1[SHEET_COLS.CORREO_SOLICITANTE - 1] || ''),
      // estadoCopia habilita el input de Drive en la card de edicion solo
      // cuando el envio original nunca tuvo Drive ("Sin archivos"). Los
      // otros casos (parcial/fallido/pendiente) se cubren con los
      // reintentos existentes — no tocamos la col C para no romper la
      // promesa de "archivos ya copiados quedan tal cual".
      estadoCopia: String(fila1[SHEET_COLS.ESTADO_COPIA - 1] || ''),
      filasRow: filasRow
    };
  } catch (err) {
    console.error('[Editar] leerSolicitudPorEnvioId: ' + err.message);
    return null;
  }
}

/**
 * Lee una celda que puede tener un hipervínculo (RichText) o texto plano.
 * Prefiere el texto plano; si está vacío, cae al link del RichText.
 * Sirve para columnas como Repositorio o Sonar donde el add-on guarda
 * la URL como link real.
 */
function leerLinkODeTexto(sheet, row, col, filaCache) {
  var texto = String(filaCache[col - 1] || '');
  if (texto) return texto;
  try {
    var rich = sheet.getRange(row, col).getRichTextValue();
    if (rich) {
      var runs = rich.getRuns();
      for (var r = 0; r < runs.length; r++) {
        var link = runs[r].getLinkUrl();
        if (link) return link;
      }
    }
  } catch (errRich) {
    // no crítico
  }
  return '';
}

// ── Escritura in-place ──────────────────────────────────────────────────

/**
 * Sobrescribe los campos editables de TODAS las filas del envío.
 * NO toca: C (Drive), G (Componente), J (Fecha), K (Estado Copia),
 * M (ID Envío). Devuelve { ok, filasActualizadas, error? }.
 */
function actualizarSolicitud(envioId, datosEditados) {
  if (!envioId) return { ok: false, filasActualizadas: 0, error: 'Falta envioId.' };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var sheet = obtenerSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: false, filasActualizadas: 0, error: 'Sheet vacío.' };

    var ids = sheet.getRange(2, SHEET_COLS.ID_ENVIO, lastRow - 1, 1).getValues();
    var filas = [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === envioId) filas.push(i + 2);
    }
    if (filas.length === 0) {
      return { ok: false, filasActualizadas: 0, error: 'No se encontró el envío en el Sheet.' };
    }

    var estadoCelda = datosEditados.observaciones
      ? (datosEditados.estado + ' - ' + datosEditados.observaciones)
      : datosEditados.estado;

    filas.forEach(function(row) {
      sheet.getRange(row, SHEET_COLS.NUMERO_CASO).setValue(datosEditados.numeroCaso);
      sheet.getRange(row, SHEET_COLS.SERVICIO).setValue(sanitizarParaSheet(datosEditados.servicio));
      sheet.getRange(row, SHEET_COLS.AMBIENTE).setValue(datosEditados.ambiente);
      sheet.getRange(row, SHEET_COLS.ESTADO).setValue(sanitizarParaSheet(estadoCelda));
      sheet.getRange(row, SHEET_COLS.CORREO_SOLICITANTE).setValue(datosEditados.correoSolicitante || '');
      sheet.getRange(row, SHEET_COLS.ARTEFACTOS).setValue(sanitizarParaSheet(datosEditados.artefactos || ''));
    });

    // Repositorio y Sonar como RichText (hipervínculo azul) — misma lógica que onEnviar.
    [
      { col: SHEET_COLS.REPOSITORIO, valor: datosEditados.repositorio },
      { col: SHEET_COLS.SONAR,       valor: datosEditados.sonar }
    ].forEach(function(campo) {
      if (typeof campo.valor !== 'string') return;
      if (campo.valor) {
        var celdaRica = construirCeldaConEnlaces(campo.valor);
        filas.forEach(function(row) {
          sheet.getRange(row, campo.col).setRichTextValue(celdaRica);
        });
      } else {
        filas.forEach(function(row) {
          sheet.getRange(row, campo.col).setValue('');
        });
      }
    });

    console.log('[Editar] Actualizado envioId ' + envioId + ' — ' + filas.length + ' fila/s.');
    return { ok: true, filasActualizadas: filas.length };
  } catch (err) {
    console.error('[Editar] actualizarSolicitud: ' + err.message);
    return { ok: false, filasActualizadas: 0, error: err.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ── Cards ───────────────────────────────────────────────────────────────

/**
 * Card de edición precargada. Archivos/Drive quedan intocables.
 * Componentes se muestran en modo lectura (cantidad fija).
 */
function buildEdicionCard(solicitud, opts) {
  opts = opts || {};
  var messageId = opts.messageId || '';

  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Editar solicitud')
        .setSubtitle('Caso ' + (solicitud.numeroCaso || '(sin caso)') + ' · ' + (solicitud.servicio || '(sin servicio)'))
    );

  var seccion = CardService.newCardSection().setHeader('Datos');
  seccion.addWidget(
    CardService.newTextInput()
      .setFieldName('numeroCaso')
      .setTitle('Número de caso *')
      .setValue(solicitud.numeroCaso || '')
  );
  seccion.addWidget(
    CardService.newTextInput()
      .setFieldName('servicioDesplegar')
      .setTitle('Servicio a desplegar *')
      .setValue(solicitud.servicio || '')
  );
  seccion.addWidget(
    CardService.newTextInput()
      .setFieldName('correoSolicitante')
      .setTitle('Correo solicitante')
      .setValue(solicitud.correoSolicitante || '')
      .setHint('Opcional')
  );
  seccion.addWidget(
    CardService.newTextInput()
      .setFieldName('repositorio')
      .setTitle('Repositorio')
      .setValue(solicitud.repositorio || '')
  );
  seccion.addWidget(
    CardService.newTextInput()
      .setFieldName('sonar')
      .setTitle('Sonar (URL)')
      .setValue(solicitud.sonar || '')
      .setHint('Opcional')
  );
  card.addSection(seccion);

  var seccionCfg = CardService.newCardSection().setHeader('Configuración');
  var dropdownAmbiente = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Ambiente')
    .setFieldName('ambiente');
  CONFIG.AMBIENTES.forEach(function(amb) {
    dropdownAmbiente.addItem(amb, amb, amb === solicitud.ambiente);
  });
  seccionCfg.addWidget(dropdownAmbiente);

  // Componente: si el envio original quedo sin componente real, mostrar
  // un dropdown para poder elegirlo ahora (util cuando ademas se van a
  // agregar Drives — el componente decide si copia a APIM o estandar).
  // Si ya tenia componente(s), se mantiene como texto no editable
  // (respeta el diseño original: cantidad de filas fija).
  var componentesActuales = (solicitud.componentes || []).filter(function(c) { return c && c !== ''; });
  var puedeElegirComponente = componentesActuales.length === 0;
  if (puedeElegirComponente) {
    seccionCfg.addWidget(
      CardService.newTextParagraph()
        .setText('<i>Este envío no tiene componente. Podés asignarle uno si querés (opcional).</i>')
    );
    var dropdownComp = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setTitle('Componente')
      .setFieldName('componenteNuevo');
    // Sin opcion pre-seleccionada — el label "Componente" queda como
    // placeholder dentro de la caja hasta que el usuario elija. Si no
    // elige nada, componenteNuevo viene vacio y no se actualiza la col G.
    CONFIG.COMPONENTES.forEach(function(comp) {
      dropdownComp.addItem(comp, comp, false);
    });
    seccionCfg.addWidget(dropdownComp);
  } else {
    seccionCfg.addWidget(
      CardService.newKeyValue()
        .setTopLabel('Componentes (no editables)')
        .setContent(componentesActuales.join(', '))
        .setMultiline(true)
    );
  }
  seccionCfg.addWidget(
    CardService.newTextInput()
      .setFieldName('artefactos')
      .setTitle('Artefactos')
      .setValue(solicitud.artefactos || '')
      .setMultiline(true)
      .setHint('Opcional')
  );
  card.addSection(seccionCfg);

  var seccionVal = CardService.newCardSection().setHeader('Validación');
  var dropdownEstado = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Estado *')
    .setFieldName('estado');
  CONFIG.ESTADOS.forEach(function(est) {
    dropdownEstado.addItem(est, est, est === solicitud.estado);
  });
  seccionVal.addWidget(dropdownEstado);
  seccionVal.addWidget(
    CardService.newTextInput()
      .setFieldName('observaciones')
      .setTitle('Observaciones (opcional)')
      .setValue(solicitud.observaciones || '')
      .setMultiline(true)
  );
  card.addSection(seccionVal);

  // Seccion Drive — solo aparece si el envio original no tenia archivos
  // (estadoCopia === 'Sin archivos'). Permite agregar URLs y disparar la
  // copia real al guardar. Para los otros casos (parcial/fallido/pendiente)
  // se muestra el aviso tradicional y NO se toca la col C.
  var puedeAgregarDrive = solicitud.estadoCopia === 'Sin archivos';
  if (puedeAgregarDrive) {
    card.addSection(
      CardService.newCardSection()
        .setHeader('Drive (opcional)')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Este envío se registró <b>sin enlaces de Drive</b>. Si querés agregar archivos ahora, pegá una URL por línea. Al guardar se van a copiar a la carpeta correspondiente.')
        )
        .addWidget(
          CardService.newTextInput()
            .setFieldName('driveDocumentacionExtra')
            .setTitle('Agregar enlaces de Drive')
            .setHint('Uno por línea. Solo URLs de Drive/Workspace.')
            .setMultiline(true)
        )
    );
  } else {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('<i>Los enlaces de Drive y los archivos ya copiados quedan tal cual — solo se actualizan los datos de la solicitud.</i>')
        )
    );
  }

  var botones = CardService.newButtonSet()
    .addButton(
      CardService.newTextButton()
        .setText('GUARDAR CAMBIOS')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onGuardarEdicion')
            .setParameters({ envioId: solicitud.envioId, messageId: messageId })
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor('#1a73e8')
    )
    .addButton(
      CardService.newTextButton()
        .setText('Cancelar')
        .setOnClickAction(
          CardService.newAction().setFunctionName('onCancelarEdicion')
        )
    );

  // URL directa a la primera fila del envío en el Sheet. Mismo formato
  // que usa EstadoCard: /edit#gid={gid}&range=A{row}. Se muestra solo si
  // pudimos armarla (Sheet accesible + hay al menos una fila).
  var urlFila = '';
  try {
    var sheetId = obtenerSheetId();
    if (sheetId && solicitud.filasRow && solicitud.filasRow.length > 0) {
      var sheet = obtenerSheet();
      urlFila = 'https://docs.google.com/spreadsheets/d/' + sheetId +
        '/edit#gid=' + sheet.getSheetId() + '&range=A' + solicitud.filasRow[0];
    }
  } catch (errUrl) {
    // no crítico — el botón simplemente no aparece
  }

  if (urlFila) {
    botones.addButton(
      CardService.newTextButton()
        .setText('📊 Ver fila en el Sheet')
        .setOpenLink(CardService.newOpenLink().setUrl(urlFila))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor('#0f9d58')
    );
  }

  card.addSection(
    CardService.newCardSection().addWidget(botones)
  );

  return card.build();
}

/**
 * Card con la lista de solicitudes editables (últimos DIAS_ATRAS días).
 */
function buildListaEditablesCard(opts) {
  opts = opts || {};
  var messageId = opts.messageId || '';

  var lista = listarSolicitudesEditables();

  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Editor de solicitudes')
        .setSubtitle(
          lista.length + ' solicitud' + (lista.length === 1 ? '' : 'es') +
          ' · últimos ' + EDITABLES_CONFIG.DIAS_ATRAS + ' días'
        )
    );

  if (lista.length === 0) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('No hay solicitudes editables en los últimos ' + EDITABLES_CONFIG.DIAS_ATRAS + ' días.')
        )
        .addWidget(
          CardService.newTextParagraph()
            .setText('<i>Las solicitudes borradas del Sheet no aparecen acá — se recuperan solo desde el historial de versiones del archivo.</i>')
        )
    );
  } else {
    // Precalculamos la URL base al Sheet una sola vez para no llamar
    // obtenerSheetId() dentro del loop.
    var sheetIdConf = obtenerSheetId();
    var gid = null;
    try {
      if (sheetIdConf) gid = obtenerSheet().getSheetId();
    } catch (e) {
      // no crítico — sin gid no se pinta el botón "Ver fila"
    }

    var seccion = CardService.newCardSection();
    var tz = Session.getScriptTimeZone();
    lista.forEach(function(item) {
      var fechaStr = Utilities.formatDate(item.fecha, tz, 'dd/MM/yyyy');
      var compTxt = (item.componentes || []).join(', ') || '(sin componente)';
      var resumen = '<b>Caso ' + item.numeroCaso + '</b> · ' + (item.servicio || '(sin servicio)') + '<br>' +
        fechaStr + ' · ' + item.estado + '<br>' +
        'Componentes: ' + compTxt;
      seccion.addWidget(CardService.newTextParagraph().setText(resumen));

      var botonesItem = CardService.newButtonSet()
        .addButton(
          CardService.newTextButton()
            .setText('✏️ Editar')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onAbrirEditar')
                .setParameters({ envioId: item.envioId, messageId: messageId })
            )
        );

      // Botón "Ver fila" — apunta a la primera fila del envío en el Sheet.
      if (sheetIdConf && gid !== null && item.filasRow && item.filasRow.length > 0) {
        var urlFila = 'https://docs.google.com/spreadsheets/d/' + sheetIdConf +
          '/edit#gid=' + gid + '&range=A' + item.filasRow[0];
        botonesItem.addButton(
          CardService.newTextButton()
            .setText('📊 Ver fila')
            .setOpenLink(CardService.newOpenLink().setUrl(urlFila))
        );
      }
      seccion.addWidget(botonesItem);
    });
    card.addSection(seccion);
  }

  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newTextButton()
          .setText('🔄 Actualizar lista')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onActualizarListaEditables')
              .setParameters({ messageId: messageId })
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor('#1a73e8')
      )
  );

  return card.build();
}

// ── Callbacks ───────────────────────────────────────────────────────────

function onListarEditables(e) {
  var messageId = (e && e.parameters && e.parameters.messageId) || '';
  var motivo = motivoConfigInvalida();
  if (motivo) {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(buildCardConfigApropiada(motivo)))
      .build();
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().pushCard(buildListaEditablesCard({ messageId: messageId }))
    )
    .build();
}

function onActualizarListaEditables(e) {
  var messageId = (e && e.parameters && e.parameters.messageId) || '';
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().updateCard(buildListaEditablesCard({ messageId: messageId }))
    )
    .setNotification(CardService.newNotification().setText('Lista actualizada.'))
    .build();
}

function onAbrirEditar(e) {
  var envioId = e && e.parameters && e.parameters.envioId;
  var messageId = (e && e.parameters && e.parameters.messageId) || '';
  if (!envioId) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Falta el ID del envío.'))
      .build();
  }
  var solicitud = leerSolicitudPorEnvioId(envioId);
  if (!solicitud) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se encontró la solicitud (puede que la hayan borrado del Sheet).')
      )
      .build();
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().pushCard(buildEdicionCard(solicitud, { messageId: messageId }))
    )
    .build();
}

function onGuardarEdicion(e) {
  var envioId = e && e.parameters && e.parameters.envioId;
  var messageId = (e && e.parameters && e.parameters.messageId) || '';
  var formInputs = (e && e.commonEventObject && e.commonEventObject.formInputs) || {};

  if (!envioId) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Falta el ID del envío.'))
      .build();
  }

  var numeroCaso = leerInput(formInputs, 'numeroCaso').trim();
  if (!numeroCaso) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('El número de caso es obligatorio.'))
      .build();
  }
  if (!/^\d{1,4}$/.test(numeroCaso)) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('El número de caso debe ser solo números (máx. 4 dígitos).'))
      .build();
  }

  var servicio = leerInput(formInputs, 'servicioDesplegar').trim();
  if (!servicio) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('El servicio a desplegar es obligatorio.'))
      .build();
  }

  var correo = leerInput(formInputs, 'correoSolicitante').trim();
  if (correo && !REGEX_EMAIL.test(correo)) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('El correo solicitante no tiene un formato válido. Dejalo vacío si no lo tenés.'))
      .build();
  }

  var sonar = leerInput(formInputs, 'sonar').trim();
  if (sonar && !/^https?:\/\/\S+$/i.test(sonar)) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Sonar debe ser una URL válida (http/https) o quedar vacío.'))
      .build();
  }

  var datosEditados = {
    numeroCaso: numeroCaso,
    servicio: servicio,
    repositorio: leerInput(formInputs, 'repositorio'),
    sonar: sonar,
    artefactos: leerInput(formInputs, 'artefactos'),
    ambiente: leerInput(formInputs, 'ambiente'),
    estado: leerInput(formInputs, 'estado') || CONFIG.ESTADO_DEFECTO,
    observaciones: leerInput(formInputs, 'observaciones'),
    correoSolicitante: correo
  };

  var res = actualizarSolicitud(envioId, datosEditados);
  if (!res.ok) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se pudo guardar: ' + (res.error || 'error desconocido'))
      )
      .build();
  }

  // Componente elegido en la edicion (dropdown que aparece solo cuando el
  // envio no tenia componente). Se ignora si el envio original ya tenia.
  var componenteNuevo = leerInput(formInputs, 'componenteNuevo').trim();
  var toastCopia = '';
  var toastComponente = '';

  // Si el usuario agrego Drive en el campo de edicion, dispararla copia real.
  var driveExtraTexto = truncarCampo(leerInput(formInputs, 'driveDocumentacionExtra'), CAMPO_MAX_LARGO.driveDocumentacionExtra, 'driveDocumentacionExtra');
  var solicitudReleida = null;

  // Releemos la solicitud si vamos a necesitarla (para componente nuevo
  // o para el flujo de copia). Una sola lectura.
  if (componenteNuevo || driveExtraTexto) {
    solicitudReleida = leerSolicitudPorEnvioId(envioId);
  }

  // Actualizar col G (Componente) si el envio no tenia componente y ahora
  // se selecciono uno. Solo aplica cuando el envio original vino "sin
  // componente" (componentes actuales vacios o todos '').
  var componentesActuales = solicitudReleida
    ? solicitudReleida.componentes.filter(function(c) { return c && c !== ''; })
    : [];
  var puedeCompletarComponente = solicitudReleida && componentesActuales.length === 0;
  if (componenteNuevo && puedeCompletarComponente) {
    try {
      var sheetG = obtenerSheet();
      solicitudReleida.filasRow.forEach(function(row) {
        sheetG.getRange(row, SHEET_COLS.COMPONENTE).setValue(componenteNuevo);
      });
      // Re-leemos para que la copia use el componente actualizado.
      solicitudReleida = leerSolicitudPorEnvioId(envioId);
      toastComponente = ' Componente asignado: ' + componenteNuevo + '.';
    } catch (errComp) {
      console.error('[Editar] No se pudo actualizar componente: ' + errComp.message);
      toastComponente = ' Falló al asignar componente: ' + errComp.message;
    }
  }

  if (driveExtraTexto) {
    if (solicitudReleida && solicitudReleida.estadoCopia === 'Sin archivos') {
      var urlsCandidatas = driveExtraTexto.split('\n')
        .map(function(u) { return u.trim(); })
        .filter(function(u) { return u !== ''; });
      var urlsValidas = [];
      var urlsDescartadas = [];
      var vistas = {};
      urlsCandidatas.forEach(function(u) {
        if (vistas[u]) return;
        vistas[u] = true;
        if (esUrlDriveOWorkspace(u)) {
          urlsValidas.push(u);
        } else {
          urlsDescartadas.push(u);
        }
      });

      if (urlsValidas.length > 0) {
        try {
          var sheet = obtenerSheet();
          var resCopia = copiarUrlsPostEnvio_(
            sheet,
            envioId,
            solicitudReleida.filasRow,
            solicitudReleida.componentes,
            servicio,
            numeroCaso,
            urlsValidas
          );
          toastCopia = ' ' + resCopia.resumenTexto;
        } catch (errCopia) {
          console.error('[Editar] Error disparando copia post-edicion: ' + errCopia.message);
          toastCopia = ' Guardado OK pero falló al iniciar la copia: ' + errCopia.message;
        }
      }

      if (urlsDescartadas.length > 0) {
        toastCopia += ' Ignoradas ' + urlsDescartadas.length + ' URL(s) por no ser de Drive/Workspace.';
        console.warn('[Editar] URLs descartadas: ' + urlsDescartadas.map(redactUrl_).join(' | '));
      }
    } else if (solicitudReleida) {
      console.log('[Editar] Drive extra ignorado — estadoCopia no es "Sin archivos": ' + solicitudReleida.estadoCopia);
    }
  }

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText('Solicitud actualizada (' + res.filasActualizadas + ' fila/s).' + toastComponente + toastCopia)
    )
    .setNavigation(
      CardService.newNavigation()
        .popCard()
        .updateCard(buildListaEditablesCard({ messageId: messageId }))
    )
    .setStateChanged(true)
    .build();
}

function onCancelarEdicion(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popCard())
    .build();
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Convierte el valor de la col Fecha en Date. Acepta:
 *   - Date real (lo devuelve tal cual)
 *   - String "dd/MM/yyyy" o "d/M/yyyy" (típico si la celda quedó como texto)
 * Retorna null si no puede interpretarlo.
 */
function parsearFechaCelda(valor) {
  if (valor instanceof Date) return valor;
  if (!valor) return null;
  var s = String(valor).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/);
  if (!m) return null;
  var dia = parseInt(m[1], 10);
  var mes = parseInt(m[2], 10) - 1;
  var anio = parseInt(m[3], 10);
  var d = new Date(anio, mes, dia);
  if (isNaN(d.getTime())) return null;
  return d;
}

