// csv_to_json.js
// Script para converter candles CSV da Binance para JSON
const fs = require('fs');

const csvFile = process.argv[2];
const jsonFile = process.argv[3] || 'candles1m_btc.json';

if (!csvFile) {
  console.error('Uso: node csv_to_json.js <arquivo.csv> [saida.json]');
  process.exit(1);
}

const lines = fs.readFileSync(csvFile, 'utf8').split('\n').filter(Boolean);

const result = lines.map(line => {
  const [
    openTime, open, high, low, close, volume,
    closeTime, quoteAssetVolume, numberOfTrades,
    takerBuyBaseAssetVolume, takerBuyQuoteAssetVolume, ignore
  ] = line.split(',');

  return {
    timestamp: Math.floor(Number(openTime) / 1000), // em segundos
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume)
  };
});

fs.writeFileSync(jsonFile, JSON.stringify(result, null, 2));
console.log(`Convertido para ${jsonFile} com ${result.length} candles.`); 