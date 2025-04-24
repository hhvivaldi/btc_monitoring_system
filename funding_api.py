# funding_api.py
"""
API para fornecer dados de Funding Rate para o BTC Decision Engine
"""
from flask import Flask, jsonify
from binance.client import Client
import time
from datetime import datetime, timedelta
from influxdb_client import InfluxDBClient
from influxdb_client.client.flux_table import FluxTable

app = Flask(__name__)

# --- Configuração ---
INFLUX_URL = 'https://eu-central-1-1.aws.cloud2.influxdata.com'
INFLUX_TOKEN = '3lJ_Z6XEWjVB9r7zbm7mZpQf6U-2b8WIVfcGEue6Q8WrhDjQVlXJwsZ49Vdj83FmNvqeuPikoSaZ8ZUw9QR-fQ=='
INFLUX_ORG = 'Hermano'
INFLUX_BUCKET = 'funding_oi'

# --- Clients ---
binance_client = Client()
influx_client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
query_api = influx_client.query_api()

def get_current_funding_rate(symbol="BTCUSDT"):
    """Obtém o funding rate atual do Binance"""
    try:
        funding = binance_client.futures_funding_rate(symbol=symbol, limit=1)[0]
        return {
            "exchange": "binance",
            "current_funding": float(funding["fundingRate"]),
            "time": funding["fundingTime"]
        }
    except Exception as e:
        print(f"Erro ao obter funding rate: {e}")
        return None

def get_predicted_funding_rate():
    """Obtém o funding rate previsto (estimativa)"""
    try:
        # Poderia usar outra API ou cálculo para previsão
        # Aqui estamos apenas usando um valor dummy baseado no atual
        current = get_current_funding_rate()
        if current:
            # Simples estimativa: ajusta o funding atual com uma pequena variação
            return {
                "exchange": "binance", 
                "predicted_funding": current["current_funding"] * 1.05,
                "time": int(time.time() * 1000)
            }
        return None
    except Exception as e:
        print(f"Erro ao calcular funding rate previsto: {e}")
        return None

def get_next_funding_rate():
    """Obtém estimativa para o próximo funding rate"""
    try:
        # Poderia usar algoritmo mais sofisticado
        # Aqui estamos usando uma estimativa simples
        current = get_current_funding_rate()
        if current:
            # Estimativa baseada na tendência dos últimos valores
            query = f'''
            from(bucket: "{INFLUX_BUCKET}")
              |> range(start: -8h)
              |> filter(fn: (r) => r._measurement == "funding_rate")
              |> filter(fn: (r) => r.symbol == "BTCUSDT")
              |> sort(columns: ["_time"], desc: true)
              |> limit(n: 3)
            '''
            result = query_api.query(org=INFLUX_ORG, query=query)
            
            if len(result) > 0 and len(result[0].records) > 1:
                records = result[0].records
                newest = float(records[0].get_value())
                older = float(records[-1].get_value())
                trend = newest - older
                
                # Próximo funding é o atual + tendência
                return {
                    "exchange": "binance",
                    "next_funding": current["current_funding"] + trend,
                    "time": int(time.time() * 1000)
                }
            
            # Fallback se não tivermos dados históricos suficientes
            return {
                "exchange": "binance",
                "next_funding": current["current_funding"] * 1.1,
                "time": int(time.time() * 1000)
            }
        return None
    except Exception as e:
        print(f"Erro ao estimar próximo funding: {e}")
        return None

@app.route('/api/funding', methods=['GET'])
def funding_data():
    """Endpoint que retorna todos os dados de funding necessários para o cálculo do score"""
    try:
        current = get_current_funding_rate()
        predicted = get_predicted_funding_rate()
        next_funding = get_next_funding_rate()
        
        if not current:
            return jsonify({"error": "Não foi possível obter dados de funding"}), 500
            
        # Montando o objeto de resposta
        response = {
            "binance": {
                "current_funding": current.get("current_funding", 0),
                "predicted_funding": predicted.get("predicted_funding", 0) if predicted else 0,
                "next_funding": next_funding.get("next_funding", 0) if next_funding else 0
            }
        }
        
        return jsonify(response)
    except Exception as e:
        print(f"Erro na API de funding: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5002) 