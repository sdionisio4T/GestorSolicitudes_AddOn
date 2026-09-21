/**
 * EstadoCard.gs — Card "Estado del envío" que muestra al usuario, dentro
 * del propio add-on de Gmail, cómo va la copia de un envío que quedó en
 * segundo plano (fase 3). El trigger sigue corriendo aunque Gmail esté
 * cerrado; esta Card es solo una ventana de lectura al progreso real que
 * ya se está escribiendo en el Sheet y en UserProperties.
 *
 * Diseño: lectura pura. No dispara reintentos ni cambia estado. Todo lo
 * pesado lo hace Reintentos.gs en el servidor.
 */

// ── Lectura del estado ────────────────────────────────────────────────

/**
 * Devuelve el sobre pendiente del envío o null si ya no existe (envío
 * terminado o nunca hubo reintento). El sobre lo escribe / borra
 * Reintentos.gs; acá solo se lee.
 */
function leerSobrePendiente(envioId) {
  if (!envioId) return null;
  try {
    var props = PropertiesService.getUserProperties();
    var raw = props.getProperty(REINTENTOS_CONFIG.PREFIJO_SOBRE + envioId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('[EstadoCard] leerSobrePendiente: ' + err.message);
    return null;
  }
}

/**
 * Devuelve TODOS los sobres pendientes del usuario (cualquier caso).
 * Se usa desde la Homepage y la Card de validación para listar los
 * envíos que siguen corriendo, sin depender de qué correo esté abierto.
 * Ordenado del más reciente al más antiguo por creadoEn.
 */
function listarTodosSobres() {
  try {
    var props = PropertiesService.getUserProperties();
    var todas = props.getProperties();
    var out = [];
    for (var k in todas) {
      if (!todas.hasOwnProperty(k)) continue;
      if (k.indexOf(REINTENTOS_CONFIG.PREFIJO_SOBRE) !== 0) continue;
      try {
        var s = JSON.parse(todas[k]);
        if (s && s.envioId) out.push(s);
      } catch (errParse) {
        // sobre corrupto — lo ignoramos, Reintentos.gs lo va a limpiar
      }
    }
    out.sort(function(a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
    return out;
  } catch (err) {
    console.error('[EstadoCard] listarTodosSobres: ' + err.message);
    return [];
  }
}

/**
 * Devuelve TODOS los sobres pendientes del usuario cuyo numeroCaso
 * coincide con el pasado. Se usa al abrir un correo para saber si hay
 * envíos en curso del mismo caso. Ordenado del más reciente al más
 * antiguo por creadoEn.
 */
function listarSobresPorCaso(numeroCaso) {
  if (!numeroCaso) return [];
  try {
    var props = PropertiesService.getUserProperties();
    var todas = props.getProperties();
    var out = [];
    for (var k in todas) {
      if (!todas.hasOwnProperty(k)) continue;
      if (k.indexOf(REINTENTOS_CONFIG.PREFIJO_SOBRE) !== 0) continue;
      try {
        var s = JSON.parse(todas[k]);
        if (s && String(s.numeroCaso) === String(numeroCaso)) {
          out.push(s);
        }
      } catch (errParse) {
        // sobre corrupto — lo ignoramos, Reintentos.gs lo va a limpiar
      }
    }
    out.sort(function(a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
    return out;
  } catch (err) {
    console.error('[EstadoCard] listarSobresPorCaso: ' + err.message);
    return [];
  }
}

/**
 * Lee la primera fila del Sheet cuyo ID Envío (col M = 13, oculta)
 * coincide con envioId y devuelve { textoL, urlCarpeta } donde urlCarpeta
 * viene del hipervínculo de la col C si es el "Ver carpeta copiada" (o
 * del texto plano si hay una URL). Retorna null si no se encuentra el
 * envío o si el Sheet no es accesible.
 */
function leerEstadoSheetPorEnvioId(envioId, sobre) {
  if (!envioId) return null;

  try {
    // Si el sobre (pendiente o terminado) trae sheetId+sheetTab, preferimos
    // ese Sheet — así el estado sigue mostrando la fila real aunque el
    // usuario haya cambiado la configuración después del envío.
    var sheet;
    var sheetIdReal;
    if (sobre && sobre.sheetId && sobre.sheetTab) {
      try {
        var ss = SpreadsheetApp.openById(sobre.sheetId);
        sheet = ss.getSheetByName(sobre.sheetTab);
        sheetIdReal = sobre.sheetId;
      } catch (errAbrir) {
        sheet = null;
      }
    }
    if (!sheet) {
      sheet = obtenerSheet();
      sheetIdReal = obtenerSheetId();
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 1) return null;

    var ids = sheet.getRange(1, SHEET_COLS.ID_ENVIO, lastRow, 1).getValues();
    var rowIdx = -1;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === envioId) { rowIdx = i + 1; break; }
    }
    if (rowIdx === -1) return null;

    var textoL = sheet.getRange(rowIdx, SHEET_COLS.ESTADO_COPIA).getValue() || '';
    var urlCarpeta = '';
    try {
      var rich = sheet.getRange(rowIdx, SHEET_COLS.DRIVE).getRichTextValue();
      if (rich) {
        var runs = rich.getRuns();
        for (var r = 0; r < runs.length; r++) {
          var link = runs[r].getLinkUrl();
          if (link) { urlCarpeta = link; break; }
        }
      }
    } catch (errRich) {
      // no crítico
    }

    // URL directa a la fila del Sheet. Formato:
    // https://docs.google.com/spreadsheets/d/{ID}/edit#gid={gid}&range=A{row}
    // gid = ID numérico de la pestaña (no confundir con el nombre de la pestaña).
    var urlFilaSheet = '';
    try {
      if (sheetIdReal) {
        urlFilaSheet = 'https://docs.google.com/spreadsheets/d/' + sheetIdReal +
          '/edit#gid=' + sheet.getSheetId() + '&range=A' + rowIdx;
      }
    } catch (errUrl) {
      // no crítico — sin URL el botón simplemente no se muestra
    }

    return {
      textoL: String(textoL),
      urlCarpeta: urlCarpeta,
      urlFilaSheet: urlFilaSheet
    };
  } catch (err) {
    console.error('[EstadoCard] leerEstadoSheetPorEnvioId: ' + err.message);
    return null;
  }
}

// ── Lectura de sobres TERMINADO ───────────────────────────────────────

/**
 * Lee el sobre TERMINADO_{envioId} o null si no existe. Un sobre
 * TERMINADO existe cuando el envío se resolvió pero quedaron URLs
 * bloqueadas por permiso; guarda esas URLs para que el usuario pueda
 * reintentar manualmente desde la Card cuando le den acceso.
 *
 * Además hace limpieza just-in-time: si el sobre está expirado
 * (>7 días) lo borra y retorna null.
 */
function leerSobreTerminado(envioId) {
  if (!envioId) return null;
  try {
    var props = PropertiesService.getUserProperties();
    var clave = REINTENTOS_CONFIG.TERMINADO_PREFIJO + envioId;
    var raw = props.getProperty(clave);
    if (!raw) return null;
    var t = JSON.parse(raw);
    var ahora = new Date().getTime();
    if (t.terminadoEn && (ahora - t.terminadoEn) > REINTENTOS_CONFIG.TERMINADO_EDAD_MAX_MS) {
      try { props.deleteProperty(clave); } catch (e) {}
      return null;
    }
    return t;
  } catch (err) {
    console.error('[EstadoCard] leerSobreTerminado: ' + err.message);
    return null;
  }
}

/**
 * Devuelve TODOS los sobres TERMINADO del usuario (con URLs esperando
 * acceso), del más reciente al más antiguo. Limpia de paso los que
 * estén expirados (>7 días).
 */
function listarTodosTerminados() {
  try {
    var props = PropertiesService.getUserProperties();
    var todas = props.getProperties();
    var vivos = [];
    var ahora = new Date().getTime();
    for (var k in todas) {
      if (!todas.hasOwnProperty(k)) continue;
      if (k.indexOf(REINTENTOS_CONFIG.TERMINADO_PREFIJO) !== 0) continue;
      try {
        var t = JSON.parse(todas[k]);
        if (!t || !t.envioId) continue;
        if (t.terminadoEn && (ahora - t.terminadoEn) > REINTENTOS_CONFIG.TERMINADO_EDAD_MAX_MS) {
          try { props.deleteProperty(k); } catch (e) {}
          continue;
        }
        vivos.push(t);
      } catch (errParse) {
        // sobre corrupto — lo borramos
        try { props.deleteProperty(k); } catch (e) {}
      }
    }
    vivos.sort(function(a, b) { return (b.terminadoEn || 0) - (a.terminadoEn || 0); });
    return vivos;
  } catch (err) {
    console.error('[EstadoCard] listarTodosTerminados: ' + err.message);
    return [];
  }
}

/**
 * Devuelve los sobres TERMINADO cuyo numeroCaso coincide con el pasado.
 * Se usa al abrir un correo para saber si hay envíos del mismo caso
 * con URLs esperando acceso.
 */
function listarTerminadosPorCaso(numeroCaso) {
  if (!numeroCaso) return [];
  return listarTodosTerminados().filter(function(t) {
    return String(t.numeroCaso) === String(numeroCaso);
  });
}

// ── Construcción de la Card ───────────────────────────────────────────

/**
 * Card de estado del envío. opts = { messageId?: string }.
 * messageId habilita el botón "Volver al formulario".
 *
 * Consulta el sobre (si existe → sigue en curso) y el Sheet (fuente
 * final). Ambos son baratos: 1 llamada a UserProperties + 1-2 a Sheets.
 */
function buildEstadoEnvioCard(envioId, opts) {
  opts = opts || {};
  var messageId = opts.messageId || '';

  var sobre = leerSobrePendiente(envioId);
  var terminado = sobre ? null : leerSobreTerminado(envioId);
  var estadoSheet = leerEstadoSheetPorEnvioId(envioId, sobre || terminado);

  // Identificación del envío para el subtítulo del header. Preferimos
  // "Caso X · Servicio Y" que le dice algo al humano. Si no tenemos
  // ninguno de los dos, caemos al envioId como último recurso.
  var caso = (sobre && sobre.numeroCaso) || (terminado && terminado.numeroCaso) || '';
  var servicio = (sobre && sobre.servicioNombre) || (terminado && terminado.servicioNombre) || '';
  var subtitulo;
  if (caso && servicio) subtitulo = 'Caso ' + caso + ' · ' + servicio;
  else if (caso) subtitulo = 'Caso ' + caso;
  else if (servicio) subtitulo = servicio;
  else subtitulo = envioId;

  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Estado del envío')
        .setSubtitle(subtitulo)
    );

  // ── Sección: estado actual ──
  var seccionEstado = CardService.newCardSection().setHeader('Estado actual');

  if (sobre) {
    // Rama A: aún corriendo (o esperando el próximo trigger).
    var relan = sobre.relanzamientos || 0;
    var copiados = sobre.copiadosPrevios || 0;
    var pendientes = (sobre.urlsPendientes || []).length;

    var lineas = [];
    lineas.push('<b>En curso.</b> Reintentando en segundo plano.');
    lineas.push('');
    lineas.push('Archivos copiados hasta ahora: <b>' + copiados + '</b>');
    lineas.push('Enlaces todavía por copiar: <b>' + pendientes + '</b>');
    if (relan > 0) {
      lineas.push('Ronda de reintento en curso: <b>' + relan + ' de ' + REINTENTOS_CONFIG.MAX_RELANZAMIENTOS + '</b> (máximo permitido).');
    } else {
      lineas.push('Esperando el primer reintento (arranca en 1 a 15 segundos).');
    }
    lineas.push('');
    lineas.push('<i>El proceso corre en el servidor de Google. Puedes cerrar Gmail; cuando vuelvas, presiona <b>Actualizar</b> para ver el progreso.</i>');
    seccionEstado.addWidget(CardService.newTextParagraph().setText(lineas.join('<br>')));

    if (estadoSheet && estadoSheet.textoL) {
      seccionEstado.addWidget(
        CardService.newKeyValue()
          .setTopLabel('Última actualización en el Sheet')
          .setContent(estadoSheet.textoL)
          .setMultiline(true)
      );
    }

  } else if (terminado) {
    // Rama B: envío terminado con URLs esperando acceso (o falla de la
    // carpeta destino). El usuario puede reintentar la copia una vez
    // que le den permiso (o cambiar la carpeta raíz desde config).
    if (terminado.esCarpetaDestino) {
      seccionEstado.addWidget(
        CardService.newTextParagraph()
          .setText('<b>⚠️ Sin acceso a la carpeta destino.</b><br><br>' +
                   'No se pudo escribir en la carpeta raíz configurada. ' +
                   'Puede que hayas perdido el permiso o que la carpeta ya no exista.<br><br>' +
                   '<b>Solución:</b> ir a "Configuración" y cambiar la carpeta raíz de Drive por una donde tengas permiso de escritura.')
      );
    } else {
      var n = (terminado.urlsPermiso || []).length;
      seccionEstado.addWidget(
        CardService.newTextParagraph()
          .setText('<b>🔓 Terminado. Esperando acceso a ' + n + ' enlace' + (n === 1 ? '' : 's') + '.</b><br><br>' +
                   'Archivos copiados: <b>' + (terminado.copiadosFinales || 0) + '</b>.<br>' +
                   'Enlaces sin copiar por falta de permiso: <b>' + n + '</b>.<br><br>' +
                   '<i>Pídele acceso al dueño de esos archivos. Cuando lo tengas, presiona <b>Reintentar copia</b>.</i>')
      );

      // Mostrar la lista de URLs para que el usuario sepa cuáles pedir.
      (terminado.urlsPermiso || []).forEach(function(url, i) {
        seccionEstado.addWidget(
          CardService.newTextParagraph()
            .setText((i + 1) + '. <a href="' + url + '">' + url + '</a>')
        );
      });
    }

  } else if (estadoSheet && estadoSheet.textoL) {
    // Rama C: envío terminado sin sobres (todo OK, o algo definitivo
    // sin permisos guardados). Mostrar lo que quedó en L.
    var esOk = /^Completado/.test(estadoSheet.textoL);
    var esParcial = /^Parcial/.test(estadoSheet.textoL);
    var esSinCopiar = /^Sin copiar/.test(estadoSheet.textoL);

    var titulo;
    if (esOk) titulo = '<b>✅ Terminado correctamente</b>';
    else if (esParcial) titulo = '<b>⚠️ Terminado con algunos enlaces sin copiar</b>';
    else if (esSinCopiar) titulo = '<b>⚠️ Terminado sin poder copiar los enlaces</b>';
    else titulo = '<b>Terminado</b>';

    seccionEstado.addWidget(CardService.newTextParagraph().setText(titulo));
    seccionEstado.addWidget(
      CardService.newKeyValue()
        .setTopLabel('Estado')
        .setContent(estadoSheet.textoL)
        .setMultiline(true)
    );

    if (esOk && estadoSheet.urlCarpeta) {
      seccionEstado.addWidget(
        CardService.newTextButton()
          .setText('Abrir carpeta copiada')
          .setOpenLink(CardService.newOpenLink().setUrl(estadoSheet.urlCarpeta))
      );
    }

  } else {
    // Ni sobre ni fila en el Sheet — raro. Puede pasar si el envioId no
    // existe (link viejo) o si el Sheet cambió.
    seccionEstado.addWidget(
      CardService.newTextParagraph()
        .setText('No se encontró información de este envío en el Sheet.<br>Puede que el envío sea muy viejo o que el Sheet haya cambiado.')
    );
  }

  card.addSection(seccionEstado);

  // ── Sección: acciones ──
  var seccionAcciones = CardService.newCardSection();
  var botones = CardService.newButtonSet();

  // "Reintentar copia" — solo si el envío está en la rama B y hay URLs
  // reintentables (o sea, no es el caso de carpeta destino).
  if (terminado && !terminado.esCarpetaDestino && (terminado.urlsPermiso || []).length > 0) {
    botones.addButton(
      CardService.newTextButton()
        .setText('🔄 Reintentar copia')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onReintentarCopiaManual')
            .setParameters({ envioId: envioId, messageId: messageId })
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor('#0f9d58')
    );
  } else {
    // En todas las demás ramas, el botón principal es Actualizar.
    botones.addButton(
      CardService.newTextButton()
        .setText('🔄 Actualizar')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onActualizarEstadoEnvio')
            .setParameters({ envioId: envioId, messageId: messageId })
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor('#1a73e8')
    );
  }

  // Descartar de la lista — texto distinto según la rama para dejar clara
  // la consecuencia:
  //   - "Descartar" en rama TERMINADO (esperando acceso): el envío ya
  //     no está avanzando, solo estás sacándolo de la lista.
  //   - "🗑️ Descartar envío" en rama EN CURSO: mata un envío que sigue
  //     activo — el usuario pierde el progreso del reintento en curso.
  if (terminado) {
    botones.addButton(
      CardService.newTextButton()
        .setText('Descartar')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onDescartarPendiente')
            .setParameters({ envioId: envioId, messageId: messageId })
        )
    );
  } else if (sobre) {
    botones.addButton(
      CardService.newTextButton()
        .setText('🗑️ Descartar envío')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onDescartarEnCurso')
            .setParameters({ envioId: envioId, messageId: messageId })
        )
    );
  }

  if (messageId) {
    botones.addButton(
      CardService.newTextButton()
        .setText('Volver al formulario')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onVolverAlFormularioDesdeEstado')
            .setParameters({ messageId: messageId })
        )
    );
  }

  // "Editar solicitud" — solo si la copia terminó (no hay sobre en curso).
  // Editar mientras la copia sigue corriendo es riesgoso porque el proceso
  // de reintento sigue escribiendo en la fila. Una vez que terminó (rama B
  // o C, o incluso rama TERMINADO esperando acceso) es seguro editar los
  // datos, ya que no tocamos la col C ni la K.
  if (!sobre) {
    botones.addButton(
      CardService.newTextButton()
        .setText('✏️ Editar solicitud')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onAbrirEditar')
            .setParameters({ envioId: envioId, messageId: messageId })
        )
    );
  }

  // Botón para saltar directo a la fila del Sheet. Solo aparece si
  // pudimos encontrar la fila (leerEstadoSheetPorEnvioId devolvió URL).
  // Verde FILLED para que sea consistente con el mismo botón en la Card
  // de validación post-envío.
  if (estadoSheet && estadoSheet.urlFilaSheet) {
    botones.addButton(
      CardService.newTextButton()
        .setText('📊 Ver fila en el Sheet')
        .setOpenLink(CardService.newOpenLink().setUrl(estadoSheet.urlFilaSheet))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor('#0f9d58')
    );
  }

  seccionAcciones.addWidget(botones);
  card.addSection(seccionAcciones);

  return card.build();
}

