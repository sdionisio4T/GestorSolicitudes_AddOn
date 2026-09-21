/**
 * Cards.gs — Builders puros de tarjetas de la UI y helpers de formulario.
 * Reciben datos y devuelven objetos Card. Los handlers de acción (onXxx)
 * viven en ConfigHandlers.gs.
 */

// === HELPERS GENERALES ===

/**
 * Escapa caracteres que podrían romper HTML inline (o abrir inyección
 * via un valor con comillas o etiquetas). Se usa antes de meter cualquier
 * texto — URLs incluidas — dentro de strings HTML que van a CardService
 * (TextParagraph.setText acepta un subconjunto de HTML).
 */
function escaparHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// === HELPERS DE FORMULARIO ===

/**
 * Devuelve el primer valor de un campo simple del formulario, o '' si no
 * fue enviado. Sirve para inputs de texto y selects de una sola opción.
 */
function leerInput(formInputs, fieldName) {
  if (formInputs[fieldName] && formInputs[fieldName].stringInputs) {
    return formInputs[fieldName].stringInputs.value[0] || '';
  }
  return '';
}

/**
 * Devuelve todos los valores marcados de un campo múltiple (checkboxes),
 * o un arreglo vacío si no hay ninguno marcado.
 */
function leerMultiInput(formInputs, fieldName) {
  if (formInputs[fieldName] && formInputs[fieldName].stringInputs) {
    return formInputs[fieldName].stringInputs.value || [];
  }
  return [];
}

// === TARJETA DE VALIDACIÓN ===

/**
 * Agrega un widget con un link clicable real (azul, subrayado) por cada
 * URL válida encontrada en valorCampo.
 */
function agregarEnlaces(seccion, valorCampo, etiquetaBase) {
  if (!valorCampo) {
    return;
  }

  var urls = valorCampo.split('\n')
    .map(function(u) { return u.trim(); })
    .filter(function(u) { return /^https?:\/\/\S+$/i.test(u); });

  if (urls.length === 0) {
    return;
  }

  var html = urls.map(function(url, i) {
    var etiqueta = urls.length > 1 ? (etiquetaBase + ' (' + (i + 1) + ')') : etiquetaBase;
    return '<a href="' + escaparHtml(url) + '">' + escaparHtml(etiqueta) + '</a>';
  }).join('<br>');

  seccion.addWidget(
    CardService.newTextParagraph().setText(html)
  );
}

