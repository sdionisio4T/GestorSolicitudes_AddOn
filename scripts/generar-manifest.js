#!/usr/bin/env node
const fs = require('fs');

const TEMPLATE_PATH = 'src/appsscript.template.json';
const MANIFEST_PATH = 'src/appsscript.json';

function logoRemoto(remotePath) {
  if (!remotePath || !fs.existsSync(remotePath)) return null;
  try {
    const remote = JSON.parse(fs.readFileSync(remotePath, 'utf8'));
    const logo = remote.addOns && remote.addOns.common && remote.addOns.common.logoUrl;
    return typeof logo === 'string' && logo.startsWith('https://') ? logo : null;
  } catch (e) {
    return null;
  }
}

const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
const logo = logoRemoto(process.argv[2]);

if (logo && template.addOns && template.addOns.common) {
  template.addOns.common.logoUrl = logo;
  console.log('Se conserva el logo que ya tiene el proyecto en Apps Script.');
} else {
  console.log('Se usa el logo por defecto de la plantilla.');
}

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(template, null, 2) + '\n');
