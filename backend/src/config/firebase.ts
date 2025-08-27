import * as admin from 'firebase-admin';

// O dotenv.config() foi movido para o index.ts para garantir que carregue primeiro.

console.log('Tentando conectar ao projeto:', process.env.FIREBASE_PROJECT_ID); 

admin.initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

export { db };