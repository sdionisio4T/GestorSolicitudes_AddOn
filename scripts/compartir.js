#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLASPRC_PATH = path.join(os.homedir(), '.clasprc.json');
const CLASP_PATH = '.clasp.json';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const FOLDER_NAME = 'Gestor de Solicitudes';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const email = (process.argv[2] || process.env.TESTER_EMAIL || '').trim();
  if (!EMAIL_RE.test(email)) {
    throw new Error('Correo invalido. Uso: node scripts/compartir.js correo@dominio.com');
  }
  if (!fs.existsSync(CLASP_PATH)) {
    throw new Error('No existe .clasp.json con el scriptId del proyecto.');
  }
  const scriptId = JSON.parse(fs.readFileSync(CLASP_PATH, 'utf8')).scriptId;
  if (!scriptId) {
    throw new Error('.clasp.json no tiene scriptId.');
  }

  const token = await getAccessToken();
  const alcance = await compartir(token, scriptId, email);

  const editorUrl = `https://script.google.com/d/${scriptId}/edit`;
  reportar(email, editorUrl, alcance);
}

async function getAccessToken() {
  if (!fs.existsSync(CLASPRC_PATH)) {
    throw new Error('No existe ~/.clasprc.json. Corre clasp login o restaura el secret CLASPRC_JSON.');
  }
  const clasprc = JSON.parse(fs.readFileSync(CLASPRC_PATH, 'utf8'));
  const t = clasprc.token || (clasprc.tokens && clasprc.tokens.default);
  const cs = clasprc.oauth2ClientSettings || {};
  if (!t || !t.refresh_token || !cs.clientId || !cs.clientSecret) {
    throw new Error('No pude leer refresh_token o clientId/clientSecret de ~/.clasprc.json.');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cs.clientId,
      client_secret: cs.clientSecret,
      refresh_token: t.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(
      `El token de CLASPRC_JSON no sirve (${res.status}). Corre clasp login en local y actualiza el secret con el contenido nuevo.`
    );
  }
  return (await res.json()).access_token;
}

function crearPermiso(token, fileId, email) {
  const url = `${DRIVE_API}/files/${fileId}/permissions?sendNotificationEmail=true&supportsAllDrives=true`;
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email }),
  });
}

async function buscarCarpeta(token) {
  const q = `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function compartir(token, scriptId, email) {
  const directo = await crearPermiso(token, scriptId, email);
  if (directo.ok) return 'proyecto';

  const detalle = await directo.text();
  if (!detalle.includes('appNotAuthorizedToFile')) {
    throw new Error(`Google rechazo compartir con ese correo (${directo.status}): ${detalle}`);
  }

  const carpetaId = await buscarCarpeta(token);
  if (!carpetaId) {
    throw new Error(
      `El token no tiene permiso sobre el archivo del proyecto y no encontre la carpeta "${FOLDER_NAME}" creada por npm run setup. Vuelve a correr npm run setup o mueve el proyecto a esa carpeta.`
    );
  }
  const porCarpeta = await crearPermiso(token, carpetaId, email);
  if (!porCarpeta.ok) {
    throw new Error(`Google rechazo compartir la carpeta (${porCarpeta.status}): ${await porCarpeta.text()}`);
  }
  return 'carpeta';
}

function reportar(email, editorUrl, alcance) {
  const donde = alcance === 'carpeta'
    ? `la carpeta "${FOLDER_NAME}" (el proyecto hereda el acceso)`
    : 'el proyecto';
  const lines = [
    '## Proyecto compartido',
    '',
    `Se dio acceso de **Editor** a \`${email}\` sobre ${donde}.`,
    '',
    `**Link del proyecto:** ${editorUrl}`,
    '',
    '### Pasos para quien recibe el acceso',
    '',
    '1. Abrir el link del proyecto.',
    '2. Menu superior: **Implementar → Implementaciones de prueba → Instalar**.',
    '3. Si Google muestra "no ha verificado esta aplicacion": **Configuracion avanzada → Ir a Gestor de Solicitudes (no seguro)** y aprobar los permisos.',
    '4. Recargar Gmail. El add-on aparece en el panel lateral.',
  ];
  const text = lines.join('\n') + '\n';
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  }
  console.log(text);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
