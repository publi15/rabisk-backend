// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();

// CORS: permite apenas o frontend (localhost:5173)
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  })
);

// Rota raiz
app.get("/", (req, res) => {
  res.send("BACKEND DO RABISK ESTÁ VIVO! 🚀");
});

// CRIA CHECKOUT SESSION
app.post("/create-checkout", express.json(), async (req, res) => {
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
});

// WEBHOOK (DEVE VIR ANTES DE express.json())
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
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

    // AQUI VOCÊ PODE SALVAR NO BANCO, ENVIAR EMAIL, ETC
  }

  res.json({ received: true });
});

// INICIA SERVIDOR
const PORT = 4242;
app.listen(PORT, () => {
  console.log(`SERVIDOR RODANDO EM http://localhost:${PORT}`);
  console.log(`CHECKOUT: POST /create-checkout`);
  console.log(`WEBHOOK: POST /webhook`);
  console.log(`TESTE: stripe trigger checkout.session.completed`);
});