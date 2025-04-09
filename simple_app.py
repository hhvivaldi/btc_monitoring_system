#!/usr/bin/env python
# simple_app.py
"""
Simplified version of app.py that only fetches data and displays it.
"""

import logging
import pandas as pd
from datetime import datetime, timedelta

# Import functions from our modules
from data_fetcher import fetch_btc_data, fetch_sp500_data, fetch_vix_data

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('simple_app')

def fix_yahoo_finance_data(df):
    """
    Fix Yahoo Finance data by flattening MultiIndex columns.
    """
    # Check if we have a MultiIndex
    if isinstance(df.columns, pd.MultiIndex):
        # If it's a single symbol, take the columns and make them top level
        df.columns = df.columns.get_level_values(0)
    
    return df

def main():
    try:
        # Set date range (past 30 days)
        end_date = datetime.now().strftime('%Y-%m-%d')
        start_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        
        logger.info(f"Fetching data from {start_date} to {end_date}")
        
        # Fetch Bitcoin data
        btc_data = fetch_btc_data(start_date=start_date, end_date=end_date)
        if not btc_data.empty:
            btc_data = fix_yahoo_finance_data(btc_data)
            logger.info(f"BTC data shape: {btc_data.shape}")
            logger.info(f"BTC columns: {btc_data.columns.tolist()}")
            print("\nBTC Data (last 5 days):")
            print(btc_data.tail(5)[['Open', 'High', 'Low', 'Close', 'Volume']])
            print(f"Current BTC price: ${float(btc_data['Close'].iloc[-1]):,.2f}")
        else:
            logger.error("No BTC data available")
        
        # Fetch S&P 500 data
        sp500_data = fetch_sp500_data(start_date=start_date, end_date=end_date)
        if not sp500_data.empty:
            sp500_data = fix_yahoo_finance_data(sp500_data)
            logger.info(f"S&P 500 data shape: {sp500_data.shape}")
            print("\nS&P 500 Data (last 5 days):")
            print(sp500_data.tail(5)[['Open', 'High', 'Low', 'Close']])
            print(f"Current S&P 500 level: {float(sp500_data['Close'].iloc[-1]):,.2f}")
        else:
            logger.error("No S&P 500 data available")
        
        # Fetch VIX data
        vix_data = fetch_vix_data(start_date=start_date, end_date=end_date)
        if not vix_data.empty:
            vix_data = fix_yahoo_finance_data(vix_data)
            logger.info(f"VIX data shape: {vix_data.shape}")
            print("\nVIX Data (last 5 days):")
            print(vix_data.tail(5)[['Open', 'High', 'Low', 'Close']])
            print(f"Current VIX level: {float(vix_data['Close'].iloc[-1]):,.2f}")
        else:
            logger.error("No VIX data available")
        
        print("\nData fetching completed successfully!")
        
    except Exception as e:
        logger.error(f"Error in main function: {str(e)}")
        print(f"An error occurred: {str(e)}")

if __name__ == "__main__":
    main() 