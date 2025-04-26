// script para backtest da lógica de scalping usando o engine de scalper.js

const fs = require('fs');
const path = require('path');
const { getScalpingDecision, calculateATR1m } = require('../scalper');

// carrega candles de 1m (array de {timestamp, open, high, low, close, volume})
const dataPath = path.join(__dirname, 'candles1m_btc.json');
if (!fs.existsSync(dataPath)) {
  console.error('Arquivo de candles não encontrado em', dataPath);
  process.exit(1);
}
const candles = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// configura backtest
let stats = { BUY: 0, SELL: 0, HOLD: 0 };
let pnl = 0, lastBuyPrice = null;

// itera começando após janelas iniciais
for (let i = 59; i < candles.length; i++) {
  const window1m = candles.slice(i - 59, i + 1);
  const window5m = candles.slice(i - 4, i + 1);
  const atr1m = calculateATR1m(window1m);

  // obtém decisão via scalper.js
  const decisionObj = getScalpingDecision({
    candles1m:   window1m,
    vwap5m:      null,      // se disponível, passar valor real
    atr1m:       atr1m,
    rollingScore: 0,        // implementar se necessário
    deltaBook5s:  0,        // implementar se necessário
    orderbook:    null
  });

  const d = decisionObj.decision;
  stats[d] = (stats[d] || 0) + 1;

  // simula PnL para buy/sell alternados
  const price = window1m[window1m.length - 1].close;
  if (d === 'BUY' && lastBuyPrice === null) {
    lastBuyPrice = price;
  }
  if (d === 'SELL' && lastBuyPrice !== null) {
    pnl += price - lastBuyPrice;
    lastBuyPrice = null;
  }
}

// resultados do backtest
console.log('Backtest Scalping Results:');
console.log('Stats:', stats);
console.log('PnL:', pnl.toFixed(2)); 