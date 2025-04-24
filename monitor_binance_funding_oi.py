# monitor_binance_funding_oi.py

import time
from datetime import datetime, timedelta
from binance.client import Client

# --- CONFIGURAÇÕES ---
BINANCE_API_KEY = 'bHxSmhfRWMGGza0x2HIoSIuSjTn3UqS5nPVMLLQDSHW7qtAG8e7FmVY53I4JVtfg'
BINANCE_API_SECRET = 'EISK8K8MbKvFA2sLgaWsJF9Nq4y4nlhITx2xodPVxGduRRTunFymCXGyFwfqptY9'
SYMBOL = 'BTCUSDT'
INTERVAL = 30  # segundos

# --- SETUP ---
client = Client(api_key=BINANCE_API_KEY, api_secret=BINANCE_API_SECRET)

# Para armazenar o OI de 1h atrás (em memória)
oi_history = []

def get_funding_rate():
    funding = client.futures_funding_rate(symbol=SYMBOL, limit=1)
    return float(funding[0]['fundingRate']), funding[0]['fundingTime']

def get_open_interest():
    oi = client.futures_open_interest(symbol=SYMBOL)
    return float(oi['openInterest'])

def main_loop():
    while True:
        try:
            funding_rate, funding_time = get_funding_rate()
            oi_now = get_open_interest()
            now = datetime.utcnow()

            # Atualiza histórico de OI (mantém só 1h)
            oi_history.append((now, oi_now))
            oi_history[:] = [(t, v) for t, v in oi_history if t > now - timedelta(hours=1)]
            oi_ago1h = oi_history[0][1] if oi_history else None

            sinal_funding = 0
            if funding_rate > 0.001:
                sinal_funding = 1
            elif funding_rate < -0.001:
                sinal_funding = -1

            sinal_oi = 0
            if oi_ago1h:
                delta_oi = (oi_now - oi_ago1h) / oi_ago1h
                if delta_oi > 0.05:
                    sinal_oi = 1
                elif delta_oi < -0.05:
                    sinal_oi = -1
            else:
                delta_oi = None

            funding_score = sinal_funding + sinal_oi

            print(f"[{now:%Y-%m-%d %H:%M:%S}] Funding: {funding_rate:.6f}, OI: {oi_now:.2f}, ΔOI: {delta_oi if delta_oi is not None else 'N/A'}, Score: {funding_score}")

            if abs(funding_rate) > 0.001 or (delta_oi is not None and abs(delta_oi) > 0.05):
                print('ALERTA: Funding ou Delta OI extremo!')

        except Exception as e:
            print("Erro na coleta:", e)

        time.sleep(INTERVAL)

if __name__ == '__main__':
    main_loop() 