const fs = require('fs');
const path = require('path');
const parse = require('csv-parse/sync');
const { calculateATR15m, calculateVWAP15m, simpleMA } = require('./server');

// Thresholds calibráveis
const ATR_BREAKOUT = 1.2;
const VOL_MULT = 1.3;
const LOOKBACK = 3;

const inputFiles = process.argv.slice(2);
if (inputFiles.length === 0) {
  console.error('Uso: node backtest_decision_v3.js arquivo1.csv [arquivo2.csv ...]');
  process.exit(1);
}

let totalStats = { BUY: 0, SELL: 0, HOLD: 0 };
let totalFails = { CONSISTENCY: 0 };
let allResults = [];

for (const csvFile of inputFiles) {
  if (!fs.existsSync(csvFile)) {
    console.error('Arquivo não encontrado:', csvFile);
    continue;
  }
  const csv = fs.readFileSync(csvFile, 'utf8');
  const records = parse.parse(csv, { columns: true, skip_empty_lines: true });
  const candles = records.map(r => ({
    timestamp: Number(r.open_time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume)
  }));
  const candles15m = { BTC: [] };
  const results = [];
  const failStats = { CONSISTENCY: 0 };

  for (let i = 0; i < candles.length; i++) {
    candles15m['BTC'].push(candles[i]);
    if (candles15m['BTC'].length >= 21) {
      global.latestMarketData = global.latestMarketData || {};
      global.latestMarketData['Nasdaq'] = { chg_pct: 0 };
      global.latestMarketData['S_P500'] = { chg_pct: 0 };
      global.latestMarketData['VIX'] = { chg_pct: 0 };
      global.latestMarketData['MOVE'] = { chg_pct: 0 };
      global.latestMarketData['HY_Spread'] = { chg_pct: 0 };
      global.latestSignals = global.latestSignals || {};
      global.latestSignals.BTC = global.latestSignals.BTC || { whale_flow: 0 };
      // Lookback de 3 velas
      let atr = calculateATR15m('BTC', 14);
      let volumes = candles15m['BTC'].map(c => c.volume);
      let avgVol20 = simpleMA(volumes, 20);
      let vwap = calculateVWAP15m('BTC', 20);
      let aboveVWAP = 0, belowVWAP = 0;
      let recent = [];
      let hits = 0;
      for (let j = 0; j < LOOKBACK; j++) {
        const c = candles15m['BTC'][candles15m['BTC'].length - 1 - j];
        if (!c) continue;
        const range = c.high - c.low;
        const atrHit = atr && range > atr * ATR_BREAKOUT;
        const volHit = c.volume > avgVol20 * VOL_MULT;
        if (atrHit && volHit) hits++;
        if (c.close > vwap) aboveVWAP++;
        if (c.close < vwap) belowVWAP++;
        recent.push({ range, volume: c.volume, close: c.close, atrHit, volHit });
      }
      // Momentum: SMA5 > SMA20
      let sma5 = simpleMA(candles15m['BTC'].slice(-5).map(c => c.close), 5);
      let sma20 = simpleMA(candles15m['BTC'].slice(-20).map(c => c.close), 20);
      let momentum = 0;
      if (sma5 !== null && sma20 !== null) {
        if (sma5 > sma20) momentum = 1;
        else if (sma5 < sma20) momentum = -1;
      }
      // marketSignal reforço
      const nasdaq = 0, sp500 = 0, vix = 0, move = 0, hy = 0;
      let idxScore = 0, idxWeight = 0;
      if (nasdaq > 0 && sp500 > 0) { idxScore += 1; idxWeight += 1; }
      if (vix > 0.5 || move > 0.5) { idxScore -= 1; idxWeight += 1; }
      if (hy > 0.5) { idxScore -= 1; idxWeight += 1; }
      const marketSignal = idxWeight > 0 ? idxScore / idxWeight : 0;
      // Score final
      let score = 0;
      if (aboveVWAP > belowVWAP) score++;
      if (belowVWAP > aboveVWAP) score--;
      score += momentum;
      if (marketSignal > 0) score++;
      if (marketSignal < 0) score--;
      let decision = 'HOLD', reason = 'no-signal';
      let failReasons = [];
      // BUY/SELL se pelo menos 2/3 últimas velas violarem ATR E volume
      if (hits >= 2) {
        if (score > 0) { decision = 'BUY'; reason = 'buy+score'; }
        else if (score < 0) { decision = 'SELL'; reason = 'sell+score'; }
        else { decision = 'BUY'; reason = 'buy'; } // default BUY se empate
      } else {
        failStats.CONSISTENCY++; totalFails.CONSISTENCY++; failReasons.push('CONSISTENCY');
      }
      results.push({
        i,
        timestamp: candles15m['BTC'][candles15m['BTC'].length - 1].timestamp,
        decision,
        reason,
        breakdown: { hits, momentum, score, aboveVWAP, belowVWAP, marketSignal, sma5, sma20, recent },
        failReasons,
        close: candles15m['BTC'][candles15m['BTC'].length - 1].close
      });
      allResults.push({
        timestamp: candles15m['BTC'][candles15m['BTC'].length - 1].timestamp,
        decision,
        close: candles15m['BTC'][candles15m['BTC'].length - 1].close
      });
      totalStats[decision] = (totalStats[decision] || 0) + 1;
      if (decision === 'HOLD') {
        console.log(`[${path.basename(csvFile)}]`, new Date(candles15m['BTC'][candles15m['BTC'].length - 1].timestamp).toISOString(), 'HOLD', 'fail:', failReasons.join(','));
      }
    }
  }
  const stats = { BUY: 0, SELL: 0, HOLD: 0 };
  results.forEach(r => { stats[r.decision] = (stats[r.decision] || 0) + 1; });
  console.log(`\nArquivo: ${csvFile}`);
  console.log('Resumo sinais:', stats);
  console.log('Fails por critério:', failStats);
  console.log('Primeiras decisões:');
  results.slice(0, 10).forEach(r => {
    console.log(new Date(r.timestamp).toISOString(), r.decision, r.reason, r.failReasons);
  });
  console.log('Últimas decisões:');
  results.slice(-10).forEach(r => {
    console.log(new Date(r.timestamp).toISOString(), r.decision, r.reason, r.failReasons);
  });
}
console.log('\nResumo total de todos os arquivos:');
console.log('Total sinais:', totalStats);
console.log('Total fails por critério:', totalFails);

