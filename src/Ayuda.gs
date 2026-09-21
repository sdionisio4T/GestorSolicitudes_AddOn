/**
 * Ayuda.gs: contenido de la card de ayuda del add-on (FAQ larga).
 * Vive aparte de Cards.gs porque su ciclo de vida es distinto: se toca
 * cuando cambia la documentación, no cuando cambia el flujo de la app.
 * Los handlers que la muestran (onMostrarAyuda / onAbrirAyuda) están en
 * ConfigHandlers.gs.
 */

function buildAyudaCard() {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Ayuda del Gestor de Solicitudes')
        .setSubtitle('Guía completa de uso')
    )

    // ═══ 1. CONCEPTOS BÁSICOS ═══
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué hace este add-on?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Automatiza el registro de solicitudes de despliegue en un Google Sheet centralizado y copia los archivos de documentación adjuntos al correo dentro de una carpeta de Drive organizada por servicio y caso. Diseñado para trabajar con casos de la mesa de arquitectura, pero puede adaptarse a otros flujos.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Cómo empiezo?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('La primera vez, el add-on te pedirá 3 datos:\n\n<b>1.</b> URL del Google Sheet donde se registran las solicitudes.\n<b>2.</b> Pestaña dentro de ese Sheet.\n<b>3.</b> Carpeta raíz de Drive donde se copiarán los archivos de documentación.\n\nSi necesitas cambiar cualquiera de los tres, ve al menú principal y usa <b>⚙ Configuración</b>. Desde ahí podés cambiar solo el aspecto que necesites, sin rehacer todo.')
        )
    )

    // ═══ 2. DETECCIÓN Y FLUJO ═══
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Cómo detecto el caso de un correo?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Al abrir un correo, el add-on muestra el <b>menú principal</b> con un botón azul arriba: <b>🔍 Detectar caso en este correo</b>. Presionalo cuando quieras leer el correo y armar el envío.\n\nLa detección ya no es automática al abrir el correo: así evitamos abrir el formulario de creación cuando el caso ya existía en el Sheet.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué pasa cuando el caso ya está en el Sheet?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Después de presionar <b>Detectar caso</b>, si el número de caso ya tiene envíos previos, aparece la card <b>"Caso ya registrado"</b> con un resumen de esos envíos y dos opciones:\n\n• <b>✏️ Editar existente</b>: si hay un solo envío previo con ID, va directo a la card de edición. Si hay varios, muestra la lista para elegir cuál.\n\n• <b>➕ Registrar otro envío nuevo</b>: abre el formulario de creación (para agregar otro ambiente o componente al mismo caso).\n\nSi el caso NO tiene envíos previos, se abre directamente el formulario de creación.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué son las "filas manuales"?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Son filas del Sheet cuyo número de caso coincide pero <b>no tienen ID de envío</b> (columna M vacía). Son filas escritas a mano directo en el Sheet, sin pasar por el add-on.\n\nSi la detección encuentra filas manuales para el caso, la card "Caso ya registrado" las lista con un aviso ⚠️ (estado, ambiente, componente y número de fila), pero <b>no ofrece el botón editar</b> para ellas: el add-on necesita el ID de envío como referencia para modificar sin duplicar. Si querés cambiar una fila manual, hacelo directamente en el Sheet.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('Si voy al inbox u otro correo, ¿pierdo el formulario?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('No. Al detectar un caso, el add-on guarda temporalmente el messageId y los datos extraídos. Si te movés al inbox o a otro correo, la homepage muestra arriba un botón <b>"🔙 Volver al formulario"</b> con el caso que estabas armando.\n\nAl volver a ese mismo correo, la card se restaura sola.\n\nEl formulario activo se limpia cuando: (a) presionás <b>ENVIAR AL SHEET</b>, (b) presionás <b>❌ Descartar</b> en la homepage, o (c) pasan 6 horas sin actividad.')
        )
    )

    // ═══ 3. NUEVO ENVÍO ═══
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué hace ENVIAR AL SHEET?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Guarda una fila nueva en el Sheet con los datos actuales del formulario: número de caso, servicio, ambiente, componente, estado, observaciones, correo solicitante y enlaces (Drive, Repositorio, Sonar). También inicia la copia de los archivos de Drive a la carpeta configurada.\n\nNo aprueba ni rechaza nada por sí solo: guarda exactamente lo que hayas seleccionado.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Cómo registro varios ambientes o componentes del mismo caso?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Después de ENVIAR, el formulario se vuelve a mostrar con los mismos datos. Cambiá el Ambiente o marcá otros Componentes y presioná ENVIAR de nuevo. No hace falta cerrar y volver a abrir el correo.\n\nSi marcás varios Componentes a la vez, se crea una fila por cada uno, todas con el mismo Ambiente, Estado y Observaciones.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Para qué sirven los campos Sonar y Artefactos?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Son campos opcionales que podés completar en el formulario:\n\n• <b>Sonar</b>: URL del análisis de Sonar del servicio. Debe empezar con <i>http://</i> o <i>https://</i>. Se guarda como hipervínculo clicable en el Sheet.\n\n• <b>Artefactos</b>: texto libre para registrar nombres de artefactos, versiones, notas del despliegue o cualquier información adicional. Acepta varias líneas.')
        )
    )

    // ═══ 4. EDITOR DE SOLICITUDES ═══
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Cómo modifico un envío ya guardado?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Dos caminos:\n\n<b>1.</b> Abrí el correo del caso, presioná <b>Detectar caso</b>, y si el caso ya existe elegí <b>✏️ Editar existente</b> en la card "Caso ya registrado".\n\n<b>2.</b> Ir al menú principal y entrar a <b>✏️ Editor de solicitudes</b>. Ahí aparecen todos los envíos de los últimos 30 días en estado <b>PENDIENTE</b>, <b>NO APROBADO</b> o <b>APROBADO</b>. Presioná <b>Editar</b> en el que quieras modificar.\n\nLa edición sobrescribe la fila existente en el Sheet, no crea una nueva. Podés cambiar servicio, ambiente, estado, observaciones, correo, repositorio, Sonar y artefactos. Los archivos de Drive ya copiados quedan intactos.\n\n<i>La cantidad de componentes queda fija: si un envío tiene 2 filas (una por cada componente), quedan 2 filas después de editar.</i>')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué envíos NO aparecen en el Editor de solicitudes?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('El editor solo muestra filas que cumplen tres condiciones:\n\n• Tienen <b>ID de envío</b> en la columna M (oculta): solo las filas creadas por el add-on.\n• Estado <b>PENDIENTE</b>, <b>NO APROBADO</b> o <b>APROBADO</b>.\n• Fecha del envío dentro de los últimos 30 días.\n\nLas filas escritas a mano sin ID de envío no aparecen acá (aunque sí las lista la card "Caso ya registrado" como aviso al detectar). Podés modificarlas directamente en el Sheet.')
        )
    )

    // ═══ 5. COPIA A DRIVE ═══
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué pasa con los enlaces de Drive del correo?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Si el correo trae varios enlaces de Drive, el formulario muestra checkboxes para elegir cuáles enviar. Si solo trae uno, aparece como campo editable. Los enlaces quedan como hipervínculos clicables en el Sheet.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Dónde quedan los archivos copiados en Drive?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Los archivos se copian dentro de la carpeta raíz que configuraste, siguiendo esta estructura:\n\n• <b>Componentes generales</b> (ESB, EI, DSS, etc.): <b>[raíz] / Servicio / Caso</b>\n• <b>Componentes API/APIM</b>: <b>[raíz] / APIM / Servicio / Caso</b>\n\nSi el envío mezcla componentes API/APIM con otros, se hacen <b>dos copias en paralelo</b>, una en cada ruta, y cada fila del Sheet apunta a su carpeta correspondiente.\n\nCuando la copia termina bien, la columna Drive del Sheet cambia a <b>"Ver carpeta copiada"</b>. Si algo falla, queda el enlace original del correo y la columna <b>Estado Copia</b> indica qué pasó.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué pasa si la copia inicial no alcanza a terminar?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('El add-on tiene 30 segundos para la primera pasada. Si son muchos archivos o carpetas grandes, lo que no alcance a copiar se pasa a un <b>proceso en segundo plano</b> que sigue reintentando en el servidor de Google (hasta 10 rondas de 5 minutos).\n\nPodés cerrar Gmail o apagar la computadora, el proceso continúa. Cuando vuelvas, presioná <b>Actualizar</b> en la card de estado o abrí el Sheet: la columna Estado Copia se actualiza sola.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué significan los mensajes de Estado Copia?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('• <b>Copiando...</b>: la primera pasada está en curso.\n• <b>Completado (N archivos)</b>: todos los archivos se copiaron y la columna Drive apunta a la carpeta.\n• <b>Parcial: X copiados. Motivos: ...</b>: algunos se copiaron, otros no.\n• <b>Reintentando (ronda X de 10)</b>: proceso en segundo plano trabajando.\n• <b>Sin copiar: ...</b>: no se pudo copiar nada. Si el motivo es "sin acceso", queda en "Esperando acceso" para reintentar manualmente.\n• <b>Sin archivos</b>: el envío no traía Drives para copiar.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué pasa si no tengo permiso a un enlace de Drive?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('El add-on no puede pedir acceso a Drive por vos: eso hay que hacerlo manualmente. El flujo es:\n\n<b>1.</b> La copia falla para ese enlace y aparece en <b>Envíos → Esperando acceso</b>. En el Sheet, el estado queda como <i>"PENDIENTE - Falta de permisos"</i> aunque hayas seleccionado APROBADO al enviar.\n\n<b>2.</b> Abrí el enlace, presioná <b>"Solicitar acceso"</b> o pedilo por chat/correo al dueño.\n\n<b>3.</b> Cuando te den acceso, volvé al add-on, entrá al envío y presioná <b>🔄 Reintentar copia</b>. En 1 a 15 segundos empieza a copiar los que faltaban.\n\nSi sabés que no vas a resolver el permiso, presioná <b>Descartar</b> para sacarlo de la lista. Los envíos sin reintentar se limpian solos a los 7 días.')
        )
    )

    // ═══ 6. NAVEGACIÓN ═══
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Cómo veo los envíos en curso o esperando acceso?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Varias formas:\n\n<b>1.</b> Menú principal → <b>📋 Envíos en curso</b>. La lista tiene dos secciones: <b>📋 En curso</b> (reintentando en segundo plano) y <b>🔓 Esperando acceso</b> (con enlaces sin copiar por falta de permiso).\n\n<b>2.</b> Al detectar un correo cuyo caso tiene un envío en marcha, aparece un banner arriba del formulario con acceso directo al estado (amarillo si está en curso, verde si está esperando acceso).\n\n<b>3.</b> El add-on también aparece en el panel lateral derecho de Google Sheets. Al abrirlo, ves directamente la lista de envíos sin tener que ir a Gmail.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Cómo vuelvo al menú principal sin cerrar el correo?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Presioná <b>🏠 Ir al menú principal</b> arriba de la validation card. Desde ahí accedés a Envíos en curso, Editor de solicitudes, Configuración y Ayuda.\n\nCuando quieras volver al caso detectado del correo, presioná <b>🔙 Volver al caso detectado</b> que aparece arriba del menú principal. Si mientras tanto vas al inbox u otro correo, el banner <b>"🔙 Volver al formulario"</b> te lleva de regreso al mismo estado.')
        )
    )

    // ═══ 7. NOTAS TÉCNICAS ═══
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué correo queda en el Sheet?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('En la columna <b>Correo solicitante</b> queda el email de la persona que pidió el despliegue, extraído del cuerpo del correo (frase <i>"del siguiente correo:"</i>). Si el detector no lo encontró, podés escribirlo a mano antes de enviar.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué pasa si presiono ENVIAR dos veces por error?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Si es exactamente la misma combinación de caso, servicio, ambiente, componente y estado, el segundo clic se ignora durante 15 segundos y no se duplica la fila. Si cambiaste algo, sí se registra como envío nuevo.\n\nAparte de este chequeo, si el caso ya existía en el Sheet cuando presionaste Detectar, la card "Caso ya registrado" te ofrece editar en vez de crear, reduciendo el riesgo de duplicados intencionales.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Qué correos detecta el add-on?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Detecta correos que contengan la frase <i>"El caso asignado con numero"</i> en el cuerpo, o que vengan de un remitente incluido en la lista de permitidos. Basta con que se cumpla una de las dos condiciones.\n\nSi el correo no cumple ninguna condición, al presionar Detectar caso aparece la card <b>"No aplica"</b>.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Hay restricciones en el número de caso?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('El número de caso debe contener solo dígitos y tener máximo 4 caracteres. Si el dato extraído del correo no cumple, podés corregirlo manualmente antes de enviar.')
        )
    )
    .addSection(
      CardService.newCardSection()
        .setHeader('¿Por qué me pidió permisos de Drive completos?')
        .addWidget(
          CardService.newTextParagraph()
            .setText('Para copiar archivos que están en el Drive de otras personas (los desarrolladores que mandan la solicitud), Google exige el permiso amplio de Drive. Sin ese permiso, el add-on solo podría acceder a archivos que ya abriste explícitamente.')
        )
    )
    .build();
}