// ── Callbacks ─────────────────────────────────────────────────────────

/**
 * Recarga la Card de estado. Como es lectura pura, updateCard con la
 * Card reconstruida es suficiente — no hay que tocar nada más.
 */
function onActualizarEstadoEnvio(e) {
  var envioId = e.parameters && e.parameters.envioId;
  var messageId = e.parameters && e.parameters.messageId;

  if (!envioId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se puede actualizar: falta el ID de envío.')
      )
      .build();
  }

  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildEstadoEnvioCard(envioId, { messageId: messageId }))
    )
    .setNotification(
      CardService.newNotification().setText('Estado actualizado.')
    )
    .build();
}

/**
 * Rearma la Card de validación a partir del correo original. Se usa
 * desde la Card de estado para que el usuario pueda hacer otro envío
 * (por ejemplo, otro ambiente o componente) sin tener que cerrar y
 * reabrir el correo.
 *
 * popToRoot + updateCard reemplaza toda la pila para dejar una única
 * card visible, como cuando Gmail dispara onGmailMessageOpen.
 */
function onVolverAlFormularioDesdeEstado(e) {
  var messageId = e.parameters && e.parameters.messageId;
  if (!messageId) {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popCard())
      .build();
  }

  try {
    if (e.gmail && e.gmail.accessToken) {
      GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
    }
    var message = GmailApp.getMessageById(messageId);
    var datos = extraerDatos(message.getPlainBody(), message.getSubject());
    var enviosCaso = listarSobresPorCaso(datos.numeroCaso);
    var envioEnCursoId = enviosCaso.length > 0 ? enviosCaso[0].envioId : null;
    var envioEsperandoAccesoId = null;
    if (!envioEnCursoId) {
      var esperando = listarTerminadosPorCaso(datos.numeroCaso);
      envioEsperandoAccesoId = esperando.length > 0 ? esperando[0].envioId : null;
    }
    var editablesCaso = listarEditablesPorCaso(datos.numeroCaso);

    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation()
          .popToRoot()
          .updateCard(buildValidacionCard(datos, messageId, null, envioEnCursoId, envioEsperandoAccesoId, null, editablesCaso))
      )
      .setStateChanged(true)
      .build();
  } catch (err) {
    console.error('[EstadoCard] onVolverAlFormularioDesdeEstado: ' + err.message);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se pudo reconstruir el formulario: ' + err.message)
      )
      .setNavigation(CardService.newNavigation().popCard())
      .build();
  }
}

