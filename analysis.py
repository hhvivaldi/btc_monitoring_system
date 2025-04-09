#!/usr/bin/env python
# analysis.py
"""
This module contains functions for technical analysis of financial market data.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Optional, Union
import logging
import traceback

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('analysis')

def calculate_pivot_points(data: pd.DataFrame) -> Dict[str, float]:
    """
    Calculate standard pivot points (PP, S1, S2, S3, R1, R2, R3) based on the previous period's data.
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame containing OHLC data with columns 'High', 'Low', 'Close'
        
    Returns:
    --------
    Dict[str, float]
        Dictionary containing calculated pivot levels:
        {'PP': float, 'S1': float, 'S2': float, 'S3': float, 'R1': float, 'R2': float, 'R3': float}
    """
    # Get the latest data point (assuming data is sorted by date in ascending order)
    latest = data.iloc[-1]
    
    # Previous data point
    if len(data) > 1:
        prev = data.iloc[-2]
    else:
        prev = latest
    
    # Calculate pivot point
    pivot_point = (prev['High'] + prev['Low'] + prev['Close']) / 3
    
    # Calculate support and resistance levels
    s1 = (2 * pivot_point) - prev['High']
    s2 = pivot_point - (prev['High'] - prev['Low'])
    s3 = pivot_point - 2 * (prev['High'] - prev['Low'])
    
    r1 = (2 * pivot_point) - prev['Low']
    r2 = pivot_point + (prev['High'] - prev['Low'])
    r3 = pivot_point + 2 * (prev['High'] - prev['Low'])
    
    return {
        'PP': pivot_point,
        'S1': s1,
        'S2': s2,
        'S3': s3,
        'R1': r1,
        'R2': r2,
        'R3': r3
    }


def calculate_fibonacci_levels(data: pd.DataFrame, trend: str = 'auto') -> Dict[str, float]:
    """
    Calculate Fibonacci retracement and extension levels.
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame containing OHLC data with columns 'High', 'Low'
    trend : str, default 'auto'
        'up' for uptrend (retracements from low to high)
        'down' for downtrend (retracements from high to low)
        'auto' to automatically detect trend based on latest price action
        
    Returns:
    --------
    Dict[str, float]
        Dictionary containing calculated Fibonacci levels as ratios:
        {'0.0': float, '0.236': float, '0.382': float, '0.5': float, '0.618': float, '0.786': float, '1.0': float,
         '1.272': float, '1.414': float, '1.618': float, '2.0': float, '2.618': float}
    """
    # Define standard Fibonacci ratios (retracements and extensions)
    fib_ratios = {
        '0.0': 0.0,
        '0.236': 0.236,
        '0.382': 0.382,
        '0.5': 0.5,
        '0.618': 0.618,
        '0.786': 0.786,
        '1.0': 1.0,
        '1.272': 1.272,
        '1.414': 1.414,
        '1.618': 1.618,
        '2.0': 2.0,
        '2.618': 2.618
    }
    
    # Find swing high and swing low points
    high = float(data['High'].max())
    low = float(data['Low'].min())
    
    # Determine trend direction
    if trend == 'auto':
        # Simple trend detection based on the last two periods
        if len(data) >= 2:
            last_close = float(data['Close'].iloc[-1])
            prev_close = float(data['Close'].iloc[-2])
            trend = 'up' if last_close > prev_close else 'down'
        else:
            trend = 'up'  # Default to uptrend if not enough data
    
    # Calculate the range
    range_val = high - low
    
    # Calculate Fibonacci levels
    fib_levels = {}
    
    if trend == 'up':
        # For uptrend, retracements go from low to high
        for ratio_name, ratio in fib_ratios.items():
            if ratio <= 1.0:
                # Retracement (down from high)
                fib_levels[ratio_name] = high - (range_val * ratio)
            else:
                # Extension (above high)
                fib_levels[ratio_name] = high + (range_val * (ratio - 1.0))
    else:
        # For downtrend, retracements go from high to low
        for ratio_name, ratio in fib_ratios.items():
            if ratio <= 1.0:
                # Retracement (up from low)
                fib_levels[ratio_name] = low + (range_val * ratio)
            else:
                # Extension (below low)
                fib_levels[ratio_name] = low - (range_val * (ratio - 1.0))
    
    return fib_levels


def identify_support_resistance(data: pd.DataFrame, window: int = 14) -> Dict[str, List[float]]:
    """
    Identify potential support and resistance levels based on local minima/maxima.
    Uses a rolling window approach.
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame containing OHLC data with 'High' and 'Low' columns
    window : int, default 14
        Number of periods on each side to check for local minima/maxima
        
    Returns:
    --------
    {'support': List[float], 'resistance': List[float]}
    """
    support_levels = []
    resistance_levels = []
    n = len(data)

    if n < window * 2 + 1:
        logger.warning(f"Not enough data points ({n}) to identify support/resistance with window {window}.")
        return {'support': [], 'resistance': []}

    logger.info(f"Identifying support/resistance with window {window}...")
    for i in range(window, n - window):
        # Slice the window data
        try:
            current_low = data['Low'].iloc[i].item()
            window_data = data.iloc[i - window : i + window + 1]
            if window_data['Low'].empty:
                logger.warning(f"Empty Low data in window at index {i}, skipping support check.")
                continue
            window_min = window_data['Low'].min()

            # --- Debugging Log ---
            logger.debug(f"Idx {i} Support Check - current_low: {current_low} (Type: {type(current_low)}), window_min: {window_min} (Type: {type(window_min)})")
            # ---------------------

            # Check if window_min is valid and perform comparison
            # Ensure BOTH sides are valid numbers before comparing
            if not pd.isna(current_low) and not pd.isna(window_min) and isinstance(window_min, (int, float)):
                # Check type explicitly before comparing scalars
                min_val = float(window_min)
                if isinstance(current_low, (int, float)) and current_low == min_val:
                    support_level = current_low
                    # Add level only if significantly different from the last added level
                    if not support_levels or abs(support_level - support_levels[-1]) > (support_level * 0.001): # Avoid too close levels (0.1% diff)
                        support_levels.append(support_level)
                        # logger.debug(f"Support found at index {i}: {support_level:.2f}") # Optional detailed log
                    
        except Exception as e:
             # Log the specific error related to support check
             logger.error(f"Error during support check logic at index {i}: {e}")

        # Resistance Check
        try:
            current_high = data['High'].iloc[i].item()
            window_data = data.iloc[i - window : i + window + 1]
            if window_data['High'].empty:
                logger.warning(f"Empty High data in window at index {i}, skipping resistance check.")
                continue
            window_max = window_data['High'].max()

            # --- Debugging Log ---
            logger.debug(f"Idx {i} Resistance Check - current_high: {current_high} (Type: {type(current_high)}), window_max: {window_max} (Type: {type(window_max)})")
            # ---------------------

            # Check if window_max is valid and perform comparison
            # Ensure BOTH sides are valid numbers before comparing
            if not pd.isna(current_high) and not pd.isna(window_max) and isinstance(window_max, (int, float)):
                # Check type explicitly before comparing scalars
                max_val = float(window_max)
                if isinstance(current_high, (int, float)) and current_high == max_val:
                    resistance_level = current_high
                    # Add level only if significantly different from the last added level
                    if not resistance_levels or abs(resistance_level - resistance_levels[-1]) > (resistance_level * 0.001): # Avoid too close levels (0.1% diff)
                        resistance_levels.append(resistance_level)
                        # logger.debug(f"Resistance found at index {i}: {resistance_level:.2f}") # Optional detailed log
                    
        except Exception as e:
             # Log the specific error related to resistance check
             logger.error(f"Error during resistance check logic at index {i}: {e}")

    # Sort and potentially refine/deduplicate levels further if needed
    support_levels.sort()
    resistance_levels.sort()
    
    # Simple deduplication (optional, adjust tolerance as needed)
    support_levels = [lvl for j, lvl in enumerate(support_levels) if j == 0 or abs(lvl - support_levels[j-1]) > (lvl * 0.001)]
    resistance_levels = [lvl for j, lvl in enumerate(resistance_levels) if j == 0 or abs(lvl - resistance_levels[j-1]) > (lvl * 0.001)]

    logger.info(f"Found {len(support_levels)} support levels and {len(resistance_levels)} resistance levels.")
    return {'support': support_levels, 'resistance': resistance_levels}


def calculate_moving_averages(
    data: pd.DataFrame, 
    periods: List[int] = [20, 50, 200],
    ma_type: str = 'sma'
) -> pd.DataFrame:
    """
    Calculate simple or exponential moving averages for the given periods.
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame containing price data with a 'Close' column
    periods : List[int], default [20, 50, 200]
        List of periods to calculate moving averages for
    ma_type : str, default 'sma'
        Type of moving average. Options: 'sma' (Simple Moving Average) or 'ema' (Exponential Moving Average)
        
    Returns:
    --------
    pd.DataFrame
        Original DataFrame with additional columns for each moving average (e.g., 'SMA_20', 'EMA_50')
    """
    result = data.copy()
    
    for period in periods:
        if ma_type.lower() == 'sma':
            result[f'SMA_{period}'] = result['Close'].rolling(window=period).mean()
        elif ma_type.lower() == 'ema':
            result[f'EMA_{period}'] = result['Close'].ewm(span=period, adjust=False).mean()
        else:
            raise ValueError("ma_type must be either 'sma' or 'ema'")
    
    return result


def calculate_rsi(data: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """
    Calculate the Relative Strength Index (RSI).
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame containing price data with a 'Close' column
    period : int, default 14
        Period to calculate RSI over
        
    Returns:
    --------
    pd.DataFrame
        Original DataFrame with an additional 'RSI' column
    """
    result = data.copy()
    
    # Calculate price changes
    delta = result['Close'].diff()
    
    # Separate gains and losses
    gain = delta.where(delta > 0, 0)
    loss = -delta.where(delta < 0, 0)
    
    # Calculate average gain and average loss
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    
    # Calculate RS
    rs = avg_gain / avg_loss
    
    # Calculate RSI
    result['RSI'] = 100 - (100 / (1 + rs))
    
    return result


def calculate_macd(
    data: pd.DataFrame, 
    fast_period: int = 12, 
    slow_period: int = 26,
    signal_period: int = 9
) -> pd.DataFrame:
    """
    Calculate the Moving Average Convergence Divergence (MACD).
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame containing price data with a 'Close' column
    fast_period : int, default 12
        Period for the fast EMA
    slow_period : int, default 26
        Period for the slow EMA
    signal_period : int, default 9
        Period for the signal line
        
    Returns:
    --------
    pd.DataFrame
        Original DataFrame with additional columns 'MACD', 'MACD_Signal', and 'MACD_Histogram'
    """
    result = data.copy()
    
    # Calculate EMAs
    fast_ema = result['Close'].ewm(span=fast_period, adjust=False).mean()
    slow_ema = result['Close'].ewm(span=slow_period, adjust=False).mean()
    
    # Calculate MACD line
    result['MACD'] = fast_ema - slow_ema
    
    # Calculate signal line
    result['MACD_Signal'] = result['MACD'].ewm(span=signal_period, adjust=False).mean()
    
    # Calculate histogram
    result['MACD_Histogram'] = result['MACD'] - result['MACD_Signal']
    
    return result


def calculate_bollinger_bands(data: pd.DataFrame, period: int = 20, std_dev: float = 2.0) -> pd.DataFrame:
    """
    Calculate Bollinger Bands for a given DataFrame.
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame containing price data with a 'Close' column
    period : int, default 20
        The period to use for the moving average
    std_dev : float, default 2.0
        The number of standard deviations for the bands
        
    Returns:
    --------
    pd.DataFrame
        DataFrame with added columns:
        - BB_Middle: The middle band (simple moving average)
        - BB_Upper: The upper band (SMA + std_dev * standard deviation)
        - BB_Lower: The lower band (SMA - std_dev * standard deviation)
    """
    try:
        result = data.copy()
        
        # Calculate middle band (20-day SMA)
        middle_band = result['Close'].rolling(window=period).mean()
        
        # Calculate standard deviation
        rolling_std = result['Close'].rolling(window=period).std()
        
        # Calculate upper and lower bands
        upper_band = middle_band + (rolling_std * std_dev)
        lower_band = middle_band - (rolling_std * std_dev)
        
        # Add bands to result DataFrame
        result['BB_Middle'] = middle_band
        result['BB_Upper'] = upper_band
        result['BB_Lower'] = lower_band
        
        return result
        
    except Exception as e:
        logger.error(f"Error calculating Bollinger Bands: {str(e)}")
        return pd.DataFrame()


def calculate_atr(data: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """
    Calculate Average True Range (ATR).
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame containing OHLC data
    period : int, default 14
        Period for ATR calculation
        
    Returns:
    --------
    pd.DataFrame
        Original DataFrame with an additional 'ATR' column
    """
    result = data.copy()
    
    # Calculate True Range
    result['tr0'] = abs(result['High'] - result['Low'])
    result['tr1'] = abs(result['High'] - result['Close'].shift())
    result['tr2'] = abs(result['Low'] - result['Close'].shift())
    result['TR'] = result[['tr0', 'tr1', 'tr2']].max(axis=1)
    
    # Calculate ATR
    result['ATR'] = result['TR'].rolling(window=period).mean()
    
    # Remove temporary columns
    result = result.drop(['tr0', 'tr1', 'tr2', 'TR'], axis=1)
    
    return result


def calculate_average_volume(data: pd.DataFrame, period: int = 20) -> pd.DataFrame:
    """
    Calculate average volume over a specified period.
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame containing volume data with a 'Volume' column
    period : int, default 20
        Period for the average calculation
        
    Returns:
    --------
    pd.DataFrame
        Original DataFrame with an additional 'Average_Volume' column
    """
    result = data.copy()
    result['Average_Volume'] = result['Volume'].rolling(window=period).mean()
    return result


def analyze_btc_data(data: pd.DataFrame) -> Dict[str, Dict[str, Union[float, str]]]:
    """
    Analyze Bitcoin price data using various technical indicators.
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame containing BTC price data with OHLCV columns
        
    Returns:
    --------
    Dict[str, Dict[str, Union[float, str]]]
        Dictionary containing analysis results:
        {
            'trend': {
                'short_term': str,  # 'bullish', 'bearish', or 'neutral'
                'medium_term': str,
                'long_term': str
            },
            'support_resistance': {
                'support_levels': List[float],
                'resistance_levels': List[float]
            },
            'indicators': {
                'rsi': float,
                'macd': Dict[str, float],
                'bollinger': Dict[str, float]
            },
            'volume': {
                'current': float,
                'average': float,
                'trend': str
            }
        }
    """
    try:
        logger.info("Starting BTC data analysis (Simplified: Trend Only)")
        
        # Ensure data is not empty
        if data.empty or 'Close' not in data.columns:
            logger.error("BTC data is empty or missing 'Close' column for analysis.")
            # Return a structure indicating failure
            return {
                 'trend': {'short_term': 'unknown', 'medium_term': 'unknown', 'long_term': 'unknown'},
                 'support_resistance': {'support': [], 'resistance': []},
                 'indicators': {'rsi': None, 'macd': None, 'bollinger': None},
                 'volume': {'current': None, 'average': None, 'trend': 'unknown'},
                 'summary': 'Error: Input data empty or missing Close column',
                 'error': "Input data empty or missing 'Close' column"
             }
        
        ma_data = calculate_moving_averages(data, periods=[20, 50, 200])
        if len(data) < 1:
             logger.error("Not enough data points for current price.")
             # Handle error appropriately, maybe return error structure like above
             # For now, let it potentially raise IndexError below if needed
             return {
                 'trend': {'short_term': 'unknown', 'medium_term': 'unknown', 'long_term': 'unknown'},
                 'support_resistance': {'support': [], 'resistance': []},
                 'indicators': {'rsi': None, 'macd': None, 'bollinger': None},
                 'volume': {'current': None, 'average': None, 'trend': 'unknown'},
                 'summary': 'Error: Not enough data points',
                 'error': "Not enough data points for current price."
             }
        
        current_price = float(data['Close'].iloc[-1]) # Keep this
        
        # Determine trends (Keep this part)
        trend = {}
        try: trend['short_term'] = 'bullish' if not pd.isna(ma_data['SMA_20'].iloc[-1]) and current_price > ma_data['SMA_20'].iloc[-1] else 'bearish' if not pd.isna(ma_data['SMA_20'].iloc[-1]) else 'unknown'
        except IndexError: trend['short_term'] = 'unknown'
        try: trend['medium_term'] = 'bullish' if not pd.isna(ma_data['SMA_50'].iloc[-1]) and current_price > ma_data['SMA_50'].iloc[-1] else 'bearish' if not pd.isna(ma_data['SMA_50'].iloc[-1]) else 'unknown'
        except IndexError: trend['medium_term'] = 'unknown'
        try: trend['long_term'] = 'bullish' if not pd.isna(ma_data['SMA_200'].iloc[-1]) and current_price > ma_data['SMA_200'].iloc[-1] else 'bearish' if not pd.isna(ma_data['SMA_200'].iloc[-1]) else 'unknown'
        except IndexError: trend['long_term'] = 'unknown'
        
        logger.info(f"Trend analysis completed: {trend}")
        
        # --- REMOVE/COMMENT OUT INDICATOR CALLS ---
        # sr_levels = identify_support_resistance(data)
        # logger.info(f"Support and resistance levels identified: {sr_levels}")
        # rsi_data = calculate_rsi(data)
        # macd_data = calculate_macd(data)
        # bb_data = calculate_bollinger_bands(data)
        # vol_data = calculate_average_volume(data)
        # -------------------------------------------

        # --- PROVIDE PLACEHOLDER/DEFAULT VALUES --- 
        sr_levels = {'support': [], 'resistance': []} # Default empty
        indicators = {'rsi': None, 'macd': None, 'bollinger': None} # Default None
        volume = {'current': None, 'average': None, 'trend': 'unknown'} # Default unknown
        summary_string = f"Simplified Analysis - Trend: {trend.get('short_term', 'N/A')}" # Basic summary
        # -------------------------------------------
        
        logger.info("Technical indicators calculation SKIPPED")
        logger.info("Volume analysis SKIPPED")
        
        analysis_results = {
            'trend': trend,
            'support_resistance': sr_levels,
            'indicators': indicators,
            'volume': volume,
            'summary': summary_string
        }
        
        logger.info(f"BTC data analysis completed successfully (Simplified). Summary: {summary_string}")
        return analysis_results
        
    except Exception as e:
        logger.error(f"Critical error in BTC data analysis: {str(e)}")
        logger.error(traceback.format_exc())
        # Return structure indicating failure
        return {
            'trend': {'short_term': 'unknown', 'medium_term': 'unknown', 'long_term': 'unknown'},
            'support_resistance': {'support': [], 'resistance': []},
            'indicators': {'rsi': None, 'macd': None, 'bollinger': None},
            'volume': {'current': None, 'average': None, 'trend': 'unknown'},
            'error': str(e),
            'summary': f"Error during simplified analysis: {str(e)}"
        }


if __name__ == "__main__":
    # Example usage
    try:
        import sys
        sys.path.append('.')  # Add current directory to path
        from data_fetcher import fetch_btc_data
        
        # Fetch some sample data
        btc_data = fetch_btc_data(start_date='2023-01-01', end_date='2023-12-31')
        
        # Calculate various indicators
        pivot_points = calculate_pivot_points(btc_data)
        print("\nPivot Points:")
        for key, value in pivot_points.items():
            print(f"{key}: {value:.2f}")
        
        fib_levels = calculate_fibonacci_levels(btc_data)
        print("\nFibonacci Levels:")
        for key, value in fib_levels.items():
            print(f"{key}: {value:.2f}")
        
        # Calculate RSI
        btc_with_rsi = calculate_rsi(btc_data)
        print("\nRSI (last 5 days):")
        print(btc_with_rsi['RSI'].tail())
        
        # Calculate Bollinger Bands
        btc_with_bb = calculate_bollinger_bands(btc_data)
        print("\nBollinger Bands (last day):")
        last_row = btc_with_bb[['BB_Lower', 'BB_Middle', 'BB_Upper']].iloc[-1]
        print(f"Lower: {last_row['BB_Lower']:.2f}")
        print(f"Middle: {last_row['BB_Middle']:.2f}")
        print(f"Upper: {last_row['BB_Upper']:.2f}")
        
    except Exception as e:
        print(f"Error in example: {str(e)}") 