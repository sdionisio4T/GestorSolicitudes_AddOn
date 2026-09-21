/**
 * Auth.gs — Verificación de permisos OAuth del add-on.
 *
 * Google muestra el diálogo de consentimiento automáticamente cuando el
 * usuario instala el add-on por primera vez. Este módulo cubre los otros
 * casos: cuando se agregan scopes nuevos en una actualización, cuando el
 * usuario rechazó parte de los permisos, o cuando la autorización expira.
 *
 * Uso: cada trigger (onHomepage, onGmailMessageOpen, onHomepageSheets)
 * llama a chequearAutorizacion_() antes de construir su UI. Si faltan
 * permisos, se muestra una tarjeta con botón "Autorizar acceso" que
 * abre el flujo nativo de Google.
 */

/**
 * Devuelve una tarjeta de autorización si faltan permisos, o null si
 * todo está en orden. Los triggers hacen:
 *
 *   var authCard = chequearAutorizacion_();
 *   if (authCard) return [authCard];
 *
 * Para handlers de acción (que devuelven ActionResponse en vez de Card)
 * usar chequearAutorizacionAction_() más abajo.
 */
function chequearAutorizacion_() {
  var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    console.log('[Auth] Faltan permisos — mostrando tarjeta de autorización');
    return buildAutorizacionCard_(authInfo.getAuthorizationUrl());
  }
  return null;
}

/**
 * Variante para handlers de acción (los que devuelven ActionResponse).
 * Envuelve la tarjeta de autorización en un ActionResponse con pushCard,
 * o devuelve null si no hace falta.
 */
function chequearAutorizacionAction_() {
  var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    console.log('[Auth] Faltan permisos en handler de acción');
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(
        buildAutorizacionCard_(authInfo.getAuthorizationUrl())
      ))
      .build();
  }
  return null;
}

/**
 * Construye la tarjeta con el botón "Autorizar acceso". El botón usa
 * AuthorizationAction, que hace que Google abra su propio popup nativo
 * de consentimiento — el mismo que aparece en la primera instalación.
 */
function buildAutorizacionCard_(authUrl) {
  var boton = CardService.newTextButton()
    .setText('Autorizar acceso')
    .setAuthorizationAction(
      CardService.newAuthorizationAction().setAuthorizationUrl(authUrl)
    )
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setBackgroundColor('#1a73e8');

  var intro = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText(
        'Para funcionar, este add-on necesita algunos permisos de Google. ' +
        'Aquí te explicamos <b>exactamente</b> qué hace con cada uno, para ' +
        'que autorices con confianza.'
      )
    );

  var loQueHace = CardService.newCardSection()
    .setHeader('✅ Lo que el add-on hace')
    .addWidget(
      CardService.newTextParagraph().setText(
        '<b>📧 Leer el correo abierto</b>\n' +
        'Solo el mensaje que tienes en pantalla, para extraer los datos de ' +
        'la solicitud (caso, servicio, ambiente, enlaces).'
      )
    )
    .addWidget(
      CardService.newTextParagraph().setText(
        '<b>📁 Copiar adjuntos a Drive</b>\n' +
        'Mueve los archivos del correo a la carpeta destino del cliente ' +
        'que tú especifiques.'
      )
    )
    .addWidget(
      CardService.newTextParagraph().setText(
        '<b>📊 Registrar el envío en Sheets</b>\n' +
        'Escribe una fila en tu hoja de cálculo con los datos del envío ' +
        'y va actualizando su estado.'
      )
    )
    .addWidget(
      CardService.newTextParagraph().setText(
        '<b>🔄 Reintentos automáticos</b>\n' +
        'Cuando un archivo queda esperando acceso, el add-on lo reintenta ' +
        'solo cada cierto tiempo hasta lograrlo.'
      )
    );

  var loQueNoHace = CardService.newCardSection()
    .setHeader('🔒 Lo que el add-on NO puede hacer')
    .addWidget(
      CardService.newTextParagraph().setText(
        '• No lee otros correos de tu bandeja\n' +
        '• No envía correos en tu nombre\n' +
        '• No borra correos ni archivos\n' +
        '• No hace llamadas a internet fuera de Google\n' +
        '• No accede a tu Calendario ni Contactos\n' +
        '• No ve archivos privados de Drive que no le pases\n' +
        '• No cambia la configuración de tu cuenta'
      )
    );

  var accion = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText(
        'Al presionar el botón, Google te mostrará su propia pantalla de ' +
        'consentimiento con la lista oficial de permisos. Puedes revisarla ' +
        'antes de aceptar.'
      )
    )
    .addWidget(boton);

  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Autorización requerida')
        .setSubtitle('Gestor de Solicitudes')
    )
    .addSection(intro)
    .addSection(loQueHace)
    .addSection(loQueNoHace)
    .addSection(accion)
    .build();
}