// --- PnL Simulado ---
let position = null;
let entryPrice = 0;
let trades = [];
let pnl = 0;
for (let i = 0; i < allResults.length; i++) {
  const { decision, close, timestamp } = allResults[i];
  if (decision === 'BUY' && position !== 'LONG') {
    if (position === 'SHORT') {
      pnl += entryPrice - close;
      trades.push({ type: 'COVER', price: close, timestamp });
    }
    position = 'LONG';
    entryPrice = close;
    trades.push({ type: 'BUY', price: close, timestamp });
  } else if (decision === 'SELL' && position !== 'SHORT') {
    if (position === 'LONG') {
      pnl += close - entryPrice;
      trades.push({ type: 'SELL', price: close, timestamp });
    }
    position = 'SHORT';
    entryPrice = close;
    trades.push({ type: 'SHORT', price: close, timestamp });
  }
}
if (position === 'LONG') {
  pnl += allResults[allResults.length - 1].close - entryPrice;
  trades.push({ type: 'CLOSE_LONG', price: allResults[allResults.length - 1].close, timestamp: allResults[allResults.length - 1].timestamp });
}
if (position === 'SHORT') {
  pnl += entryPrice - allResults[allResults.length - 1].close;
  trades.push({ type: 'CLOSE_SHORT', price: allResults[allResults.length - 1].close, timestamp: allResults[allResults.length - 1].timestamp });
}
console.log('\nResumo PnL simulado:');
console.log('Total trades:', trades.length);
console.log('PnL total (em pontos):', pnl.toFixed(2)); 