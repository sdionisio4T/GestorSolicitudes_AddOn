/**
 * Diagnostico.gs — Panel de diagnóstico y rescate para el add-on.
 *
 * Todas las funciones de limpieza (limpiarSobresPendientes,
 * limpiarSobresTerminados) ya existen en Reintentos.gs y se pueden
 * correr manualmente desde el editor de Apps Script. Este módulo las
 * expone también en la UI del add-on, para que un usuario final que no
 * tiene acceso al editor pueda hacer las mismas operaciones cuando algo
 * se le atasca — típicamente tras un cambio de scopes que dejó triggers
 * o propiedades viejas colgadas.
 *
 * Se accede desde la Homepage (botón "🔧 Diagnóstico" en la sección
 * "Otros").
 */

// ── Entrada: card de diagnóstico ──────────────────────────────────────

/**
 * Handler del botón "🔧 Diagnóstico" en la Homepage. Pushea la card de
 * diagnóstico sobre la pila actual.
 */
function onAbrirDiagnostico(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildDiagnosticoCard()))
    .build();
}

/**
 * Construye la card que muestra el estado actual del add-on para este
 * usuario y ofrece botones de limpieza. Se puede volver a construir
 * (updateCard) tras cada acción para reflejar el estado nuevo.
 */
function buildDiagnosticoCard() {
  var estado = contarEstadoDiagnostico_();

  var intro = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText(
        'Herramientas para resolver problemas del add-on. Úsalas solo si ' +
        'algo dejó de funcionar (por ejemplo: el add-on te pide permisos ' +
        'que ya diste, no procesa reintentos, o quedó pegado tras una ' +
        'actualización).'
      )
    );

  var estadoSection = CardService.newCardSection()
    .setHeader('Estado actual')
    .addWidget(
      CardService.newTextParagraph().setText(
        '<b>Envíos con reintento en curso:</b> ' + estado.sobresPendientes + '\n' +
        '<b>Envíos esperando acceso:</b> ' + estado.sobresTerminados + '\n' +
        '<b>Reintentos programados:</b> ' + estado.triggersReintento
      )
    );

  var acciones = CardService.newCardSection()
    .setHeader('Limpieza')
    .addWidget(
      CardService.newTextParagraph().setText(
        'Cada botón limpia una parte específica. Empieza por el más suave.'
      )
    )
    .addWidget(
      CardService.newTextButton()
        .setText('🧹 Limpiar reintentos en curso')
        .setOnClickAction(
          CardService.newAction().setFunctionName('onLimpiarSobresPendientesUI')
        )
    )
    .addWidget(
      CardService.newTextButton()
        .setText('🧹 Limpiar lista "Esperando acceso"')
        .setOnClickAction(
          CardService.newAction().setFunctionName('onLimpiarSobresTerminadosUI')
        )
    )
    .addWidget(
      CardService.newTextButton()
        .setText('⚠️ Reset total (borra todo)')
        .setOnClickAction(
          CardService.newAction().setFunctionName('onResetTotalConfirmar')
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor('#d93025')
    );

  var permisos = CardService.newCardSection()
    .setHeader('Permisos colgados')
    .addWidget(
      CardService.newTextParagraph().setText(
        'Si el add-on te sigue pidiendo permisos aunque ya los diste, o ' +
        'quedó atrapado en un loop de autorización, tienes que revocar el ' +
        'acceso desde tu cuenta de Google y volver a instalar el add-on:'
      )
    )
    .addWidget(
      CardService.newTextParagraph().setText(
        '<b>1.</b> Abre <b>myaccount.google.com/permissions</b>\n' +
        '<b>2.</b> Busca "Gestor de Solicitudes" y clic en <b>Quitar acceso</b>\n' +
        '<b>3.</b> En Gmail: Complementos → gestionar → desinstala el add-on\n' +
        '<b>4.</b> Vuelve a instalarlo con el mismo ID de implementación de prueba\n' +
        '<b>5.</b> Acepta los permisos nuevos'
      )
    )
    .addWidget(
      CardService.newTextButton()
        .setText('🌐 Abrir permisos de mi cuenta')
        .setOpenLink(
          CardService.newOpenLink()
            .setUrl('https://myaccount.google.com/permissions')
            .setOpenAs(CardService.OpenAs.FULL_SIZE)
        )
    );

  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('🔧 Diagnóstico')
        .setSubtitle('Gestor de Solicitudes')
    )
    .addSection(intro)
    .addSection(estadoSection)
    .addSection(acciones)
    .addSection(permisos)
    .build();
}

// ── Handlers de los botones ───────────────────────────────────────────

/**
 * Botón "Limpiar reintentos en curso". Llama a la función que ya existe
 * en Reintentos.gs y reconstruye la card para mostrar el estado nuevo.
 */
function onLimpiarSobresPendientesUI(e) {
  try {
    var res = limpiarSobresPendientes();
    var msg = 'Reintentos limpiados: ' + res.sobres + ' sobre(s) y ' +
              res.triggers + ' trigger(s) borrado(s).';
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(msg))
      .setNavigation(CardService.newNavigation().updateCard(buildDiagnosticoCard()))
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Error: ' + err.message))
      .build();
  }
}

