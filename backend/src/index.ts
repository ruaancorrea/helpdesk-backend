import dotenv from 'dotenv';
dotenv.config(); // Carrega as variáveis de ambiente primeiro

import express, { Request, Response } from 'express';
import cors from 'cors';
import { db } from './config/firebase';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
// import nodemailer from 'nodemailer'; // <-- REMOVIDO
import { Resend } from 'resend'; // <-- ADICIONADO
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';

// Configuração do Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configuração do Multer para guardar o ficheiro temporariamente em memória
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- INICIALIZAÇÃO DO RESEND ---
// Pega a chave da API das variáveis de ambiente (configuradas na Railway/Render)
const resend = new Resend(process.env.RESEND_API_KEY); // <-- ADICIONADO

// --- FUNÇÃO REUTILIZÁVEL PARA ENVIAR E-MAILS (ATUALIZADA PARA RESEND) ---
async function sendNotificationEmail(to: string, subject: string, html: string) {
    // Verifica se a chave da API foi configurada no ambiente
    if (!process.env.RESEND_API_KEY) {
        console.error('ERRO CRÍTICO: Chave da API RESEND_API_KEY não definida nas variáveis de ambiente.');
        // Pode lançar um erro ou retornar para evitar mais processamento
        // throw new Error('Chave da API Resend não configurada.');
        return; // Não tenta enviar se a chave não existe
    }

    // Define o remetente usando o domínio padrão do Resend
    // Mude 'Helpdesk NTW Socium' para o nome que deseja que apareça
    const fromAddress = 'Helpdesk NTW Socium <onboarding@resend.dev>';

    try {
        console.log(`Tentando enviar e-mail para ${to} com assunto "${subject}" via Resend...`);

        const { data, error } = await resend.emails.send({
            from: fromAddress,
            to: [to], // Resend espera um array de e-mails
            subject: subject,
            html: html,
            replyTo: 'helpdesk@ntwsocium.com.br' // <-- Respostas irão para este e-mail
        });

        // Verifica se houve erro na resposta da API Resend
        if (error) {
            console.error(`Falha ao enviar e-mail para ${to} via Resend:`, error);
            // Decide se quer lançar o erro para a rota que chamou a função saber
            // throw error;
            return; // Ou apenas sai da função
        }

        // Se chegou aqui, o envio foi bem-sucedido (ou ao menos aceito pela API)
        console.log(`E-mail de notificação enviado para: ${to} via Resend. ID: ${data?.id}`);

    } catch (catchedError) {
        // Captura erros gerais (problemas de rede, etc.)
        console.error(`Exceção capturada ao tentar enviar e-mail para ${to} via Resend:`, catchedError);
        // Decide se quer lançar o erro
        // throw catchedError;
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
        const newUser = { ...req.body, createdAt: Timestamp.now().toDate().toISOString() };
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

app.delete('/users/:id', async (req: Request, res: Response) => {
    try {
        const userId = req.params.id;
        await db.collection('users').doc(userId).delete();
        res.status(200).send(`Usuário ${userId} apagado com sucesso.`);
    } catch (error) {
        console.error("Erro ao apagar usuário:", error);
        res.status(500).send("Erro ao apagar usuário.");
    }
});

// --- ROTA DE BULK USUÁRIOS ---
app.post('/users/bulk', async (req: Request, res: Response) => {
    const usersToCreate = req.body.users;
    if (!Array.isArray(usersToCreate) || usersToCreate.length === 0) {
        return res.status(400).send('Por favor, envie uma lista de usuários válida.');
    }

    try {
        const batch = db.batch();
        const usersRef = db.collection('users');
        let createdCount = 0;

        usersToCreate.forEach(user => {
            // Adapte os nomes das colunas conforme sua planilha
            if (!user.Nome || !user.Email || !user.Senha) return;

            const role = String(user.Papel).toLowerCase() === 'admin' ? 'admin'
                       : String(user.Papel).toLowerCase() === 'technician' ? 'technician'
                       : 'user';

            const newUser = {
                name: user.Nome,
                email: user.Email,
                department: user.Departamento || 'Não especificado',
                password: String(user.Senha), // Certifique-se de que a senha seja string
                role: role,
                position: user.Cargo || (role === 'admin' ? 'Administrador' : role === 'technician' ? 'Técnico' : 'Usuário'),
                phone: user.Telefone || '',
                createdAt: Timestamp.now().toDate().toISOString(),
            };

            const docRef = usersRef.doc(); // Cria um novo doc com ID automático
            batch.set(docRef, newUser);
            createdCount++;
        });

        if (createdCount === 0) {
            return res.status(400).send('Nenhum usuário válido para criar.');
        }

        await batch.commit();
        res.status(201).send(`${createdCount} usuários criados com sucesso!`);
    } catch (error) {
        console.error("Erro ao criar usuários em massa:", error);
        res.status(500).send("Erro ao processar a planilha.");
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
            timeline: [], // Inicializa vazio
            internalComments: [] // Inicializa vazio
        };
        const docRef = await db.collection('tickets').add(newTicketData);
        const newTicket = { id: docRef.id, ...newTicketData };
        res.status(201).json(newTicket); // Responde primeiro

        // Tenta enviar e-mails de notificação depois
        console.log('Iniciando envio de e-mail para técnicos...');
        const techsSnapshot = await db.collection('users').where('role', '==', 'technician').get();
        if (!techsSnapshot.empty) {
            const subject = `Novo Chamado Aberto: ${newTicket.title}`;
            const html = `<p>Um novo chamado foi aberto no sistema de Helpdesk.</p>
                          <p><b>Título:</b> ${newTicket.title}</p>
                          <p><b>Prioridade:</b> ${newTicket.priority}</p>
                          <p>Por favor, verifique o painel para mais detalhes.</p>`;
            const emailPromises: Promise<void>[] = []; // Cria array para promessas
            techsSnapshot.forEach(doc => {
                const tech = doc.data();
                if (tech.email) {
                    // Adiciona a promessa de envio ao array
                    emailPromises.push(sendNotificationEmail(tech.email, subject, html));
                }
            });
            // Espera todas as tentativas de envio concluírem (sem bloquear a resposta principal)
            Promise.allSettled(emailPromises).then(results => {
                console.log('Tentativas de envio de e-mail para técnicos concluídas.');
                results.forEach((result, index) => {
                    if (result.status === 'rejected') {
                        // Loga erros individuais se houver falha no envio para algum técnico
                        console.error(`Falha ao enviar e-mail para técnico ${index}:`, result.reason);
                    }
                });
            });
        }
    } catch (error) {
        console.error("Erro ao criar ticket:", error);
        // Garante que uma resposta seja enviada mesmo se o envio de email falhar antes
        if (!res.headersSent) {
            res.status(500).send("Erro ao criar ticket.");
        }
    }
});


app.put('/tickets/:id', async (req: Request, res: Response) => {
    try {
        const ticketId = req.params.id;
        const ticketData = {
            ...req.body,
            updatedAt: Timestamp.now().toDate().toISOString(),
        };
        await db.collection('tickets').doc(ticketId).update(ticketData);
        res.status(200).json({ id: ticketId, ...ticketData });
    } catch (error) {
        console.error("Erro ao atualizar ticket:", error);
        res.status(500).send("Erro ao atualizar ticket.");
    }
});

app.delete('/tickets/:id', async (req: Request, res: Response) => {
    try {
        const ticketId = req.params.id;
        // Adicionar verificação de permissão (ex: admin) aqui se necessário
        await db.collection('tickets').doc(ticketId).delete();
        res.status(200).send(`Ticket ${ticketId} apagado com sucesso.`);
    } catch (error) {
        console.error("Erro ao apagar ticket:", error);
        res.status(500).send("Erro ao apagar ticket.");
    }
});


// --- ROTAS DE TIMELINE E COMENTÁRIOS INTERNOS ---
app.post('/tickets/:id/timeline', async (req: Request, res: Response) => {
    try {
        const ticketId = req.params.id;

        const ticketBeforeSnap = await db.collection('tickets').doc(ticketId).get();
        if (!ticketBeforeSnap.exists) return res.status(404).send("Chamado não encontrado.");
        const ticketBefore = ticketBeforeSnap.data();

        const timelineEntry = {
            id: Math.random().toString(36).substring(7),
            ...req.body,
            createdAt: Timestamp.now().toDate().toISOString(),
        };

        await db.collection('tickets').doc(ticketId).update({
            timeline: FieldValue.arrayUnion(timelineEntry)
        });
        res.status(201).json(timelineEntry); // Responde primeiro

        // Tenta enviar notificação por e-mail depois
        if (ticketBefore) {
            const userSnap = await db.collection('users').doc(ticketBefore.userId).get();
            if (userSnap.exists) {
                const user = userSnap.data();
                if (user && user.email) {
                    const ticketAfterSnap = await db.collection('tickets').doc(ticketId).get(); // Pega o estado atualizado
                    const ticketAfter = ticketAfterSnap.data();
                    let statusChangeHtml = '';

                    // Compara status antes e depois da atualização da timeline (pode ter sido atualizado junto)
                    if (ticketAfter && ticketBefore.status !== ticketAfter.status) {
                        statusChangeHtml = `<p>Além disso, o status do seu chamado foi alterado para: <b>${ticketAfter.status}</b>.</p>`;
                    }

                    const subject = `Nova Resposta no seu Chamado: ${ticketBefore.title}`;
                    const html = `<p>Olá, ${user.name}!</p>
                                  <p>Houve uma nova resposta no seu chamado "${ticketBefore.title}".</p>
                                  <p><b>Comentário de ${timelineEntry.userName}:</b></p>
                                  <blockquote style="border-left: 2px solid #ccc; padding-left: 1em; margin-left: 1em; font-style: italic;">
                                    ${timelineEntry.message}
                                  </blockquote>
                                  ${statusChangeHtml}
                                  <p>Acesse o portal para mais detalhes.</p>`;
                    // Envia o e-mail sem esperar (não bloqueia a resposta)
                    sendNotificationEmail(user.email, subject, html);
                }
            }
        }

    } catch (error) {
        console.error("Erro ao adicionar entrada na timeline:", error);
        if (!res.headersSent) {
            res.status(500).send("Erro ao adicionar entrada na timeline.");
        }
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
    } catch (error) { console.error("Erro ao buscar categorias:", error); res.status(500).send("Erro ao buscar categorias."); }
});
app.post('/categories', async (req: Request, res: Response) => {
    try {
        const newCategory = { ...req.body, createdAt: Timestamp.now().toDate().toISOString() };
        const docRef = await db.collection('categories').add(newCategory);
        res.status(201).json({ id: docRef.id, ...newCategory });
    } catch (error) { console.error("Erro ao criar categoria:", error); res.status(500).send("Erro ao criar categoria."); }
});
app.put('/categories/:id', async (req: Request, res: Response) => {
    try {
        const categoryId = req.params.id;
        const categoryData = req.body;
        await db.collection('categories').doc(categoryId).update(categoryData);
        res.status(200).json({ id: categoryId, ...categoryData });
    } catch (error) { console.error("Erro ao atualizar categoria:", error); res.status(500).send("Erro ao atualizar categoria."); }
});

// --- ROTAS DE CONFIGURAÇÃO DE SLA ---
app.get('/sla-config', async (req: Request, res: Response) => {
    try {
        const slaSnapshot = await db.collection('slaConfig').get();
        const slaList = slaSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(slaList);
    } catch (error) { console.error("Erro ao buscar configurações de SLA:", error); res.status(500).send("Erro ao buscar configurações de SLA."); }
});
app.put('/sla-config/:id', async (req: Request, res: Response) => {
    try {
        const slaId = req.params.id;
        const slaData = req.body;
        await db.collection('slaConfig').doc(slaId).update(slaData);
        res.status(200).json({ id: slaId, ...slaData });
    } catch (error) { console.error("Erro ao atualizar SLA:", error); res.status(500).send("Erro ao atualizar SLA."); }
});

// --- ROTAS DE CONFIGURAÇÕES GERAIS E DE E-MAIL ---
app.get('/settings/general', async (req: Request, res: Response) => {
    try {
        const doc = await db.collection('generalSettings').doc('main').get();
        if (!doc.exists) return res.status(404).send('Configurações gerais não encontradas.');
        res.status(200).json(doc.data());
    } catch (error) { res.status(500).send("Erro ao buscar configurações gerais."); }
});
app.post('/settings/general', async (req: Request, res: Response) => {
    try {
        await db.collection('generalSettings').doc('main').set(req.body, { merge: true });
        res.status(200).json(req.body);
    } catch (error) { res.status(500).send("Erro ao salvar configurações gerais."); }
});
app.get('/settings/email', async (req: Request, res: Response) => {
    try {
        const doc = await db.collection('emailSettings').doc('main').get();
        if (!doc.exists) return res.status(404).send('Configurações de e-mail não encontradas.');
        res.status(200).json(doc.data());
    } catch (error) { res.status(500).send("Erro ao buscar configurações de e-mail."); }
});
app.post('/settings/email', async (req: Request, res: Response) => {
    try {
        // NÃO SALVA MAIS CREDENCIAIS SMTP AQUI, POIS USAMOS RESEND COM API KEY
        // Você pode remover os campos smtpUser, smtpPassword, smtpServer, smtpPort
        // da interface de frontend se quiser, ou apenas ignorá-los aqui.
        // Vamos manter as opções de notificação:
        const { notifyOnNew, notifyOnUpdate, notifyOnClose } = req.body;
        await db.collection('emailSettings').doc('main').set({
           notifyOnNew,
           notifyOnUpdate,
           notifyOnClose
           // Adicione quaisquer outras configurações *não* relacionadas a SMTP que você queira salvar
        }, { merge: true });
        res.status(200).json({ notifyOnNew, notifyOnUpdate, notifyOnClose }); // Retorna apenas o que foi salvo
    } catch (error) {
        console.error("Erro ao salvar configurações de e-mail:", error);
        res.status(500).send("Erro ao salvar configurações de e-mail.");
    }
});


// Rota de teste de e-mail (agora usa Resend)
app.post('/send-test-email', async (req: Request, res: Response) => {
    const { to } = req.body;
    if (!to) {
        return res.status(400).send('O campo "to" é obrigatório.');
    }
    try {
        // Chama a nova função sendNotificationEmail que usa Resend
        await sendNotificationEmail(to, 'E-mail de Teste do Helpdesk (via Resend)', '<p>Este é um e-mail de teste enviado usando Resend.</p>');
        res.status(200).send('Tentativa de envio de e-mail de teste iniciada com sucesso via Resend!');
    } catch (error: any) {
        // A função sendNotificationEmail já loga o erro, mas podemos enviar uma resposta de erro genérica
        console.error("Erro na rota /send-test-email:", error);
        // Evita expor detalhes do erro ao cliente
        res.status(500).send(`Erro ao tentar iniciar o envio do e-mail de teste.`);
    }
});


// --- ROTA PARA UPLOAD DE FICHEIROS (Cloudinary) ---
app.post('/upload', upload.single('file'), (req: Request, res: Response) => {
    if (!req.file) {
        return res.status(400).send('Nenhum ficheiro enviado.');
    }

    cloudinary.uploader.upload_stream({ resource_type: 'auto' }, (error, result) => {
        if (error || !result) {
            console.error("Erro no upload para o Cloudinary:", error);
            return res.status(500).send('Erro ao fazer upload do ficheiro.');
        }
        // Retorna a URL segura e o nome original do arquivo
        res.status(200).json({ url: result.secure_url, name: req.file!.originalname });
    }).end(req.file.buffer);
});


// --- INICIAR SERVIDOR ---
app.listen(port, () => {
  console.log(`🚀 Servidor backend rodando em http://localhost:${port}`);
});