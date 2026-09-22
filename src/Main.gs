function onHomepage(e) {
  console.log('[Homepage] Sheet configurado: ' + (obtenerSheetId() || 'NO'));

  var authCard = chequearAutorizacion_();
  if (authCard) return [authCard];

  var motivo = motivoConfigInvalida();
  if (motivo) {
    return [buildCardConfigApropiada(motivo)];
  }

  return [buildHomepageCard(null, null, leerFormularioActivo_())];
}

/**
 * Construye la card del panel principal.
 *
 * - `messageIdVolver`: botón "Volver al caso detectado" (interno, usado
 *   por onIrAlInicio cuando el usuario ya está viendo la validation).
 * - `messageIdDetectar`: botón "Detectar caso en este correo". Se usa
 *   al abrir un correo sin form activo — la detección ya no es
 *   automática para evitar duplicados cuando el caso ya existe.
 * - `activo`: si hay un formulario activo (de cualquier correo) sin
 *   submitear, se agrega arriba de todo un botón para volver a él.
 */
function buildHomepageCard(messageIdVolver, messageIdDetectar, activo) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Gestor de Solicitudes')
        .setSubtitle('Panel principal')
    );

  // ── Botón "Volver al caso que estás armando" (siempre que haya activo) ──
  if (activo && activo.messageId && activo.messageId !== messageIdVolver) {
    var etiqueta = activo.datos && activo.datos.numeroCaso
      ? 'Caso ' + activo.datos.numeroCaso
      : 'este caso';
    var seccionActivo = CardService.newCardSection()
      .addWidget(
        CardService.newTextParagraph()
          .setText('📝 <b>Estás armando un envío para ' + escaparHtml(etiqueta) + '.</b>')
      )
      .addWidget(
        CardService.newButtonSet()
          .addButton(
            CardService.newTextButton()
              .setText('🔙 Volver al formulario')
              .setOnClickAction(
                CardService.newAction()
                  .setFunctionName('onVolverAlFormularioActivo')
              )
              .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
              .setBackgroundColor('#f9ab00')
          )
          .addButton(
            CardService.newTextButton()
              .setText('❌ Descartar')
              .setOnClickAction(
                CardService.newAction()
                  .setFunctionName('onDescartarFormularioActivo')
              )
          )
      );
    card.addSection(seccionActivo);
  } else if (messageIdVolver) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextButton()
            .setText('🔙 Volver al caso detectado')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onVolverAlCaso')
                .setParameters({ messageId: messageIdVolver })
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#5f6368')
        )
    );
  }

  // ── Botón "Detectar caso" (cuando estamos en un correo sin form activo) ──
  if (messageIdDetectar && (!activo || activo.messageId !== messageIdDetectar)) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextButton()
            .setText('🔍 Detectar caso en este correo')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onDetectarCaso')
                .setParameters({ messageId: messageIdDetectar })
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#1a73e8')
        )
    );
  }

  return card
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText(messageIdDetectar
              ? 'Presiona <b>Detectar caso</b> para leer este correo y armar el envío. Si el caso ya existe, vas a ver los envíos previos y puedes modificarlos en vez de duplicar.'
              : 'Abre un correo de solicitud y presiona <b>Detectar caso</b>. Desde este panel también puedes gestionar los envíos existentes.')
        )
    )
    // ── Nuevo envío ──
    .addSection(
      CardService.newCardSection()
        .setHeader('Nuevo envío')
        .addWidget(
          CardService.newTextButton()
            .setText('📝 Llenar formulario manualmente')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onAbrirFormularioManual')
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#0f9d58')
        )
    )
    // ── Gestionar envíos ──
    .addSection(
      CardService.newCardSection()
        .setHeader('Gestionar envíos')
        .addWidget(
          CardService.newTextButton()
            .setText('📋 Envíos en curso')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onListarEnviosEnCurso')
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#1a73e8')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('✏️ Editor de solicitudes')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onListarEditables')
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#f9ab00')
        )
    )
    // ── Pie: config + ayuda ──
    .addSection(
      CardService.newCardSection()
        .setHeader('Otros')
        .addWidget(
          CardService.newButtonSet()
            .addButton(
              CardService.newTextButton()
                .setText('⚙ Configuración')
                .setOnClickAction(
                  CardService.newAction()
                    .setFunctionName('onMostrarConfig')
                )
            )
            .addButton(
              CardService.newTextButton()
                .setText('❓ Ayuda')
                .setOnClickAction(
                  CardService.newAction()
                    .setFunctionName('onAbrirAyuda')
                )
            )
            .addButton(
              CardService.newTextButton()
                .setText('🔧 Diagnóstico')
                .setOnClickAction(
                  CardService.newAction()
                    .setFunctionName('onAbrirDiagnostico')
                )
            )
        )
    )
    .build();
}

