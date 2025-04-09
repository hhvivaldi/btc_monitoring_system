#!/usr/bin/env python
# data_fetcher.py
"""
This module contains functions for fetching financial market data from various sources.
"""

import logging
import pandas as pd
import numpy as np
import yfinance as yf
from datetime import datetime, timedelta
import requests
from typing import Optional, Dict, Any, Union, Tuple


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('data_fetcher')


def fetch_btc_data(
    start_date: Optional[Union[str, datetime]] = None,
    end_date: Optional[Union[str, datetime]] = None,
    interval: str = "1d"
) -> pd.DataFrame:
    """
    Fetch Bitcoin historical price data using yfinance.
    
    Parameters:
    -----------
    start_date : str or datetime, optional
        The starting date for data retrieval. If None, defaults to 1 year ago.
    end_date : str or datetime, optional
        The ending date for data retrieval. If None, defaults to today.
    interval : str, default "1d"
        The data interval. Options include "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"
        
    Returns:
    --------
    pd.DataFrame
        A DataFrame containing the BTC price data with columns:
        Date, Open, High, Low, Close, Adj Close, Volume
    """
    try:
        # Set default dates if not provided
        if start_date is None:
            start_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
            
        logger.info(f"Fetching BTC data from {start_date} to {end_date} with interval {interval}")
        
        # Fetch data using yfinance
        btc_data = yf.download('BTC-USD', start=start_date, end=end_date, interval=interval)
        
        # Check if data is empty
        if btc_data.empty:
            logger.warning("No BTC data found for the specified period")
            return pd.DataFrame()
        
        logger.info(f"Successfully fetched BTC data: {len(btc_data)} rows")
        return btc_data
    
    except Exception as e:
        logger.error(f"Error fetching BTC data: {str(e)}")
        raise


def fetch_sp500_data(
    start_date: Optional[Union[str, datetime]] = None,
    end_date: Optional[Union[str, datetime]] = None,
    interval: str = "1d"
) -> pd.DataFrame:
    """
    Fetch S&P 500 index historical data using yfinance.
    
    Parameters:
    -----------
    start_date : str or datetime, optional
        The starting date for data retrieval. If None, defaults to 1 year ago.
    end_date : str or datetime, optional
        The ending date for data retrieval. If None, defaults to today.
    interval : str, default "1d"
        The data interval. Options include "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"
        
    Returns:
    --------
    pd.DataFrame
        A DataFrame containing the S&P 500 index data with columns:
        Date, Open, High, Low, Close, Adj Close, Volume
    """
    try:
        # Set default dates if not provided
        if start_date is None:
            start_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
            
        logger.info(f"Fetching S&P 500 data from {start_date} to {end_date} with interval {interval}")
        
        # Fetch data using yfinance (^GSPC is the ticker for S&P 500)
        sp500_data = yf.download('^GSPC', start=start_date, end=end_date, interval=interval)
        
        # Check if data is empty
        if sp500_data.empty:
            logger.warning("No S&P 500 data found for the specified period")
            return pd.DataFrame()
        
        logger.info(f"Successfully fetched S&P 500 data: {len(sp500_data)} rows")
        return sp500_data
    
    except Exception as e:
        logger.error(f"Error fetching S&P 500 data: {str(e)}")
        raise


def fetch_vix_data(
    start_date: Optional[Union[str, datetime]] = None,
    end_date: Optional[Union[str, datetime]] = None,
    interval: str = "1d"
) -> pd.DataFrame:
    """
    Fetch VIX (Volatility Index) historical data using yfinance.
    
    Parameters:
    -----------
    start_date : str or datetime, optional
        The starting date for data retrieval. If None, defaults to 1 year ago.
    end_date : str or datetime, optional
        The ending date for data retrieval. If None, defaults to today.
    interval : str, default "1d"
        The data interval. Options include "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"
        
    Returns:
    --------
    pd.DataFrame
        A DataFrame containing the VIX data with columns:
        Date, Open, High, Low, Close, Adj Close, Volume
    """
    try:
        # Set default dates if not provided
        if start_date is None:
            start_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
            
        logger.info(f"Fetching VIX data from {start_date} to {end_date} with interval {interval}")
        
        # Fetch data using yfinance (^VIX is the ticker for the VIX)
        vix_data = yf.download('^VIX', start=start_date, end=end_date, interval=interval)
        
        # Check if data is empty
        if vix_data.empty:
            logger.warning("No VIX data found for the specified period")
            return pd.DataFrame()
        
        logger.info(f"Successfully fetched VIX data: {len(vix_data)} rows")
        return vix_data
    
    except Exception as e:
        logger.error(f"Error fetching VIX data: {str(e)}")
        raise