function buildValidacionCard(datos, messageId, seleccion, envioEnCursoId, envioEsperandoAccesoId, ultimaFilaUrl, editablesCaso) {
  datos = datos || {};
  editablesCaso = editablesCaso || [];
  var esManual = !messageId;
  console.log('[Card] Construyendo validación, caso: ' + redactCaso_(datos.numeroCaso) + ' | messageId: ' + (messageId || '(manual)') + ' | envioEnCurso: ' + (envioEnCursoId || 'no') + ' | envioEsperandoAcceso: ' + (envioEsperandoAccesoId || 'no') + ' | editables: ' + editablesCaso.length);

  var esReenvio = !!seleccion;
  seleccion = seleccion || {};
  var ambienteSeleccionado = seleccion.ambiente || datos.ambienteExtraido || '';
  var componentesSeleccionados = seleccion.componentes || [];
  var estadoSeleccionado = seleccion.estado || CONFIG.ESTADO_DEFECTO;
  var observacionesActuales = seleccion.observaciones || '';
  // El correo solicitante puede venir de tres lados (en orden de prioridad):
  // 1) lo que el usuario ya escribió/corrigió en un envío anterior (seleccion)
  // 2) lo que el extractor sacó del body del correo
  // 3) vacío (modo manual o extracción fallida — el usuario lo escribe)
  var correoSolicitanteActual = seleccion.correoSolicitante || datos.correoSolicitante || '';

  var card = CardService.newCardBuilder();

  // ── Header prominente ──

  var subtituloHeader;
  if (esManual) {
    subtituloHeader = 'Formulario manual, llena los datos';
  } else {
    subtituloHeader = 'Solicitud detectada, revisa y envía';
  }
  card.setHeader(
    CardService.newCardHeader()
      .setTitle(esManual ? 'Registro manual' : ('Caso #' + (datos.numeroCaso || '???')))
      .setSubtitle(subtituloHeader)
      .setImageStyle(CardService.ImageStyle.SQUARE)
  );

  // ── Botón "Menú principal" + nota orientativa. Aclara al usuario los
  // dos flujos disponibles (nuevo envío vs. editar existente) para evitar
  // que genere una fila duplicada por error. Se pasa el messageId para
  // que desde el menú principal se pueda volver acá.
  if (!esManual) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText(
              '<b>Elige una acción</b><br>' +
              '• <b>Registrar un envío nuevo</b> para este caso: completa el formulario y presiona <b>ENVIAR AL SHEET</b>.<br>' +
              '• <b>Modificar un envío existente</b> (por ejemplo, cambiar el estado a <i>APROBADO</i>): ve al menú principal y entra a <b>Editor de solicitudes</b>.'
            )
        )
        .addWidget(
          CardService.newTextButton()
            .setText('🏠 Ir al menú principal')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onIrAlInicio')
                .setParameters({ messageId: messageId || '' })
            )
        )
    );
  }

  // ── Banner de resumen rápido ──
  // En modo manual (sin correo) no tiene sentido: no hay datos extraídos
  // todavía. Se omite para no mostrar "(no detectado)" al usuario.
  if (!esManual) {
    var seccionBanner = CardService.newCardSection();
    var resumenHtml = '<b>Servicio:</b> ' + (datos.servicioDesplegar || '(no detectado)');
    if (ambienteSeleccionado) {
      resumenHtml += '<br><b>Ambiente:</b> ' + ambienteSeleccionado;
    }
    seccionBanner.addWidget(
      CardService.newTextParagraph().setText(resumenHtml)
    );
    card.addSection(seccionBanner);
  }

  // ── Banner "envío en curso" (fase 3): solo si onGmailMessageOpen
  // detectó que hay un sobre pendiente para el mismo caso. Le da al
  // usuario una puerta al estado sin tener que recordar el envioId. ──
  if (envioEnCursoId) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('🔄 <b>Hay un envío en curso para este caso.</b> La copia sigue corriendo en segundo plano.')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Ver estado del envío')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onAbrirEstadoEnvio')
                .setParameters({ envioId: envioEnCursoId, messageId: messageId || '' })
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#f9ab00')
        )
    );
  } else if (envioEsperandoAccesoId) {
    // Banner "esperando acceso": un envío anterior para este
    // caso quedó con enlaces que fallaron por permiso. El usuario puede
    // reintentar la copia cuando le den acceso.
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('🔓 <b>Envío anterior de este caso esperando acceso.</b> Hay enlaces de Drive sin copiar por falta de permiso.')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Ver estado del envío')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onAbrirEstadoEnvio')
                .setParameters({ envioId: envioEsperandoAccesoId, messageId: messageId || '' })
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#0f9d58')
        )
    );
  }

  // Banner "hay envío existente editable" (PENDIENTE / NO APROBADO). Se
  // pinta cuando el caso del correo ya tiene solicitudes que podés editar,
  // para evitar que se cree una fila nueva sin darse cuenta. Si hay uno
  // solo, el botón lleva directo a la card de edición; si hay varios,
  // lleva a la lista para elegir.
  if (editablesCaso.length > 0) {
    var seccionEditables = CardService.newCardSection();
    if (editablesCaso.length === 1) {
      var e0 = editablesCaso[0];
      seccionEditables.addWidget(
        CardService.newTextParagraph()
          .setText('✏️ <b>Este caso ya tiene un envío editable</b> (' + e0.estado + '). Puedes modificarlo en vez de crear uno nuevo.')
      );
      seccionEditables.addWidget(
        CardService.newTextButton()
          .setText('Editar solicitud existente')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onAbrirEditar')
              .setParameters({ envioId: e0.envioId, messageId: messageId || '' })
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor('#f9ab00')
      );
    } else {
      seccionEditables.addWidget(
        CardService.newTextParagraph()
          .setText('✏️ <b>Este caso ya tiene ' + editablesCaso.length + ' envíos editables.</b> Puedes modificar alguno en vez de crear uno nuevo.')
      );
      seccionEditables.addWidget(
        CardService.newTextButton()
          .setText('Ver solicitudes existentes')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onListarEditables')
              .setParameters({ messageId: messageId || '' })
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor('#f9ab00')
      );
    }
    card.addSection(seccionEditables);
  }

  // Sección con el botón para saltar a la fila recién escrita en el
  // Sheet. Se pinta arriba de "Datos extraídos" para que sea de las
  // primeras cosas visibles cuando el usuario vuelve al formulario
  // tras un envío exitoso. Solo aparece cuando onEnviar pasó una URL.
  if (ultimaFilaUrl) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('✅ <b>Envío guardado.</b>')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('📊 Ver última fila enviada en el Sheet')
            .setOpenLink(CardService.newOpenLink().setUrl(ultimaFilaUrl))
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#0f9d58')
        )
    );
  }

  // ── Sección: Datos del correo ──

  var seccionDatos = CardService.newCardSection()
    .setHeader(esManual ? 'Datos del caso' : 'Datos extraídos');

  seccionDatos.addWidget(
    CardService.newTextInput()
      .setFieldName('numeroCaso')
      .setTitle('Número de caso *')
      .setValue(datos.numeroCaso || '')
  );

  seccionDatos.addWidget(
    CardService.newTextInput()
      .setFieldName('servicioDesplegar')
      .setTitle('Servicio a desplegar *')
      .setValue(datos.servicioDesplegar || '')
  );

  seccionDatos.addWidget(
    CardService.newTextInput()
      .setFieldName('correoSolicitante')
      .setTitle('Correo solicitante')
      .setValue(correoSolicitanteActual)
      .setHint('Opcional. Email de quien pidió el despliegue (viene dentro del correo)')
  );

  card.addSection(seccionDatos);

  // ── Sección: Enlaces y URLs ──

  var seccionUrls = CardService.newCardSection()
    .setHeader('Documentación y enlaces');

  var urlsDrive = (datos.driveDocumentacion || '').split('\n')
    .map(function(u) { return u.trim(); })
    .filter(function(u) { return u !== ''; });

  // Rama unificada: si hay 1 o más Drive detectados, cada uno aparece como
  // checkbox (marcado por defecto) + un campo separado "Agregar otro enlace"
  // para reemplazar o sumar. Antes, con 1 solo Drive detectado, aparecía un
  // único TextInput multilinea prellenado — ambiguo: si el usuario pegaba
  // otra URL sin borrar la vieja, se enviaban las dos por accidente.
  // Con esta unificación los 3 casos quedan explícitos:
  //   - sin tocar nada → envía el/los detectado(s)
  //   - desmarcar checkbox(es) + pegar en Extra → envía solo lo nuevo
  //   - dejar marcado + pegar en Extra → envía ambos
  if (urlsDrive.length >= 1) {
    var checksDrive = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.CHECK_BOX)
      .setTitle(urlsDrive.length === 1
        ? 'Drive documentación (desmarca para reemplazar)'
        : 'Drive documentación (selecciona los que aplican)')
      .setFieldName('driveDocumentacion');
    var drivesSeleccionados = seleccion.driveDocumentacion || urlsDrive;
    urlsDrive.forEach(function(url, i) {
      var etiqueta = urlsDrive.length === 1
        ? 'Drive: ...' + url.slice(-40)
        : 'Drive (' + (i + 1) + '): ...' + url.slice(-40);
      checksDrive.addItem(etiqueta, url, drivesSeleccionados.indexOf(url) !== -1);
    });
    seccionUrls.addWidget(checksDrive);
    agregarEnlaces(seccionUrls, datos.driveDocumentacion, 'Abrir Drive');
    // Campo opcional para reemplazar o agregar otros enlaces de Drive.
    // SheetWriter.onEnviar combina lo marcado en los checkboxes + lo que
    // esté en Extra (dedup por URL exacta).
    seccionUrls.addWidget(
      CardService.newTextInput()
        .setFieldName('driveDocumentacionExtra')
        .setTitle('Agregar otro enlace de Drive (opcional, uno por línea)')
        .setMultiline(true)
    );
  } else {
    // Sin Drive detectado: solo el campo Extra. Se usa el mismo fieldName
    // así el flujo de combinación en onEnviar sigue funcionando idéntico.
    seccionUrls.addWidget(
      CardService.newTextInput()
        .setFieldName('driveDocumentacionExtra')
        .setTitle('Drive documentación (opcional, uno por línea)')
        .setMultiline(true)
    );
  }

  agregarEnlaces(seccionUrls, datos.repositorio, 'Abrir repositorio');

  seccionUrls.addWidget(
    CardService.newTextInput()
      .setFieldName('repositorio')
      .setTitle('Repositorio')
      .setValue(datos.repositorio || '')
  );

  // Sonar — URL opcional, se guarda como hipervínculo en el Sheet.
  var sonarActual = seleccion.sonar || '';
  agregarEnlaces(seccionUrls, sonarActual, 'Abrir Sonar');
  seccionUrls.addWidget(
    CardService.newTextInput()
      .setFieldName('sonar')
      .setTitle('Sonar (URL)')
      .setValue(sonarActual)
      .setHint('Opcional')
  );

  card.addSection(seccionUrls);

  // ── Sección: Selección manual (Ambiente + Componente) ──

  var seccionManual = CardService.newCardSection()
    .setHeader('Configuración de despliegue');

  var dropdownAmbiente = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Ambiente')
    .setFieldName('ambiente');

  CONFIG.AMBIENTES.forEach(function(amb) {
    dropdownAmbiente.addItem(amb, amb, amb === ambienteSeleccionado);
  });

  seccionManual.addWidget(dropdownAmbiente);

  var checkComponente = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.CHECK_BOX)
    .setTitle('Componente (puede elegir varios)')
    .setFieldName('componente');

  CONFIG.COMPONENTES.forEach(function(comp) {
    checkComponente.addItem(comp, comp, componentesSeleccionados.indexOf(comp) !== -1);
  });

  seccionManual.addWidget(checkComponente);

  // Artefactos — texto libre (nombre/versión, notas de despliegue, etc.)
  seccionManual.addWidget(
    CardService.newTextInput()
      .setFieldName('artefactos')
      .setTitle('Artefactos')
      .setValue(seleccion.artefactos || '')
      .setMultiline(true)
      .setHint('Opcional')
  );

  card.addSection(seccionManual);

  // ── Sección: Estado y Observaciones ──

  var seccionEstado = CardService.newCardSection()
    .setHeader('Validación');

  var dropdownEstado = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Estado *')
    .setFieldName('estado');

  CONFIG.ESTADOS.forEach(function(est) {
    dropdownEstado.addItem(est, est, est === estadoSeleccionado);
  });

  seccionEstado.addWidget(dropdownEstado);

  seccionEstado.addWidget(
    CardService.newTextInput()
      .setFieldName('observaciones')
      .setTitle('Observaciones (opcional)')
      .setValue(observacionesActuales)
      .setMultiline(true)
  );

  card.addSection(seccionEstado);

  // ── Botón ENVIAR ──

  var seccionBotones = CardService.newCardSection();

  var accionEnviar = CardService.newAction()
    .setFunctionName('onEnviar')
    .setParameters({ messageId: messageId || '' });

  seccionBotones.addWidget(
    CardService.newButtonSet()
      .addButton(
        CardService.newTextButton()
          .setText('ENVIAR AL SHEET')
          .setOnClickAction(accionEnviar)
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor('#1a73e8')
      )
  );

  if (esManual && !esReenvio) {
    seccionBotones.addWidget(
      CardService.newTextParagraph()
        .setText('<i>Modo manual: no hay correo asociado. Llena los datos y presiona ENVIAR.</i>')
    );
  } else if (!esReenvio) {
    seccionBotones.addWidget(
      CardService.newTextParagraph()
        .setText('<i>Otro ambiente o componente? Cambia el campo y presiona ENVIAR de nuevo.</i>')
    );
  } else {
    seccionBotones.addWidget(
      CardService.newTextParagraph()
        .setText('<i>Envío anterior registrado. Puedes ajustar y enviar de nuevo.</i>')
    );
  }

  card.addSection(seccionBotones);

  // ── Pie: Config y Ayuda ──

  var seccionConfig = CardService.newCardSection();
  seccionConfig.addWidget(
    CardService.newButtonSet()
      .addButton(
        CardService.newTextButton()
          .setText('📋 Envíos en curso')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onListarEnviosEnCurso')
              .setParameters({ messageId: messageId || '' })
          )
      )
      .addButton(
        CardService.newTextButton()
          .setText('Configuración')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onMostrarConfig')
          )
      )
      .addButton(
        CardService.newTextButton()
          .setText('Ayuda')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onAbrirAyuda')
          )
      )
  );
  card.addSection(seccionConfig);

  return card.build();
}