/**
 * Callback del botón "Menú principal" que aparece arriba de la validation
 * card. Push la Homepage sobre la pila actual para que el usuario pueda
 * acceder a "Editor de solicitudes", "Envíos en curso", etc. sin tener
 * que cerrar el correo. Pasa el messageId para que la Homepage muestre
 * un botón "Volver al caso" y el usuario pueda regresar sin cerrar todo.
 */
function onIrAlInicio(e) {
  var messageId = (e && e.parameters && e.parameters.messageId) || '';
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().pushCard(buildHomepageCard(messageId, null, leerFormularioActivo_()))
    )
    .build();
}

/**
 * Callback del botón "Volver al caso detectado" que aparece arriba en la
 * Homepage cuando se llegó desde un correo. Reconstruye la validation
 * card del correo original y reemplaza la pila para que la validation
 * quede visible como si acabara de abrir el correo.
 */
function onVolverAlCaso(e) {
  var messageId = e && e.parameters && e.parameters.messageId;
  if (!messageId) {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popCard())
      .build();
  }

  // Preferimos los datos guardados del formulario activo — así no
  // dependemos del access token del correo (que puede haber expirado
  // si el usuario ya navegó al menú y volvió).
  var activo = leerFormularioActivo_();
  if (activo && activo.messageId === messageId) {
    var card = cardDetectada_(activo.datos, messageId);
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().popToRoot().updateCard(card)
      )
      .setStateChanged(true)
      .build();
  }

  // Fallback: no hay activo guardado, intentamos releer el correo.
  try {
    if (e.gmail && e.gmail.accessToken) {
      GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
    }
    var cardFallback = construirValidacionDesdeMessageId_(messageId);
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().popToRoot().updateCard(cardFallback)
      )
      .setStateChanged(true)
      .build();
  } catch (err) {
    console.error('[Main] onVolverAlCaso: ' + err.message);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se pudo volver al caso: ' + err.message)
      )
      .setNavigation(CardService.newNavigation().popCard())
      .build();
  }
}

/**
 * Handler del botón "Llenar formulario manualmente". Abre la card de
 * validación con datos vacíos y sin messageId asociado. El usuario llena
 * todo a mano y presiona ENVIAR. Se usa cuando no hay correo abierto o
 * cuando el add-on no detectó una solicitud en el correo actual.
 */
function onAbrirFormularioManual(e) {
  console.log('[FormularioManual] Abriendo formulario en blanco');
  var motivo = motivoConfigInvalida();
  if (motivo) {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(buildCardConfigApropiada(motivo)))
      .build();
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildValidacionCard({}, null, null, null, null)))
    .build();
}

/**
 * Homepage del add-on cuando se abre desde Google Sheets. El mismo
 * ícono del add-on aparece en el panel lateral derecho de cualquier
 * Sheet; al hacer click, se muestra directamente la lista de envíos
 * (En curso + Esperando acceso) para que el usuario pueda revisar y
 * reintentar copias sin tener que ir a Gmail.
 *
 * Se declara acá porque appsscript.json apunta a esta función en su
 * addOns.sheets.homepageTrigger.runFunction.
 */
function onHomepageSheets(e) {
  console.log('[HomepageSheets] Abierto desde Sheets');

  var authCard = chequearAutorizacion_();
  if (authCard) return [authCard];

  var motivo = motivoConfigInvalida();
  if (motivo) {
    return [buildCardConfigApropiada(motivo)];
  }

  return [buildListaEnviosEnCursoCard({})];
}

function onGmailMessageOpen(e) {
  console.log('[GmailOpen] messageId: ' + e.gmail.messageId);

  var authCard = chequearAutorizacion_();
  if (authCard) return [authCard];

  var motivo = motivoConfigInvalida();
  if (motivo) {
    console.log('[GmailOpen] Config inválida — mostrando config: ' + motivo);
    return [buildCardConfigApropiada(motivo)];
  }

  var messageId = e.gmail.messageId;
  var activo = leerFormularioActivo_();

  // Si hay un formulario activo para ESTE correo, restauramos la card
  // directamente desde los datos guardados (sin releer el mensaje).
  if (activo && activo.messageId === messageId) {
    console.log('[GmailOpen] Restaurando formulario activo para ' + messageId);
    return [cardDetectada_(activo.datos, messageId)];
  }

  // Si hay un formulario activo pero para OTRO correo, pintamos el menú
  // del correo actual con un botón arriba "Volver al caso que estás armando".
  return [buildHomepageCard(null, messageId, activo)];
}

