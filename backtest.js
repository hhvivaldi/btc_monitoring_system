// backtest.js
// Backtest simples do ENGINE 2.0 usando candles de 1h
const fs = require('fs');

const inputFile = process.argv[2] || 'candles1h_btc.json';
if (!fs.existsSync(inputFile)) {
  console.error('Arquivo não encontrado:', inputFile);
  process.exit(1);
}

const candles = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// Função de decisão simplificada (exemplo)
function engine2Decision(candle, prevCandle) {
  // Exemplo: BUY se fechamento maior que abertura, SELL se menor, HOLD se igual
  if (candle.close > candle.open) return 'BUY';
  if (candle.close < candle.open) return 'SELL';
  return 'HOLD';
}

let stats = { BUY: 0, SELL: 0, HOLD: 0 };
let lastBuyPrice = null;
let lastSellPrice = null;
let pnl = 0;

candles.forEach((candle, i) => {
  const prev = i > 0 ? candles[i - 1] : null;
  const decision = engine2Decision(candle, prev);
  stats[decision]++;
  // Simulação PnL simples: compra/venda alternada
  if (decision === 'BUY' && lastBuyPrice === null) {
    lastBuyPrice = candle.close;
  }
  if (decision === 'SELL' && lastBuyPrice !== null) {
    pnl += candle.close - lastBuyPrice;
    lastBuyPrice = null;
  }
});