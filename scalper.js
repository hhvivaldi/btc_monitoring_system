// scalper.js
// Scalping Engine: processa candles de 1min, book pressure e gera sinais de scalping

const SCALPER_HISTORY_SIZE = 10;
const SCALPER_TRADE_LIMIT_PER_HOUR = 3;
const SCALPER_STOP_LOSS = 0.002; // 0.2%
const SCALPER_TAKE_PROFIT = 0.003; // 0.3%

const SCALP_CFG = require('./scalper_config');
const { sma, vwapDev, isForbiddenTime, getImbalance } = require('./scalper_utils');
const { CFG } = require('./scalperConfig');

let scalperSignals = [];
let tradesThisHour = 0;
let lastTradeTimestamp = 0;

function calculateATR1m(candles) {
    if (!candles || candles.length < 15) return null;
    let trs = [];
    for (let i = candles.length - 14; i < candles.length; i++) {
        const c = candles[i];
        const prev = candles[i - 1];
        if (!c || !prev) continue;
        const tr = Math.max(
            c.high - c.low,
            Math.abs(c.high - prev.close),
            Math.abs(c.low - prev.close)
        );
        trs.push(tr);
    }
    if (trs.length < 14) {
        return null;
    }
    return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function getAvgVolume(candles, n = 20) {
    if (!candles || candles.length < n) return 0;
    const recent = candles.slice(-n);
    return recent.reduce((a, b) => a + (b.volume || 0), 0) / recent.length;
}

function clamp(x, a, b) {
    return Math.max(a, Math.min(x, b));
}

function getScalpingDecision(ctx) {
  const { candles1m, vwap5m, atr1m, rollingScore, deltaBook5s, orderbook } = ctx;
  const last = candles1m.at(-1);
  if (!last || !vwap5m || !atr1m) return { decision: 'HOLD', reason: 'missing-data' };

  // Volume filter
  const avgVol20 = sma(candles1m.map(c => c.volume), 20);
  if (last.volume < CFG.VOL_MULT * avgVol20) {
    return { decision: 'HOLD', reason: 'low-vol', volume: last.volume, avgVol20, deltaBook5s, rollingScore };
  }

  // Book Imbalance
  const imb = getImbalance(3, orderbook);
  if (Math.abs(imb) < CFG.IMB_TH) {
    return { decision: 'HOLD', reason: 'imbalance-fail', imb, deltaBook5s, rollingScore };
  }

  // Rolling Score
  if (typeof rollingScore !== 'number' || Math.abs(rollingScore) < CFG.ROLL_TH) {
    return { decision: 'HOLD', reason: 'rolling-fail', rollingScore, deltaBook5s };
  }

  // VWAP deviation
  const vwapDevRatio = vwapDev(last.close, vwap5m);
  if (Math.abs(vwapDevRatio) < CFG.VWAP_DEV) {
    return { decision: 'HOLD', reason: 'vwapDev-fail', vwapDev: vwapDevRatio, deltaBook5s, rollingScore };
  }

  // Breakout ATR
  const breakoutDiff = last.close - last.open;
  if (breakoutDiff >= atr1m * 1.0) {
    return {
      decision: 'BUY',
      reason: 'breakout-buy',
      stop: last.close - CFG.STOP_ATR * atr1m,
      take: last.close + CFG.TAKE_PCT * last.close,
      volume: last.volume, imb, rollingScore, vwapDev: vwapDevRatio, breakoutDiff, deltaBook5s
    };
  }
  if (breakoutDiff <= -atr1m * 1.0) {
    return {
      decision: 'SELL',
      reason: 'breakout-sell',
      stop: last.close + CFG.STOP_ATR * atr1m,
      take: last.close - CFG.TAKE_PCT * last.close,
      volume: last.volume, imb, rollingScore, vwapDev: vwapDevRatio, breakoutDiff, deltaBook5s
    };
  }

  return {
    decision: 'HOLD',
    reason: 'breakout-fail',
    volume: last.volume, imb, rollingScore, vwapDev: vwapDevRatio, breakoutDiff, deltaBook5s
  };
}

function checkScalperSignal({ candles1m, bookPressureRaw }) {
    if (!candles1m || candles1m.length < 20) return { signal: 'HOLD', reason: 'not_enough_data' };
    const last = candles1m[candles1m.length - 1];
    const prev = candles1m[candles1m.length - 2];
    if (!last || !prev) return { signal: 'HOLD', reason: 'no_last_candle' };
    const chg_pct = prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
    const avgVol = getAvgVolume(candles1m, 20);
    const atr1m = calculateATR1m(candles1m);
    let trigger = null;
    let params = { chg_pct, volume: last.volume, avgVol, atr1m, bookPressureRaw };
    // Gatilho 1: Momentum 1min
    if (chg_pct >= 0.3 && last.volume >= 2 * avgVol) {
        trigger = 'momentum_1m_buy';
        return { signal: 'BUY', trigger, params };
    }
    if (chg_pct <= -0.3 && last.volume >= 2 * avgVol) {
        trigger = 'momentum_1m_sell';
        return { signal: 'SELL', trigger, params };
    }
    // Gatilho 2: Breakout ATR 1min
    if (atr1m !== null) {
        if ((last.close - prev.close) >= atr1m * 1.0) {
            trigger = 'breakout_atr1m_buy';
            return { signal: 'BUY', trigger, params };
        }
        if ((last.close - prev.close) <= -atr1m * 1.0) {
            trigger = 'breakout_atr1m_sell';
            return { signal: 'SELL', trigger, params };
        }
    }
    // Gatilho 3: Book pressure
    if (typeof bookPressureRaw === 'number') {
        if (bookPressureRaw > 0.7) {
            trigger = 'book_pressure_buy';
            return { signal: 'BUY', trigger, params };
        }
        if (bookPressureRaw < -0.7) {
            trigger = 'book_pressure_sell';
            return { signal: 'SELL', trigger, params };
        }
    }
    return { signal: 'HOLD', trigger: 'none', params };
}

function canTradeNow() {
    const now = Date.now();
    // Limite de 3 trades por hora
    if (lastTradeTimestamp && now - lastTradeTimestamp > 60 * 60 * 1000) {
        tradesThisHour = 0;
    }
    return tradesThisHour < SCALPER_TRADE_LIMIT_PER_HOUR;
}

function registerTrade() {
    tradesThisHour++;
    lastTradeTimestamp = Date.now();
}

function pushScalperSignal(signalObj) {
    scalperSignals.push({ ...signalObj, timestamp: Date.now() });
    if (scalperSignals.length > SCALPER_HISTORY_SIZE) scalperSignals.shift();
}

function getScalperState() {
    return {
        last_signal: scalperSignals[scalperSignals.length - 1] || null,
        history: [...scalperSignals],
        trades_last_hour: tradesThisHour
    };
}

module.exports = {
    checkScalperSignal,
    canTradeNow,
    registerTrade,
    pushScalperSignal,
    getScalperState,
    getScalpingDecision,
    calculateATR1m,
    SCALPER_STOP_LOSS,
    SCALPER_TAKE_PROFIT
}; 