/**
 * Card con la lista de todos los envíos que siguen en curso para el
 * usuario. Se abre desde la Homepage o desde el pie de la Card de
 * validación — así el usuario puede revisar cualquier envío sin
 * depender del correo que tenga abierto.
 *
 * Cada envío se pinta como un KeyValue clickable (button = "Ver
 * detalle") que empuja la Card de estado normal.
 */
function buildListaEnviosEnCursoCard(opts) {
  opts = opts || {};
  var messageId = opts.messageId || '';

  var enCurso = listarTodosSobres();
  var terminados = listarTodosTerminados();

  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Envíos')
        .setSubtitle(
          enCurso.length + ' en curso · ' +
          terminados.length + ' esperando acceso'
        )
    );

  if (enCurso.length === 0 && terminados.length === 0) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('No hay envíos pendientes. Todo tranquilo.')
        )
        .addWidget(
          CardService.newTextParagraph()
            .setText('<i>Los envíos aparecen aquí cuando la copia inicial no terminó (están reintentando en segundo plano) o cuando quedaron enlaces esperando que te den acceso a Drive.</i>')
        )
    );
    // Botón Actualizar aún vacío también, por si querés refrescar por
    // si alguno arrancó.
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextButton()
            .setText('🔄 Actualizar lista')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onActualizarListaEnvios')
                .setParameters({ messageId: messageId })
            )
        )
    );
    return card.build();
  }

  // ── Sección: En curso ──
  if (enCurso.length > 0) {
    var seccionCurso = CardService.newCardSection()
      .setHeader('📋 En curso (' + enCurso.length + ')');

    enCurso.forEach(function(s) {
      var caso = s.numeroCaso || '(sin caso)';
      var servicio = s.servicioNombre || '(sin servicio)';
      var relan = s.relanzamientos || 0;
      var copiados = s.copiadosPrevios || 0;
      var pendientes = (s.urlsPendientes || []).length;

      var resumenHtml = '<b>Caso ' + caso + '</b> · ' + servicio + '<br>' +
        copiados + ' archivo' + (copiados === 1 ? '' : 's') + ' copiado' + (copiados === 1 ? '' : 's') +
        ', ' + pendientes + ' enlace' + (pendientes === 1 ? '' : 's') + ' por copiar' +
        (relan > 0
          ? '<br>Ronda ' + relan + ' de ' + REINTENTOS_CONFIG.MAX_RELANZAMIENTOS
          : '<br>Esperando el primer reintento');

      seccionCurso.addWidget(CardService.newTextParagraph().setText(resumenHtml));
      seccionCurso.addWidget(
        CardService.newButtonSet()
          .addButton(
            CardService.newTextButton()
              .setText('Ver detalle')
              .setOnClickAction(
                CardService.newAction()
                  .setFunctionName('onAbrirEstadoEnvio')
                  .setParameters({ envioId: s.envioId, messageId: messageId })
              )
          )
          .addButton(
            CardService.newTextButton()
              .setText('🗑️ Descartar')
              .setOnClickAction(
                CardService.newAction()
                  .setFunctionName('onDescartarEnCurso')
                  .setParameters({ envioId: s.envioId, messageId: messageId })
              )
          )
      );
    });

    card.addSection(seccionCurso);
  }

  // ── Sección: Esperando acceso ──
  if (terminados.length > 0) {
    var seccionEsp = CardService.newCardSection()
      .setHeader('🔓 Esperando acceso (' + terminados.length + ')');

    terminados.forEach(function(t) {
      var caso = t.numeroCaso || '(sin caso)';
      var servicio = t.servicioNombre || '(sin servicio)';
      var n = (t.urlsPermiso || []).length;

      var resumenHtml;
      if (t.esCarpetaDestino) {
        resumenHtml = '<b>Caso ' + caso + '</b> · ' + servicio + '<br>' +
          '<i>Sin acceso a la carpeta destino. Cambiá la carpeta raíz desde config.</i>';
      } else {
        resumenHtml = '<b>Caso ' + caso + '</b> · ' + servicio + '<br>' +
          n + ' enlace' + (n === 1 ? '' : 's') + ' esperando permiso' +
          '<br>Archivos ya copiados: ' + (t.copiadosFinales || 0);
      }

      seccionEsp.addWidget(CardService.newTextParagraph().setText(resumenHtml));
      seccionEsp.addWidget(
        CardService.newTextButton()
          .setText('Ver detalle')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onAbrirEstadoEnvio')
              .setParameters({ envioId: t.envioId, messageId: messageId })
          )
      );
    });

    // Botón para descartar en batch cuando hay 2+ pendientes. Con
    // solo 1, el botón individual "Descartar" de la Card de estado ya
    // alcanza — evitar redundancia visual.
    if (terminados.length >= 2) {
      seccionEsp.addWidget(
        CardService.newTextParagraph().setText(
          '<i>Si sabes que ninguno se va a resolver (docs borrados, dueños que ya no están, etc.) puedes sacarlos todos de una vez.</i>'
        )
      );
      seccionEsp.addWidget(
        CardService.newTextButton()
          .setText('🗑️ Descartar todos (' + terminados.length + ')')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onDescartarTodosPendientes')
              .setParameters({ messageId: messageId })
          )
      );
    }

    card.addSection(seccionEsp);
  }

  // ── Botón para refrescar la lista ──
  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newTextButton()
          .setText('🔄 Actualizar lista')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onActualizarListaEnvios')
              .setParameters({ messageId: messageId })
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor('#1a73e8')
      )
  );

  return card.build();
}

