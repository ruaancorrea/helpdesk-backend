import dotenv from 'dotenv';
dotenv.config(); // Carrega as variáveis de ambiente primeiro

import express, { Request, Response } from 'express';
import cors from 'cors';
import { db } from './config/firebase';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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
        const newTicket = {
            ...req.body,
            createdAt: Timestamp.now().toDate().toISOString(),
            updatedAt: Timestamp.now().toDate().toISOString(),
            timeline: [], // Inicializa campos como arrays vazios
            internalComments: []
        };
        const docRef = await db.collection('tickets').add(newTicket);
        res.status(201).json({ id: docRef.id, ...newTicket });
    } catch (error) {
        console.error("Erro ao criar ticket:", error);
        res.status(500).send("Erro ao criar ticket.");
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

app.post('/tickets/:id/timeline', async (req: Request, res: Response) => {
    try {
        const ticketId = req.params.id;
        const timelineEntry = {
            id: Math.random().toString(36).substring(7), // ID aleatório simples
            ...req.body,
            createdAt: Timestamp.now().toDate().toISOString(),
        };

        await db.collection('tickets').doc(ticketId).update({
            timeline: FieldValue.arrayUnion(timelineEntry)
        });

        res.status(201).json(timelineEntry);
    } catch (error) {
        console.error("Erro ao adicionar entrada na timeline:", error);
        res.status(500).send("Erro ao adicionar entrada na timeline.");
    }
});

app.post('/tickets/:id/internal-comments', async (req: Request, res: Response) => {
    try {
        const ticketId = req.params.id;
        const internalComment = {
            id: Math.random().toString(36).substring(7), // ID aleatório simples
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


app.listen(port, () => {
  console.log(`🚀 Servidor backend rodando em http://localhost:${port}`);
});
