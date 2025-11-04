import cors from "cors";

// server.js — VERSÃO FINAL QUE FUNCIONA COM R$1,00
require("dotenv").config();
const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();

// 1. CORS PERFEITO
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "http://localhost:5173");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, stripe-signature");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// 2. RAIZ
app.get("/", (req, res) => res.send("BACKEND RABISK2D VIVO! 🚀"));

// 3. CRIA CHECKOUT (agora com rota correta)
app.post("/create-checkout-session", express.json(), async (req, res) => {
  const { plan } = req.body;
  if (!["lifetime", "subscription"].includes(plan)) return res.status(400).json({ error: "Plano inválido" });

  const priceId = plan === "lifetime" 
    ? process.env.STRIPE_PRICE_ID_VITALICIA 
    : process.env.STRIPE_PRICE_ID_ASSINATURA;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: plan === "lifetime" ? "payment" : "subscription",
      success_url: `${process.env.FRONTEND_URL}/obrigado?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/#planos`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("ERRO CHECKOUT:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. WEBHOOK (RAW + VERIFICAÇÃO)
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`WEBHOOK ERRO: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log("\n🎉 PAGAMENTO RECEBIDO!");
    console.log(`Plano: ${session.metadata.plan === "lifetime" ? "VITALÍCIO" : "MENSAL"}`);
    console.log(`Email: ${session.customer_details?.email}`);
    console.log(`ID: ${session.id}\n`);
  }
  res.json({ received: true });
});

// 5. START
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`SERVIDOR ON FIRE: ${process.env.FRONTEND_URL}`);
  console.log(`CHECKOUT → POST /create-checkout-session`);
  console.log(`WEBHOOK → POST /webhook`);
});