/**
 * Callback del botón "Envíos en curso" (Homepage / pie del formulario).
 * pushCard sobre la pila actual — el usuario puede volver con el back
 * nativo de Gmail.
 */
function onListarEnviosEnCurso(e) {
  var messageId = (e.parameters && e.parameters.messageId) || '';
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .pushCard(buildListaEnviosEnCursoCard({ messageId: messageId }))
    )
    .build();
}

/**
 * Refresca la lista de envíos en curso (updateCard con la lista
 * recargada — puede haber cambiado si alguno terminó desde la última
 * apertura).
 */
function onActualizarListaEnvios(e) {
  var messageId = (e.parameters && e.parameters.messageId) || '';
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildListaEnviosEnCursoCard({ messageId: messageId }))
    )
    .setNotification(
      CardService.newNotification().setText('Lista actualizada.')
    )
    .build();
}

/**
 * Callback del botón "Ver estado del envío" que aparece en el banner
 * de la Card de validación cuando hay un sobre pendiente para el mismo
 * caso. Empuja la Card de estado sobre la pila actual — el usuario
 * puede volver al formulario con el botón "Volver al formulario" o con
 * el back de Gmail.
 */
function onAbrirEstadoEnvio(e) {
  var envioId = e.parameters && e.parameters.envioId;
  var messageId = e.parameters && e.parameters.messageId;
  if (!envioId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se pudo abrir el estado: falta el ID de envío.')
      )
      .build();
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .pushCard(buildEstadoEnvioCard(envioId, { messageId: messageId }))
    )
    .build();
}

