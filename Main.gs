function onHomepage(e) {
  console.log('[Homepage] Sheet configurado: ' + (obtenerSheetId() || 'NO'));

  var authCard = chequearAutorizacion_();
  if (authCard) return [authCard];

  var motivo = motivoConfigInvalida();
  if (motivo) {
    return [buildCardConfigApropiada(motivo)];
  }

  return [buildHomepageCard()];
}

/**
 * Construye la card del panel principal. Extraída para poder reutilizarla
 * desde `onIrAlInicio` (botón "Menú principal" en la validation card),
 * así el usuario puede volver al menú sin salir del correo.
 *
 * Si se pasa messageId, arriba de todo se muestra un botón "Volver al
 * caso" que lo lleva de vuelta a la validation card del correo actual.
 */
function buildHomepageCard(messageId) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Gestor de Solicitudes')
        .setSubtitle('Panel principal')
    );

  // ── Volver al caso (solo si venimos desde un correo) ──
  if (messageId) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextButton()
            .setText('🔙 Volver al caso detectado')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onVolverAlCaso')
                .setParameters({ messageId: messageId })
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#5f6368')
        )
    );
  }

  return card
    // ── Intro ──
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('Abrí un correo de solicitud para validar y enviar. Desde acá también podés gestionar los envíos existentes.')
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
      CardService.newNavigation().pushCard(buildHomepageCard(messageId))
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

  var accessToken = e.gmail.accessToken;
  GmailApp.setCurrentMessageAccessToken(accessToken);

  var messageId = e.gmail.messageId;
  var message = GmailApp.getMessageById(messageId);

  if (!message) {
    console.error('[GmailOpen] No se pudo leer el mensaje: ' + messageId);
    return [buildErrorCard('No se pudo leer el correo.')];
  }

  var remitente = message.getFrom();
  var body = message.getPlainBody();
  var asunto = message.getSubject();

  console.log('[GmailOpen] Remitente: ' + remitente + ' | Asunto: ' + asunto + ' | Body: ' + (body ? body.length : 0) + ' chars');

  if (!esSolicitudValida(remitente, body)) {
    console.log('[GmailOpen] No es solicitud válida — descartado');
    return [buildNoAplicaCard()];
  }

  var datos = extraerDatos(body, asunto);

  console.log('[GmailOpen] Extraído: caso=' + datos.numeroCaso + ' | servicio=' + datos.servicioDesplegar + ' | ambiente=' + datos.ambienteExtraido);

  // Si hay al menos un envío del mismo caso todavía en reintento (sobre
  // pendiente en UserProperties), pasamos el envioId más reciente para
  // que buildValidacionCard pinte el banner "Ver estado del envío".
  // Si no hay en curso pero SÍ hay un envío terminado con enlaces
  // esperando acceso (sobre TERMINADO), pintamos el otro banner.
  var enviosCaso = listarSobresPorCaso(datos.numeroCaso);
  var envioEnCursoId = enviosCaso.length > 0 ? enviosCaso[0].envioId : null;
  var envioEsperandoAccesoId = null;
  if (!envioEnCursoId) {
    var esperando = listarTerminadosPorCaso(datos.numeroCaso);
    envioEsperandoAccesoId = esperando.length > 0 ? esperando[0].envioId : null;
  }

  // Editables para el mismo caso (PENDIENTE / NO APROBADO en los últimos
  // 30 días). Si hay al menos uno, la validación pinta un banner arriba
  // que ofrece editar en lugar de crear un envío nuevo — así el usuario
  // no genera una fila duplicada por confundirse con el formulario.
  var editablesCaso = listarEditablesPorCaso(datos.numeroCaso);

  if (envioEnCursoId) {
    console.log('[GmailOpen] Envío en curso detectado para caso ' + datos.numeroCaso + ': ' + envioEnCursoId);
  } else if (envioEsperandoAccesoId) {
    console.log('[GmailOpen] Envío esperando acceso para caso ' + datos.numeroCaso + ': ' + envioEsperandoAccesoId);
  }
  if (editablesCaso.length > 0) {
    console.log('[GmailOpen] Editables detectados para caso ' + datos.numeroCaso + ': ' + editablesCaso.length);
  }

  return [buildValidacionCard(datos, messageId, null, envioEnCursoId, envioEsperandoAccesoId, null, editablesCaso)];
}