// === TARJETA DE CORREO SIN SOLICITUD ===

function buildNoAplicaCard() {
  console.log('[Card] Correo sin solicitud — mostrando tarjeta mínima');

  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Gestor de Solicitudes')
        .setSubtitle('Sin acción requerida')
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('Este correo no contiene una solicitud de caso. Si aun así quieres registrar un caso, puedes llenar el formulario a mano con el botón de abajo.')
        )
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
    .build();
}

// === TARJETA DE ERROR ===

function buildErrorCard(mensaje) {
  console.error('[Card] Error: ' + mensaje);

  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Error')
        .setSubtitle('Algo salió mal')
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText(mensaje)
        )
    )
    .build();
}

// === TARJETAS DE CONFIGURACIÓN ===

function buildConfigCard(mostrarBorrar, mensajeError) {
  console.log('[Config] Mostrando config — mostrarBorrar: ' + !!mostrarBorrar + ' | mensajeError: ' + (mensajeError || 'ninguno'));

  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Configuración inicial')
        .setSubtitle('Configura el Sheet de destino')
    );

  if (mensajeError) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('<b>⚠ ' + mensajeError + '</b>')
        )
    );
  }

  // Aviso cuando el usuario viene desde "Cambiar Sheet" y tiene envíos
  // que apuntan al Sheet actual — los reintentos y sobres terminados
  // siguen escribiendo en el Sheet original, no en el nuevo.
  if (mostrarBorrar) {
    try {
      var conteo = contarSobresPropios_();
      if (conteo.total > 0) {
        var detalle;
        if (conteo.pendientes > 0 && conteo.terminados > 0) {
          detalle = conteo.pendientes + ' en curso y ' + conteo.terminados + ' esperando acceso';
        } else if (conteo.pendientes > 0) {
          detalle = conteo.pendientes + ' en curso';
        } else {
          detalle = conteo.terminados + ' esperando acceso';
        }
        card.addSection(
          CardService.newCardSection()
            .addWidget(
              CardService.newTextParagraph()
                .setText(
                  '<b>⚠ Hay ' + conteo.total + ' envío(s) apuntando al Sheet actual</b> (' + detalle + ').\n\n' +
                  'Si cambias la configuración ahora, esos envíos van a seguir escribiendo en el <b>Sheet actual</b> (no en el nuevo). Ningún reintento se pierde ni se cancela.'
                )
            )
        );
      }
    } catch (errAviso) {
      // No crítico — si algo falla, simplemente no pintamos el aviso.
      console.log('[Config] No se pudo calcular aviso de sobres: ' + errAviso.message);
    }
  }

  card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('Pega la URL del Google Sheet donde se registrarán las solicitudes.')
        )
        .addWidget(
          CardService.newTextInput()
            .setFieldName('sheetUrl')
            .setTitle('URL del Google Sheet')
            .setHint('Pega aquí la URL completa')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('GUARDAR')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onGuardarConfig')
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor('#1a73e8')
        )
    );

  if (mostrarBorrar) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextButton()
            .setText('Borrar Sheet guardado')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onConfirmarBorrado')
            )
        )
    );
  }

  return card.build();
}