/**
 * Callback del botón "🔄 Reintentar copia" que aparece en la rama
 * "esperando acceso" de la Card de estado. Rearma un sobre pendiente
 * con las URLs bloqueadas por permiso y programa un trigger nuevo. El
 * usuario debe apretar este botón DESPUÉS de que le dieron acceso — si
 * lo aprieta antes, la copia va a fallar igual y el sobre TERMINADO se
 * va a recrear al final del reintento.
 */
function onReintentarCopiaManual(e) {
  var authResp = chequearAutorizacionAction_();
  if (authResp) return authResp;

  var envioId = e.parameters && e.parameters.envioId;
  var messageId = (e.parameters && e.parameters.messageId) || '';

  if (!envioId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se puede reintentar: falta el ID de envío.')
      )
      .build();
  }

  var terminado = leerSobreTerminado(envioId);
  if (!terminado) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se encontró el envío para reintentar (puede que ya se haya resuelto o expirado).')
      )
      .build();
  }

  if (terminado.esCarpetaDestino) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('El problema es la carpeta destino, no los enlaces. Ve a "Configuración" y cambia la carpeta raíz.')
      )
      .build();
  }

  if (!terminado.carpetaDestinoId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No hay carpeta destino registrada para este envío. No se puede reintentar.')
      )
      .build();
  }

  var urls = terminado.urlsPermiso || [];
  if (urls.length === 0) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No hay enlaces pendientes para reintentar.')
      )
      .build();
  }

  // Armar el sobre pendiente. copiadosPrevios arranca en el total ya
  // copiado antes, así el resumen final del reintento sigue siendo
  // coherente ("Completado (N archivos)").
  var sobre = {
    envioId: terminado.envioId,
    servicioNombre: terminado.servicioNombre,
    numeroCaso: terminado.numeroCaso,
    carpetaDestinoId: terminado.carpetaDestinoId,
    urlsPendientes: urls.slice(),
    urlsPermisoPreexistentes: [], // se resetean — si vuelven a fallar por permiso, aparecerán en el TERMINADO del retry
    copiadosPrevios: terminado.copiadosFinales || 0,
    relanzamientos: 0,
    creadoEn: new Date().getTime()
  };

  try {
    var ok = programarReintentoCopia(sobre);
    if (!ok) {
      return CardService.newActionResponseBuilder()
        .setNotification(
          CardService.newNotification().setText('No se pudo programar el reintento. Puede que haya demasiados envíos corriendo en paralelo — probá de nuevo en unos minutos.')
        )
        .build();
    }
    // Borramos el sobre TERMINADO. Si el reintento vuelve a fallar por
    // permiso, procesarSobre lo re-crea al terminar.
    try {
      PropertiesService.getUserProperties().deleteProperty(
        REINTENTOS_CONFIG.TERMINADO_PREFIJO + terminado.envioId
      );
    } catch (errDel) {
      console.error('[Reintentar] No se pudo borrar sobre TERMINADO: ' + errDel.message);
    }

    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText(
          'Reintento del caso ' + terminado.numeroCaso + ' programado. Corre en 1 a 15 segundos.'
        )
      )
      .setNavigation(
        CardService.newNavigation()
          .updateCard(buildEstadoEnvioCard(envioId, { messageId: messageId }))
      )
      .build();
  } catch (err) {
    console.error('[Reintentar] Error programando: ' + err.message);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Error programando el reintento: ' + err.message)
      )
      .build();
  }
}

