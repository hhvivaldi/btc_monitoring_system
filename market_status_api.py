from flask import Flask, jsonify
from datetime import datetime, timedelta
import pytz

app = Flask(__name__)

# Lista dos mercados globais
MARKETS = [
    "NASDAQ",
    "S&P 500",
    "VIX",
    "DXY",
    "Gold",
    "Crude Oil"
]

def is_market_open_et():
    """Retorna True se agora está entre domingo 17:00 ET e sexta 17:00 ET."""
    et = pytz.timezone('US/Eastern')
    now = datetime.now(et)
    weekday = now.weekday()  # 0=segunda, 6=domingo
    hour = now.hour
    minute = now.minute
    # Domingo após 17:00 até sexta antes de 17:00
    if weekday == 6 and (hour > 17 or (hour == 17 and minute >= 0)):
        return True
    if 0 <= weekday <= 4:
        return True
    if weekday == 5 and (hour < 17 or (hour == 17 and minute == 0)):
        return True
    return False

@app.route('/api/market-status')
def market_status():
    open_now = is_market_open_et()
    status = {}
    for m in MARKETS:
        status[m] = {
            "data_fresh": open_now,
            "message": "Mercado aberto" if open_now else "Mercado fechado"
        }
    return jsonify(status)

if __name__ == '__main__':
    app.run(port=5000, debug=True) 