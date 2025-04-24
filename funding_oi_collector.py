# funding_oi_collector.py
"""
Script para coletar funding rate e open interest da Binance Perp
E gravar no InfluxDB periodicamente (a cada 1 minuto)
Não interfere no backend Node.js
"""
import time
from binance.client import Client
from influxdb_client import InfluxDBClient, Point, WritePrecision

# --- CONFIG ---
INFLUX_URL = 'https://eu-central-1-1.aws.cloud2.influxdata.com'  # Atualizado para Cloud
INFLUX_TOKEN = '3lJ_Z6XEWjVB9r7zbm7mZpQf6U-2b8WIVfcGEue6Q8WrhDjQVlXJwsZ49Vdj83FmNvqeuPikoSaZ8ZUw9QR-fQ=='
INFLUX_ORG = 'Hermano'
INFLUX_BUCKET = 'funding_oi'
SYMBOL = 'BTCUSDT'

# --- Binance client ---
client = Client()

# --- InfluxDB client ---
influx = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = influx.write_api()

def fetch_and_store():
    # Funding rate
    funding = client.futures_funding_rate(symbol=SYMBOL, limit=1)[0]
    funding_time = int(funding['fundingTime']) // 1000
    funding_rate = float(funding['fundingRate'])
    # Open interest
    oi = client.futures_open_interest(symbol=SYMBOL)
    oi_time = int(time.time())
    open_interest = float(oi['openInterest'])
    # Write to InfluxDB
    try:
        funding_point = Point('funding_rate').tag('symbol', SYMBOL).field('value', funding_rate).time(funding_time, WritePrecision.S)
        oi_point = Point('open_interest').tag('symbol', SYMBOL).field('value', open_interest).time(oi_time, WritePrecision.S)
        write_api.write(bucket=INFLUX_BUCKET, record=[funding_point, oi_point])
        print(f"Stored funding: {funding_rate} at {funding_time}, OI: {open_interest} at {oi_time}")
    except Exception as e:
        print(f"INFLUX ERROR: {e}")

if __name__ == '__main__':
    while True:
        try:
            fetch_and_store()
        except Exception as e:
            print(f"Error: {e}")
        time.sleep(60)  # 1 minuto 