/**
 * Callback del botón "Descartar" en la rama "esperando acceso" de la
 * Card de estado. Borra el sobre TERMINADO sin reintentar. Sirve para
 * sacar de la lista casos que el usuario sabe que no va a resolver
 * (por ejemplo, el dueño ya no trabaja acá).
 */
function onDescartarPendiente(e) {
  var envioId = e.parameters && e.parameters.envioId;
  var messageId = (e.parameters && e.parameters.messageId) || '';

  if (!envioId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se puede descartar: falta el ID de envío.')
      )
      .build();
  }

  try {
    PropertiesService.getUserProperties().deleteProperty(
      REINTENTOS_CONFIG.TERMINADO_PREFIJO + envioId
    );
  } catch (err) {
    console.error('[Descartar] ' + err.message);
  }

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText('Envío descartado de la lista de pendientes.')
    )
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildListaEnviosEnCursoCard({ messageId: messageId }))
    )
    .build();
}

/**
 * Descarta un envío EN CURSO (sobre PENDIENTE_). A diferencia de
 * onDescartarPendiente (que borra un sobre TERMINADO ya sin actividad),
 * este mata un envío que todavía está avanzando en segundo plano:
 *   - Borra el sobre PENDIENTE_ de UserProperties (el próximo trigger
 *     no lo encuentra y no lo procesa).
 *   - Intenta borrar cualquier trigger asociado (best-effort, no crítico
 *     si falla — sin sobres, el trigger se auto-elimina cuando dispara).
 *   - Escribe "Descartado manualmente" en la col Estado Copia del Sheet
 *     para dejar trazabilidad — la fila no desaparece, solo cambia el
 *     texto de estado.
 */
