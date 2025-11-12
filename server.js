// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet"); // 🛡️ SEGURANÇA
const rateLimit = require("express-rate-limit"); // ⏱️ LIMITE DE REQUISIÇÕES
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { pool } = require("./database");
const { generateUniqueKey } = require("./utils/keyGenerator"); // Verifique o nome do arquivo, o seu está como keyGenerate.js

const app = express();

// ===== CONFIGURAÇÃO DO HELMET (SEGURANÇA) =====
// Adiciona headers de segurança HTTP automaticamente
app.use(
  helmet({
    contentSecurityPolicy: false, // Desabilita CSP para não interferir com Stripe
    crossOriginEmbedderPolicy: false, // Permite embedar recursos externos
  })
);

// ===== CONFIGURAÇÃO DO CORS =====
const allowedOrigins = [
  "https://rabisk-frontend.vercel.app", // ⬅️ SUA URL DE PRODUÇÃO NO VERCEL
  "http://localhost:5173", // URL para desenvolvimento local
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite requisições sem 'origin' (como apps ou ferramentas)
      // OU se a origem estiver na nossa lista (Vercel ou localhost)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        // Se for outra origem, bloqueia o CORS (segurança)
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
  })
);

// ===== CONFIGURAÇÃO DE RATE LIMITING =====

// Rate Limiter GERAL (para todas as rotas, exceto webhook)
// Limita a 100 requisições por 15 minutos por IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // Máximo de 100 requisições por janela de tempo
  message: {
    error: "Muitas requisições deste IP, tente novamente em 15 minutos.",
  },
  standardHeaders: true, // Retorna informações de rate limit nos headers `RateLimit-*`
  legacyHeaders: false, // Desabilita os headers `X-RateLimit-*`
});

// Rate Limiter para CHECKOUT (mais restritivo)
// Limita a 5 tentativas de checkout por 15 minutos por IP
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Máximo de 5 tentativas de checkout
  message: {
    error: "Muitas tentativas de checkout. Tente novamente em 15 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Ignora requisições bem-sucedidas (só conta falhas/tentativas)
  skipSuccessfulRequests: false,
});

// Aplicar rate limiter geral em todas as rotas (exceto webhook)
app.use((req, res, next) => {
  // Webhook do Stripe NÃO deve ter rate limit (ou o Stripe pode falhar)
  if (req.path === "/webhook") {
    return next();
  }
  generalLimiter(req, res, next);
});

// ===== ROTAS =====

// Rota raiz
app.get("/", (req, res) => {
  res.json({
    message: "BACKEND DO RABISK ESTÁ VIVO!",
    security: "Helmet ativado",
    rateLimit: "Ativo",
  });
});

// CRIA CHECKOUT SESSION (com rate limit específico)
app.post(
  "/create-checkout",
  checkoutLimiter, // ⬅️ Rate limit específico para checkout
  express.json(),
  async (req, res) => {
    const { plan } = req.body;

    // VALIDAÇÃO
    if (!plan || !["lifetime", "subscription"].includes(plan)) {
      return res.status(400).json({ error: "Plano inválido" });
    }

    const priceId =
      plan === "lifetime"
        ? process.env.STRIPE_PRICE_ID_VITALICIA
        : process.env.STRIPE_PRICE_ID_ASSINATURA;

    if (!priceId) {
      return res.status(500).json({ error: "ID do preço não configurado" });
    }

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: plan === "lifetime" ? "payment" : "subscription",
        success_url: `${process.env.FRONTEND_URL}/obrigado?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/#planos`,
        metadata: { plan },
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error("ERRO AO CRIAR SESSÃO:", err.message);
      res.status(500).json({ error: "Falha ao criar sessão de pagamento" });
    }
  }
);

// WEBHOOK (DEVE VIR ANTES de express.json() e SEM rate limit)
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log(`ERRO NO WEBHOOK: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // SUCESSO NO PAGAMENTO
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const plan = session.metadata?.plan || "desconhecido";

    console.log("\n");
    console.log("==================================");
    console.log("PAGAMENTO RECEBIDO!");
    console.log(`Plano: ${plan === "lifetime" ? "VITALÍCIO" : "MENSAL"}`);
    console.log(`Email: ${session.customer_details?.email || "não informado"}`);
    console.log(`ID: ${session.id}`);
    console.log("==================================");
    console.log("\n");

    // AQUI VAMOS SALVAR NO BANCO!
    try {
      // 1. Gerar uma chave única
      const newKey = await generateUniqueKey();

      // 2. Pegar os dados do cliente
      const customerEmail = session.customer_details?.email;
      const customerId = session.customer;
      const sessionId = session.id;

      // 3. Inserir no banco de dados (SQL!)
      const queryText = `
    INSERT INTO access_keys (key, email, plan, stripe_session_id, stripe_customer_id, is_active)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id;
  `;

      const queryParams = [
        newKey,
        customerEmail,
        plan,
        sessionId,
        customerId,
        true
      ];

      await pool.query(queryText, queryParams);

      console.log(`✅ CHAVE GERADA E SALVA: ${newKey} para ${customerEmail}`);

    } catch (dbError) {
      console.error("❌ ERRO AO SALVAR CHAVE NO BANCO:", dbError);
    }
  }

  res.json({ received: true });
});

/**
 * ROTA: ✅ Validar Chave de Acesso
 */
app.post("/validate-key", express.json(), async (req, res) => {
  try {
    const { key } = req.body; // Pega a chave do corpo da requisição

    if (!key) {
      return res.status(400).json({ valid: false, error: "Chave não fornecida" });
    }

    // Faz a consulta SQL no Supabase
    const result = await pool.query(
      "SELECT * FROM access_keys WHERE key = $1",
      [key.toUpperCase()]
    );

    const accessKey = result.rows[0];

    if (!accessKey) {
      return res.status(404).json({ valid: false, error: "Chave não encontrada" });
    }

    if (!accessKey.is_active) {
      return res.status(403).json({ valid: false, error: "Chave inativa ou expirada" });
    }

    // Sucesso! A chave é válida.
    res.json({
      valid: true,
      plan: accessKey.plan,
      email: accessKey.email,
      message: "Chave válida! Acesso liberado."
    });

  } catch (error) {
    console.error("❌ Erro ao validar chave:", error);
    res.status(500).json({ valid: false, error: "Erro interno do servidor" });
  }
});

// INICIA SERVIDOR
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`\n SERVIDOR RODANDO EM http://localhost:${PORT}`);
  console.log(` Helmet: ATIVO`);
  console.log(` Rate Limit: ATIVO`);
  console.log(`   - Geral: 100 req/15min`);
  console.log(`   - Checkout: 5 req/15min`);
  console.log(`\n ROTAS DISPONÍVEIS:`);
  console.log(`   GET  / - Status do servidor`);
  console.log(`   POST /create-checkout - Criar sessão de pagamento`);
  console.log(`   POST /webhook - Webhook do Stripe`);
  console.log(`\n TESTE: stripe trigger checkout.session.completed\n`);
});
