# test_influx_write.py
from influxdb_client import InfluxDBClient, Point, WritePrecision

INFLUX_URL = 'https://eu-central-1-1.aws.cloud2.influxdata.com'
INFLUX_TOKEN = '3lJ_Z6XEWjVB9r7zbm7mZpQf6U-2b8WIVfcGEue6Q8WrhDjQVlXJwsZ49Vdj83FmNvqeuPikoSaZ8ZUw9QR-fQ=='
INFLUX_ORG = 'Hermano'
INFLUX_BUCKET = 'test_bucket'

influx = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = influx.write_api()
point = Point('test_measurement').tag('symbol', 'TEST').field('value', 123).time(1744973000, WritePrecision.S)
try:
    write_api.write(bucket=INFLUX_BUCKET, record=point)
    print("Test point written to test_bucket")
except Exception as e:
    print(f"INFLUX ERROR: {e}") 