function onDescartarEnCurso(e) {
  var authResp = chequearAutorizacionAction_();
  if (authResp) return authResp;

  var envioId = e.parameters && e.parameters.envioId;
  var messageId = (e.parameters && e.parameters.messageId) || '';

  if (!envioId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se puede descartar: falta el ID de envío.')
      )
      .build();
  }

  var sobre = null;
  try {
    var raw = PropertiesService.getUserProperties().getProperty(
      REINTENTOS_CONFIG.PREFIJO_SOBRE + envioId
    );
    if (raw) sobre = JSON.parse(raw);
  } catch (errParse) {
    // Sobre corrupto — igual seguimos con el borrado.
  }

  try {
    PropertiesService.getUserProperties().deleteProperty(
      REINTENTOS_CONFIG.PREFIJO_SOBRE + envioId
    );
  } catch (errDel) {
    console.error('[DescartarEnCurso] No se pudo borrar sobre: ' + errDel.message);
  }

  // Actualizamos el Sheet para trazabilidad. Usamos el helper de reintentos
  // que ya sabe encontrar la fila por envioId. Si el sobre trae sheetId/tab,
  // los usa; si no, cae al Sheet actual.
  try {
    var sheet = obtenerSheetDelSobre_(sobre || { envioId: envioId });
    actualizarSheetPorEnvioId(sheet, envioId, 'Descartado manualmente', null);
  } catch (errSheet) {
    console.error('[DescartarEnCurso] No se pudo actualizar Sheet: ' + errSheet.message);
  }

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText('Envío descartado. Su fila en el Sheet quedó marcada como "Descartado manualmente".')
    )
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildListaEnviosEnCursoCard({ messageId: messageId }))
    )
    .build();
}

