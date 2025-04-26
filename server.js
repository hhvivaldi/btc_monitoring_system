// server.js

const express = require('express');
const path = require('path');
const TradingView = require('@mathieuc/tradingview');
const EventEmitter = require('events'); // Import EventEmitter
const { InfluxDB } = require('@influxdata/influxdb-client');
const axios = require('axios');
const fs = require('fs');
const moment = require('moment-timezone');
const marketCalendars = require('./market_calendars.json');
const scalper = require('./scalper');
const WebSocket = require('ws'); // Adiciona WebSocket para Binance

const app = express();
const port = 5001;

// --- Configuration ---
app.use(express.static(path.join(__dirname, 'static')));
// app.use(express.static(path.join(__dirname, 'templates')));
app.use(express.json()); // Needed for potential future interactions

// --- Global State ---
const marketUpdateEmitter = new EventEmitter(); // Emitter for market data changes
let sseClients = []; // Array to hold connected SSE client response objects
let latestMarketData = {}; // Store the most recent full data state
let latestSignals = {}; // Store the most recent calculated signals
const previousClosesStore = {}; // Store previous day's closes

// Novo: Histórico de preços do BTC para cálculo de variação de 1h
let btcPrice1hHistory = []; // [{ timestamp: Date, price: Number }]

// Novo: Armazenar último timestamp de candle/barra para cada ativo
const lastCandleTimestamp = {};

// Buffers de candles para cada timeframe e símbolo
const candles1h = {};
const candles15m = {};
const candles5m = {}; // Novo: buffer de 5 minutos
const candles1m = {};
const candles1d = {};
// Exemplo de uso: candles1h['BTC'] = [{timestamp, open, high, low, close, volume}, ...]

// Histórico de preços do BVOL24H para cálculo de variação
let bvol24hHistory = [];

// --- TradingView Setup ---
const symbols = {
    Nasdaq: 'IG:NASDAQ',
    S_P500: 'SPX', // alterado de 'SP:SPX' para 'SPX'
    VIX: 'VIX', // alterado de 'TVC:VIX' para 'VIX'
    DXY: 'DXY', // alterado de 'TVC:DXY' para 'DXY'
    Gold: 'OANDA:XAUUSD',
    CrudeOil: 'TVC:USOIL',
    BTC: 'COINBASE:BTCUSD',
    RUT: 'AMEX:IWM', // alterado de 'AMEX:IWM' para 'RUT'
    T10Y2Y: 'T10Y2Y',
    HY_Spread: 'FRED:BAMLH0A0HYM2',
    MOVE: 'MOVE',
    BTC_Dom: 'CRYPTOCAP:BTC.D',
    BVOL24H: 'BVOL24H:BITMEX'
};
// Alternative symbols (Not fully implemented for SSE yet, but kept for structure)
const alternativeSymbols = {
    VIX: ['INDEX:VIX', 'CBOE:VIX', 'VIX']
};
const symbolKeys = [
    'Nasdaq',
    'S_P500',
    'RUT',
    'VIX',
    'DXY',
    'Gold',
    'CrudeOil',
    'T10Y2Y',
    'HY_Spread',
    'MOVE',
    'BTC_Dom',
    'BVOL24H',
    'BTC'
];
const inverted_symbols = ['VIX', 'DXY', 'HY_Spread', 'MOVE'];
const ignore_for_overall_score = ['BTC', 'BTC_Dom', 'BVOL24H'];
const weights = {
    Nasdaq: 1.2,
    S_P500: 1.2,
    RUT: 1.0,
    VIX: 1.5,
    DXY: 1.5,
    Gold: 0.8,
    CrudeOil: 0.8,
    T10Y2Y: 1.0,
    HY_Spread: 1.0,
    MOVE: 1.0
    // BTC_Dom e BVOL24H não entram no score global
};

let tvClient = null;
let clientReady = false;
const charts = {}; // Object to hold persistent chart sessions

// --- !! WARNING: HARDCODED CREDENTIALS - VERY INSECURE !! ---
const SESSIONID = "k04w8ejw0jhhx12ndza8isg6kkvuzqut";
const SIGNATURE = "v3:1ecRmC74psRykWm/F0+OLUCKAkzAZC9/csx7F0dBeQI=";
// --- !! Consider using environment variables instead !! ---

// --- InfluxDB Setup ---
const INFLUX_URL = 'https://eu-central-1-1.aws.cloud2.influxdata.com'; // Cloud URL
const INFLUX_TOKEN = '3lJ_Z6XEWjVB9r7zbm7mZpQf6U-2b8WIVfcGEue6Q8WrhDjQVlXJwsZ49Vdj83FmNvqeuPikoSaZ8ZUw9QR-fQ=='; // Token correto
const INFLUX_ORG = 'Hermano'; // Org correta
const INFLUX_BUCKET = 'funding_oi'; // bucket onde armazena funding/oi
const influxDB = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });

const STATE_FILE = path.join(__dirname, 'state.json');

const CANDLES_FILE = path.join(__dirname, 'candles1m_btc.json');

// --- Histórico de scalp_score/momentum ---
const SCALP_HISTORY_FILE = path.join(__dirname, 'scalp_history.jsonl');
function saveScalpHistory(entry) {
    fs.appendFile(SCALP_HISTORY_FILE, JSON.stringify(entry) + '\n', err => {
        if (err) console.error('Erro ao salvar scalp_history:', err);
    });
}
function loadScalpHistory(periodMinutes = 1440) {
    if (!fs.existsSync(SCALP_HISTORY_FILE)) return [];
    const now = Date.now();
    const minTimestamp = now - periodMinutes * 60 * 1000;
    return fs.readFileSync(SCALP_HISTORY_FILE, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter(e => e && new Date(e.timestamp).getTime() >= minTimestamp);
}

// Carregar estado salvo ao iniciar
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            if (state.latestMarketData) latestMarketData = state.latestMarketData;
            if (state.btcPrice1hHistory) btcPrice1hHistory = state.btcPrice1hHistory;
            if (state.lastCandleTimestamp) Object.assign(lastCandleTimestamp, state.lastCandleTimestamp);
            if (state.candles1h) Object.assign(candles1h, state.candles1h);
            if (state.candles15m) Object.assign(candles15m, state.candles15m);
            if (state.candles5m) Object.assign(candles5m, state.candles5m); // Novo
            if (state.candles1m) Object.assign(candles1m, state.candles1m);
            if (state.bvol24hHistory) bvol24hHistory = state.bvol24hHistory;
            console.log('Estado restaurado de state.json');
        }
    } catch (e) {
        console.error('Erro ao carregar state.json:', e);
    }
}

// Salvar estado periodicamente e ao shutdown
function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({
            latestMarketData,
            btcPrice1hHistory,
            lastCandleTimestamp,
            candles1h,
            candles15m,
            candles5m, // Novo
            candles1m,
            bvol24hHistory
        }, null, 2));
    } catch (e) {
        console.error('Erro ao salvar state.json:', e);
    }
}
setInterval(saveState, 60 * 1000); // Salva a cada 1 min
process.on('SIGINT', () => { saveState(); process.exit(); });
process.on('SIGTERM', () => { saveState(); process.exit(); });

// Carregar estado ao iniciar
loadState();

// Restaurar candles1m['BTC'] do arquivo, se existir
if (fs.existsSync(CANDLES_FILE)) {
    try {
        candles1m['BTC'] = JSON.parse(fs.readFileSync(CANDLES_FILE, 'utf8'));
        console.log(`Candles BTC restaurados de ${CANDLES_FILE}:`, candles1m['BTC'].length, 'candles');
    } catch (e) {
        console.error('Erro ao restaurar candles1m BTC:', e);
        candles1m['BTC'] = [];
    }
}

// Salvar candles1m['BTC'] a cada 1 minuto
setInterval(() => {
    if (candles1m['BTC'] && candles1m['BTC'].length > 0) {
        fs.writeFileSync(CANDLES_FILE, JSON.stringify(candles1m['BTC'], null, 2));
    }
}, 60 * 1000);

// Também salve ao encerrar
process.on('SIGINT', () => {
    if (candles1m['BTC'] && candles1m['BTC'].length > 0) {
        fs.writeFileSync(CANDLES_FILE, JSON.stringify(candles1m['BTC'], null, 2));
    }
    process.exit();
});
process.on('SIGTERM', () => {
    if (candles1m['BTC'] && candles1m['BTC'].length > 0) {
        fs.writeFileSync(CANDLES_FILE, JSON.stringify(candles1m['BTC'], null, 2));
    }
    process.exit();
});

// --- TradingView Initialization and Monitoring ---

async function initializeTradingView() {
    if (clientReady) return tvClient;
    try {
        console.log("Initializing TradingView client (Authenticated with hardcoded credentials)...");
        const client = new TradingView.Client({
            token: SESSIONID,
            signature: SIGNATURE,
        });
        client.onError((...err) => {
            console.error('TradingView Client Error:', ...err);
            clientReady = false;
            tvClient = null;
            // Optionally: Attempt re-initialization or notify SSE clients
            try { marketUpdateEmitter.emit('error', { type: 'tvClient', message: 'TradingView client connection error.' }); } catch (e) { console.error('Global chart error:', e); }
        });
        tvClient = client;
        clientReady = true;
        console.log("TradingView client instance created (Authenticated with hardcoded credentials).");
        return tvClient;
    } catch (error) {
        console.error("Failed to initialize TradingView client:", error);
        clientReady = false;
        tvClient = null;
        return null;
    }
}

async function fetchPreviousCloses() {
    console.log("Attempting to fetch previous day's closes...");
    if (!tvClient || !clientReady) {
        console.warn("Client not ready for fetching previous closes. Trying init...");
        await initializeTradingView();
        if (!tvClient) {
             console.error("Client could not be initialized. Cannot fetch previous closes.");
             return; // Exit if client failed
        }
    }

    // Clear existing store before fetching
    Object.keys(previousClosesStore).forEach(key => delete previousClosesStore[key]);
    console.log("Cleared previousClosesStore.");

    const promises = [];
    for (const key of symbolKeys) {
        if (key === 'BVOL24H') continue; // Não criar chart para BVOL24H
        const tvSymbol = symbols[key];

        const fetchPromise = new Promise((resolve) => {
            let chart = null;
            let resolved = false;
            const timeoutDuration = 15000; // Longer timeout

            const timeoutHandle = setTimeout(() => {
                if (!resolved) {
                    console.warn(` -> Timeout (${timeoutDuration}ms) waiting for previous close for ${key}.`);
                    resolved = true;
                    resolve({ key, prevClose: null });
                    if (chart) chart.delete(); // Clean up chart on timeout
                }
            }, timeoutDuration);

            try {
                console.log(` -> Creating DAILY chart session for previous close: ${key} (${tvSymbol})`);
                chart = new tvClient.Session.Chart();
                chart.setMarket(tvSymbol, { timeframe: 'D', range: 2 });

                 chart.onError((...err) => {
                     console.error(` -> Daily Chart Error for ${key}:`, ...err);
                     if (!resolved) {
                         resolved = true;
                         clearTimeout(timeoutHandle);
                         resolve({ key, prevClose: null });
                         if (chart) chart.delete(); // Clean up chart on error
                     }
                 });

                 chart.onUpdate(() => {
                     if (!resolved && chart.periods && chart.periods.length >= 1) {
                          let targetIndex = (chart.periods.length > 1) ? 1 : 0;
                          const previousDayBar = chart.periods[targetIndex];

                          // console.log(` -> DETAILED Previous Day Bar for ${key} (Index ${targetIndex}):`, JSON.stringify(previousDayBar, null, 2));

                          if (previousDayBar && typeof previousDayBar.close === 'number') {
                              const prevClose = previousDayBar.close;
                              console.log(` -> Previous close found for ${key}: ${prevClose}`);
                              resolved = true;
                              clearTimeout(timeoutHandle);
                              resolve({ key, prevClose: prevClose });
                          } else {
                              // If no close, wait briefly for potential further updates before giving up
                              console.warn(` -> No valid close in previous daily bar for ${key}. Waiting briefly.`);
                          }
                     } else if (!resolved) {
                          // console.log(` -> Daily onUpdate fired for ${key} but no periods data yet.`);
                     }
                     if (resolved && chart) chart.delete(); // Clean up chart once resolved
                 });

            } catch (error) {
                console.error(` -> Error creating daily chart session for ${key}:`, error);
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeoutHandle);
                    resolve({ key, prevClose: null });
                }
                if (chart) chart.delete(); // Clean up chart on exception
            }
        }); // End Promise

        promises.push(fetchPromise);
         await new Promise(resolve => setTimeout(resolve, 200)); // Stagger connection starts slightly more
    } // End loop

    console.log("Waiting for all previous close fetches...");
    const results = await Promise.all(promises);

    results.forEach(result => {
        if (result.prevClose !== null) {
            previousClosesStore[result.key] = result.prevClose;
        } else {
            console.warn(`Failed to get previous close for ${result.key}. Using null.`);
            previousClosesStore[result.key] = null; // Explicitly store null if failed
        }
    });
    console.log("Finished fetching previous day's closes. Store:", previousClosesStore);
    // Store initial data based *only* on previous closes before RT starts
    updateLatestDataWithInitialValues();
}

