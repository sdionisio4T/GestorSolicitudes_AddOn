/**
 * ConfigHandlers.gs — Handlers de acción invocados desde los botones del
 * wizard de configuración, ayuda y panel de configuración. Todos leen
 * inputs del formulario, tocan UserProperties/Sheets/Drive según haga
 * falta, y devuelven un ActionResponse. Los builders puros de las cards
 * que devuelven viven en Cards.gs.
 */

// === HANDLERS DEL WIZARD DE CONFIGURACIÓN ===

function onConfirmarBorrado(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .pushCard(buildConfirmarBorradoCard())
    )
    .build();
}

function onBorrarConfig(e) {
  console.log('[Config] Sheet borrado por el usuario');

  borrarSheetId();

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification()
        .setText('Sheet eliminado. Pega una URL nueva para volver a configurar.')
    )
    .setNavigation(
      CardService.newNavigation()
        .popToRoot()
        .updateCard(buildConfigCard(false))
    )
    .build();
}

function onCancelarBorrado(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .popCard()
    )
    .build();
}

function onGuardarConfig(e) {
  var authResp = chequearAutorizacionAction_();
  if (authResp) return authResp;

  var formInputs = e.commonEventObject.formInputs || {};
  var sheetUrl = leerInput(formInputs, 'sheetUrl');

  if (!sheetUrl) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('Debes pegar la URL del Sheet.')
      )
      .build();
  }

  var sheetId = extraerSheetIdDeUrl(sheetUrl);

  if (!sheetId) {
    console.log('[Config] URL inválida: ' + sheetUrl);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('La URL no parece ser de un Google Sheet válido.')
      )
      .build();
  }

  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var nombre = ss.getName();

    guardarSheetId(sheetId);
    console.log('[Config] Sheet guardado: ' + sheetId + ' (' + nombre + ')');

    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('Sheet configurado: ' + nombre + '. Ahora elige la pestaña.')
      )
      .setNavigation(
        CardService.newNavigation()
          .pushCard(buildSeleccionTabCard(sheetId))
      )
      .build();

  } catch (error) {
    console.error('[Config] No se pudo abrir Sheet ' + sheetId + ': ' + error.message);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText(mensajeErrorUsuario(error, 'sheet'))
      )
      .build();
  }
}

function onGuardarTab(e) {
  var authResp = chequearAutorizacionAction_();
  if (authResp) return authResp;

  var formInputs = e.commonEventObject.formInputs || {};
  var tabName = leerInput(formInputs, 'tabSeleccionada');

  if (!tabName) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Debes seleccionar una pestaña.')
      )
      .build();
  }

  guardarSheetTab(tabName);

  // Pasamos por buildCardConfigApropiada para que, si la pestaña está
  // vacía, se ofrezca crear las cabeceras automáticamente antes de
  // avanzar al paso 3 (carpeta raíz). Si no está vacía, va directo al
  // paso 3 como siempre.
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().pushCard(
        buildCardConfigApropiada(null)
      )
    )
    .build();
}

/**
 * Handler del botón "Crear cabeceras automáticamente". Escribe los 13
 * headers en la pestaña configurada y avanza al paso 3 (carpeta raíz).
 */
function onCrearHeaders(e) {
  var authResp = chequearAutorizacionAction_();
  if (authResp) return authResp;

  try {
    var sheetId = obtenerSheetId();
    var tabName = obtenerSheetTab();
    if (!sheetId || !tabName) {
      return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText('Falta configurar Sheet o pestaña primero.'))
        .build();
    }
    var pestana = SpreadsheetApp.openById(sheetId).getSheetByName(tabName);
    if (!pestana) {
      return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText('La pestaña "' + tabName + '" ya no existe.'))
        .build();
    }
    crearHeadersEnSheetVacio_(pestana);
    // Después de crear headers, decidimos a dónde ir según qué falte:
    //   - si aún falta carpeta raíz → paso 3
    //   - si ya está todo configurado → card de éxito
    var estadoPostCreacion = estadoConfig();
    var siguienteCard;
    var mensaje;
    if (estadoPostCreacion.paso === 'sin_carpeta' || estadoPostCreacion.paso === 'carpeta_inaccesible') {
      siguienteCard = buildSeleccionCarpetaRaizCard(null);
      mensaje = 'Cabeceras creadas. Ahora elegí la carpeta raíz.';
    } else {
      // Wizard completo: caemos directo al menú principal para que el
      // usuario tenga a mano todas las opciones sin pasos intermedios.
      siguienteCard = buildHomepageCard(null, null, leerFormularioActivo_());
      mensaje = 'Cabeceras creadas. Configuración completa.';
    }
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(mensaje))
      .setNavigation(
        CardService.newNavigation().updateCard(siguienteCard)
      )
      .build();
  } catch (err) {
    console.error('[Config] onCrearHeaders: ' + err.message);
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('No se pudieron crear las cabeceras: ' + err.message))
      .build();
  }
}

/**
 * Handler del botón "Continuar sin crear". Simplemente avanza al paso 3
 * dejando la pestaña vacía — el usuario asume que va a armar los headers
 * después. onEnviar va a funcionar igual, escribiendo en la fila 1.
 */