def fetch_crypto_data_from_binance(
    symbol: str = "BTCUSDT",
    interval: str = "1d",
    limit: int = 365
) -> pd.DataFrame:
    """
    Fetch cryptocurrency data from Binance public API.
    
    Parameters:
    -----------
    symbol : str, default "BTCUSDT"
        The trading pair symbol (e.g., "BTCUSDT", "ETHUSDT")
    interval : str, default "1d"
        The data interval. Options include "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"
    limit : int, default 365
        Number of candles to fetch (max 1000)
        
    Returns:
    --------
    pd.DataFrame
        A DataFrame containing the crypto data with columns:
        Open time, Open, High, Low, Close, Volume, Close time, Quote asset volume, 
        Number of trades, Taker buy base asset volume, Taker buy quote asset volume, Ignore
    """
    try:
        logger.info(f"Fetching {symbol} data from Binance with interval {interval}, limit {limit}")
        
        # Binance API endpoint for kline (candlestick) data
        url = "https://api.binance.com/api/v3/klines"
        
        # Request parameters
        params = {
            "symbol": symbol,
            "interval": interval,
            "limit": limit
        }
        
        # Make the request
        response = requests.get(url, params=params)
        data = response.json()
        
        # Check if we got a valid response
        if not data or not isinstance(data, list):
            logger.warning(f"No valid data received from Binance for {symbol}")
            return pd.DataFrame()
        
        # Convert to DataFrame
        df = pd.DataFrame(data, columns=[
            'Open time', 'Open', 'High', 'Low', 'Close', 'Volume',
            'Close time', 'Quote asset volume', 'Number of trades',
            'Taker buy base asset volume', 'Taker buy quote asset volume', 'Ignore'
        ])
        
        # Convert timestamp to datetime
        df['Open time'] = pd.to_datetime(df['Open time'], unit='ms')
        df['Close time'] = pd.to_datetime(df['Close time'], unit='ms')
        
        # Convert numeric columns
        numeric_columns = ['Open', 'High', 'Low', 'Close', 'Volume', 'Quote asset volume',
                          'Number of trades', 'Taker buy base asset volume', 'Taker buy quote asset volume']
        for col in numeric_columns:
            df[col] = pd.to_numeric(df[col])
        
        logger.info(f"Successfully fetched {symbol} data from Binance: {len(df)} rows")
        return df
    
    except Exception as e:
        logger.error(f"Error fetching data from Binance: {str(e)}")
        raise


def fetch_multiple_assets(
    symbols: list,
    start_date: Optional[Union[str, datetime]] = None,
    end_date: Optional[Union[str, datetime]] = None,
    interval: str = "1d"
) -> Dict[str, pd.DataFrame]:
    """
    Fetch data for multiple assets simultaneously.
    
    Parameters:
    -----------
    symbols : list
        List of ticker symbols to fetch
    start_date : str or datetime, optional
        The starting date for data retrieval. If None, defaults to 1 year ago.
    end_date : str or datetime, optional
        The ending date for data retrieval. If None, defaults to today.
    interval : str, default "1d"
        The data interval.
        
    Returns:
    --------
    Dict[str, pd.DataFrame]
        A dictionary with ticker symbols as keys and corresponding DataFrames as values
    """
    try:
        # Set default dates if not provided
        if start_date is None:
            start_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
            
        logger.info(f"Fetching data for multiple assets: {symbols}")
        
        # Fetch data for all symbols
        data_dict = yf.download(symbols, start=start_date, end=end_date, interval=interval, group_by='ticker')
        
        # If only one symbol is provided, yfinance doesn't group by ticker, so we need to handle that case
        if len(symbols) == 1:
            symbol = symbols[0]
            return {symbol: data_dict}
        
        # Create a dictionary with clean DataFrames
        result = {}
        for symbol in symbols:
            if symbol in data_dict:
                symbol_data = data_dict[symbol].copy()
                if not symbol_data.empty:
                    result[symbol] = symbol_data
                    logger.info(f"Successfully fetched data for {symbol}: {len(symbol_data)} rows")
                else:
                    logger.warning(f"No data found for {symbol}")
            else:
                logger.warning(f"No data found for {symbol}")
        
        return result
    
    except Exception as e:
        logger.error(f"Error fetching data for multiple assets: {str(e)}")
        raise


if __name__ == "__main__":
    # Example usage
    try:
        # Fetch Bitcoin data for the last 30 days
        start_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        btc_data = fetch_btc_data(start_date=start_date)
        print(f"BTC Data shape: {btc_data.shape}")
        print(btc_data.head())
        
        # Fetch S&P 500 data
        sp500_data = fetch_sp500_data(start_date=start_date)
        print(f"\nS&P 500 Data shape: {sp500_data.shape}")
        print(sp500_data.head())
        
        # Fetch VIX data
        vix_data = fetch_vix_data(start_date=start_date)
        print(f"\nVIX Data shape: {vix_data.shape}")
        print(vix_data.head())
        
        # Fetch multiple assets
        assets = ['BTC-USD', 'ETH-USD', 'AAPL', 'MSFT']
        multi_data = fetch_multiple_assets(assets, start_date=start_date)
        for symbol, data in multi_data.items():
            print(f"\n{symbol} Data shape: {data.shape}")
            print(data.head(2))
            
    except Exception as e:
        print(f"Error in example: {str(e)}") 