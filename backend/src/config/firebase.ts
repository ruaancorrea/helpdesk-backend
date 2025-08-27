import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

console.log('Tentando conectar ao projeto:', process.env.FIREBASE_PROJECT_ID);

// Caminho padrão onde a Render coloca os ficheiros secretos
const renderServiceAccountPath = '/etc/secrets/firebase-service-account.json';

// Caminho para desenvolvimento local (assumindo que o ficheiro está na raiz da pasta 'backend')
const localServiceAccountPath = path.resolve('./firebase-service-account.json');

let serviceAccount;

if (fs.existsSync(renderServiceAccountPath)) {
  console.log('A usar o ficheiro de credenciais da Render.');
  serviceAccount = JSON.parse(fs.readFileSync(renderServiceAccountPath, 'utf8'));
} else if (fs.existsSync(localServiceAccountPath)) {
  console.log('A usar o ficheiro de credenciais local.');
  serviceAccount = require(localServiceAccountPath);
} else {
  console.error('FICHEIRO DE CREDENCIAIS NÃO ENCONTRADO! A autenticação com o Firebase vai falhar.');
}

admin.initializeApp({
  credential: serviceAccount ? admin.credential.cert(serviceAccount) : undefined,
  projectId: process.env.FIREBASE_PROJECT_ID,
});

console.log('Firebase Admin SDK inicializado.');

const db = admin.firestore();

export { db };