function buildConfirmarBorradoCard() {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Borrar el Sheet configurado?')
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('El add-on va a dejar de saber a qué Sheet apuntar. Vas a tener que pegar una URL de nuevo antes de poder registrar solicitudes.')
        )
        .addWidget(
          CardService.newButtonSet()
            .addButton(
              CardService.newTextButton()
                .setText('Sí, borrar')
                .setOnClickAction(
                  CardService.newAction()
                    .setFunctionName('onBorrarConfig')
                )
                .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
                .setBackgroundColor('#ea4335')
            )
            .addButton(
              CardService.newTextButton()
                .setText('Cancelar')
                .setOnClickAction(
                  CardService.newAction()
                    .setFunctionName('onCancelarBorrado')
                )
            )
        )
    )
    .build();
}

function buildSeleccionTabCard(sheetId) {
  var spreadsheet = SpreadsheetApp.openById(sheetId);
  var hojas = spreadsheet.getSheets();

  var section = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph()
        .setText('Selecciona la pestaña donde se registrarán los casos:')
    );

  var dropdown = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setFieldName('tabSeleccionada')
    .setTitle('Pestaña');

  for (var i = 0; i < hojas.length; i++) {
    var nombre = hojas[i].getName();
    dropdown.addItem(nombre, nombre, i === 0);
  }

  section.addWidget(dropdown);
  section.addWidget(
    CardService.newTextButton()
      .setText('Confirmar')
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onGuardarTab')
      )
  );

  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Configuración')
        .setSubtitle('Paso 2: Elegir pestaña')
    )
    .addSection(section)
    .build();
}

