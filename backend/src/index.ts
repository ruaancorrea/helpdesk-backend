import dotenv from 'dotenv';
dotenv.config(); // Carrega as variáveis de ambiente primeiro

import express, { Request, Response } from 'express';
import cors from 'cors';
import { db } from './config/firebase';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer'; // Importar o nodemailer

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- FUNÇÃO REUTILIZÁVEL PARA ENVIAR E-MAILS ---
async function sendNotificationEmail(to: string, subject: string, html: string) {
    try {
        const emailSettingsDoc = await db.collection('emailSettings').doc('main').get();
        if (!emailSettingsDoc.exists) {
            throw new Error('Configurações de e-mail não encontradas.');
        }
        const settings = emailSettingsDoc.data();

        if (!settings || !settings.smtpUser || !settings.smtpPassword) {
             throw new Error('Usuário ou senha do SMTP não configurados.');
        }

        const transporter = nodemailer.createTransport({
            host: settings.smtpServer,
            port: settings.smtpPort,
            secure: settings.smtpPort === 465,
            auth: {
                user: settings.smtpUser,
                pass: settings.smtpPassword, // Senha de App
            },
        });

        await transporter.sendMail({
            from: `"Helpdesk Pro" <${settings.smtpUser}>`,
            to,
            subject,
            html,
        });
        console.log(`E-mail de notificação enviado para: ${to}`);
    } catch (error) {
        console.error(`Falha ao enviar e-mail para ${to}:`, error);
        // Não retorna um erro para a requisição principal não falhar
    }
}


// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).send('Email e senha são obrigatórios.');
  }
  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).where('password', '==', password).limit(1).get();

    if (snapshot.empty) {
      return res.status(401).json({ success: false, message: 'Email ou senha incorretos' });
    }

    const userDoc = snapshot.docs[0];
    const user = { id: userDoc.id, ...userDoc.data() };
    res.status(200).json({ success: true, user });

  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).send("Erro no servidor durante o login.");
  }
});


// --- ROTAS DE USUÁRIOS (CRUD) ---

app.get('/users', async (req: Request, res: Response) => {
  try {
    const usersSnapshot = await db.collection('users').get();
    const usersList = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(usersList);
  } catch (error) {
    console.error("Erro ao buscar usuários:", error);
    res.status(500).send("Erro ao buscar usuários no servidor.");
  }
});

app.post('/users', async (req: Request, res: Response) => {
    try {
        const newUser = {
            ...req.body,
            createdAt: Timestamp.now().toDate().toISOString(),
        };
        const docRef = await db.collection('users').add(newUser);
        res.status(201).json({ id: docRef.id, ...newUser });
    } catch (error) {
        console.error("Erro ao criar usuário:", error);
        res.status(500).send("Erro ao criar usuário.");
    }
});

app.put('/users/:id', async (req: Request, res: Response) => {
    try {
        const userId = req.params.id;
        const userData = req.body;
        await db.collection('users').doc(userId).update(userData);
        res.status(200).json({ id: userId, ...userData });
    } catch (error) {
        console.error("Erro ao atualizar usuário:", error);
        res.status(500).send("Erro ao atualizar usuário.");
    }
});


// --- ROTAS DE TICKETS (CRUD) ---

app.get('/tickets', async (req: Request, res: Response) => {
    try {
        const ticketsSnapshot = await db.collection('tickets').get();
        const ticketsList = ticketsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(ticketsList);
    } catch (error) {
        console.error("Erro ao buscar tickets:", error);
        res.status(500).send("Erro ao buscar tickets.");
    }
});

app.post('/tickets', async (req: Request, res: Response) => {
    try {
        const newTicketData = {
            ...req.body,
            createdAt: Timestamp.now().toDate().toISOString(),
            updatedAt: Timestamp.now().toDate().toISOString(),
            timeline: [],
            internalComments: []
        };
        const docRef = await db.collection('tickets').add(newTicketData);
        const newTicket = { id: docRef.id, ...newTicketData };
        res.status(201).json(newTicket);

        // --- LÓGICA DE E-MAIL PARA TÉCNICOS ---
        console.log('Iniciando envio de e-mail para técnicos...');
        const techsSnapshot = await db.collection('users').where('role', '==', 'technician').get();
        if (!techsSnapshot.empty) {
            const subject = `Novo Chamado Aberto: ${newTicket.title}`;
            const html = `<p>Um novo chamado foi aberto no sistema de Helpdesk.</p>
                        <p><b>Título:</b> ${newTicket.title}</p>
                        <p><b>Prioridade:</b> ${newTicket.priority}</p>
                        <p>Por favor, verifique o painel para mais detalhes.</p>`;
            
            techsSnapshot.forEach(doc => {
                const tech = doc.data();
                if (tech.email) {
                    sendNotificationEmail(tech.email, subject, html);
                }
            });
        }
        // --- FIM DA LÓGICA DE E-MAIL ---

    } catch (error) {
        console.error("Erro ao criar ticket:", error);
        res.status(500).send("Erro ao criar ticket.");
    }
});

