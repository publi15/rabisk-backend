// utils/keyGenerator.js
const { pool } = require('../database');
const crypto = require('crypto');

/**
 * Gera chave segura de 12 caracteres (ex: A1B2-C3D4-E5F6)
 * Usamos crypto para garantir aleatoriedade real
 */
function generateRandomKey() {
  // Gera bytes aleatórios e converte para Hex maiúsculo
  const raw = crypto.randomBytes(6).toString('hex').toUpperCase(); 
  // Formata para leitura humana (opcional, mas ajuda no suporte)
  // Resultado ex: "A1B2C3D4E5F6"
  return raw; 
}

async function generateUniqueKey() {
  let key;
  let exists = true;
  let attempts = 0;

  while (exists && attempts < 10) {
    key = generateRandomKey();
    
    // Verifica duplicidade no banco
    const result = await pool.query(
      'SELECT id FROM access_keys WHERE key = $1', 
      [key]
    );
    const { pool } = require('../database'); // <-- IMPORTANTE: Puxa nossa conexão
    
    /**
     * Gera uma chave aleatória de 6 caracteres...
     */
    function generateRandomKey() {
      // ... (o resto do código dele está correto) ...
    }
    
    /**
     * Gera uma chave única (verifica se já existe no banco)
     */
    async function generateUniqueKey() {
      let key;
      let exists = true;
      let attempts = 0;
      // ...
      
      while (exists && attempts < 10) {
        key = generateRandomKey();
        
        // Verifica se a chave já existe no banco (SQL!)
        const result = await pool.query( // <-- Correto! Usa o pool
          'SELECT id FROM access_keys WHERE key = $1',
          [key]
        );
        
        exists = result.rows.length > 0;
        attempts++;
      }
      // ... (o resto do código dele está correto) ...
      return key;
    }
    
    module.exports = {
      generateRandomKey,
      generateUniqueKey,
    };
    exists = result.rows.length > 0;
    attempts++;
  }

  if (exists) {
    throw new Error("Falha ao gerar chave única após 10 tentativas");
  }

  return key;
}

module.exports = { generateUniqueKey };
