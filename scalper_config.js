module.exports = {
  SMA_FAST: 20,
  SMA_SLOW: 60,
  VOL_MULT: 1.5,
  IMBAL_TH: 0.6,
  VWAP_MIN: 0.003,
  VWAP_K: 0.6,
  ATR_BE: 0.25,   // move stop
  RISK_R: 0.25,   // stop = 0.25*ATR
  TP_PCT: 0.004,  // 0.4 %
  HOLD_WINDOWS: [
    { from: '15:40', to: '16:10', tz: 'America/New_York' }
  ]
}; 