// NEW: Populate initial latestMarketData
function updateLatestDataWithInitialValues() {
    const bvolBackup = latestMarketData.BVOL24H;
    latestMarketData = {}; // Reset
    for (const key of symbolKeys) {
        if (key === 'BVOL24H') continue; // Não sobrescrever BVOL24H
        latestMarketData[key] = {
            price: null, // Will be filled by RT updates
            chg: null,
            chg_pct: null,
            prevClose: previousClosesStore[key] ?? null,
            last_update: Date.now()
        };
    }
    if (bvolBackup) latestMarketData.BVOL24H = bvolBackup;
    console.log("Initialized latestMarketData with previous closes:", latestMarketData);
    // Calculate initial signals based on this potentially incomplete data
    latestSignals = calculateSignals(latestMarketData);
    marketUpdateEmitter.emit('update', { type: 'full', data: latestSignals }); // Emit initial state
}


// NEW: Function to start and manage persistent real-time chart updates
async function startRealtimeMonitoring() {
    console.log("Starting real-time market monitoring...");
    if (!tvClient || !clientReady) {
        console.error("TradingView client not ready. Cannot start monitoring.");
        await initializeTradingView();
        if (!tvClient) return;
    }
    if (Object.keys(previousClosesStore).length < symbolKeys.length) {
        console.warn("Previous closes store seems incomplete. Fetching them first...");
        await fetchPreviousCloses();
        if (Object.keys(previousClosesStore).length < symbolKeys.length) {
             console.error("Still unable to fetch all previous closes. Real-time data might be inaccurate.");
        } else {
            console.log("Previous closes fetched successfully before starting RT.")
        }
    }
    // Limpar sessões antigas
    for (const key in charts) {
        try { charts[key].delete(); } catch (e) {}
        delete charts[key];
    }
    // --- INTRADAY SYMBOLS ---
    const INTRADAY_SYMBOLS = ['Nasdaq', 'S_P500', 'RUT', 'VIX', 'DXY', 'Gold', 'CrudeOil', 'BTC_Dom', 'BVOL24H', 'BTC'];
    for (const key of INTRADAY_SYMBOLS) {
        const tvSymbol = symbols[key];
        let previousClose = previousClosesStore[key] ?? null;
        const tf = '15';
        const chartKey = `${key}_${tf}`;
            const chart = new tvClient.Session.Chart();
        charts[chartKey] = chart;
        chart.setMarket(tvSymbol, { timeframe: tf });
            chart.onError((...err) => {
            // Remover log [DEBUG]
            try { marketUpdateEmitter.emit('error', { type: 'chart', symbol: key, timeframe: tf, message: `Chart error: ${err}` }); } catch (e) {}
            if (charts[chartKey]) { try { charts[chartKey].delete(); } catch(e){} delete charts[chartKey]; }
        });
            chart.onUpdate(() => {
                if (chart.periods && chart.periods.length > 0) {
                    const latestPeriod = chart.periods[0];
                    const currentPrice = latestPeriod.close ?? null;
                const candleTime = latestPeriod.time || latestPeriod.timestamp || null;
                let buffer = candles15m;
                if (!buffer[key]) buffer[key] = [];
                const last = buffer[key][buffer[key].length - 1];
                if (!last || last.timestamp !== candleTime) {
                    buffer[key].push({
                        timestamp: candleTime,
                        open: latestPeriod.open,
                        high: latestPeriod.max ?? latestPeriod.high,
                        low: latestPeriod.min ?? latestPeriod.low,
                        close: latestPeriod.close,
                        volume: latestPeriod.volume || 0
                    });
                    if (buffer[key].length > 200) buffer[key].shift();
                } else {
                    last.high = Math.max(last.high, latestPeriod.max ?? latestPeriod.high);
                    last.low = Math.min(last.low, latestPeriod.min ?? latestPeriod.low);
                    last.close = latestPeriod.close;
                    if (latestPeriod.volume) last.volume += latestPeriod.volume;
                }
                let chg = null, chg_pct = null;
                if (chart.periods.length > 1) previousClose = chart.periods[1].close;
                    if (currentPrice !== null && previousClose !== null && previousClose !== 0) {
                        chg = currentPrice - previousClose;
                        chg_pct = (chg / previousClose) * 100;
                    }
                    latestMarketData[key] = {
                        price: currentPrice,
                        chg: chg,
                        chg_pct: chg_pct,
                    prevClose: previousClose,
                    last_update: Date.now()
                    };
                    latestSignals = calculateSignals(latestMarketData);
                    marketUpdateEmitter.emit('update', { type: 'full', data: latestSignals });
                } else {
            }
        });
        // Removido log [DEBUG]
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    // --- DAILY SYMBOLS ---
    const MACRO_SYMBOLS = ['Nasdaq', 'S_P500', 'RUT', 'VIX', 'DXY', 'Gold', 'CrudeOil', 'T10Y2Y', 'HY_Spread', 'MOVE'];
    for (const key of MACRO_SYMBOLS) {
        const tvSymbol = symbols[key];
        let previousClose = previousClosesStore[key] ?? null;
        const chartKey = `${key}_D`;
        const chart = new tvClient.Session.Chart();
        charts[chartKey] = chart;
        chart.setMarket(tvSymbol, { timeframe: 'D' });
        chart.onError((...err) => {
            // Removido log [DEBUG]
            try { marketUpdateEmitter.emit('error', { type: 'chart', symbol: key, timeframe: 'D', message: `Chart error: ${err}` }); } catch (e) {}
            if (charts[chartKey]) { try { charts[chartKey].delete(); } catch(e){} delete charts[chartKey]; }
        });
        chart.onUpdate(() => {
            if (chart.periods && chart.periods.length > 0) {
                const latestPeriod = chart.periods[0];
                const candleTime = latestPeriod.time || latestPeriod.timestamp || null;
                if (!candles1d) candles1d = {};
                if (!candles1d[key]) candles1d[key] = [];
                const last = candles1d[key][candles1d[key].length - 1];
                if (!last || last.timestamp !== candleTime) {
                    candles1d[key].push({
                        timestamp: candleTime,
                        open: latestPeriod.open,
                        high: latestPeriod.max ?? latestPeriod.high,
                        low: latestPeriod.min ?? latestPeriod.low,
                        close: latestPeriod.close,
                        volume: latestPeriod.volume || 0
                    });
                    if (candles1d[key].length > 200) candles1d[key].shift();
                } else {
                    last.high = Math.max(last.high, latestPeriod.max ?? latestPeriod.high);
                    last.low = Math.min(last.low, latestPeriod.min ?? latestPeriod.low);
                    last.close = latestPeriod.close;
                    if (latestPeriod.volume) last.volume += latestPeriod.volume;
                }
            } else {
            }
        });
        // Removido log [DEBUG]
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    // --- BTC 5m Candle ---
    // Novo: Chart de 5 minutos para BTC
    const btc5mChartKey = 'BTC_5';
    const btc5mChart = new tvClient.Session.Chart();
    charts[btc5mChartKey] = btc5mChart;
    btc5mChart.setMarket(symbols['BTC'], { timeframe: '5' });
    btc5mChart.onError((...err) => {
        try { marketUpdateEmitter.emit('error', { type: 'chart', symbol: 'BTC', timeframe: '5', message: `Chart error: ${err}` }); } catch (e) {}
        if (charts[btc5mChartKey]) { try { charts[btc5mChartKey].delete(); } catch(e){} delete charts[btc5mChartKey]; }
    });
    btc5mChart.onUpdate(() => {
        if (btc5mChart.periods && btc5mChart.periods.length > 0) {
            const latestPeriod = btc5mChart.periods[0];
            const candleTime = latestPeriod.time || latestPeriod.timestamp || null;
            if (!candles5m['BTC']) candles5m['BTC'] = [];
            const last = candles5m['BTC'][candles5m['BTC'].length - 1];
            if (!last || last.timestamp !== candleTime) {
                candles5m['BTC'].push({
                    timestamp: candleTime,
                    open: latestPeriod.open,
                    high: latestPeriod.max ?? latestPeriod.high,
                    low: latestPeriod.min ?? latestPeriod.low,
                    close: latestPeriod.close,
                    volume: latestPeriod.volume || 0
                });
                if (candles5m['BTC'].length > 200) candles5m['BTC'].shift();
            } else {
                last.high = Math.max(last.high, latestPeriod.max ?? latestPeriod.high);
                last.low = Math.min(last.low, latestPeriod.min ?? latestPeriod.low);
                last.close = latestPeriod.close;
                if (latestPeriod.volume) last.volume += latestPeriod.volume;
            }
        }
    });
    console.log(' -> Chart session established for BTC (5m)');
    await new Promise(resolve => setTimeout(resolve, 100));
    // --- BTC 1m Candle ---
    const btc1mChartKey = 'BTC_1';
    const btc1mChart = new tvClient.Session.Chart();
    charts[btc1mChartKey] = btc1mChart;
    btc1mChart.setMarket(symbols['BTC'], { timeframe: '1' });
    btc1mChart.onError((...err) => {
        try { marketUpdateEmitter.emit('error', { type: 'chart', symbol: 'BTC', timeframe: '1', message: `Chart error: ${err}` }); } catch (e) {}
        if (charts[btc1mChartKey]) { try { charts[btc1mChartKey].delete(); } catch(e){} delete charts[btc1mChartKey]; }
    });
    btc1mChart.onUpdate(() => {
        if (btc1mChart.periods && btc1mChart.periods.length > 0) {
            const latestPeriod = btc1mChart.periods[0];
            const candleTime = latestPeriod.time || latestPeriod.timestamp || null;
            if (!candles1m['BTC']) candles1m['BTC'] = [];
            const last = candles1m['BTC'][candles1m['BTC'].length - 1];
            if (!last || last.timestamp !== candleTime) {
                candles1m['BTC'].push({
                    timestamp: candleTime,
                    open: latestPeriod.open,
                    high: latestPeriod.max ?? latestPeriod.high,
                    low: latestPeriod.min ?? latestPeriod.low,
                    close: latestPeriod.close,
                    volume: latestPeriod.volume || 0
                });
                if (candles1m['BTC'].length > 2000) candles1m['BTC'].shift();
            } else {
                last.high = Math.max(last.high, latestPeriod.max ?? latestPeriod.high);
                last.low = Math.min(last.low, latestPeriod.min ?? latestPeriod.low);
                last.close = latestPeriod.close;
                if (latestPeriod.volume) last.volume += latestPeriod.volume;
            }
        }
    });
    console.log(' -> Chart session established for BTC (1m)');
    await new Promise(resolve => setTimeout(resolve, 100));
    // --- BTC 15m Candle ---
    const btc15mChartKey = 'BTC_15';
    const btc15mChart = new tvClient.Session.Chart();
    charts[btc15mChartKey] = btc15mChart;
    btc15mChart.setMarket(symbols['BTC'], { timeframe: '15' });
    btc15mChart.onError((...err) => {
        try { marketUpdateEmitter.emit('error', { type: 'chart', symbol: 'BTC', timeframe: '15', message: `Chart error: ${err}` }); } catch (e) {}
        if (charts[btc15mChartKey]) { try { charts[btc15mChartKey].delete(); } catch(e){} delete charts[btc15mChartKey]; }
    });
    btc15mChart.onUpdate(() => {
        if (btc15mChart.periods && btc15mChart.periods.length > 0) {
            const latestPeriod = btc15mChart.periods[0];
            const candleTime = latestPeriod.time || latestPeriod.timestamp || null;
            if (!candles15m['BTC']) candles15m['BTC'] = [];
            const last = candles15m['BTC'][candles15m['BTC'].length - 1];
            if (!last || last.timestamp !== candleTime) {
                candles15m['BTC'].push({
                    timestamp: candleTime,
                    open: latestPeriod.open,
                    high: latestPeriod.max ?? latestPeriod.high,
                    low: latestPeriod.min ?? latestPeriod.low,
                    close: latestPeriod.close,
                    volume: latestPeriod.volume || 0
                });
                if (candles15m['BTC'].length > 200) candles15m['BTC'].shift();
            } else {
                last.high = Math.max(last.high, latestPeriod.max ?? latestPeriod.high);
                last.low = Math.min(last.low, latestPeriod.min ?? latestPeriod.low);
                last.close = latestPeriod.close;
                if (latestPeriod.volume) last.volume += latestPeriod.volume;
            }
        }
    });
    console.log(' -> Chart session established for BTC (15m)');
    await new Promise(resolve => setTimeout(resolve, 100));
    // --- BTC 1h Candle ---
    const btc1hChartKey = 'BTC_1h';
    const btc1hChart = new tvClient.Session.Chart();
    charts[btc1hChartKey] = btc1hChart;
    btc1hChart.setMarket(symbols['BTC'], { timeframe: '60' });
    btc1hChart.onError((...err) => {
        try { marketUpdateEmitter.emit('error', { type: 'chart', symbol: 'BTC', timeframe: '60', message: `Chart error: ${err}` }); } catch (e) {}
        if (charts[btc1hChartKey]) { try { charts[btc1hChartKey].delete(); } catch(e){} delete charts[btc1hChartKey]; }
    });
    btc1hChart.onUpdate(() => {
        if (btc1hChart.periods && btc1hChart.periods.length > 0) {
            const latestPeriod = btc1hChart.periods[0];
            const candleTime = latestPeriod.time || latestPeriod.timestamp || null;
            if (!candles1h['BTC']) candles1h['BTC'] = [];
            const last = candles1h['BTC'][candles1h['BTC'].length - 1];
            if (!last || last.timestamp !== candleTime) {
                candles1h['BTC'].push({
                    timestamp: candleTime,
                    open: latestPeriod.open,
                    high: latestPeriod.max ?? latestPeriod.high,
                    low: latestPeriod.min ?? latestPeriod.low,
                    close: latestPeriod.close,
                    volume: latestPeriod.volume || 0
                });
                if (candles1h['BTC'].length > 200) candles1h['BTC'].shift();
            } else {
                last.high = Math.max(last.high, latestPeriod.max ?? latestPeriod.high);
                last.low = Math.min(last.low, latestPeriod.min ?? latestPeriod.low);
                last.close = latestPeriod.close;
                if (latestPeriod.volume) last.volume += latestPeriod.volume;
            }
        }
    });
    console.log(' -> Chart session established for BTC (1h)');
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log("Real-time monitoring setup complete for all symbols.");
}


// --- Calculate Signals Function --- (Modified for new global indicators)
function calculateSignals(currentMarketData) {
    const signals = {};
    let totalScore = 0;
    let totalWeight = 0;

    // --- NOVO: Controle de stale ---
    const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hora
    const globalKeys = symbolKeys.filter(key => !ignore_for_overall_score.includes(key) && weights[key]);
    let freshGlobals = [];
    let staleGlobals = [];
    for (const key of globalKeys) {
        const data = currentMarketData[key];
        if (data && typeof data.last_update === 'number' && (Date.now() - data.last_update < STALE_THRESHOLD_MS)) {
            freshGlobals.push(key);
        } else {
            staleGlobals.push(key); // Inclui last_update null/undefined como stale
        }
    }
    // ---

    for (const key of symbolKeys) {
        const data = currentMarketData[key];
        let initialScore = 0;
        let finalScore = 0;
        let signal_emoji = '⚪';
        let trend = 'neutral';

        if (data && typeof data.chg_pct === 'number' && !isNaN(data.chg_pct)) {
            const pctChange = data.chg_pct;

            // Magnitude bands
            if (pctChange > 1.5) initialScore = 2;
            else if (pctChange > 0.5) initialScore = 1;
            else if (pctChange < -1.5) initialScore = -2;
            else if (pctChange < -0.5) initialScore = -1;
            else initialScore = 0;

            finalScore = inverted_symbols.includes(key) ? -initialScore : initialScore;

            // Definir trend para cada ativo (sem neutral)
            if (pctChange > 0) trend = 'bullish';
            else if (pctChange < 0) trend = 'bearish';
            else trend = 'neutral';

            // Só soma score/weight se for global e fresco
            if (!ignore_for_overall_score.includes(key) && weights[key] && freshGlobals.includes(key)) {
                totalScore += finalScore * weights[key];
                totalWeight += weights[key];
            }
        } else {
            if (latestSignals[key]) {
                 trend = latestSignals[key].trend || 'neutral';
                 signal_emoji = latestSignals[key].signal || '⚪';
                 finalScore = latestSignals[key].score || 0;
             }
        }

        signals[key] = {
            trend: trend,
            signal: signal_emoji,
            price: data?.price ?? latestSignals[key]?.price ?? null,
            chg: data?.chg ?? latestSignals[key]?.chg ?? null,
            chg_pct: data?.chg_pct ?? latestSignals[key]?.chg_pct ?? null,
            score: finalScore
        };
    }

    // --- Modo crypto-only se menos de 50% dos globais estiverem frescos ---
    let normScore = 0;
    let globalMode = 'normal';
    if (freshGlobals.length < globalKeys.length / 2) {
        normScore = 0;
        globalMode = 'crypto-only';
    } else {
        normScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    }
    // ---

    // Preservar campos BTC-specific se já existirem
    if (latestSignals.BTC && signals.BTC) {
        const preserveFields = [
            'funding_rate', 'open_interest', 'open_interest_1h_ago',
            'basis_perc', 'book_pressure', 'chg_pct_1h'
        ];
        for (const field of preserveFields) {
            if (latestSignals.BTC[field] !== undefined) {
                signals.BTC[field] = latestSignals.BTC[field];
            }
        }
    }

    // Determine Overall Sentiment
    let overall_sentiment_text = 'Neutral';
    let overall_signal = '⚪';
    let overall_trend = 'neutral';
    if (normScore >= 0.8) { overall_sentiment_text = 'Bullish'; overall_signal = '🟢'; overall_trend = 'bullish'; }
    else if (normScore <= -0.8) { overall_sentiment_text = 'Bearish'; overall_signal = '🔴'; overall_trend = 'bearish'; }

    signals['Overall'] = {
        trend: overall_trend,
        signal: overall_signal,
        sentiment: overall_sentiment_text,
        score: normScore,
        price: null, chg: null, chg_pct: null,
        global_mode: globalMode,
        fresh_globals: freshGlobals,
        stale_globals: staleGlobals
    };

    return signals;
}

// Função clamp e normalização para lógica de decisão
function clamp(x, a, b) {
    return Math.max(a, Math.min(x, b));
}

function norm(x, cap) {
    return clamp(x / cap, -1, 1);
}

/**
 * Normaliza o valor de um indicador global para a faixa [-1, +1],
 * aplicando caps e inversões conforme especificação.
 * @param {string} key - Nome do indicador (ex: 'Nasdaq', 'VIX', etc.)
 * @param {number} value - Variação percentual do indicador
 * @returns {number} Valor normalizado
 */
function normalizeIndicator(key, value) {
    if (value === null || value === undefined || isNaN(value)) return 0;
    switch (key) {
        case 'Nasdaq':
        case 'S_P500':
        case 'RUT':
        case 'Gold':
        case 'CrudeOil':
            // Cap em [-5, +5]
            return Math.max(-1, Math.min(1, value / 5));
        case 'VIX':
        case 'DXY':
            // Invertido, cap em [-5, +5]
            return Math.max(-1, Math.min(1, -value / 5));
        case 'HY_Spread':
            // Invertido, cap em [-2, +2] (200bps)
            return Math.max(-1, Math.min(1, -value / 2));
        case 'MOVE':
            // Invertido, cap em [-10, +10]
            return Math.max(-1, Math.min(1, -value / 10));
        case 'T10Y2Y':
            // Cap em [-5, +5]
            return Math.max(-1, Math.min(1, value / 5));
        default:
            return 0;
    }
}

/**
 * Lógica de decisão agregada conforme especificação do usuário.
 * Espera todos os indicadores normalizados e book_pressure já disponível.
 */
function decisionLogic({
    nasdaq_pct, sp500_pct, rut_pct, vix_pct, dxy_pct, gold_pct, crudeoil_pct,
    t10y2y_pct, hy_spread_pct, move_pct,
    funding_rate, oi_now, oi_1h_ago, basis_perc, book_pressure, btc_pct_1h
}) {
    // 1. Normalização
    const norm_global = {
        nasdaq:  norm(nasdaq_pct, 5),
        sp500:   norm(sp500_pct, 5),
        rut:     norm(rut_pct, 5),
        vix:     norm(vix_pct, 5) * (-1),
        dxy:     norm(dxy_pct, 5) * (-1),
        gold:    norm(gold_pct, 5),
        oil:     norm(crudeoil_pct, 5),
        t10y2y:  norm(t10y2y_pct, 5),
        hy_spread: norm(hy_spread_pct, 5) * (-1),
        move:    norm(move_pct, 5) * (-1),
    };
    const norm_funding = norm(funding_rate * 100, 0.1); // funding em %
    const norm_oi      = norm(((oi_now - oi_1h_ago) / oi_1h_ago) * 100, 5);
    const norm_basis   = norm(basis_perc, 0.5);
    const norm_trend   = norm(btc_pct_1h, 1);

    // 2. Scores
    const score_global = Object.values(norm_global).reduce((a, b) => a + b, 0) / Object.values(norm_global).length;
    const score_btc = (
        2.0 * norm_funding +
        1.5 * norm_oi +
        1.5 * norm_basis +
        2.0 * book_pressure
    ) / (2.0 + 1.5 + 1.5 + 2.0);
    const score_total = score_global + score_btc;

    // 3. Thresholds
    const T = 0.5;
    let decision;
    if (score_total >= T) decision = "BUY";
    else if (score_total <= -T) decision = "SELL";
    else decision = "HOLD";

    // 4. Validação com tendência
    if (decision === "BUY" && btc_pct_1h < -0.2) decision = "HOLD";
    if (decision === "SELL" && btc_pct_1h > 0.2) decision = "HOLD";

    return { decision, score_total };
}

// --- API Endpoints ---

// NEW: Server-Sent Events Endpoint
app.get('/api/sse-updates', (req, res) => {
    console.log('SSE client connected');
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Flush headers to establish connection

    // Send the current state immediately
    const initialState = { type: 'full', data: latestSignals };
    res.write(`id: ${Date.now()}
event: update
data: ${JSON.stringify(initialState)}

`);

    // Add the client to the list
    const clientId = Date.now();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);
    console.log(`SSE client ${clientId} added. Total clients: ${sseClients.length}`);


    // Listener for market updates
    const marketUpdateListener = (updateData) => {
        // console.log(`SSE sending update to client ${clientId}: ${updateData.type}`);
        try {
            res.write(`id: ${Date.now()}
event: update
data: ${JSON.stringify(updateData)}

`);
        } catch (error) {
             console.error(`Error writing to SSE client ${clientId}: ${error.message}. Removing client.`);
             // Force removal if write fails
             marketUpdateEmitter.removeListener('update', marketUpdateListener);
             marketUpdateEmitter.removeListener('error', errorUpdateListener);
             sseClients = sseClients.filter(client => client.id !== clientId);
             console.log(`SSE client ${clientId} forcefully removed due to write error. Total clients: ${sseClients.length}`);
        }
    };
    marketUpdateEmitter.on('update', marketUpdateListener);

    // Listener for error updates
     const errorUpdateListener = (errorData) => {
        console.log(`SSE sending error to client ${clientId}`);
         try {
             res.write(`id: ${Date.now()}
event: error
data: ${JSON.stringify(errorData)}

`);
         } catch (error) {
             console.error(`Error writing error to SSE client ${clientId}: ${error.message}. Removing client.`);
             // Force removal if write fails
             marketUpdateEmitter.removeListener('update', marketUpdateListener);
             marketUpdateEmitter.removeListener('error', errorUpdateListener);
             sseClients = sseClients.filter(client => client.id !== clientId);
             console.log(`SSE client ${clientId} forcefully removed due to write error. Total clients: ${sseClients.length}`);
         }
    };
    marketUpdateEmitter.on('error', errorUpdateListener);


    // Handle client disconnection
    req.on('close', () => {
        console.log(`SSE client ${clientId} disconnected.`);
        marketUpdateEmitter.removeListener('update', marketUpdateListener);
        marketUpdateEmitter.removeListener('error', errorUpdateListener);
        sseClients = sseClients.filter(client => client.id !== clientId);
        console.log(`SSE client ${clientId} removed. Total clients: ${sseClients.length}`);
    });
});
// --- API Funding & OI ---
app.get('/api/funding-oi', async (req, res) => {
  const { symbol = 'BTCUSDT', period = '1h' } = req.query;
  const queryApi = influxDB.getQueryApi(INFLUX_ORG);
  const fluxQuery = `
    from(bucket: "${INFLUX_BUCKET}")
      |> range(start: -${period})
      |> filter(fn: (r) => r.symbol == "${symbol}")
      |> filter(fn: (r) => r._measurement == "funding_rate" or r._measurement == "open_interest")
      |> sort(columns: ["_time"])
  `;
  let fundingRate = null, fundingRateTime = null;
  let openInterest = null, openInterestTime = null;
  try {
    await queryApi.collectRows(fluxQuery, (row) => {
      console.log('INFLUX ROW:', row);
      if (row[7] === 'funding_rate' && row[5] !== null && row[5] !== undefined) {
        if (!fundingRateTime || new Date(row[4]) > new Date(fundingRateTime)) {
          fundingRate = parseFloat(row[5]);
          fundingRateTime = row[4];
        }
      }
      if (row[7] === 'open_interest' && row[5] !== null && row[5] !== undefined) {
        if (!openInterestTime || new Date(row[4]) > new Date(openInterestTime)) {
          openInterest = parseFloat(row[5]);
          openInterestTime = row[4];
        }
      }
    });
    res.json({
      funding_rate: fundingRate,
      funding_rate_time: fundingRateTime,
      open_interest: openInterest,
      open_interest_time: openInterestTime
    });
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

// Endpoint para Funding Rate da Binance (COIN-M)
app.get('/api/binance-funding-rate', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'BTCUSD_PERP';
    const fundingResp = await axios.get(`https://dapi.binance.com/dapi/v1/fundingRate?symbol=${symbol}&limit=1`);
    const fundingRate = parseFloat(fundingResp.data[0].fundingRate);
    const fundingTime = fundingResp.data[0].fundingTime;
    res.json({
      funding_rate: fundingRate,
      funding_time: fundingTime
    });
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

// Endpoint para Open Interest da Binance (COIN-M)
app.get('/api/binance-open-interest', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'BTCUSD_PERP';
    const oiResp = await axios.get(`https://dapi.binance.com/dapi/v1/openInterest?symbol=${symbol}`);
    const openInterest = parseFloat(oiResp.data.openInterest);
    res.json({
      open_interest: openInterest,
      time: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

// Endpoint para Basis (Premium/Discount) XBTUSD PERP vs Spot usando BitMEX
app.get('/api/basis-premium', async (req, res) => {
  try {
        // Preço PERP (XBTUSD)
        const perpResp = await axios.get('https://www.bitmex.com/api/v1/instrument?symbol=XBTUSD');
        // Preço Spot (índice .BXBT)
        const spotResp = await axios.get('https://www.bitmex.com/api/v1/instrument?symbol=.BXBT');
        if (!Array.isArray(perpResp.data) || perpResp.data.length === 0 ||
            !Array.isArray(spotResp.data) || spotResp.data.length === 0) {
            return res.status(500).json({ error: 'BitMEX API returned no data' });
        }
        const perp = perpResp.data[0].lastPrice;
        const spot = spotResp.data[0].lastPrice;
        const basis = perp - spot;
        const basis_percent = (basis / spot) * 100;
    res.json({
      spot,
      perp,
      basis_percent,
            basis
    });
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

// NOVO: Endpoint para os dados de Funding Score (proxy para a API Python)
app.get('/api/funding', async (req, res) => {
    try {
        const response = await axios.get('http://localhost:5002/api/funding');
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching funding data:', error.message);
        res.status(500).json({ error: 'Failed to fetch funding data' });
    }
});

// Existing Binance Funding Rate endpoint
app.get('/api/binance-funding-rate', async (req, res) => {
    const symbol = req.query.symbol || 'BTCUSD_PERP';

    try {
        // ... código existente do endpoint ...
        
        // Query most recent funding rate from InfluxDB
        const query = `
        from(bucket: "${INFLUX_BUCKET}")
          |> range(start: -24h)
          |> filter(fn: (r) => r._measurement == "funding_rate" or r._measurement == "open_interest")
          |> filter(fn: (r) => r.symbol == "BTCUSDT")
          |> sort(columns: ["_time"], desc: true)
          |> limit(n: 2)
        `;
        
        const queryApi = influxDB.getQueryApi(INFLUX_ORG);
        
        let fundingRate = null;
        let fundingRateTime = null;
        let openInterest = null;
        let openInterestTime = null;
        
        await new Promise((resolve, reject) => {
            queryApi.queryRows(query, {
                next(row, tableMeta) {
                    const rowData = tableMeta.toObject(row);
                    
                    if (rowData._measurement === 'funding_rate' && rowData._value !== null && rowData._value !== undefined) {
                        fundingRate = parseFloat(rowData._value);
                        fundingRateTime = rowData._time;
                    }
                    
                    if (rowData._measurement === 'open_interest' && rowData._value !== null && rowData._value !== undefined) {
                        openInterest = parseFloat(rowData._value);
                        openInterestTime = rowData._time;
                    }
                },
                error(error) {
                    console.error('InfluxDB query error:', error);
                    reject(error);
                },
                complete() {
                    resolve();
                },
            });
        });
        
        const response = {
            funding_rate: fundingRate,
            funding_time: fundingRateTime,
            open_interest: openInterest,
            time: openInterestTime
        };
        
        res.json(response);
    } catch (error) {
        console.error('Error fetching funding rate:', error);
        res.status(500).json({ error: 'Failed to fetch funding rate data' });
    }
});

// Existing Open Interest endpoint
app.get('/api/binance-open-interest', async (req, res) => {
    const symbol = req.query.symbol || 'BTCUSD_PERP';

    try {
        // ...código existente do endpoint...
        
        // Query most recent open interest from InfluxDB
        const query = `
        from(bucket: "${INFLUX_BUCKET}")
          |> range(start: -24h)
          |> filter(fn: (r) => r._measurement == "open_interest")
          |> filter(fn: (r) => r.symbol == "BTCUSDT")
          |> sort(columns: ["_time"], desc: true)
          |> limit(n: 1)
        `;
        
        const queryApi = influxDB.getQueryApi(INFLUX_ORG);
        
        let openInterest = null;
        let openInterestTime = null;
        
        await new Promise((resolve, reject) => {
            queryApi.queryRows(query, {
                next(row, tableMeta) {
                    const rowData = tableMeta.toObject(row);
                    openInterest = parseFloat(rowData._value);
                    openInterestTime = rowData._time;
                },
                error(error) {
                    console.error('InfluxDB query error:', error);
                    reject(error);
                },
                complete() {
                    resolve();
                },
            });
        });
        
        res.json({
            open_interest: openInterest,
            time: openInterestTime
        });
    } catch (error) {
        console.error('Error fetching open interest:', error);
        res.status(500).json({ error: 'Failed to fetch open interest data' });
    }
});

// Endpoint para receber book_pressure do frontend
app.post('/api/book-pressure', (req, res) => {
    const { value } = req.body;
    if (typeof value !== 'number' || isNaN(value)) {
        return res.status(400).json({ error: 'Invalid book_pressure value' });
    }
    if (!latestSignals.BTC) latestSignals.BTC = {};
    latestSignals.BTC.book_pressure = value;

    // --- Armazenar histórico para cálculo do deltaBook5s ---
    const now = Date.now();
    bookPressureHistory.push({ timestamp: now, value });
    // Limpar valores antigos (>10s)
    bookPressureHistory = bookPressureHistory.filter(e => now - e.timestamp <= 10000);
    // Encontrar valor de 5s atrás
    const fiveSecondsAgo = now - 5000;
    // Pega o valor mais próximo anterior a 5s atrás
    let prev = null;
    for (let i = bookPressureHistory.length - 1; i >= 0; i--) {
        if (bookPressureHistory[i].timestamp <= fiveSecondsAgo) {
            prev = bookPressureHistory[i];
            break;
        }
    }
    let deltaBook5s = 0;
    if (prev) {
        deltaBook5s = value - prev.value;
    }
    latestSignals.BTC.deltaBook5s = deltaBook5s;

    res.json({ status: 'ok', book_pressure: value });
});

// Endpoint de teste para preencher todos os campos BTC-specific manualmente
app.post('/api/mock-btc-indicators', (req, res) => {
    const {
        funding_rate, open_interest, open_interest_1h_ago,
        basis_perc, book_pressure, btc_pct_1h
    } = req.body;
    if (!latestSignals.BTC) latestSignals.BTC = {};
    latestSignals.BTC.funding_rate = funding_rate;
    latestSignals.BTC.open_interest = open_interest;
    latestSignals.BTC.open_interest_1h_ago = open_interest_1h_ago;
    latestSignals.BTC.basis_perc = basis_perc;
    latestSignals.BTC.book_pressure = book_pressure;
    latestSignals.BTC.chg_pct_1h = btc_pct_1h;
    latestSignals.BTC.btc_pct_1h = btc_pct_1h;
    if (!latestMarketData.BTC) latestMarketData.BTC = {};
    latestMarketData.BTC.chg_pct_1h = btc_pct_1h;
    res.json({ status: 'ok', BTC: latestSignals.BTC });
});

// Endpoint temporário para forçar fresh/stale nos globais para testes
app.post('/api/mock-globals-mode', (req, res) => {
    const { mode } = req.body;
    const globalKeys = ['Nasdaq','S_P500','RUT','VIX','DXY','Gold','CrudeOil','T10Y2Y','HY_Spread','MOVE'];
    if (mode === 'fresh') {
        for (let key of globalKeys) {
            if (!latestMarketData[key]) latestMarketData[key] = {};
            latestMarketData[key].last_update = Date.now();
        }
        return res.json({ status: 'ok', mode: 'full-market' });
    } else if (mode === 'stale') {
        for (let key of globalKeys) {
            if (!latestMarketData[key]) latestMarketData[key] = {};
            latestMarketData[key].last_update = Date.now() - 2 * 60 * 60 * 1000; // 2h atrás
        }
        return res.json({ status: 'ok', mode: 'crypto-only' });
    } else {
        return res.status(400).json({ error: 'mode deve ser fresh ou stale' });
    }
});

// --- Serve Main HTML Page ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'decision.html'));
});

// --- Start Server ---
app.listen(port, '0.0.0.0', async () => {
    console.log(`Server listening at http://0.0.0.0:${port}`);
    try {
        await initializeTradingView();
        if (tvClient) {
            await fetchPreviousCloses(); // Fetch initial closes
            await startRealtimeMonitoring(); // Start persistent monitoring
        } else {
            console.error("!!! Failed to initialize TradingView client on startup. Real-time updates will not work. !!!");
        }
        // MOCK BTC INDICATORS (após inicialização)
        try {
            await axios.post('http://localhost:5001/api/mock-btc-indicators', {
                funding_rate: 0.0001,
                open_interest: 10000,
                open_interest_1h_ago: 9900,
                basis_perc: 0.05,
                book_pressure: 0.1,
                btc_pct_1h: 0.02
            });
            console.log('Mock BTC indicators injected at startup.');
        } catch (mockErr) {
            console.error('Failed to inject mock BTC indicators:', mockErr);
        }
    } catch (error) {
        console.error("!!! Error during server startup sequence:", error, "!!!");
    }
}); 

// Função para buscar BVOL24H do BitMEX (usando símbolo oficial .BVOL24H)
async function fetchBVOL24HFromBitmex() {
    try {
        const resp = await axios.get('https://www.bitmex.com/api/v1/trade', {
            params: {
                symbol: '.BVOL24H',
                count: 1,
                columns: 'price',
                reverse: true
            }
        });
        if (resp.data && resp.data.length > 0) {
            return resp.data[0].price;
        }
        return null;
    } catch (err) {
        console.error('Erro ao buscar BVOL24H do BitMEX:', err.message);
        return null;
    }
}

// Atualizar BVOL24H sempre via BitMEX
async function updateBVOL24H() {
    const bvol = await fetchBVOL24HFromBitmex();
    if (bvol !== null) {
        const now = Date.now();
        bvol24hHistory.push({ timestamp: now, price: bvol });
        // Manter apenas os valores das últimas 24h
        const cutoff = now - 24 * 60 * 60 * 1000;
        bvol24hHistory = bvol24hHistory.filter(e => e.timestamp >= cutoff);

        let chg = null, chg_pct = null;
        if (bvol24hHistory.length >= 2) {
            const prev = bvol24hHistory[0].price; // O mais antigo dentro das 24h
            chg = bvol - prev;
            if (prev !== 0) chg_pct = (chg / prev) * 100;
        }

        latestMarketData.BVOL24H = {
            price: bvol,
            chg,
            chg_pct,
            prevClose: null
        };
        latestSignals = calculateSignals(latestMarketData);
        marketUpdateEmitter.emit('update', { type: 'full', data: latestSignals });
        console.log('Painel BVOL24H atualizado via BitMEX API (.BVOL24H).');
    } else {
        console.warn('BVOL24H BitMEX indisponível.');
    }
}

// Chamar updateBVOL24H periodicamente (ex: a cada 5 minutos)
setInterval(updateBVOL24H, 5 * 60 * 1000);
// E também logo após inicialização
updateBVOL24H();

// Endpoint para consultar o valor atual de BVOL24H
app.get('/api/bvol24h', (req, res) => {
    if (latestMarketData.BVOL24H) {
        res.json(latestMarketData.BVOL24H);
    } else {
        res.status(404).json({ error: 'BVOL24H data not available' });
    }
});

// Endpoint para consultar o valor mais recente de BVOL24H diretamente da API do BitMEX
app.get('/api/bvol24h-live', async (req, res) => {
    try {
        const bvol = await fetchBVOL24HFromBitmex();
        if (bvol !== null) {
            res.json({ price: bvol });
        } else {
            res.status(404).json({ error: 'BVOL24H data not available' });
        }
    } catch (err) {
        res.status(500).json({ error: err.toString() });
    }
});

// Histórico do basis (últimos 100 pontos)
let basisHistory = [];

// Atualizar o basis do BitMEX periodicamente
async function updateBasisFromBitmex() {
    try {
        const resp = await axios.get('http://localhost:5001/api/basis-premium');
        const basis_perc = resp.data.basis_percent;
        const perp = resp.data.perp;
        const spot = resp.data.spot;
        const basis = resp.data.basis;
        const timestamp = Date.now();
        if (typeof basis_perc === 'number' && !isNaN(basis_perc)) {
            if (!latestSignals.BTC) latestSignals.BTC = {};
            latestSignals.BTC.basis_perc = basis_perc;
            if (!latestMarketData.BTC) latestMarketData.BTC = {};
            latestMarketData.BTC.basis_perc = basis_perc;
            // Salvar no histórico
            basisHistory.push({ basis_perc, perp, spot, basis, timestamp });
            if (basisHistory.length > 100) basisHistory.shift();
            // Emitir atualização para o frontend
            marketUpdateEmitter.emit('update', { type: 'full', data: latestSignals });
        } else {
            console.warn('Basis percent inválido:', basis_perc);
        }
    } catch (err) {
        console.error('Erro ao atualizar basis do BitMEX:', err.message);
    }
}
setInterval(updateBasisFromBitmex, 60000);
updateBasisFromBitmex();

// Endpoint para histórico do basis
app.get('/api/basis-history', (req, res) => {
    res.json(basisHistory);
});

/**
 * Atualiza os buffers de candles de 1h e 15m para o símbolo informado.
 * @param {string} symbol - Ex: 'BTC', 'Nasdaq', etc.
 * @param {number} price - Preço atual.
 * @param {number} volume - Volume do tick (ou null se não disponível).
 * @param {number} timestamp - Timestamp em ms.
 */
function updateCandlesBuffer(symbol, price, volume, timestamp) {
    // Corrigir timestamp: se vier em segundos, converter para ms
    if (timestamp < 1e12) timestamp = timestamp * 1000;
    // --- 1h ---
    const hour = new Date(timestamp);
    hour.setMinutes(0, 0, 0);
    const hourTs = hour.getTime();
    if (!candles1h[symbol]) candles1h[symbol] = [];
    let last1h = candles1h[symbol][candles1h[symbol].length - 1];
    if (!last1h || last1h.timestamp !== hourTs) {
        candles1h[symbol].push({
            timestamp: hourTs,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: volume || 0
        });
        if (candles1h[symbol].length > 200) candles1h[symbol].shift();
    } else {
        last1h.high = Math.max(last1h.high, price);
        last1h.low = Math.min(last1h.low, price);
        last1h.close = price;
        if (volume) last1h.volume += volume;
    }
    // --- 15m ---
    const min15 = new Date(timestamp);
    min15.setMinutes(Math.floor(min15.getMinutes() / 15) * 15, 0, 0);
    const min15Ts = min15.getTime();
    if (!candles15m[symbol]) candles15m[symbol] = [];
    let last15m = candles15m[symbol][candles15m[symbol].length - 1];
    if (!last15m || last15m.timestamp !== min15Ts) {
        candles15m[symbol].push({
            timestamp: min15Ts,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: volume || 0
        });
        if (candles15m[symbol].length > 200) candles15m[symbol].shift();
    } else {
        last15m.high = Math.max(last15m.high, price);
        last15m.low = Math.min(last15m.low, price);
        last15m.close = price;
        if (volume) last15m.volume += volume;
    }
}

/**
 * Calcula o ATR (Average True Range) dos últimos 14 candles de 1h do BTC.
 * Retorna o ATR em valor absoluto e em porcentagem do preço atual.
 * @param {number} k - multiplicador para o limiar dinâmico (ex: 1.2)
 * @returns {{atr: number, atr_pct: number, t_dynamic: number}}
 */
function calculateATR1hAndThreshold(k = 1.2) {
    const candles = candles1h['BTC'] || [];
    if (candles.length < 15) return { atr: null, atr_pct: null, t_dynamic: null };
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
    if (trs.length < 14) return { atr: null, atr_pct: null, t_dynamic: null };
    const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
    const price = candles[candles.length - 1].close;
    const atr_pct = price ? (atr / price) * 100 : null;
    const t_dynamic = atr_pct !== null ? atr_pct * k : null;
    return { atr, atr_pct, t_dynamic };
}

const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1363618415914520706/AV1ISsQpjGa7ywAvfejJpRScYztCNtqKz-EnTpnr8ULE02euICW19_4gE2mafJUum8UX';
let lastDiscordDecision = null;

async function sendDiscordAlert(decision, explanation) {
  const color = decision === 'BUY' ? 0x2ecc71 : decision === 'SELL' ? 0xe74c3c : 0xf1c40f;
  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      content: (decision === 'BUY' || decision === 'SELL') ? '@everyone' : undefined,
      embeds: [{
        title: `Novo Sinal: ${decision}`,
        description: explanation || '',
        color: color,
        timestamp: new Date().toISOString()
      }]
    });
  } catch (e) {
    console.error('Erro ao enviar alerta para Discord:', e.message, e.response?.data);
  }
}

function isMarketGloballyClosed(now) {
    const ny = moment.tz(now, 'America/New_York');
    const sydney = moment.tz(now, 'Australia/Sydney');
    const isFridayAfter5pmNY = ny.day() === 5 && ny.hour() >= 17;
    const isSaturdayNY = ny.day() === 6;
    const isSundayBefore8Sydney = sydney.day() === 0 && sydney.hour() < 8;
    return isFridayAfter5pmNY || isSaturdayNY || isSundayBefore8Sydney;
}

// --- Buffers curtos para variações percentuais ---
const oiBuffer = [];
const basisBuffer = [];
const fundingBuffer = [];
const scalpScoreBuffer = [];
let lastScalpHistoryMinute = null;

// --- Buffers e variáveis para filtros de sinal ---
const scalpEmaBuffer = [];
let lastFilteredSignal = 'HOLD';
let debounceBuffer = [];
let lastSignalTime = 0;
let lastSignalType = 'HOLD';
let lastEma = null;
let lastRawScore = null;
let lastMomentum = 0;

function calcEMA(buffer, alpha = 0.5) {
    if (buffer.length === 0) return 0;
    let ema = buffer[0];
    for (let i = 1; i < buffer.length; i++) {
        ema = alpha * buffer[i] + (1 - alpha) * ema;
    }
    return ema;
}

// --- MT4 Integration: variável global para última ordem ---
let lastMt4Order = { action: 'HOLD', entry_price: null, stop_loss: null, take_profit: null };
// --- Proteção contra whipsaws: cooldown após stop loss ---
let lastStopLossTime = 0;

app.get('/api/scalping-decision', (req, res) => {
    // initialize debug object for filters
    let filters_debug = {};
    // capture current timestamp for stop loss cooldown check
    const nowMs2 = Date.now();
    // define trendOverride flag from query parameters or default to false
    let trendOverride = false;
    if (req.query.trendOverride === 'true' || req.query.trendOverride === '1') {
        trendOverride = true;
    }
    // define cooldown duration after stop loss (milliseconds)
    const COOLDOWN_STOPLOSS_MS = 10000;
    // --- 1. Pega candles de 1m e 5m ---
    const c1m = candles1m['BTC'] || [];
    const c5m = candles5m['BTC'] || [];
    // --- Funções auxiliares ---
    function pctChange(now, prev) {
        if (typeof now !== 'number' || typeof prev !== 'number' || prev === 0) return 0;
        return (now / prev) - 1;
    }
    function avg(arr) {
        if (!arr || arr.length === 0) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }
    // --- 2. Calcula variações para cada TF ---
    // 1m
    let pctPrice_1m = 0, pctVol_1m = 0, avgVol_1m = 0, close_now_1m = 0, close_prev_1m = 0, vol_now_1m = 0;
    if (c1m.length >= 2) {
        close_now_1m = c1m[c1m.length-1].close;
        close_prev_1m = c1m[c1m.length-2].close;
        pctPrice_1m = pctChange(close_now_1m, close_prev_1m);
        vol_now_1m = c1m[c1m.length-1].volume;
        const vols = c1m.slice(-20).map(c => c.volume);
        avgVol_1m = avg(vols);
        pctVol_1m = avgVol_1m ? (vol_now_1m / avgVol_1m) - 1 : 0;
    }
    // 5m
    let pctPrice_5m = 0, pctVol_5m = 0, avgVol_5m = 0, close_now_5m = 0, close_prev_5m = 0, vol_now_5m = 0;
    if (c5m.length >= 2) {
        close_now_5m = c5m[c5m.length-1].close;
        close_prev_5m = c5m[c5m.length-2].close;
        pctPrice_5m = pctChange(close_now_5m, close_prev_5m);
        vol_now_5m = c5m[c5m.length-1].volume;
        const vols = c5m.slice(-20).map(c => c.volume);
        avgVol_5m = avg(vols);
        pctVol_5m = avgVol_5m ? (vol_now_5m / avgVol_5m) - 1 : 0;
    }
    // --- 3. Basis, Funding, OI em scores (variação percentual) ---
    // OI
    const oi_now = latestSignals.BTC?.open_interest ?? 0;
    if (oi_now > 0) {
        oiBuffer.push(oi_now);
        if (oiBuffer.length > 2) oiBuffer.shift();
    }
    let oi_score = 0;
    if (oiBuffer.length >= 2) {
        oi_score = pctChange(oiBuffer[1], oiBuffer[0]);
    }
    // Basis
    const basis_now = latestSignals.BTC?.basis_perc ?? 0;
    if (typeof basis_now === 'number') {
        basisBuffer.push(basis_now);
        if (basisBuffer.length > 2) basisBuffer.shift();
    }
    let basis_score = 0;
    if (basisBuffer.length >= 2) {
        basis_score = pctChange(basisBuffer[1], basisBuffer[0]);
    }
    // Funding
    let funding_now = latestSignals.BTC?.funding_rate ?? 0;
    if (typeof funding_now === 'number') {
        fundingBuffer.push(funding_now);
        if (fundingBuffer.length > 2) fundingBuffer.shift();
    }
    let funding_score = 0;
    if (fundingBuffer.length >= 2) {
        funding_score = pctChange(fundingBuffer[1], fundingBuffer[0]);
    }
    // --- 4. Pesos ---
    const w_1m = 0.6, w_5m = 0.4;
    const priceW = 0.8, volW = 0.1, basisW = 0.1, fundingW = 0.05, oiW = 0.05, w_book = 0.1;
    // --- Book Pressure ---
    let book_pressure_now = null, book_pressure_prev = null;
    if (Array.isArray(bookPressureHistory) && bookPressureHistory.length > 0) {
        book_pressure_now = bookPressureHistory[bookPressureHistory.length - 1].value;
        // Busca o valor mais próximo de 1 período atrás (1 segundo)
        const now = Date.now();
        let prev = null;
        for (let i = bookPressureHistory.length - 2; i >= 0; i--) {
            if (now - bookPressureHistory[i].timestamp >= 1000) {
                prev = bookPressureHistory[i].value;
                break;
            }
        }
        book_pressure_prev = prev !== null ? prev : book_pressure_now;
    }
    // Normalização opcional (já está entre -1 e +1)
    const book_score = book_pressure_now ?? 0;
    // --- 5. Score de cada TF ---
    const tf_score_1m = priceW * pctPrice_1m + volW * pctVol_1m;
    const tf_score_5m = priceW * pctPrice_5m + volW * pctVol_5m;
    // --- Whale Flow (últimos 60s) ---
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const recentWhales = whaleFlowBuffer.filter(e => e.timestamp >= oneMinuteAgo);
    let smallFlow = 0, mediumFlow = 0, largeFlow = 0;
    for (const tx of recentWhales) {
        const btc = tx.value / 1e8;
        if (btc >= 20 && btc < 50) smallFlow += btc;
        else if (btc >= 50 && btc < 100) mediumFlow += btc;
        else if (btc >= 100) largeFlow += btc;
    }
    const whaleScoreRaw = smallFlow * 0.02 + mediumFlow * 0.05 + largeFlow * 0.10;
    const whaleScore = whaleScoreRaw / 100;
    const w_whale = 0.1;
    // --- Trend Score dos últimos 3 candles 1m e 5m ---
    let trend_score = 0;
    function getTrendBonus(candles) {
        if (candles.length < 3) return 0;
        const last3 = candles.slice(-3);
        const ups = last3.every(c => c.close > c.open);
        const downs = last3.every(c => c.close < c.open);
        if (ups) return 0.005;
        if (downs) return -0.005;
        return 0;
    }
    trend_score += getTrendBonus(c1m);
    trend_score += getTrendBonus(c5m);
    const w_trend = 0.05;
    // --- 6. Score total do scalping ---
    const scalp_score =
        w_1m * tf_score_1m +
        w_5m * tf_score_5m +
        basisW   * basis_score +
        fundingW * funding_score +
        oiW      * oi_score +
        w_trend  * trend_score; // book/whale removidos do score
    // --- Filtros de sinal ---
    // 1. EMA rápida (α=0.5)
    scalpEmaBuffer.push(scalp_score);
    if (scalpEmaBuffer.length > 5) scalpEmaBuffer.shift();
    const scalp_ema = calcEMA(scalpEmaBuffer, 0.5);
    // 2. Momentum (velocidade)
    lastMomentum = lastEma !== null ? scalp_ema - lastEma : 0;
    lastEma = scalp_ema;
    // 3. Debounce de 2 ciclos
    let rawSignal = 'HOLD';
    if (scalp_ema > 0.001) rawSignal = 'BUY';
    else if (scalp_ema < -0.001) rawSignal = 'SELL';
    debounceBuffer.push(rawSignal);
    if (debounceBuffer.length > 2) debounceBuffer.shift();
    let filteredSignal = 'HOLD';
    if (debounceBuffer[0] === debounceBuffer[1] && debounceBuffer[0] !== 'HOLD') {
        filteredSignal = debounceBuffer[0];
    }
    // --- Filtro de tendência: só permite SELL se pelo menos 2 dos últimos 3 candles forem de baixa ---
    if (filteredSignal === 'SELL' && c1m.length >= 3) {
        let downCandles = 0;
        for (let i = c1m.length - 3; i < c1m.length; i++) {
            if (c1m[i].close < c1m[i].open) downCandles++;
        }
        if (downCandles < 2) filteredSignal = 'HOLD';
    }
    // 4. Cool-down de 10s entre reversões (exceto se momentum forte)
    const nowMs = Date.now();
    let cooldownActive = false;
    if (filteredSignal !== lastSignalType && lastSignalType !== 'HOLD') {
        if (nowMs - lastSignalTime < 10000) {
            cooldownActive = true;
            filteredSignal = lastSignalType;
        } else {
            lastSignalTime = nowMs;
            lastSignalType = filteredSignal;
        }
    } else if (nowMs - lastSignalTime < 10000 && lastSignalType !== 'HOLD') {
        cooldownActive = true;
    }
    // 5. Classificação de força
    let signalStrength = 'none';
    if (Math.abs(scalp_ema) >= 0.001 && Math.abs(scalp_ema) < 0.002) signalStrength = 'weak';
    if (Math.abs(scalp_ema) >= 0.002) signalStrength = 'strong';
    // 6. Classificação de momentum com rótulos intuitivos
    let signalMomentum = 'flat';
    if (filteredSignal === 'SELL') {
        if (lastMomentum !== null && lastMomentum < -0.002) signalMomentum = 'fast sell';
        else if (lastMomentum !== null && lastMomentum > 0.002) signalMomentum = 'slowing sell';
    } else if (filteredSignal === 'BUY') {
        if (lastMomentum !== null && lastMomentum > 0.002) signalMomentum = 'fast buy';
        else if (lastMomentum !== null && lastMomentum < -0.002) signalMomentum = 'slowing buy';
    }
    // --- Persistência do histórico a cada candle (1m) ---
    const nowMinute = Math.floor(Date.now() / 60000);
    if (scalpScoreBuffer.length > 2) scalpScoreBuffer.shift();
    scalpScoreBuffer.push(scalp_score);
    let momentum = null;
    if (scalpScoreBuffer.length >= 2) {
        momentum = scalpScoreBuffer[scalpScoreBuffer.length - 1] - scalpScoreBuffer[scalpScoreBuffer.length - 2];
    }
    if (momentum === undefined) momentum = null;
    // --- 7. Threshold ---
    const THRESHOLD = 0.001;
    let decision = 'HOLD';
    if (scalp_score > THRESHOLD) decision = 'BUY';
    else if (scalp_score < -THRESHOLD) decision = 'SELL';
    // --- 8. Resposta detalhada ---
    // --- ATR(14) de 1m para SL/TP ---
    function calcATR(candles, period = 14) {
        if (candles.length < period + 1) return null;
        let trs = [];
        for (let i = candles.length - period; i < candles.length; i++) {
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
        if (trs.length < period) return null;
        return trs.reduce((a, b) => a + b, 0) / trs.length;
    }
    let entryPrice = null, stopLoss = null, takeProfit = null;
    const atr1m = calcATR(c1m, 14);
    // --- Filtros adicionais ---
    let healthyVolatility = false;
    let multiTFConfirm = false;
    let healthyVolume = false;
    // 1. Volatilidade saudável (ATR entre 0.02% e 1.5% do preço)
    if (c1m.length > 0 && atr1m !== null) {
        const price = c1m[c1m.length-1].close;
        const atrPct = price ? (atr1m / price) * 100 : 0;
        healthyVolatility = (atrPct > 0.02 && atrPct < 1.5);
    }
    // 2. Confirmação multi-timeframe
    if (c1m.length > 0 && c5m.length > 0) {
        const c1 = c1m[c1m.length-1];
        const c5 = c5m[c5m.length-1];
        if (filteredSignal === 'BUY') {
            multiTFConfirm = (c1.close > c1.open && c5.close > c5.open);
        } else if (filteredSignal === 'SELL') {
            multiTFConfirm = (c1.close < c1.open && c5.close < c5.open);
        } else {
            multiTFConfirm = true;
        }
    }
    // 3. Filtro de volume (volume atual > 80% da média dos últimos 20 candles)
    if (c1m.length >= 20) {
        const vols = c1m.slice(-20).map(c => c.volume);
        const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
        const volNow = c1m[c1m.length-1].volume;
        healthyVolume = (volNow > avgVol * 0.8);
    }
    filters_debug.trendOverride = trendOverride;
    // Aplica filtros apenas se não houver override de tendência
    if (!trendOverride && (!healthyVolatility || !multiTFConfirm || !healthyVolume)) {
        filteredSignal = 'HOLD';
        filters_debug.confluence_pass = false;
    }
    // Proteção contra whipsaws: cooldown após stop loss
    if (nowMs2 - lastStopLossTime < COOLDOWN_STOPLOSS_MS) {
        filteredSignal = 'HOLD';
        filters_debug.cooldownStopLoss = true;
    }
    // --- Score de Confluência ---
    // Usa o controle dinâmico pelo isConfluenceEnabled global
    if (!isConfluenceEnabled) {
        // filtro completamente ignorado
    } else if (filteredSignal === 'BUY' || filteredSignal === 'SELL') {
        let aligned = 0;
        if (filteredSignal === 'BUY') {
            if (pctPrice_1m > 0) aligned++;
            if (pctVol_1m > 0) aligned++;
            if (book_score > 0) aligned++;
            if (whaleScore > 0) aligned++;
            if (aligned < 3) {
                filteredSignal = 'HOLD';
                filters_debug.confluence_pass = false;
            }
        } else if (filteredSignal === 'SELL') {
            if (pctPrice_1m < 0) aligned++;
            if (pctVol_1m < 0) aligned++;
            if (book_score < 0) aligned++;
            if (aligned < 2) {
                filteredSignal = 'HOLD';
                filters_debug.confluence_pass = false;
            }
        }
        // Se falhou confluence, bloqueia e marca false
        // Caso contrário confluence_pass permanece true
    }
    res.json({
        decision,
        scalp_score: +scalp_score.toFixed(5),
        scalp_ema: +scalp_ema.toFixed(5),
        scalp_signal_raw: rawSignal,
        scalp_signal_filtered: filteredSignal,
        scalp_signal_strength: signalStrength,
        scalp_signal_momentum: signalMomentum,
        scalp_signal_cooldown: cooldownActive,
        tf_score_1m: +tf_score_1m.toFixed(5),
        tf_score_5m: +tf_score_5m.toFixed(5),
        basis_score: +basis_score.toFixed(5),
        funding_score: +funding_score.toFixed(5),
        oi_score: +oi_score.toFixed(5),
        pctPrice_1m: +pctPrice_1m.toFixed(5),
        pctVol_1m: +pctVol_1m.toFixed(5),
        pctPrice_5m: +pctPrice_5m.toFixed(5),
        pctVol_5m: +pctVol_5m.toFixed(5),
        close_now_1m, close_prev_1m, avgVol_1m, vol_now_1m,
        close_now_5m, close_prev_5m, avgVol_5m, vol_now_5m,
        basis_now: basisBuffer[1] ?? basis_now, basis_prev: basisBuffer[0] ?? basis_now,
        funding_now: fundingBuffer[1] ?? funding_now, funding_prev: fundingBuffer[0] ?? funding_now,
        oi_now: oiBuffer[1] ?? oi_now, oi_prev: oiBuffer[0] ?? oi_now,
        momentum: momentum !== null ? +momentum.toFixed(5) : null,
        weights: { w_1m, w_5m, priceW, volW, basisW, fundingW, oiW, w_book, w_whale },
        threshold: THRESHOLD,
        // Novos campos de Book Pressure
        book_pressure_now: book_pressure_now !== null ? +book_pressure_now.toFixed(3) : null,
        book_pressure_prev: book_pressure_prev !== null ? +book_pressure_prev.toFixed(3) : null,
        book_score: book_score !== null ? +book_score.toFixed(3) : null,
        // Whale Flow
        whale_flow: {
            small: +smallFlow.toFixed(2),
            medium: +mediumFlow.toFixed(2),
            large: +largeFlow.toFixed(2)
        },
        whale_score: +whaleScore.toFixed(3),
        trend_score: +trend_score.toFixed(5),
        w_trend,
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        atr_1m: atr1m,
        confluence_enabled: isConfluenceEnabled,
        filters_debug // <-- novo campo
    });
    // DEBUG: Logar timestamps e closes dos candles1m['BTC']
    // Removido conforme solicitado
});

const SCALPING_DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1363915609284280433/oUAHp6Ps4OpVWG8AT-595OMq5giUebbEMvbnUSzn_MUVVq7nIWAFidzZng0T-pzxN36R';
let lastScalpingDecision = null;

async function sendScalpingDiscordAlert(decision, explanation) {
  try {
    let color = 0xf1c40f; // amarelo para HOLD
    let emoji = '⏸️';
    let title = 'Scalping Engine mudou para:';
    if (decision === 'BUY') { color = 0x2ecc71; emoji = '🟢⬆️'; }
    if (decision === 'SELL') { color = 0xe74c3c; emoji = '🔴⬇️'; }
    if (decision === 'HOLD') { color = 0xf1c40f; emoji = '⏸️'; }
    await axios.post(SCALPING_DISCORD_WEBHOOK_URL, {
      content: '@everyone',
      embeds: [{
        title: `${title} ${emoji} ${decision}`,
        description: explanation || '',
        color: color,
        timestamp: new Date().toISOString()
      }]
    });
  } catch (e) {
    console.error('Erro ao enviar alerta do scalping para Discord:', e.message, e.response?.data);
  }
}

function scalpingEngine() {
    // ... lógica do scalping ...
    const result = {
        decision, // 'BUY', 'SELL', 'HOLD'
        explanation, // explicação opcional
        timestamp: new Date().toISOString()
    };
    // Enviar alerta para o Discord se a decisão mudou
    if (decision && decision !== lastScalpingDecision) {
        sendScalpingDiscordAlert(decision, explanation);
        lastScalpingDecision = decision;
    }
    return result;
}

app.get('/api/test-scalping-discord', async (req, res) => {
  await sendScalpingDiscordAlert('BUY', 'Teste de alerta manual do scalping.');
  res.json({ status: 'ok' });
});

app.get('/api/candles1m-btc', (req, res) => {
    const arr = candles1m['BTC'] || [];
    res.json({
        count: arr.length,
        last20: arr.slice(-20)
    });
});

// --- Book Pressure Binance WebSocket ---
let bookPressureHistory = [];
function startBookPressureBinance() {
    const ws = new WebSocket('wss://dstream.binance.com/ws/btcusd_perp@depth20@100ms');
    ws.on('open', () => {
        console.log('[BookPressure] WebSocket Binance conectado.');
    });
    ws.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            const bids = (parsed.b || []).map(([p, s]) => [parseFloat(p), parseFloat(s)]);
            const asks = (parsed.a || []).map(([p, s]) => [parseFloat(p), parseFloat(s)]);
            if (!bids.length || !asks.length) return;
            const bestBid = bids[0][0];
            const bestAsk = asks[0][0];
            const mid = (bestBid + bestAsk) / 2;
            const vol_bids = bids.filter(([p]) => p > mid * 0.999).reduce((a, [,s]) => a + s, 0);
            const vol_asks = asks.filter(([p]) => p < mid * 1.001).reduce((a, [,s]) => a + s, 0);
            let pressure = 0;
            if (vol_bids + vol_asks > 0) {
                pressure = (vol_bids - vol_asks) / (vol_bids + vol_asks);
            }
            if (!latestSignals.BTC) latestSignals.BTC = {};
            latestSignals.BTC.book_pressure = pressure;
            // Atualiza histórico para deltaBook5s
            const now = Date.now();
            bookPressureHistory.push({ timestamp: now, value: pressure });
            // Limpa valores antigos (>10s)
            bookPressureHistory = bookPressureHistory.filter(e => now - e.timestamp <= 10000);
            // Calcula deltaBook5s
            const fiveSecondsAgo = now - 5000;
            let prev = null;
            for (let i = bookPressureHistory.length - 1; i >= 0; i--) {
                if (bookPressureHistory[i].timestamp <= fiveSecondsAgo) {
                    prev = bookPressureHistory[i];
                    break;
                }
            }
            let deltaBook5s = 0;
            if (prev) {
                deltaBook5s = pressure - prev.value;
            }
            latestSignals.BTC.deltaBook5s = deltaBook5s;
            // Removido log de debug
        } catch (e) {
            // Ignora parse errors
        }
    });
    ws.on('close', () => {
        console.log('[BookPressure] WebSocket Binance desconectado. Reconectando em 5s...');
        setTimeout(startBookPressureBinance, 5000);
    });
    ws.on('error', (err) => {
        console.error('[BookPressure] WebSocket erro:', err);
        ws.close();
    });
}

startBookPressureBinance();

// --- WhaleFlow via blockchain.com WebSocket ---
function startWhaleFlowBlockchain() {
    const ws = new WebSocket('wss://ws.blockchain.info/inv');
    ws.on('open', () => {
        console.log('[WhaleFlow] WebSocket blockchain.info conectado.');
        ws.send(JSON.stringify({ op: 'unconfirmed_sub' }));
    });
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.op === 'utx' && msg.x && Array.isArray(msg.x.out)) {
                const total = msg.x.out.reduce((sum, o) => sum + (o.value || 0), 0);
                if (total > 1 * 1e8) {
                    whaleFlowBuffer.push({
                        value: total,
                        timestamp: Date.now()
                    });
                    // Removido log do WhaleFlow
                }
            }
        } catch (e) {
            // Ignora parse errors
        }
    });
    ws.on('close', () => {
        console.log('[WhaleFlow] WebSocket blockchain.info desconectado. Reconectando em 5s...');
        setTimeout(startWhaleFlowBlockchain, 5000);
    });
    ws.on('error', (err) => {
        console.error('[WhaleFlow] WebSocket erro:', err);
        ws.close();
    });
}
// Zerar o buffer ao inicializar
whaleFlowBuffer = [];
startWhaleFlowBlockchain();

