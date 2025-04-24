// backtest_scalping.js
// Backtest do scalping engine usando candles de 1m e lógica real do backend
const fs = require('fs');
const path = require('path');
const { getScalpingDecision, calculateATR1m } = require('./scalper');

const inputFile = process.argv[2] || 'candles1m_btc.json';
if (!fs.existsSync(inputFile)) {
  console.error('Arquivo não encontrado:', inputFile);
  process.exit(1);
}

const candles = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

function calcVWAP(candles) {
  if (!candles || candles.length === 0) return null;
  let sumPV = 0, sumV = 0;
  for (const c of candles) {
    if (c && c.close && c.volume) {
      sumPV += c.close * c.volume;
      sumV += c.volume;
    }
  }
  return sumV > 0 ? sumPV / sumV : null;
}

function calcRollingScore(candles, minutes = 3) {
  if (!candles || candles.length < minutes) return null;
  const last = candles.at(-1);
  const prev = candles.at(-minutes);
  if (!last || !prev || !prev.close) return null;
  return ((last.close - prev.close) / prev.close) * 100;
}

// Simular deltaBook5s (usando apenas o preço, pois não temos book real)
function calcDeltaBook5s(candles, i) {
  if (i < 5) return 0;
  return candles[i].close - candles[i - 5].close;
}

let stats = { BUY: 0, SELL: 0, HOLD: 0 };
let reasons = {};
let lastBuyPrice = null;
let pnl = 0;

for (let i = 59; i < candles.length; i++) {
  const candles1m = candles.slice(i - 59, i + 1);
  const window5m = candles.slice(i - 4, i + 1);
  const vwap5m = calcVWAP(window5m);
  const atr1m = calculateATR1m(candles1m);
  const lastCandle = candles[i];
  const atr1m_pct = atr1m && lastCandle.close ? atr1m / lastCandle.close : 0;
  // deltaBook5s: diferença do preço de fechamento atual para 5 candles atrás
  const deltaBook5s = i >= 5 ? lastCandle.close - candles[i - 5].close : 0;
  // rollingScore: variação percentual dos últimos 3 candles
  const rollingScore = i >= 2 ? ((lastCandle.close - candles[i - 2].close) / candles[i - 2].close) * 100 : 0;
  const ctx = {
    candles1m,
    vwap5m,
    atr1m,
    atr1m_pct,
    deltaBook5s,
    rollingScore,
    orderbook: null // mock para backtest
  };
  const decisionObj = getScalpingDecision(ctx);
  const decision = decisionObj.decision;
  stats[decision] = (stats[decision] || 0) + 1;
  if (decision === 'HOLD') {
    reasons[decisionObj.reason] = (reasons[decisionObj.reason] || 0) + 1;
  }
  // Simulação PnL simples: compra/venda alternada
  if (decision === 'BUY' && lastBuyPrice === null) {
    lastBuyPrice = lastCandle.close;
  }
  if (decision === 'SELL' && lastBuyPrice !== null) {
    pnl += lastCandle.close - lastBuyPrice;
    lastBuyPrice = null;
  }
}

console.log('Backtest SCALPING ENGINE v1.2:');
console.log('Total candles:', candles.length);
console.log('BUY:', stats.BUY, 'SELL:', stats.SELL, 'HOLD:', stats.HOLD);
console.log('PnL teórico (simples):', pnl.toFixed(2));
console.log('Motivos de HOLD:', reasons); 