// database.js
require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ ERRO CRÍTICO: DATABASE_URL faltando no .env");
  process.exit(1); // Encerra o app se não tiver banco
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false // Necessário para Supabase em alguns ambientes Node
  }
});

pool.on('error', (err) => {
  console.error('❌ Erro inesperado no cliente PostgreSQL', err);
});

module.exports = { pool };
