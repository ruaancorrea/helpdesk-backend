import { db } from './config/firebase';
import * as fs from 'fs';
import * as path from 'path';

// O caminho para o seu arquivo db.json original no frontend
const dbPath = path.resolve(__dirname, '../../src/data/db.json');

interface DbData {
  users: any[];
  tickets: any[];
  categories: any[];
  slaConfig: any[];
}

async function seedDatabase() {
  try {
    console.log('🌱 Iniciando a semeadura do banco de dados...');

    // 1. Ler o arquivo db.json
    if (!fs.existsSync(dbPath)) {
      console.error(`❌ Erro: Arquivo db.json não encontrado em: ${dbPath}`);
      return;
    }
    const dbData: DbData = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));

    // 2. Semear a coleção 'users'
    console.log('- Semeando usuários...');
    for (const user of dbData.users) {
      await db.collection('users').doc(user.id).set(user);
    }
    console.log('✅ Usuários semeados com sucesso!');

    // 3. Semear a coleção 'tickets'
    console.log('- Semeando tickets...');
    for (const ticket of dbData.tickets) {
      await db.collection('tickets').doc(ticket.id).set(ticket);
    }
    console.log('✅ Tickets semeados com sucesso!');
    
    // 4. Semear a coleção 'categories'
    console.log('- Semeando categorias...');
    for (const category of dbData.categories) {
      await db.collection('categories').doc(category.id).set(category);
    }
    console.log('✅ Categorias semeadas com sucesso!');

    // 5. Semear a coleção 'slaConfig'
    console.log('- Semeando slaConfig...');
    for (const sla of dbData.slaConfig) {
      await db.collection('slaConfig').doc(sla.id).set(sla);
    }
    console.log('✅ Configurações de SLA semeadas com sucesso!');

    // 6. Semear configurações iniciais
    console.log('- Semeando configurações gerais e de e-mail...');
    const generalSettings = {
        companyName: 'HelpDesk Pro',
        supportEmail: 'suporte@empresa.com',
        maxFileSize: 10,
        allowedFileTypes: '.pdf,.doc,.docx,.jpg,.jpeg,.png',
        autoAssignment: true,
        requireApproval: false,
    };
    await db.collection('generalSettings').doc('main').set(generalSettings);

    const emailSettings = {
        smtpServer: 'smtp.gmail.com',
        smtpPort: 587,
        smtpUser: '',
        smtpPassword: '',
        notifyOnNew: true,
        notifyOnUpdate: true,
        notifyOnClose: true,
    };
    await db.collection('emailSettings').doc('main').set(emailSettings);
    console.log('✅ Configurações semeadas com sucesso!');


    console.log('Database semeado com sucesso! 🎉');

  } catch (error) {
    console.error('❌ Erro durante a semeadura do banco de dados:', error);
  }
}

seedDatabase();