/**
 * Devuelve la card de config más apropiada según qué pieza esté rota o
 * faltando: si falta el Sheet, muestra el paso 1; si falta la pestaña,
 * el paso 2; si falta la carpeta raíz, el paso 3. Evita hacer al usuario
 * repetir pasos que ya completó (especialmente relevante en la
 * migración: los usuarios que ya tenían Sheet + pestaña configurados
 * caen directo en el paso 3 tras el cambio de scope, sin re-pegar la
 * URL del Sheet).
 */
function buildCardConfigApropiada(mensajeError) {
  var estado = estadoConfig();

  // Sheet inaccesible o inexistente → paso 1 (pedir URL de nuevo).
  if (estado.paso === 'sin_sheet' || estado.paso === 'sheet_inaccesible') {
    return buildConfigCard(false, mensajeError);
  }

  // Sheet OK pero falta pestaña (o la que había ya no existe) → paso 2.
  if (estado.paso === 'sin_tab' || estado.paso === 'tab_no_existe') {
    try {
      return buildSeleccionTabCard(obtenerSheetId());
    } catch (e) {
      // Si el Sheet dejó de ser accesible entre estadoConfig() y
      // buildSeleccionTabCard, caemos al paso 1.
      return buildConfigCard(false, mensajeError);
    }
  }

  // Sheet + pestaña OK pero la pestaña está vacía — ofrecemos crear las
  // cabeceras automáticamente. El usuario también puede saltearlo y
  // configurar la carpeta directamente si prefiere hacerlas a mano.
  if (estado.paso === 'sheet_vacio') {
    return buildCrearHeadersCard(mensajeError);
  }

  // Sheet + pestaña OK, solo falta la carpeta o dejó de ser accesible → paso 3.
  return buildSeleccionCarpetaRaizCard(mensajeError);
}

