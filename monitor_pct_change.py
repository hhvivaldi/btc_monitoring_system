# monitor_pct_change.py

import re
import sys
import os

# Permite passar o nome do arquivo de log como argumento
LOG_FILE = sys.argv[1] if len(sys.argv) > 1 else 'backend.log'

# Regex para extrair os campos das linhas de debug
DEBUG_REGEX = re.compile(r'\[DEBUG\]\[(\w+)\]\[(\w+)\] prev_close=([\d.\-]+) \(([^)]+)\), curr_close=([\d.\-]+) \(([^)]+)\), pctPrice=([+\-]?[\d.]+)')

dados = []

if not os.path.exists(LOG_FILE):
    print(f"Arquivo de log '{LOG_FILE}' não encontrado. Passe o nome do arquivo como argumento ou coloque o log no mesmo diretório.")
    sys.exit(1)

with open(LOG_FILE, encoding='utf-8') as f:
    for line in f:
        m = DEBUG_REGEX.search(line)
        if m:
            indice = m.group(1)
            tf = m.group(2)
            prev_close = float(m.group(3))
            curr_close = float(m.group(5))
            pctPrice_log = float(m.group(7))
            dados.append({
                'indice': indice,
                'tf': tf,
                'prev_close': prev_close,
                'curr_close': curr_close,
                'pctPrice_log': pctPrice_log
            })

if not dados:
    print(f"Nenhuma linha [DEBUG][...] encontrada em '{LOG_FILE}'. Certifique-se de que o log contém as linhas de debug corretas.")
    sys.exit(1)

print(f'{"Índice":<8} {"TF":<4} {"prev_close":>10} {"curr_close":>10} {"pctPrice_log":>12} {"pctPrice_calc":>12} {"diff":>10} {"OK?":>4}')
for d in dados:
    pct_calc = (d["curr_close"] / d["prev_close"]) - 1
    diff = abs(pct_calc - d["pctPrice_log"])
    ok = "OK" if diff < 0.0005 else "NOK"
    print(f'{d["indice"]:<8} {d["tf"]:<4} {d["prev_close"]:>10.4f} {d["curr_close"]:>10.4f} {d["pctPrice_log"]:>12.6f} {pct_calc:>12.6f} {diff:>10.6f} {ok:>4}') 