/**
 * Descarta en batch TODOS los sobres TERMINADO (esperando acceso)
 * del usuario. Útil cuando el usuario sabe que ninguno va a resolverse
 * (correos viejos, docs borrados, personas que ya no trabajan acá).
 *
 * No pide confirmación explícita — el nombre del botón ya dice "Descartar
 * todos" y la notificación posterior aclara cuántos borró. Si borrás por
 * error, los sobres se van solos a los 7 días de todos modos.
 */
function onDescartarTodosPendientes(e) {
  var messageId = (e.parameters && e.parameters.messageId) || '';

  var borrados = 0;
  var errores = 0;
  try {
    var props = PropertiesService.getUserProperties();
    var todas = props.getProperties();
    for (var k in todas) {
      if (!todas.hasOwnProperty(k)) continue;
      if (k.indexOf(REINTENTOS_CONFIG.TERMINADO_PREFIJO) !== 0) continue;
      try {
        props.deleteProperty(k);
        borrados++;
      } catch (errDel) {
        errores++;
        console.error('[DescartarTodos] No se pudo borrar ' + k + ': ' + errDel.message);
      }
    }
  } catch (err) {
    console.error('[DescartarTodos] ' + err.message);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Error al descartar: ' + err.message)
      )
      .build();
  }

  var msg;
  if (borrados === 0) msg = 'No había pendientes para descartar.';
  else if (errores === 0) msg = borrados + ' pendiente' + (borrados === 1 ? '' : 's') + ' descartado' + (borrados === 1 ? '' : 's') + '.';
  else msg = borrados + ' descartados, ' + errores + ' fallaron. Ver logs.';

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(msg))
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildListaEnviosEnCursoCard({ messageId: messageId }))
    )
    .build();
}
