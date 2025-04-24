// test-mempool.js
const WebSocket = require('ws');
const ws = new WebSocket('wss://mempool.space/api/v1/ws');

ws.on('open', () => {
  ws.send(JSON.stringify({ op: 'new_tx' }));
  console.log('Conectado ao mempool.space! Aguardando transações baleia...');
});

ws.on('message', (data) => {
  try {
    const tx = JSON.parse(data);
    if (tx.total_output && tx.total_output > 100 * 1e8) {
      console.log('[WHALE]', tx.total_output, 'sats', (tx.total_output / 1e8).toFixed(2), 'BTC');
    }
  } catch (e) {
    // Ignora erros de parse
  }
});

ws.on('close', () => {
  console.log('WebSocket fechado.');
});

ws.on('error', (err) => {
  console.error('Erro no WebSocket:', err);
}); 