/**
 * Card intermedia entre "elegir pestaña" y "elegir carpeta raíz" para el
 * caso de una pestaña vacía. Ofrece crear las 13 cabeceras automáticamente
 * (botón verde) o saltear (botón secundario). Al saltear, se avanza al
 * paso 3 igual — el usuario puede armar los headers a mano cuando quiera.
 */
function buildCrearHeadersCard(mensajeError) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Configuración')
        .setSubtitle('Pestaña vacía — crear cabeceras')
    );

  if (mensajeError) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('<b>⚠ ' + mensajeError + '</b>')
        )
    );
  }

  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newTextParagraph()
          .setText(
            'La pestaña seleccionada está vacía. Puedo crear las <b>13 cabeceras</b> ' +
            'automáticamente en la fila 1 (formato bold y fila congelada). ' +
            'Después solo falta elegir la carpeta raíz de Drive.\n\n' +
            'Si preferís armar los headers a mano después, presioná <b>Continuar sin crear</b>.'
          )
      )
      .addWidget(
        CardService.newTextButton()
          .setText('✅ Crear cabeceras automáticamente')
          .setOnClickAction(
            CardService.newAction().setFunctionName('onCrearHeaders')
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor('#0f9d58')
      )
      .addWidget(
        CardService.newTextButton()
          .setText('Continuar sin crear')
          .setOnClickAction(
            CardService.newAction().setFunctionName('onSaltearCrearHeaders')
          )
      )
  );

  return card.build();
}

