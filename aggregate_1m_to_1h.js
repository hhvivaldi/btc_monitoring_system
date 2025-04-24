// aggregate_1m_to_1h.js
// Script para agregar candles de 1m em candles de 1h
const fs = require('fs');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || 'candles1h_btc.json';

if (!inputFile) {
  console.error('Uso: node aggregate_1m_to_1h.js <candles1m.json> [saida1h.json]');
  process.exit(1);
}

const candles1m = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

const candles1h = [];
let currentHour = null;
let hourCandles = [];

candles1m.forEach(candle => {
  // Timestamp em segundos, arredondar para o início da hora
  const hourTs = candle.timestamp - (candle.timestamp % 3600);
  if (currentHour === null) currentHour = hourTs;
  if (hourTs !== currentHour) {
    if (hourCandles.length > 0) {
      candles1h.push({
        timestamp: currentHour,
        open: hourCandles[0].open,
        high: Math.max(...hourCandles.map(c => c.high)),
        low: Math.min(...hourCandles.map(c => c.low)),
        close: hourCandles[hourCandles.length - 1].close,
        volume: hourCandles.reduce((a, c) => a + c.volume, 0)
      });
    }
    currentHour = hourTs;
    hourCandles = [];
  }
  hourCandles.push(candle);
});
// Última hora
if (hourCandles.length > 0) {
  candles1h.push({
    timestamp: currentHour,
    open: hourCandles[0].open,
    high: Math.max(...hourCandles.map(c => c.high)),
    low: Math.min(...hourCandles.map(c => c.low)),
    close: hourCandles[hourCandles.length - 1].close,
    volume: hourCandles.reduce((a, c) => a + c.volume, 0)
  });
}

fs.writeFileSync(outputFile, JSON.stringify(candles1h, null, 2));
console.log(`Gerado ${outputFile} com ${candles1h.length} candles de 1h.`); 