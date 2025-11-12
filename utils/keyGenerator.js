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