function buildSeleccionCarpetaRaizCard(mensajeError) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Configuración')
        .setSubtitle('Paso 3: Carpeta raíz de Drive')
    );

  if (mensajeError) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('<b>⚠ ' + mensajeError + '</b>')
        )
    );
  }

  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newTextParagraph()
          .setText('Elige la carpeta de Drive donde se van a copiar los archivos de documentación de cada envío. Dentro se creará una estructura <b>Servicio/Caso</b> automáticamente.\n\nPega la URL de la carpeta (algo como <i>https://drive.google.com/drive/folders/...</i>).')
      )
      .addWidget(
        CardService.newTextInput()
          .setFieldName('carpetaRaizUrl')
          .setTitle('URL de la carpeta raíz')
          .setHint('Pega la URL de la carpeta')
      )
      .addWidget(
        CardService.newTextButton()
          .setText('GUARDAR')
          .setOnClickAction(
            CardService.newAction().setFunctionName('onGuardarCarpetaRaiz')
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor('#1a73e8')
      )
  );

  return card.build();
}

/**
 * Panel de configuración: muestra los 3 aspectos (Sheet, pestaña, carpeta
 * raíz) con su valor actual y un botón individual para cambiar cada uno.
 * Antes, "Cambiar Sheet" arrancaba siempre en el paso 1 del wizard, así
 * que para cambiar solo la carpeta había que rehacer todo. Ahora podés
 * cambiar solo lo que necesitás.
 */