// --- NOVO MACRO-ENGINE latest-decision ---

// Parâmetros configuráveis
const INDICES = [
  { key: 'NASDAQ', sign: +1, tf_keys: { '1D': 'NASDAQ_1D', '1H': 'NASDAQ_1H', '15m': 'NASDAQ_15m' } },
  { key: 'SPX500', sign: +1, tf_keys: { '1D': 'SPX500_1D', '1H': 'SPX500_1H', '15m': 'SPX500_15m' } },
  { key: 'RUT', sign: +1, tf_keys: { '1D': 'RUT_1D', '1H': 'RUT_1H', '15m': 'RUT_15m' } },
  { key: 'GOLD', sign: +1, tf_keys: { '1D': 'GOLD_1D', '1H': 'GOLD_1H', '15m': 'GOLD_15m' } },
  { key: 'CRUDEOIL', sign: +1, tf_keys: { '1D': 'CRUDEOIL_1D', '1H': 'CRUDEOIL_1H', '15m': 'CRUDEOIL_15m' } },
  { key: 'VIX', sign: -1, tf_keys: { '1D': 'VIX_1D', '1H': 'VIX_1H', '15m': 'VIX_15m' } },
  { key: 'DXY', sign: -1, tf_keys: { '1D': 'DXY_1D', '1H': 'DXY_1H', '15m': 'DXY_15m' } },
  { key: 'T10Y2Y', sign: -1, tf_keys: { '1D': 'T10Y2Y_1D', '1H': 'T10Y2Y_1H', '15m': 'T10Y2Y_15m' } },
  { key: 'HYSPREAD', sign: -1, tf_keys: { '1D': 'HYSPREAD_1D', '1H': 'HYSPREAD_1H', '15m': 'HYSPREAD_15m' } },
  { key: 'MOVE', sign: -1, tf_keys: { '1D': 'MOVE_1D', '1H': 'MOVE_1H', '15m': 'MOVE_15m' } },
];
const TF_WEIGHTS = { '1D': 0.6, '1H': 0.25, '15m': 0.15 };
const PRICE_WEIGHT = 0.7;
const VOLUME_WEIGHT = 0.3;
const THRESHOLD = 0.05;