function onSaltearCrearHeaders(e) {
  // Como en onCrearHeaders: si ya está todo configurado, cerramos el
  // wizard con la card de éxito. Si falta la carpeta, seguimos al paso 3.
  var estadoPostSaltear = estadoConfig();
  var siguienteCard;
  var mensaje = null;
  if (estadoPostSaltear.paso === 'sin_carpeta' || estadoPostSaltear.paso === 'carpeta_inaccesible') {
    siguienteCard = buildSeleccionCarpetaRaizCard(null);
  } else {
    siguienteCard = buildHomepageCard(null, null, leerFormularioActivo_());
    mensaje = 'Configuración completa.';
  }
  var responseBuilder = CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().updateCard(siguienteCard)
    );
  if (mensaje) {
    responseBuilder.setNotification(
      CardService.newNotification().setText(mensaje)
    );
  }
  return responseBuilder.build();
}

function onGuardarCarpetaRaiz(e) {
  var authResp = chequearAutorizacionAction_();
  if (authResp) return authResp;

  var formInputs = e.commonEventObject.formInputs || {};
  var carpetaUrl = leerInput(formInputs, 'carpetaRaizUrl');

  if (!carpetaUrl) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Debes pegar la URL de la carpeta.')
      )
      .build();
  }

  var parsed = parsearIdDrive(carpetaUrl);
  if (!parsed || (parsed.tipo !== 'carpeta' && parsed.tipo !== 'desconocido')) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('La URL no parece ser de una carpeta de Drive. Debe contener /drive/folders/...')
      )
      .build();
  }

  try {
    // Probamos que exista y sea una carpeta (getFolderById lanza si el
    // ID es de un archivo). No validamos permiso de escritura acá:
    // Session.getActiveUser().getEmail() viene vacío en add-ons de
    // Gmail por privacidad, así que getAccess() daría NONE incluso en
    // carpetas propias. Si falta escritura, el envío va a fallar con
    // mensaje claro y el usuario reconfigura.
    var carpeta = DriveApp.getFolderById(parsed.id);
    var nombreCarpeta = carpeta.getName();

    guardarCarpetaRaizId(parsed.id);
    console.log('[Config] Carpeta raíz guardada: ' + parsed.id + ' (' + nombreCarpeta + ')');

    var responseBuilder = CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('Carpeta raíz configurada: ' + nombreCarpeta)
      );

    // Si el wizard se abrió desde un correo (trigger contextual con
    // config inválida), la pila del mensaje quedaría mostrando la card
    // "abre un correo" y el trigger onGmailMessageOpen no se vuelve a
    // disparar solo — el usuario tiene que cerrar y reabrir el correo
    // para ver la card de validación. Lo evitamos re-corriendo el
    // trigger nosotros y reemplazando toda la pila por su resultado.
    if (e.gmail && e.gmail.messageId) {
      try {
        var cards = onGmailMessageOpen(e);
        if (cards && cards.length) {
          return responseBuilder
            .setNavigation(
              CardService.newNavigation()
                .popToRoot()
                .updateCard(cards[0])
            )
            .setStateChanged(true)
            .build();
        }
      } catch (errCtx) {
        console.error('[Config] No se pudo reconstruir la card del correo tras guardar: ' + errCtx.message);
        // Cae al fallback de la card genérica.
      }
    }

    return responseBuilder
      .setNavigation(
        CardService.newNavigation()
          .popToRoot()
          .updateCard(buildHomepageCard(null, null, leerFormularioActivo_()))
      )
      .build();

  } catch (error) {
    console.error('[Config] No se pudo abrir la carpeta ' + parsed.id + ': ' + error.message);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText(mensajeErrorUsuario(error, 'carpeta'))
      )
      .build();
  }
}

// === HANDLERS DEL PANEL DE CONFIGURACIÓN ===

function onMostrarConfig(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .pushCard(buildPanelConfiguracionCard())
    )
    .build();
}

function onCambiarSoloSheet(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().pushCard(buildConfigCard(false))
    )
    .build();
}

function onCambiarSoloTab(e) {
  var sheetId = obtenerSheetId();
  if (!sheetId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Primero configurá un Sheet.')
      )
      .setNavigation(
        CardService.newNavigation().pushCard(buildConfigCard(false))
      )
      .build();
  }
  try {
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().pushCard(buildSeleccionTabCard(sheetId))
      )
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('El Sheet no es accesible: ' + err.message)
      )
      .setNavigation(
        CardService.newNavigation().pushCard(buildConfigCard(false))
      )
      .build();
  }
}

function onCambiarSoloCarpeta(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().pushCard(buildSeleccionCarpetaRaizCard(null))
    )
    .build();
}

// === HANDLERS DE AYUDA ===

function onMostrarAyuda(e) {
  return CardService.newUniversalActionResponseBuilder()
    .displayAddOnCards([buildAyudaCard()])
    .build();
}

function onAbrirAyuda(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .pushCard(buildAyudaCard())
    )
    .build();
}
