#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLASPRC_PATH = path.join(os.homedir(), '.clasprc.json');
const CLASP_PATH = '.clasp.json';
const TEMPLATE_PATH = 'src/appsscript.template.json';
const MANIFEST_PATH = 'src/appsscript.json';
const LOGO_LOCAL_PATH = 'assets/icon_96x96.png';
const FOLDER_NAME = 'Gestor de Solicitudes';
const LOGO_NAME = 'icon_96x96.png';
const PROJECT_TITLE = 'Gestor de Solicitudes';
const FALLBACK_LOGO_URL = 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_48dp.png';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function main() {
  ensureLogin();
  const token = await getAccessToken();
  const folderId = await ensureFolder(token);
  console.log(`Carpeta lista en Drive: ${folderId}`);

  let logoUrl;
  try {
    logoUrl = await ensureLogo(token, folderId);
    console.log(`Logo publico: ${logoUrl}`);
  } catch (e) {
    console.warn(`Fallo la subida del logo: ${e.message}`);
    console.warn(`Usando logo por defecto: ${FALLBACK_LOGO_URL}`);
    logoUrl = FALLBACK_LOGO_URL;
  }

  renderManifest(logoUrl);
  console.log('src/appsscript.json generado desde la plantilla.');

  ensureProject(folderId);
  finalizeClaspJson();
  console.log('.clasp.json actualizado.');

  execSync('clasp push --force', { stdio: 'inherit' });

  const scriptId = JSON.parse(fs.readFileSync(CLASP_PATH, 'utf8')).scriptId;
  const editorUrl = `https://script.google.com/d/${scriptId}/edit`;

  console.log('');
  console.log('========================================================');
  console.log('Setup completo.');
  console.log('');
  console.log('PROXIMO PASO (manual, una sola vez):');
  console.log('');
  console.log(`  1. Abri: ${editorUrl}`);
  console.log('  2. En la barra superior: Deploy > Test deployments');
  console.log('  3. Boton "Install", luego "Done".');
  console.log('  4. Refresca Gmail. El add-on aparece en el panel derecho.');
  console.log('========================================================');
}

function ensureLogin() {
  if (fs.existsSync(CLASPRC_PATH)) return;
  console.log('No hay credenciales, corriendo clasp login...');
  execSync('clasp login', { stdio: 'inherit' });
}

async function getAccessToken() {
  const clasprc = JSON.parse(fs.readFileSync(CLASPRC_PATH, 'utf8'));
  const t = clasprc.token || (clasprc.tokens && clasprc.tokens.default);
  const cs = clasprc.oauth2ClientSettings || {};
  if (!t || !t.refresh_token || !cs.clientId || !cs.clientSecret) {
    throw new Error('No pude leer refresh_token o clientId/clientSecret de ~/.clasprc.json.');
  }
  const body = new URLSearchParams({
    client_id: cs.clientId,
    client_secret: cs.clientSecret,
    refresh_token: t.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Refresh token fallo: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function ensureFolder(token) {
  const q = `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const listRes = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const list = await listRes.json();
  if (list.files && list.files.length > 0) return list.files[0].id;

  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Crear carpeta fallo: ${createRes.status} ${await createRes.text()}`);
  }
  const created = await createRes.json();
  return created.id;
}

async function ensureLogo(token, folderId) {
  let fileId;
  const q = `name = '${LOGO_NAME}' and '${folderId}' in parents and trashed = false`;
  const listRes = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const list = await listRes.json();
  if (list.files && list.files.length > 0) {
    fileId = list.files[0].id;
    console.log('Logo ya existe en Drive, reusando.');
  } else {
    const imageBytes = fs.readFileSync(LOGO_LOCAL_PATH);
    const boundary = 'boundary' + Date.now();
    const metadata = JSON.stringify({ name: LOGO_NAME, parents: [folderId] });
    const preamble =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      metadata +
      `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: image/png\r\n\r\n`;
    const closing = `\r\n--${boundary}--`;
    const body = Buffer.concat([
      Buffer.from(preamble, 'utf8'),
      imageBytes,
      Buffer.from(closing, 'utf8'),
    ]);
    const uploadRes = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!uploadRes.ok) {
      throw new Error(`Subir logo fallo: ${uploadRes.status} ${await uploadRes.text()}`);
    }
    const uploaded = await uploadRes.json();
    fileId = uploaded.id;
    console.log('Logo subido a Drive.');
  }

  await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

function renderManifest(logoUrl) {
  const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  if (template.addOns && template.addOns.common) {
    template.addOns.common.logoUrl = logoUrl;
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(template, null, 2) + '\n');
}

function ensureProject(folderId) {
  if (fs.existsSync(CLASP_PATH)) {
    console.log('.clasp.json ya existe, salto clasp create.');
    return;
  }
  execSync(
    `clasp create --title "${PROJECT_TITLE}" --type standalone --parentId "${folderId}"`,
    { stdio: 'inherit' }
  );
  // clasp create baja el manifest default a la raiz aunque el rootDir
  // apunte a src/. Es un bug conocido de clasp. Lo borramos para no
  // dejarlo confundiendo el repo.
  limpiarManifestHuerfano();
}

function limpiarManifestHuerfano() {
  try {
    if (fs.existsSync('appsscript.json')) {
      fs.unlinkSync('appsscript.json');
    }
  } catch (e) {
    console.warn(`No se pudo borrar appsscript.json de la raiz: ${e.message}`);
  }
}

function finalizeClaspJson() {
  const clasp = JSON.parse(fs.readFileSync(CLASP_PATH, 'utf8'));
  const complete = {
    scriptId: clasp.scriptId,
    rootDir: 'src',
    scriptExtensions: ['.js', '.gs'],
    htmlExtensions: ['.html'],
    jsonExtensions: ['.json'],
    filePushOrder: [],
    skipSubdirectories: false,
  };
  fs.writeFileSync(CLASP_PATH, JSON.stringify(complete, null, 2) + '\n');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
