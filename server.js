// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { pool } = require("./database");
const { generateUniqueKey } = require("./utils/keyGenerator");

const app = express();

// ===== SEGURANÇA (HELMET) =====
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// ===== CORS =====
const allowedOrigins = [
  "https://rabisk-frontend.vercel.app",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Bloqueado pelo CORS"));
      }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
  })
);

// ===== RATE LIMITING =====
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Muitas requisições. Tente novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Aumentei levemente para evitar falsos positivos legítimos
  message: { error: "Muitas tentativas de checkout. Aguarde." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Aplica limitador geral (exceto webhook)
app.use((req, res, next) => {
  if (req.path === "/webhook") return next();
  generalLimiter(req, res, next);
});

// ===== ROTAS =====

app.get("/", (req, res) => {
  res.json({ status: "Online", security: "Ativo" });
});

// CHECKOUT
app.post("/create-checkout", checkoutLimiter, express.json(), async (req, res) => {
  const { plan } = req.body;

  if (!plan || !["lifetime", "subscription"].includes(plan)) {
    return res.status(400).json({ error: "Plano inválido" });
  }

  const priceId =
    plan === "lifetime"
      ? process.env.STRIPE_PRICE_ID_VITALICIA
      : process.env.STRIPE_PRICE_ID_ASSINATURA;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: plan === "lifetime" ? "payment" : "subscription",
      success_url: `${process.env.FRONTEND_URL}/obrigado?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/#planos`,
      metadata: { plan },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Erro checkout:", err.message);
    res.status(500).json({ error: "Erro ao criar pagamento" });
  }
});

// WEBHOOK (SEGURANÇA CRÍTICA AQUI)
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
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const sessionId = session.id;

    // 🛡️ CORREÇÃO DE IDEMPOTÊNCIA: Verifica se já processamos esse pagamento
    try {
      const checkExists = await pool.query(
        "SELECT id FROM access_keys WHERE stripe_session_id = $1",
        [sessionId]
      );

      if (checkExists.rows.length > 0) {
        console.log(`⚠️ Pagamento ${sessionId} já processado. Ignorando duplicidade.`);
        return res.json({ received: true });
      }

      // Se não existe, prossegue...
      const plan = session.metadata?.plan || "desconhecido";
      const customerEmail = session.customer_details?.email;
      const customerId = session.customer;

      // Gera chave (Código melhorado no keyGenerator.js)
      const newKey = await generateUniqueKey();

      await pool.query(
        `INSERT INTO access_keys (key, email, plan, stripe_session_id, stripe_customer_id, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newKey, customerEmail, plan, sessionId, customerId, true]
      );

      console.log(`✅ Nova venda processada: ${customerEmail} (Chave: ${newKey})`);

    } catch (err) {
      console.error("❌ Erro crítico no banco de dados:", err);
      // Retornar 500 faz o Stripe tentar de novo. 
      // Se for erro de lógica, pode causar loop, mas é melhor que perder a venda.
      return res.status(500).send("Erro interno ao salvar chave");
    }
  }

  res.json({ received: true });
});

// VALIDAÇÃO DE CHAVE (SEM VAZAR DADOS)
app.post("/validate-key", express.json(), async (req, res) => {
  try {
    const { key } = req.body;

    if (!key || typeof key !== "string") {
      return res.status(400).json({ valid: false, error: "Formato inválido" });
    }

    const cleanKey = key.trim().toUpperCase();

    // Consulta otimizada
    const result = await pool.query(
      "SELECT plan, is_active, email FROM access_keys WHERE key = $1",
      [cleanKey]
    );

    const accessKey = result.rows[0];

    if (!accessKey) {
      // Delay artificial para evitar ataque de força bruta (Timing Attack)
      await new Promise(resolve => setTimeout(resolve, 200)); 
      return res.status(404).json({ valid: false, error: "Chave inválida" });
    }

    if (!accessKey.is_active) {
      return res.status(403).json({ valid: false, error: "Chave expirada" });
    }

    // 🛡️ CORREÇÃO DE PRIVACIDADE: Mascarar o email
    const emailParts = accessKey.email.split("@");
    const maskedEmail = emailParts[0].substring(0, 3) + "***@" + emailParts[1];

    res.json({
      valid: true,
      plan: accessKey.plan,
      masked_email: maskedEmail, // Frontend mostra apenas "mic***@gmail.com"
      message: "Acesso autorizado"
    });

  } catch (error) {
    console.error("Erro na validação:", error);
    res.status(500).json({ valid: false, error: "Erro interno" });
  }
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`🔒 Servidor seguro rodando na porta ${PORT}`);
});