/**
 * Reconstruye la card de validación a partir de datos ya extraídos.
 * No requiere acceso al mensaje — útil desde onHomepage donde no hay
 * `e.gmail.accessToken`.
 */
function construirValidacionDesdeDatos_(datos, messageId) {
  var enviosCaso = listarSobresPorCaso(datos.numeroCaso);
  var envioEnCursoId = enviosCaso.length > 0 ? enviosCaso[0].envioId : null;
  var envioEsperandoAccesoId = null;
  if (!envioEnCursoId) {
    var esperando = listarTerminadosPorCaso(datos.numeroCaso);
    envioEsperandoAccesoId = esperando.length > 0 ? esperando[0].envioId : null;
  }
  var editablesCaso = listarEditablesPorCaso(datos.numeroCaso);
  return buildValidacionCard(datos, messageId, null, envioEnCursoId, envioEsperandoAccesoId, null, editablesCaso);
}

/**
 * Decide qué card mostrar tras detectar (o restaurar) un caso: si el
 * caso ya tiene envíos previos en el Sheet (con envioId o filas
 * manuales), muestra la chooser "Nuevo envío / Editar existente";
 * si no, el formulario de creación.
 *
 * Se pasan dos listados al chooser: `todosEnviosCaso` (todos los
 * envíos previos del caso, para el resumen visual) y `editablesCaso`
 * (solo los que están en PENDIENTE, para decidir si se ofrece el
 * botón "Editar existente"). Los envíos APROBADOS o NO APROBADOS
 * aparecen en el aviso pero no como editables.
 */
function cardDetectada_(datos, messageId) {
  var todosEnviosCaso = listarTodosEnviosPorCaso(datos.numeroCaso);
  var editablesCaso = listarEditablesPorCaso(datos.numeroCaso);
  var manuales = listarFilasManualesPorCaso(datos.numeroCaso);
  if (todosEnviosCaso.length > 0 || manuales.length > 0) {
    return buildElegirAccionCasoCard(datos, messageId, editablesCaso, manuales, todosEnviosCaso);
  }
  return construirValidacionDesdeDatos_(datos, messageId);
}

/**
 * Reconstruye la card leyendo el mensaje. Requiere que el llamador ya
 * haya seteado `GmailApp.setCurrentMessageAccessToken` con un token
 * válido para ese mensaje.
 */
function construirValidacionDesdeMessageId_(messageId) {
  var message = GmailApp.getMessageById(messageId);
  var datos = extraerDatos(message.getPlainBody(), message.getSubject());
  return construirValidacionDesdeDatos_(datos, messageId);
}

// ─── Formulario activo (persistencia global entre correos e inbox) ───
// Al detectar un caso, guardamos {messageId, datos, ts} bajo UNA sola clave.
// onHomepage y onGmailMessageOpen lo leen para restaurar el form o mostrar
// un botón "Volver al caso" — así el usuario no pierde el trabajo aunque
// navegue al inbox o a otros correos. Se limpia al submitear, al pulsar
// "Cerrar formulario", o pasadas 6 horas.
var FORMULARIO_ACTIVO_KEY_ = 'form_activo';
var FORMULARIO_ACTIVO_TTL_MS_ = 21600000; // 6 horas

function guardarFormularioActivo_(messageId, datos) {
  if (!messageId || !datos) return;
  var payload = JSON.stringify({ messageId: messageId, datos: datos, ts: Date.now() });
  PropertiesService.getUserProperties().setProperty(FORMULARIO_ACTIVO_KEY_, payload);
  console.log('[FormActivo] GUARDADO msg=' + messageId + ' caso=' + redactCaso_(datos.numeroCaso));
}

function leerFormularioActivo_() {
  var raw = PropertiesService.getUserProperties().getProperty(FORMULARIO_ACTIVO_KEY_);
  if (!raw) {
    console.log('[FormActivo] leer → nada');
    return null;
  }
  var payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.error('[FormActivo] JSON inválido, limpiando: ' + err.message);
    cerrarFormularioActivo_();
    return null;
  }
  var edad = Date.now() - (payload.ts || 0);
  if (edad > FORMULARIO_ACTIVO_TTL_MS_) {
    console.log('[FormActivo] EXPIRADO (edad ' + edad + 'ms), limpiando');
    cerrarFormularioActivo_();
    return null;
  }
  console.log('[FormActivo] leer → activo msg=' + payload.messageId + ' edad=' + edad + 'ms');
  return payload;
}

