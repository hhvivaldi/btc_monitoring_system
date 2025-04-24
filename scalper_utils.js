const moment = require('moment-timezone');
const SCALP_CFG = require('./scalper_config');

function sma(arr, len) {
  if (!arr || arr.length < len) return null;
  const slice = arr.slice(-len);
  if (typeof slice[0] === 'object' && slice[0].close !== undefined) {
    // Array de candles
    return slice.reduce((a, c) => a + c.close, 0) / len;
  }
  // Array de números
  return slice.reduce((a, b) => a + b, 0) / len;
}

function vwapDev(price, vwap) {
  if (!price || !vwap) return null;
  return (price - vwap) / vwap;
}

function isForbiddenTime(now = new Date()) {
  // Verifica janelas de exclusão (ex: 15:40-16:10 NY)
  for (const win of SCALP_CFG.HOLD_WINDOWS) {
    const mNow = moment.tz(now, win.tz);
    const [fromH, fromM] = win.from.split(':').map(Number);
    const [toH, toM] = win.to.split(':').map(Number);
    const from = mNow.clone().hour(fromH).minute(fromM).second(0);
    const to = mNow.clone().hour(toH).minute(toM).second(0);
    if (mNow.isBetween(from, to, null, '[)')) return true;
  }
  return false;
}

function getImbalance(depth = 3, orderbook = null) {
  // MOCK para backtest: retorna 0 sempre
  // Em produção, usar orderbook real
  if (!orderbook || !orderbook.bids || !orderbook.asks) return 0;
  const bids = orderbook.bids.slice(0, depth).reduce((a, b) => a + b[1], 0);
  const asks = orderbook.asks.slice(0, depth).reduce((a, b) => a + b[1], 0);
  if (bids + asks === 0) return 0;
  return (bids - asks) / (bids + asks);
}

module.exports = {
  sma,
  vwapDev,
  isForbiddenTime,
  getImbalance
}; 