function getPctChange(now, prev) {
  if (typeof now !== 'number' || typeof prev !== 'number' || prev === 0) return 0;
  return (now / prev) - 1;
}

// Variável global para guardar o score anterior do macroEngine
if (!global.lastTotalScore) global.lastTotalScore = 0;
const VEL_THRESHOLD = 0.3;

function getGlobalZone(score) {
    if (score < -0.05) return { tag: 'Strong Sell', color: '#e74c3c' };
    if (score < -0.01) return { tag: 'Weak Sell', color: '#f39c12' };
    if (score <= 0.01 && score >= -0.01) return { tag: 'Neutral', color: '#aaa' };
    if (score <= 0.05) return { tag: 'Weak Buy', color: '#2ecc71' };
    return { tag: 'Strong Buy', color: '#198754' };
}

function macroEngine(currentMarketData) {
  let total_score = 0;
  let breakdown = {};
  for (const idx of INDICES) {
    let idx_score = 0;
    breakdown[idx.key] = {};
    // Detectar TFs disponíveis (com preço)
    const available_tfs = Object.keys(TF_WEIGHTS).filter(tf => {
      const tf_key = idx.tf_keys[tf];
      const data = currentMarketData[tf_key] || {};
      return typeof data.close_now === 'number' && typeof data.close_prev === 'number' && data.close_prev !== 0;
    });
    const sum_w = available_tfs.reduce((acc, tf) => acc + TF_WEIGHTS[tf], 0);
    let tf_scores = {};
    for (const tf of available_tfs) {
      const tf_key = idx.tf_keys[tf];
      const data = currentMarketData[tf_key] || {};
      const pctPrice = (typeof data.close_now === 'number' && typeof data.close_prev === 'number' && data.close_prev !== 0)
        ? (data.close_now / data.close_prev) - 1 : 0;
      // DEBUG LOG solicitado
      const prevTs = data.prev_timestamp ? new Date(data.prev_timestamp).toISOString() : 'N/A';
      const currTs = data.curr_timestamp ? new Date(data.curr_timestamp).toISOString() : 'N/A';
      // [DEBUG LOG solicitado]
      // console.log(`[DEBUG][${idx.key}][${tf}] prev_close=${data.close_prev} (${prevTs}), curr_close=${data.close_now} (${currTs}), pctPrice=${pctPrice >= 0 ? '+' : ''}${pctPrice.toFixed(6)}`);
      let pctVol = 0;
      let priceW = PRICE_WEIGHT, volW = VOLUME_WEIGHT;
      // Calcular média de volume no TF se houver série de volume
      if (typeof data.vol_now === 'number' && Array.isArray(data.vol_series) && data.vol_series.length > 0) {
        const avgVol = data.vol_series.reduce((a, b) => a + b, 0) / data.vol_series.length;
        if (avgVol !== 0) {
          pctVol = (data.vol_now / avgVol) - 1;
        } else {
          pctVol = 0;
        }
      } else {
        pctVol = 0;
        priceW = 1.0; volW = 0.0;
      }
      const w_norm = TF_WEIGHTS[tf] / sum_w;
      const tf_score = w_norm * (priceW * pctPrice + volW * pctVol);
      tf_scores[tf] = { pctPrice, pctVol, tf_score, w_norm, priceW, volW };
      idx_score += tf_score;
    }
    breakdown[idx.key] = { ...tf_scores, idx_score };
    total_score += idx_score;
  }
  // --- NOVO: cálculo de momentum ---
  const velocity = typeof global.lastTotalScore === 'number' ? (total_score - global.lastTotalScore) : 0;
  global.lastTotalScore = total_score;
  // ---
  // --- Decisão textual e zona ---
  const zone = getGlobalZone(total_score);
  let decision = 'HOLD';
  if (zone.tag === 'Strong Buy' || zone.tag === 'Weak Buy') decision = 'BUY';
  else if (zone.tag === 'Strong Sell' || zone.tag === 'Weak Sell') decision = 'SELL';
  // Campo separado de momentum
  let momentum = null;
  if (velocity >= VEL_THRESHOLD) momentum = 'positive';
  else if (velocity <= -VEL_THRESHOLD) momentum = 'negative';
  return { decision, total_score, velocity, momentum, zone: zone.tag, breakdown, timestamp: new Date().toISOString() };
}