app.put('/tickets/:id', async (req: Request, res: Response) => {
    try {
        const ticketId = req.params.id;
        
        // Buscar o estado anterior do ticket para comparar
        const ticketBeforeSnap = await db.collection('tickets').doc(ticketId).get();
        if (!ticketBeforeSnap.exists) {
            return res.status(404).send("Chamado não encontrado.");
        }
        const ticketBefore = ticketBeforeSnap.data();

        const ticketData = {
            ...req.body,
            updatedAt: Timestamp.now().toDate().toISOString(),
        };
        await db.collection('tickets').doc(ticketId).update(ticketData);
        res.status(200).json({ id: ticketId, ...ticketData });
        
        // --- LÓGICA DE E-MAIL PARA USUÁRIO (MUDANÇA DE STATUS) ---
        if (ticketBefore && ticketData.status !== ticketBefore.status) {
            console.log(`Status do chamado ${ticketId} alterado. Enviando e-mail...`);
            const userSnap = await db.collection('users').doc(ticketBefore.userId).get();
            if (userSnap.exists) {
                const user = userSnap.data();
                if (user && user.email) {
                    const subject = `Atualização no seu Chamado: ${ticketBefore.title}`;
                    const html = `<p>Olá, ${user.name}!</p>
                                <p>O status do seu chamado "${ticketBefore.title}" foi alterado para: <b>${ticketData.status}</b>.</p>
                                <p>Acesse o portal para mais detalhes.</p>`;
                    sendNotificationEmail(user.email, subject, html);
                }
            }
        }
        // --- FIM DA LÓGICA DE E-MAIL ---

    } catch (error) {
        console.error("Erro ao atualizar ticket:", error);
        res.status(500).send("Erro ao atualizar ticket.");
    }
});

app.post('/tickets/:id/timeline', async (req: Request, res: Response) => {
    try {
        const ticketId = req.params.id;
        const timelineEntry = {
            id: Math.random().toString(36).substring(7),
            ...req.body,
            createdAt: Timestamp.now().toDate().toISOString(),
        };

        await db.collection('tickets').doc(ticketId).update({
            timeline: FieldValue.arrayUnion(timelineEntry)
        });
        res.status(201).json(timelineEntry);

        // --- LÓGICA DE E-MAIL PARA USUÁRIO (NOVO COMENTÁRIO) ---
        console.log(`Novo comentário no chamado ${ticketId}. Enviando e-mail...`);
        const ticketSnap = await db.collection('tickets').doc(ticketId).get();
        if (ticketSnap.exists) {
            const ticket = ticketSnap.data();
            if (ticket) {
                const userSnap = await db.collection('users').doc(ticket.userId).get();
                 if (userSnap.exists) {
                    const user = userSnap.data();
                    if (user && user.email) {
                        const subject = `Nova Resposta no seu Chamado: ${ticket.title}`;
                        const html = `<p>Olá, ${user.name}!</p>
                                    <p>Houve uma nova resposta no seu chamado "${ticket.title}".</p>
                                    <p><b>Comentário de ${timelineEntry.userName}:</b></p>
                                    <p><i>"${timelineEntry.message}"</i></p>
                                    <p>Acesse o portal para responder.</p>`;
                        sendNotificationEmail(user.email, subject, html);
                    }
                }
            }
        }
        // --- FIM DA LÓGICA DE E-MAIL ---

    } catch (error) {
        console.error("Erro ao adicionar entrada na timeline:", error);
        res.status(500).send("Erro ao adicionar entrada na timeline.");
    }
});

app.post('/tickets/:id/internal-comments', async (req: Request, res: Response) => {
    try {
        const ticketId = req.params.id;
        const internalComment = {
            id: Math.random().toString(36).substring(7),
            ...req.body,
            createdAt: Timestamp.now().toDate().toISOString(),
        };

        await db.collection('tickets').doc(ticketId).update({
            internalComments: FieldValue.arrayUnion(internalComment)
        });

        res.status(201).json(internalComment);
    } catch (error) {
        console.error("Erro ao adicionar comentário interno:", error);
        res.status(500).send("Erro ao adicionar comentário interno.");
    }
});

// --- ROTAS DE CATEGORIAS (CRUD) ---

