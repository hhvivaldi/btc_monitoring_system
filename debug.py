#!/usr/bin/env python
# debug.py
"""
Debug script to test functions individually
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import logging

# Configure basic logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('debug')

# Import our functions
from data_fetcher import fetch_btc_data
from analysis import (
    calculate_pivot_points,
    calculate_fibonacci_levels,
    calculate_bollinger_bands
)

def main():
    # Fetch a small sample of BTC data
    start_date = (datetime.now() - timedelta(days=60)).strftime('%Y-%m-%d')
    end_date = datetime.now().strftime('%Y-%m-%d')
    
    logger.info(f"Fetching BTC data from {start_date} to {end_date}")
    btc_data = fetch_btc_data(start_date=start_date, end_date=end_date)
    
    if btc_data.empty:
        logger.error("No BTC data was fetched")
        return
    
    logger.info(f"Successfully fetched {len(btc_data)} rows of BTC data")
    logger.info(f"BTC data columns: {btc_data.columns.tolist()}")
    logger.info(f"First few rows of BTC data:\n{btc_data.head(2)}")
    
    # Test calculate_pivot_points
    try:
        logger.info("Testing calculate_pivot_points...")
        pivot_points = calculate_pivot_points(btc_data)
        logger.info(f"Pivot points: {pivot_points}")
    except Exception as e:
        logger.error(f"Error calculating pivot points: {str(e)}")
    
    # Test calculate_fibonacci_levels
    try:
        logger.info("Testing calculate_fibonacci_levels...")
        fib_levels = calculate_fibonacci_levels(btc_data)
        logger.info(f"Fibonacci levels: {fib_levels}")
    except Exception as e:
        logger.error(f"Error calculating Fibonacci levels: {str(e)}")
    
    # Test calculate_bollinger_bands
    try:
        logger.info("Testing calculate_bollinger_bands...")
        bb_data = calculate_bollinger_bands(btc_data)
        logger.info(f"Bollinger Bands columns: {bb_data.columns.tolist()}")
        logger.info(f"Last row of Bollinger Bands data:\n{bb_data[['Close', 'BB_Lower', 'BB_Middle', 'BB_Upper']].tail(1)}")
    except Exception as e:
        logger.error(f"Error calculating Bollinger Bands: {str(e)}")

if __name__ == "__main__":
    main() 