/**
 * Botón "Limpiar lista Esperando acceso".
 */
function onLimpiarSobresTerminadosUI(e) {
  try {
    var res = limpiarSobresTerminados();
    var msg = 'Lista limpiada: ' + res.terminados + ' envío(s) borrado(s).';
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(msg))
      .setNavigation(CardService.newNavigation().updateCard(buildDiagnosticoCard()))
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Error: ' + err.message))
      .build();
  }
}

/**
 * Botón "Reset total". Primero pide confirmación con una card intermedia
 * — el reset borra TODO (propiedades del usuario + triggers de este
 * proyecto para este usuario), así que no queremos que se dispare por
 * un click accidental.
 */
function onResetTotalConfirmar(e) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('¿Reset total?')
        .setSubtitle('Esta acción no se puede deshacer')
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph().setText(
            'Vas a borrar <b>todo</b> lo que el add-on tiene guardado para ti:\n\n' +
            '• Configuración (ID del Sheet, preferencias)\n' +
            '• Envíos en reintento\n' +
            '• Lista de envíos esperando acceso\n' +
            '• Triggers de reintento programados\n\n' +
            'Los envíos ya registrados en el Sheet no se borran — solo se ' +
            'pierde el seguimiento en el add-on.\n\n' +
            'Úsalo solo si nada más funciona.'
          )
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Sí, borrar todo')
            .setOnClickAction(
              CardService.newAction().setFunctionName('onResetTotalEjecutar')
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#d93025')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Cancelar')
            .setOnClickAction(
              CardService.newAction().setFunctionName('onCancelarReset')
            )
        )
    )
    .build();

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card))
    .build();
}

/**
 * Cancela la confirmación de reset y vuelve a la card de diagnóstico.
 */
function onCancelarReset(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popCard())
    .build();
}

/**
 * Ejecuta el reset total tras la confirmación. Llama a resetTotalUsuario_
 * y muestra un resumen. Pop dos veces para volver a la Homepage limpia.
 */
function onResetTotalEjecutar(e) {
  try {
    var res = resetTotalUsuario_();
    var msg = 'Reset completado. Propiedades borradas: ' + res.propiedades +
              ' | Triggers borrados: ' + res.triggers;
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(msg))
      .setNavigation(
        CardService.newNavigation()
          .popCard()      // sale de la card de confirmación
          .popCard()      // sale de la card de diagnóstico
      )
      .setStateChanged(true)
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Error: ' + err.message))
      .build();
  }
}

// ── Lógica de reset ───────────────────────────────────────────────────

/**
 * Reset nuclear: borra TODAS las UserProperties de este usuario para
 * este script + todos los triggers de este proyecto para este usuario.
 *
 * Diferencia con limpiarSobresPendientes():
 *   - limpiarSobresPendientes borra solo sobres PENDIENTE_ y triggers
 *     de reintentarCopiaPendiente.
 *   - resetTotalUsuario_ borra TODO (config, sobres, triggers de
 *     cualquier handler).
 *
 * También se puede correr manualmente desde el editor: seleccionar
 * resetTotalUsuario_ → Ejecutar. (El sufijo _ no impide correrla desde
 * el editor, solo indica que es "interna" para el resto del código.)
 */
function resetTotalUsuario_() {
  var props = PropertiesService.getUserProperties();
  var todas = props.getProperties();
  var propiedades = Object.keys(todas).length;
  props.deleteAllProperties();

  var triggers = ScriptApp.getProjectTriggers();
  var triggersBorrados = 0;
  triggers.forEach(function(t) {
    try {
      ScriptApp.deleteTrigger(t);
      triggersBorrados++;
    } catch (err) {
      // no crítico: seguimos con los que sí se puedan borrar
    }
  });

  console.log('[Diagnostico] Reset total — propiedades: ' + propiedades +
              ' | triggers: ' + triggersBorrados);
  return { propiedades: propiedades, triggers: triggersBorrados };
}

// ── Utilidades ────────────────────────────────────────────────────────

/**
 * Cuenta el estado actual para mostrarlo en la card de diagnóstico.
 */
function contarEstadoDiagnostico_() {
  var props = PropertiesService.getUserProperties();
  var todas = props.getProperties();
  var pend = 0, term = 0;
  for (var k in todas) {
    if (!todas.hasOwnProperty(k)) continue;
    if (k.indexOf(REINTENTOS_CONFIG.PREFIJO_SOBRE) === 0) pend++;
    else if (k.indexOf(REINTENTOS_CONFIG.TERMINADO_PREFIJO) === 0) term++;
  }

  var triggersReintento = 0;
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'reintentarCopiaPendiente') {
        triggersReintento++;
      }
    }
  } catch (err) {
    // si falla getProjectTriggers, asumimos 0
  }

  return {
    sobresPendientes: pend,
    sobresTerminados: term,
    triggersReintento: triggersReintento
  };
}