app.get('/categories', async (req: Request, res: Response) => {
    try {
        const categoriesSnapshot = await db.collection('categories').where('isActive', '==', true).get();
        const categoriesList = categoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(categoriesList);
    } catch (error) {
        console.error("Erro ao buscar categorias:", error);
        res.status(500).send("Erro ao buscar categorias.");
    }
});

app.post('/categories', async (req: Request, res: Response) => {
    try {
        const newCategory = {
            ...req.body,
            createdAt: Timestamp.now().toDate().toISOString(),
        };
        const docRef = await db.collection('categories').add(newCategory);
        res.status(201).json({ id: docRef.id, ...newCategory });
    } catch (error) {
        console.error("Erro ao criar categoria:", error);
        res.status(500).send("Erro ao criar categoria.");
    }
});

app.put('/categories/:id', async (req: Request, res: Response) => {
    try {
        const categoryId = req.params.id;
        const categoryData = req.body;
        await db.collection('categories').doc(categoryId).update(categoryData);
        res.status(200).json({ id: categoryId, ...categoryData });
    } catch (error) {
        console.error("Erro ao atualizar categoria:", error);
        res.status(500).send("Erro ao atualizar categoria.");
    }
});

// --- ROTAS DE CONFIGURAÇÃO DE SLA ---

app.get('/sla-config', async (req: Request, res: Response) => {
    try {
        const slaSnapshot = await db.collection('slaConfig').get();
        const slaList = slaSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(slaList);
    } catch (error) {
        console.error("Erro ao buscar configurações de SLA:", error);
        res.status(500).send("Erro ao buscar configurações de SLA.");
    }
});

app.put('/sla-config/:id', async (req: Request, res: Response) => {
    try {
        const slaId = req.params.id;
        const slaData = req.body;
        await db.collection('slaConfig').doc(slaId).update(slaData);
        res.status(200).json({ id: slaId, ...slaData });
    } catch (error) {
        console.error("Erro ao atualizar SLA:", error);
        res.status(500).send("Erro ao atualizar SLA.");
    }
});

// --- ROTAS DE CONFIGURAÇÕES GERAIS E DE E-MAIL ---
const GENERAL_SETTINGS_DOC_ID = 'main';
const EMAIL_SETTINGS_DOC_ID = 'main';

app.get('/settings/general', async (req: Request, res: Response) => {
    try {
        const doc = await db.collection('generalSettings').doc(GENERAL_SETTINGS_DOC_ID).get();
        if (!doc.exists) {
            return res.status(404).send('Configurações gerais não encontradas.');
        }
        res.status(200).json(doc.data());
    } catch (error) {
        res.status(500).send("Erro ao buscar configurações gerais.");
    }
});

app.post('/settings/general', async (req: Request, res: Response) => {
    try {
        await db.collection('generalSettings').doc(GENERAL_SETTINGS_DOC_ID).set(req.body, { merge: true });
        res.status(200).json(req.body);
    } catch (error) {
        res.status(500).send("Erro ao salvar configurações gerais.");
    }
});

app.get('/settings/email', async (req: Request, res: Response) => {
    try {
        const doc = await db.collection('emailSettings').doc(EMAIL_SETTINGS_DOC_ID).get();
        if (!doc.exists) {
            return res.status(404).send('Configurações de e-mail não encontradas.');
        }
        res.status(200).json(doc.data());
    } catch (error) {
        res.status(500).send("Erro ao buscar configurações de e-mail.");
    }
});

app.post('/settings/email', async (req: Request, res: Response) => {
    try {
        await db.collection('emailSettings').doc(EMAIL_SETTINGS_DOC_ID).set(req.body, { merge: true });
        res.status(200).json(req.body);
    } catch (error) {
        res.status(500).send("Erro ao salvar configurações de e-mail.");
    }
});

// Rota de teste de e-mail
app.post('/send-test-email', async (req: Request, res: Response) => {
    try {
        const { to } = req.body;
        const subject = 'E-mail de Teste do Helpdesk';
        const html = '<p>Este é um e-mail de teste para verificar as suas configurações de SMTP.</p>';
        
        // A função sendNotificationEmail já faz toda a lógica de buscar settings e enviar
        await sendNotificationEmail(to, subject, html);

        res.status(200).send('E-mail de teste enviado com sucesso!');
    } catch (error: any) {
        console.error("Erro ao enviar e-mail de teste:", error);
        res.status(500).send(`Erro ao enviar e-mail de teste: ${error.message}`);
    }
});


app.listen(port, () => {
  console.log(`🚀 Servidor backend rodando em http://localhost:${port}`);
});