function buildPanelConfiguracionCard() {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Configuración')
        .setSubtitle('Cambiá cualquiera de los 3 aspectos')
    );

  // Aviso si hay envíos en curso apuntando al Sheet actual.
  try {
    var conteo = contarSobresPropios_();
    if (conteo.total > 0) {
      var detalle;
      if (conteo.pendientes > 0 && conteo.terminados > 0) {
        detalle = conteo.pendientes + ' en curso y ' + conteo.terminados + ' esperando acceso';
      } else if (conteo.pendientes > 0) {
        detalle = conteo.pendientes + ' en curso';
      } else {
        detalle = conteo.terminados + ' esperando acceso';
      }
      card.addSection(
        CardService.newCardSection()
          .addWidget(
            CardService.newTextParagraph()
              .setText(
                '<b>⚠ Hay ' + conteo.total + ' envío(s) apuntando al Sheet/carpeta actual</b> (' + detalle + ').\n\n' +
                'Si cambias la configuración ahora, esos envíos siguen usando los valores <b>actuales</b> (no los nuevos). Ningún reintento se pierde.'
              )
          )
      );
    }
  } catch (errAviso) {
    console.log('[Config] No se pudo calcular aviso de sobres: ' + errAviso.message);
  }

  // Bloque 1: Sheet
  var sheetSection = CardService.newCardSection().setHeader('📊 Sheet');
  var nombreSheet = '(no configurado)';
  try {
    var sheetId = obtenerSheetId();
    if (sheetId) nombreSheet = SpreadsheetApp.openById(sheetId).getName();
  } catch (errSheet) {
    nombreSheet = '(no accesible)';
  }
  sheetSection.addWidget(
    CardService.newKeyValue()
      .setTopLabel('Actual')
      .setContent(escaparHtml(nombreSheet))
      .setMultiline(true)
  );
  sheetSection.addWidget(
    CardService.newTextButton()
      .setText('Cambiar Sheet')
      .setOnClickAction(
        CardService.newAction().setFunctionName('onCambiarSoloSheet')
      )
  );
  card.addSection(sheetSection);

  // Bloque 2: Pestaña
  var tabSection = CardService.newCardSection().setHeader('📑 Pestaña');
  var nombreTab = obtenerSheetTab() || '(no seleccionada)';
  tabSection.addWidget(
    CardService.newKeyValue()
      .setTopLabel('Actual')
      .setContent(escaparHtml(nombreTab))
  );
  tabSection.addWidget(
    CardService.newTextButton()
      .setText('Cambiar pestaña')
      .setOnClickAction(
        CardService.newAction().setFunctionName('onCambiarSoloTab')
      )
  );
  card.addSection(tabSection);

  // Bloque 3: Carpeta raíz de Drive
  var carpSection = CardService.newCardSection().setHeader('📁 Carpeta raíz de Drive');
  var nombreCarp = '(no configurada)';
  try {
    var carpId = obtenerCarpetaRaizId();
    if (carpId) nombreCarp = DriveApp.getFolderById(carpId).getName();
  } catch (errCarp) {
    nombreCarp = '(no accesible)';
  }
  carpSection.addWidget(
    CardService.newKeyValue()
      .setTopLabel('Actual')
      .setContent(escaparHtml(nombreCarp))
      .setMultiline(true)
  );
  carpSection.addWidget(
    CardService.newTextButton()
      .setText('Cambiar carpeta')
      .setOnClickAction(
        CardService.newAction().setFunctionName('onCambiarSoloCarpeta')
      )
  );
  card.addSection(carpSection);

  // Botón destructivo (borrar toda la config y arrancar de cero).
  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newTextParagraph()
          .setText('<i>Si quieres arrancar la configuración desde cero (borra Sheet, pestaña y carpeta) usa el botón de abajo.</i>')
      )
      .addWidget(
        CardService.newTextButton()
          .setText('🗑 Borrar toda la configuración')
          .setOnClickAction(
            CardService.newAction().setFunctionName('onConfirmarBorrado')
          )
      )
  );

  return card.build();
}

function extraerSheetIdDeUrl(url) {
  var match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return match[1];
  }
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) {
    return url.trim();
  }
  return null;
}
