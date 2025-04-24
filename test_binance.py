# test_binance.py
from binance.client import Client
import os

# Não precisa de API key para endpoints públicos
client = Client()

# Funding rate endpoint (futures)
result = client.futures_funding_rate(symbol="BTCUSDT", limit=1)
print(result) 