function cerrarFormularioActivo_() {
  PropertiesService.getUserProperties().deleteProperty(FORMULARIO_ACTIVO_KEY_);
  console.log('[FormActivo] CERRADO');
}

/**
 * Handler del botón "🔙 Volver al formulario" que aparece en la homepage
 * (inbox u otro correo) cuando hay un formulario activo. Reconstruye la
 * validation card usando los datos guardados — no necesita releer el
 * mensaje, así que funciona incluso desde el inbox.
 */
function onVolverAlFormularioActivo(e) {
  var activo = leerFormularioActivo_();
  if (!activo) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('El formulario ya no está disponible.')
      )
      .setNavigation(CardService.newNavigation().updateCard(buildHomepageCard()))
      .build();
  }
  var card = cardDetectada_(activo.datos, activo.messageId);
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().popToRoot().updateCard(card)
    )
    .setStateChanged(true)
    .build();
}

/**
 * Handler del botón "❌ Descartar" en la homepage. Limpia el formulario
 * activo y refresca la card para que el botón desaparezca.
 */
function onDescartarFormularioActivo(e) {
  cerrarFormularioActivo_();
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().updateCard(buildHomepageCard())
    )
    .setNotification(
      CardService.newNotification().setText('Formulario descartado.')
    )
    .build();
}

/**
 * Callback del botón "Detectar caso en este correo" (Homepage abierta
 * desde Gmail). Ejecuta la lectura del mensaje, validación y extracción
 * de datos, y muestra la validation card. Antes esto corría automático
 * en onGmailMessageOpen, pero generaba confusión cuando el caso ya
 * existía (se abría el formulario de creación aunque hubiera envíos
 * previos). Ahora el usuario decide cuándo detectar.
 */
function onDetectarCaso(e) {
  var messageId = (e && e.parameters && e.parameters.messageId)
    || (e && e.gmail && e.gmail.messageId);
  if (!messageId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se pudo identificar el correo abierto.')
      )
      .build();
  }

  if (e && e.gmail && e.gmail.accessToken) {
    GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  }

  var message = GmailApp.getMessageById(messageId);
  if (!message) {
    console.error('[Detectar] No se pudo leer el mensaje: ' + messageId);
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(buildErrorCard('No se pudo leer el correo.')))
      .build();
  }

  var remitente = message.getFrom();
  var body = message.getPlainBody();
  var asunto = message.getSubject();

  console.log('[Detectar] Remitente: ' + redactEmail_(remitente) + ' | Asunto: ' + redactTexto_(asunto) + ' | Body: ' + (body ? body.length : 0) + ' chars');

  if (!esSolicitudValida(remitente, body)) {
    console.log('[Detectar] No es solicitud válida — descartado');
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(buildNoAplicaCard()))
      .build();
  }

  var datos = extraerDatos(body, asunto);
  console.log('[Detectar] Extraído: caso=' + redactCaso_(datos.numeroCaso) + ' | servicio=' + redactTexto_(datos.servicioDesplegar));

  guardarFormularioActivo_(messageId, datos);

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(cardDetectada_(datos, messageId)))
    .build();
}

/**
 * Card intermedia que aparece cuando "Detectar caso" encuentra que el
 * caso YA existe en el Sheet. El usuario elige:
 *   - Editar existente → edit card (1) o lista de editables (>1).
 *     Solo aparece si hay envíos con envioId (editables desde el add-on).
 *   - Nuevo envío → formulario de creación (ambiente/componente extra).
 *     Siempre aparece.
 *   - Filas manuales (sin envioId) → se listan como aviso; no se pueden
 *     editar desde el add-on porque les falta el envioId de referencia.
 */