// Novo endpoint /api/latest-decision
app.get('/api/latest-decision', async (req, res) => {
  try {
    const result = macroEngine(global.currentMarketData || {});
    // Enviar alerta para o Discord se a decisão mudou
    if (result.decision && result.decision !== lastDiscordDecision) {
        let emoji = '⏸️';
        if (result.decision === 'BUY') emoji = '🟢⬆️';
        if (result.decision === 'SELL') emoji = '🔴⬇️';
        if (result.decision === 'HOLD') emoji = '⏸️';
        sendDiscordAlert(result.decision, `${emoji} Novo sinal macro: ${result.decision} (score: ${result.total_score.toFixed(5)})`);
        lastDiscordDecision = result.decision;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

// Atualiza global.currentMarketData com os candles de cada índice/timeframe
function updateMacroMarketDataFromCandles() {
  if (!global.currentMarketData) global.currentMarketData = {};
  const macroIndices = [
    { key: 'NASDAQ', buf: 'Nasdaq' },
    { key: 'SPX500', buf: 'S_P500' },
    { key: 'RUT', buf: 'RUT' },
    { key: 'GOLD', buf: 'Gold' },
    { key: 'CRUDEOIL', buf: 'CrudeOil' },
    { key: 'VIX', buf: 'VIX' },
    { key: 'DXY', buf: 'DXY' },
    { key: 'T10Y2Y', buf: 'T10Y2Y' },
    { key: 'HYSPREAD', buf: 'HY_Spread' },
    { key: 'MOVE', buf: 'MOVE' },
  ];
  const tfs = [
    { tf: '1D', buf: 'candles1d' },
    { tf: '1H', buf: 'candles1h' },
    { tf: '15m', buf: 'candles15m' },
  ];
  for (const idx of macroIndices) {
    for (const tf of tfs) {
      let arr = [];
      if (tf.buf === 'candles1d') arr = candles1d[idx.buf] || [];
      if (tf.buf === 'candles1h') arr = candles1h[idx.buf] || [];
      if (tf.buf === 'candles15m') arr = candles15m[idx.buf] || [];
      if (arr.length >= 2) {
        // Seleciona currBar como o último candle
        let currBar = arr[arr.length - 1];
        if (currBar.timestamp < 1e12) currBar.timestamp = currBar.timestamp * 1000;
        // Busca prevBar: o candle mais recente com timestamp < currBar.timestamp
        let prevIdx = arr.length - 2;
        let prevBar = arr[prevIdx];
        while (prevIdx >= 0 && prevBar.timestamp >= currBar.timestamp) {
          prevIdx--;
          prevBar = arr[prevIdx];
        }
        if (!prevBar || prevBar.timestamp >= currBar.timestamp) {
          console.warn(`[CANDLE][${idx.key}][${tf.tf}] Não encontrou prevBar válido para currBar ts=${currBar.timestamp}`);
          global.currentMarketData[`${idx.key}_${tf.tf}`] = {
            close_now: 0, close_prev: 0, vol_now: 0, vol_prev: 0, vol_series: [], curr_timestamp: null, prev_timestamp: null, curr_bar_start: null, curr_bar_end: null, prev_bar_start: null, prev_bar_end: null
          };
          continue;
        }
        if (prevBar.timestamp < 1e12) prevBar.timestamp = prevBar.timestamp * 1000;
        const vol_series = arr.slice(-20).map(c => typeof c.volume === 'number' ? c.volume : 0);
        // Calcular start/endTime corretos para cada TF
        let tfMillis = 0;
        if (tf.tf === '1D') tfMillis = 24 * 60 * 60 * 1000;
        if (tf.tf === '1H') tfMillis = 60 * 60 * 1000;
        if (tf.tf === '15m') tfMillis = 15 * 60 * 1000;
        // Logar os intervalos para debug
        // console.log(`[CANDLE][${idx.key}][${tf.tf}] prev: ts=${prevBar.timestamp}, start=${new Date(prevBar.timestamp).toISOString()}, end=${new Date(prevBar.timestamp + tfMillis - 1).toISOString()} | curr: ts=${currBar.timestamp}, start=${new Date(currBar.timestamp).toISOString()}, end=${new Date(currBar.timestamp + tfMillis - 1).toISOString()}`);
        // --- NOVO: log para comparar com TradingView ---
        // console.log(
        //   `[${tf.tf}] prev=${new Date(prevBar.timestamp).toISOString()}@${prevBar.close}  curr=${new Date(currBar.timestamp).toISOString()}@${currBar.close}`
        // );
        global.currentMarketData[`${idx.key}_${tf.tf}`] = {
          close_now: currBar.close,
          close_prev: prevBar.close,
          vol_now: currBar.volume,
          vol_prev: prevBar.volume,
          vol_series,
          curr_timestamp: currBar.timestamp,
          prev_timestamp: prevBar.timestamp,
          curr_bar_start: currBar.timestamp ? new Date(currBar.timestamp).toISOString() : null,
          curr_bar_end: currBar.timestamp ? new Date(currBar.timestamp + tfMillis - 1).toISOString() : null,
          prev_bar_start: prevBar.timestamp ? new Date(prevBar.timestamp).toISOString() : null,
          prev_bar_end: prevBar.timestamp ? new Date(prevBar.timestamp + tfMillis - 1).toISOString() : null
        };
      } else {
        global.currentMarketData[`${idx.key}_${tf.tf}`] = {
          close_now: 0, close_prev: 0, vol_now: 0, vol_prev: 0, vol_series: [], curr_timestamp: null, prev_timestamp: null, curr_bar_start: null, curr_bar_end: null, prev_bar_start: null, prev_bar_end: null
        };
      }
    }
  }
  // LOG: mostrar conteúdo real dos buffers 1D para debug
  // console.log('candles1d["T10Y2Y"]:', candles1d['T10Y2Y']);
  // console.log('candles1d["HY_Spread"]:', candles1d['HY_Spread']);
  // console.log('candles1d["MOVE"]:', candles1d['MOVE']);
}

// Atualizar a cada 30 segundos
setInterval(updateMacroMarketDataFromCandles, 30000);
// E também logo após inicialização
updateMacroMarketDataFromCandles();

// Função utilitária para buscar histórico diário de um símbolo do TradingView
async function fetchDailyHistory(symbol, n = 30) {
    if (!tvClient || !clientReady) await initializeTradingView();
    return new Promise((resolve, reject) => {
        const chart = new tvClient.Session.Chart();
        chart.setMarket(symbol, { timeframe: 'D', range: n });
        chart.onError((...err) => {
            chart.delete();
            reject(err);
        });
        chart.onUpdate(() => {
            if (chart.periods && chart.periods.length > 0) {
                // Converter para formato do buffer
                const candles = chart.periods.map(p => {
                    let ts = p.time || p.timestamp;
                    if (ts < 1e12) ts = ts * 1000; // Corrigir para ms se vier em segundos
                    return {
                        timestamp: ts,
                        open: p.open,
                        high: p.max ?? p.high,
                        low: p.min ?? p.low,
                        close: p.close,
                        volume: p.volume || 0
                    };
                });
                chart.delete();
                resolve(candles.reverse()); // do mais antigo para o mais recente
            }
        });
    });
}

// Função para popular todos os buffers candles1d dos índices macro
async function populateAllDailyBuffers() {
    const macroSymbols = [
        { key: 'Nasdaq', tv: symbols['Nasdaq'] },
        { key: 'S_P500', tv: symbols['S_P500'] },
        { key: 'RUT', tv: symbols['RUT'] },
        { key: 'VIX', tv: symbols['VIX'] },
        { key: 'DXY', tv: symbols['DXY'] },
        { key: 'Gold', tv: symbols['Gold'] },
        { key: 'CrudeOil', tv: symbols['CrudeOil'] },
        { key: 'T10Y2Y', tv: symbols['T10Y2Y'] },
        { key: 'HY_Spread', tv: symbols['HY_Spread'] },
        { key: 'MOVE', tv: symbols['MOVE'] }
    ];
    for (const { key, tv } of macroSymbols) {
        try {
            const candles = await fetchDailyHistory(tv, 30);
            candles1d[key] = candles;
            console.log(`[HIST] candles1d[${key}] carregado com ${candles.length} candles`);
            // Atualizar latestMarketData para o frontend
            if (candles && candles.length > 1) {
                const last = candles[candles.length - 1];
                const prev = candles[candles.length - 2];
                latestMarketData[key] = {
                    price: last.close,
                    chg: last.close - prev.close,
                    chg_pct: prev.close !== 0 ? ((last.close - prev.close) / prev.close) * 100 : null,
                    prevClose: prev.close,
                    last_update: Date.now()
                };
            }
        } catch (e) {
            console.error(`[HIST] Falha ao carregar candles1d[${key}]:`, e);
        }
        await new Promise(r => setTimeout(r, 500)); // evitar rate limit
    }
}

// Função utilitária para buscar histórico intraday de um símbolo do TradingView
async function fetchIntradayHistory(symbol, tf = '60', n = 100) {
    if (!tvClient || !clientReady) await initializeTradingView();
    return new Promise((resolve, reject) => {
        const chart = new tvClient.Session.Chart();
        chart.setMarket(symbol, { timeframe: tf, range: n });
        chart.onError((...err) => {
            chart.delete();
            reject(err);
        });
        chart.onUpdate(() => {
            if (chart.periods && chart.periods.length > 0) {
                // Converter para formato do buffer
                const candles = chart.periods.map(p => {
                    let ts = p.time || p.timestamp;
                    if (ts < 1e12) ts = ts * 1000; // Corrigir para ms se vier em segundos
                    return {
                        timestamp: ts,
                        open: p.open,
                        high: p.max ?? p.high,
                        low: p.min ?? p.low,
                        close: p.close,
                        volume: p.volume || 0
                    };
                });
                chart.delete();
                resolve(candles.reverse()); // do mais antigo para o mais recente
            }
        });
    });
}

// Função para popular todos os buffers candles1h e candles15m dos índices macro
async function populateAllIntradayBuffers() {
    const macroSymbols = [
        { key: 'Nasdaq', tv: symbols['Nasdaq'] },
        { key: 'S_P500', tv: symbols['S_P500'] },
        { key: 'RUT', tv: symbols['RUT'] },
        { key: 'VIX', tv: symbols['VIX'] },
        { key: 'DXY', tv: symbols['DXY'] },
        { key: 'Gold', tv: symbols['Gold'] },
        { key: 'CrudeOil', tv: symbols['CrudeOil'] }
        // T10Y2Y, HY_Spread, MOVE não têm série intraday
    ];
    for (const { key, tv } of macroSymbols) {
        try {
            // 1H
            const candles1hArr = await fetchIntradayHistory(tv, '60', 100);
            candles1h[key] = candles1hArr;
            console.log(`[HIST] candles1h[${key}] carregado com ${candles1hArr.length} candles`);
            // 15m
            const candles15mArr = await fetchIntradayHistory(tv, '15', 100);
            candles15m[key] = candles15mArr;
            console.log(`[HIST] candles15m[${key}] carregado com ${candles15mArr.length} candles`);
        } catch (e) {
            console.error(`[HIST] Falha ao carregar candles intraday [${key}]:`, e);
        }
        await new Promise(r => setTimeout(r, 500)); // evitar rate limit
    }
}

// Chamar populateAllIntradayBuffers após inicializar o TradingView, antes de startRealtimeMonitoring
(async () => {
    await initializeTradingView();
    await populateAllDailyBuffers();
    await populateAllIntradayBuffers();
    await startRealtimeMonitoring();
})();
// (Opcional) Atualizar intraday buffers periodicamente (ex: a cada 10 minutos)
setInterval(populateAllIntradayBuffers, 10 * 60 * 1000);

// Função para verificar se o mercado global está aberto (domingo 17:00 ET até sexta 17:00 ET)
function isMarketGloballyOpen(now) {
    const ny = require('moment-timezone')(now).tz('America/New_York');
    const day = ny.day(); // 0=domingo, 1=segunda, ..., 5=sexta, 6=sábado
    const hour = ny.hour();
    const minute = ny.minute();
    // Abre domingo 17:00 ET
    if (day === 0 && (hour > 17 || (hour === 17 && minute >= 0))) return true;
    // Segunda a quinta: sempre aberto
    if (day >= 1 && day <= 4) return true;
    // Sexta: aberto até 17:00 ET
    if (day === 5 && (hour < 17 || (hour === 17 && minute === 0))) return true;
    // Sábado: fechado
    return false;
}

// Endpoint para status do mercado global
app.get('/api/market-status', (req, res) => {
    const now = new Date();
    const open = isMarketGloballyOpen(now);
    // Mercados especiais que seguem a regra global
    const SPECIAL_MARKETS = ["T10Y2Y", "HY Spread", "MOVE"];
    const MARKETS = [
        "NASDAQ", "S&P 500", "VIX", "DXY", "Gold", "Crude Oil", ...SPECIAL_MARKETS
    ];
    const status = {};
    for (const m of MARKETS) {
        status[m] = {
            data_fresh: open,
            message: open ? "Mercado aberto" : "Mercado fechado"
        };
    }
    res.json(status);
});

// Atualizar o campo last_update dos mercados especiais sempre que o mercado global estiver aberto
setInterval(() => {
    const now = new Date();
    const open = isMarketGloballyOpen(now);
    const SPECIAL_MARKETS = ["T10Y2Y", "HY Spread", "MOVE"];
    if (open) {
        for (const key of SPECIAL_MARKETS) {
            if (!latestMarketData[key]) latestMarketData[key] = {};
            latestMarketData[key].last_update = Date.now();
        }
    }
}, 60 * 1000); // a cada 1 minuto

// --- Polling Funding Rate e Open Interest Binance a cada 1 min ---
setInterval(async () => {
    try {
        // Funding Rate
        const fundingResp = await axios.get('http://localhost:5001/api/binance-funding-rate?symbol=BTCUSD_PERP');
        if (!latestSignals.BTC) latestSignals.BTC = {};
        latestSignals.BTC.funding_rate = fundingResp.data.funding_rate;
        latestSignals.BTC.funding_time = fundingResp.data.funding_time || fundingResp.data.funding_rate_time;
        // Open Interest
        const oiResp = await axios.get('http://localhost:5001/api/binance-open-interest?symbol=BTCUSD_PERP');
        latestSignals.BTC.open_interest = oiResp.data.open_interest;
        latestSignals.BTC.open_interest_time = oiResp.data.time;
        // Emitir atualização
        marketUpdateEmitter.emit('update', { type: 'full', data: latestSignals });
    } catch (err) {
        console.error('[Polling Binance] Erro ao atualizar funding/OI:', err.message);
    }
}, 60000);

// --- Endpoint para histórico de scalp_score/momentum ---
app.get('/api/scalp-history', (req, res) => {
    // period=1d, 7d, 1h, etc. Default: 1d (1440min)
    let period = req.query.period || '1d';
    let minutes = 1440;
    if (period.endsWith('h')) minutes = parseInt(period) * 60;
    else if (period.endsWith('d')) minutes = parseInt(period) * 1440;
    else if (!isNaN(parseInt(period))) minutes = parseInt(period);
    const history = loadScalpHistory(minutes);
    res.json({ count: history.length, history });
});

// Fallback: consulta REST da mempool.space a cada 10s para grandes transações
setInterval(async () => {
    try {
        const resp = await axios.get('https://mempool.space/api/mempool/recent');
        for (const tx of resp.data) {
            if (tx.value && tx.value > 1 * 1e8) {
                console.log('[WhaleFlow REST] TX grande:', tx.txid, (tx.value / 1e8).toFixed(2), 'BTC');
            }
        }
    } catch (e) {
        console.error('[WhaleFlow REST] Erro:', e.message);
    }
}, 10000);

// --- Endpoint para MT4 pegar a última ordem ---
app.get('/api/mt4-order/latest', (req, res) => {
    // Remover log de acesso ao endpoint
    // const now = new Date().toISOString();
    // const remoteIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    // console.log(`[${now}] /api/mt4-order/latest accessed from ${remoteIp}`);
    res.json(lastMt4Order);
});

// --- Novo endpoint para decisão de Day Trade BTCUSD ---
app.get('/api/daytrade-decision', async (req, res) => {
    // 1. Obter candles de 15m e 1h
    const c15m = candles15m['BTC'] || [];
    const c1h = candles1h['BTC'] || [];
    // Funções auxiliares
    function pctChange(now, prev) {
        if (typeof now !== 'number' || typeof prev !== 'number' || prev === 0) return 0;
        return (now / prev) - 1;
    }
    function avg(arr) {
        if (!arr || arr.length === 0) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }
    // 2. Calcular indicadores principais
    // --- 15m ---
    let close_now_15m = 0, close_prev_15m = 0, pctPrice_15m = 0, vol_now_15m = 0, avgVol_15m = 0;
    if (c15m.length >= 2) {
        close_now_15m = c15m[c15m.length-1].close;
        close_prev_15m = c15m[c15m.length-2].close;
        pctPrice_15m = pctChange(close_now_15m, close_prev_15m);
        vol_now_15m = c15m[c15m.length-1].volume;
        avgVol_15m = avg(c15m.slice(-20).map(c => c.volume));
    }
    // --- 1h ---
    let close_now_1h = 0, close_prev_1h = 0, pctPrice_1h = 0, vol_now_1h = 0, avgVol_1h = 0;
    if (c1h.length >= 2) {
        close_now_1h = c1h[c1h.length-1].close;
        close_prev_1h = c1h[c1h.length-2].close;
        pctPrice_1h = pctChange(close_now_1h, close_prev_1h);
        vol_now_1h = c1h[c1h.length-1].volume;
        avgVol_1h = avg(c1h.slice(-20).map(c => c.volume));
    }
    // --- ATR(14) 15m ---
    function calcATR(candles, period = 14) {
        if (candles.length < period + 1) return null;
        let trs = [];
        for (let i = candles.length - period; i < candles.length; i++) {
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
        if (trs.length < period) return null;
        return trs.reduce((a, b) => a + b, 0) / trs.length;
    }
    const atr_15m = calcATR(c15m, 14);
    // --- Tendência (EMA 20 vs EMA 50) ---
    function calcEMA(arr, period) {
        if (!arr || arr.length < period) return null;
        let k = 2 / (period + 1);
        let ema = arr[0];
        for (let i = 1; i < arr.length; i++) {
            ema = arr[i] * k + ema * (1 - k);
        }
        return ema;
    }
    let trend_15m = 'neutral', trend_1h = 'neutral';
    if (c15m.length >= 50) {
        const closes = c15m.map(c => c.close);
        const ema20 = calcEMA(closes.slice(-50), 20);
        const ema50 = calcEMA(closes.slice(-50), 50);
        if (ema20 && ema50) {
            if (ema20 > ema50) trend_15m = 'bullish';
            else if (ema20 < ema50) trend_15m = 'bearish';
        }
    }
    if (c1h.length >= 50) {
        const closes = c1h.map(c => c.close);
        const ema20 = calcEMA(closes.slice(-50), 20);
        const ema50 = calcEMA(closes.slice(-50), 50);
        if (ema20 && ema50) {
            if (ema20 > ema50) trend_1h = 'bullish';
            else if (ema20 < ema50) trend_1h = 'bearish';
        }
    }
    // 3. Obter contexto macro
    let macro_context = 'neutral';
    try {
        const macro = latestSignals.Overall?.trend || null;
        if (macro === 'bullish') macro_context = 'bullish';
        else if (macro === 'bearish') macro_context = 'bearish';
    } catch {}
    // 4. Aplicar filtros
    let filters_debug = {
        trend_15m: trend_15m !== 'neutral',
        trend_1h: trend_1h !== 'neutral',
        volume_15m: vol_now_15m > avgVol_15m,
        volume_1h: vol_now_1h > avgVol_1h,
        volatility: atr_15m !== null && atr_15m > 0,
        macro: macro_context !== 'bearish',
    };
    let decision = 'HOLD';
    let signal_strength = 'none';
    let explanation = '';
    // BUY
    if (
        trend_15m === 'bullish' &&
        trend_1h === 'bullish' &&
        vol_now_15m > avgVol_15m &&
        vol_now_1h > avgVol_1h &&
        atr_15m !== null && atr_15m > 0 &&
        macro_context !== 'bearish'
    ) {
        decision = 'BUY';
        signal_strength = 'strong';
        explanation = 'Tendência de alta em 15m e 1h, volume acima da média, volatilidade saudável, macro favorável.';
    }
    // SELL
    if (
        trend_15m === 'bearish' &&
        trend_1h === 'bearish' &&
        vol_now_15m > avgVol_15m &&
        vol_now_1h > avgVol_1h &&
        atr_15m !== null && atr_15m > 0 &&
        macro_context !== 'bullish'
    ) {
        decision = 'SELL';
        signal_strength = 'strong';
        explanation = 'Tendência de baixa em 15m e 1h, volume acima da média, volatilidade saudável, macro favorável.';
    }
    // 5. Definir entrada, stop e alvo
    let entry_price = null, stop_loss = null, take_profit = null;
    if (decision === 'BUY' || decision === 'SELL') {
        entry_price = close_now_15m;
        if (decision === 'BUY') {
            stop_loss = entry_price - (atr_15m || 0);
            take_profit = entry_price + 2 * (atr_15m || 0);
        } else if (decision === 'SELL') {
            stop_loss = entry_price + (atr_15m || 0);
            take_profit = entry_price - 2 * (atr_15m || 0);
        }
    }
    // 6. Montar resposta JSON
    res.json({
        decision,
        signal_strength,
        entry_price,
        stop_loss,
        take_profit,
        timeframes: ['15m', '1h'],
        trend_15m,
        trend_1h,
        atr_15m,
        close_now_15m,
        close_prev_15m,
        pctPrice_15m,
        vol_now_15m,
        avgVol_15m,
        close_now_1h,
        close_prev_1h,
        pctPrice_1h,
        vol_now_1h,
        avgVol_1h,
        macro_context,
        filters_debug,
        explanation
    });
});

// Controle dinâmico para filtro de confluência
let isConfluenceEnabled = true;

// Endpoint para obter status do filtro de confluência
app.get('/api/config/confluence-status', (req, res) => {
    res.json({ enabled: isConfluenceEnabled });
});

// Endpoint para alternar status do filtro de confluência
app.post('/api/config/toggle-confluence', (req, res) => {
    isConfluenceEnabled = !isConfluenceEnabled;
    res.json({ enabled: isConfluenceEnabled });
});