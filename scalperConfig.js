// scalperConfig.js
exports.CFG = {
  VOL_MULT:   1.2,    // volume mínimo = 1.2× média de 20 candles
  IMB_TH:     0.30,   // book imbalance threshold
  ROLL_TH:    0.20,   // rollingScore threshold
  VWAP_DEV:   0.0025, // desvio VWAP = 0.25%
  STOP_ATR:   0.30,   // stop‑loss = 0.30 × ATR 1m
  TAKE_PCT:   0.0035  // take‑profit = 0.35% do preço
}; 