function buildElegirAccionCasoCard(datos, messageId, editablesCaso, manuales, todosEnviosCaso) {
  editablesCaso = editablesCaso || [];
  manuales = manuales || [];
  // Compatibilidad: si el llamador no pasó `todosEnviosCaso` caemos a
  // `editablesCaso` para no romper firmas antiguas.
  todosEnviosCaso = todosEnviosCaso || editablesCaso;

  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Caso ya registrado')
        .setSubtitle('Caso ' + (datos.numeroCaso || '(sin caso)') + ' · ' + (datos.servicioDesplegar || '(sin servicio)'))
    );

  // ── Envíos con envioId (todos los del caso, editables o no) ──
  if (todosEnviosCaso.length > 0) {
    var resumen = todosEnviosCaso.map(function(item) {
      var comp = (item.componentes || []).join(', ') || '(sin componente)';
      var editableMarca = (item.estado === 'PENDIENTE') ? '' : ' <i>(no editable)</i>';
      return '• <b>' + escaparHtml(item.estado) + '</b> · ' + escaparHtml(item.ambiente || '(sin ambiente)') +
             ' · ' + escaparHtml(comp) + editableMarca;
    }).join('<br>');
    var pendientesCount = editablesCaso.length;
    var totalCount = todosEnviosCaso.length;
    var textoIntro;
    if (pendientesCount === 0) {
      textoIntro = 'Este caso ya tiene <b>' + totalCount + ' envío' +
        (totalCount === 1 ? '' : 's') + '</b> registrado' +
        (totalCount === 1 ? '' : 's') + ' desde el add-on. Ninguno está en PENDIENTE, así que no se pueden editar (solo registrar otro nuevo):';
    } else if (pendientesCount === totalCount) {
      textoIntro = 'Este caso ya tiene <b>' + totalCount + ' envío' +
        (totalCount === 1 ? '' : 's') + '</b> registrado' +
        (totalCount === 1 ? '' : 's') + ' desde el add-on:';
    } else {
      textoIntro = 'Este caso ya tiene <b>' + totalCount + ' envío' +
        (totalCount === 1 ? '' : 's') + '</b> registrado' +
        (totalCount === 1 ? '' : 's') + ' desde el add-on (' + pendientesCount + ' en PENDIENTE, el resto no editable):';
    }
    card.addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph().setText(textoIntro))
        .addWidget(CardService.newTextParagraph().setText(resumen))
    );
  }

  // ── Filas manuales (sin envioId) — aviso, no se pueden editar ──
  if (manuales.length > 0) {
    var resumenManual = manuales.map(function(m) {
      return '• <b>' + escaparHtml(m.estado || '(sin estado)') + '</b> · ' +
             escaparHtml(m.ambiente || '(sin ambiente)') + ' · ' +
             escaparHtml(m.componente || '(sin componente)') +
             ' · fila ' + m.filaSheet;
    }).join('<br>');
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('⚠️ <b>' + manuales.length + ' fila' + (manuales.length === 1 ? '' : 's') +
              ' manual' + (manuales.length === 1 ? '' : 'es') +
              '</b> (sin ID de envío) para este caso. Revisa antes de duplicar:')
        )
        .addWidget(
          CardService.newTextParagraph().setText(resumenManual)
        )
        .addWidget(
          CardService.newTextParagraph()
            .setText('<i>No se pueden editar desde el add-on porque les falta el ID de envío. Si quieres modificarlas, hazlo directo en el Sheet.</i>')
        )
    );
  }

  // ── Opciones ──
  var seccionAcciones = CardService.newCardSection().setHeader('¿Qué quieres hacer?');

  if (editablesCaso.length > 0) {
    var accionEditar;
    if (editablesCaso.length === 1) {
      accionEditar = CardService.newAction()
        .setFunctionName('onAbrirEditar')
        .setParameters({ envioId: editablesCaso[0].envioId, messageId: messageId || '' });
    } else {
      accionEditar = CardService.newAction()
        .setFunctionName('onListarEditables')
        .setParameters({ messageId: messageId || '' });
    }
    seccionAcciones.addWidget(
      CardService.newTextButton()
        .setText('✏️ Editar existente')
        .setOnClickAction(accionEditar)
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor('#f9ab00')
    );
  }

  seccionAcciones.addWidget(
    CardService.newTextButton()
      .setText('➕ Registrar otro envío nuevo')
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onIrANuevoEnvio')
          .setParameters({ messageId: messageId || '' })
      )
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setBackgroundColor('#1a73e8')
  );

  card.addSection(seccionAcciones);
  return card.build();
}

/**
 * Handler del botón "Registrar otro envío nuevo" en la card
 * buildElegirAccionCasoCard. Reemplaza esa card por el formulario de
 * creación con los datos del correo ya extraídos.
 */
function onIrANuevoEnvio(e) {
  var messageId = (e && e.parameters && e.parameters.messageId) || '';
  var activo = leerFormularioActivo_();
  if (!activo || activo.messageId !== messageId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('No se encontraron los datos del correo. Volvé a detectar.')
      )
      .setNavigation(CardService.newNavigation().popCard())
      .build();
  }
  var card = construirValidacionDesdeDatos_(activo.datos, messageId);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card))
    .setStateChanged(true)
    .build();
}