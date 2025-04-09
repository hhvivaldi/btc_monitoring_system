#!/usr/bin/env python
# market_signals.py
"""
Traffic Light Indicator System using scraped Investing.com data.
"""

import logging
import pandas as pd
import numpy as np
# import investpy # No longer using investpy directly here
from datetime import datetime, timedelta
import requests
from typing import Dict, List, Tuple, Optional, Union
import traceback
import time

# Import the Selenium scraper function
from scraper_investing import scrape_instrument_page, clean_value # Keep clean_value? Maybe not needed now.

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('market_signals')

# --- Removing old fetch/analysis functions ---

def get_signal_status() -> Dict[str, Dict[str, Union[str, float, None]]]:
    """Fetches status for Nasdaq, S&P500, VIX, DXY by scraping individual pages."""
    try:
        logger.info("Getting market signal status (Scraping Individual Pages)")
        
        # Define target URLs and keys
        target_urls = {
            "Nasdaq": "https://www.investing.com/indices/nq-100-futures",
            "S&P500": "https://www.investing.com/indices/us-spx-500",
            "VIX": "https://www.investing.com/indices/us-spx-vix-futures",
            "DXY": "https://www.investing.com/indices/usdollar?cid=1224074"
        }

        # Initialize signals with defaults
        signals = {
            key: {"trend": "unknown", "signal": "⚪", "price": None, "direction": "unknown"} 
            for key in target_urls
        }

        # --- Scrape each instrument page --- 
        for key, url in target_urls.items():
            logger.info(f"--- Scraping page for: {key} --- URL: {url}")
            instrument_data = scrape_instrument_page(url)
            
            if instrument_data and isinstance(instrument_data.get('Last'), float) and isinstance(instrument_data.get('Chg. %'), float):
                price = instrument_data['Last']
                chg_pct = instrument_data['Chg. %']
                logger.info(f"Successfully scraped {key}: Price={price}, Chg %={chg_pct}")

                # Determine direction and signal based on change %
                is_inverted = (key == "VIX" or key == "DXY")
                if chg_pct > 0.01: # Using 0.01% threshold
                    direction = "up"; trend = "bullish"
                    signal_emoji = "🔴" if is_inverted else "🟢"
                elif chg_pct < -0.01:
                    direction = "down"; trend = "bearish"
                    signal_emoji = "🟢" if is_inverted else "🔴"
                else:
                    direction = "neutral"; trend = "neutral"; signal_emoji = "⚪"

                signals[key] = {
                    "trend": trend,
                    "signal": signal_emoji,
                    "price": price,
                    "direction": direction
                }
                logger.info(f"Updated {key}: Signal={signal_emoji}, Trend={trend}")
            else:
                logger.warning(f"Scraping failed or returned invalid data for {key}. Keeping default signal.")
        # --- End scraping loop --- 

        # --- Calculate overall market sentiment --- 
        bullish_count = 0
        bearish_count = 0
        contributing_signals = 0
        
        for key, indicator in signals.items():
            # No need to check for 'Overall' key here anymore
            signal = indicator.get("signal", "⚪")
            if signal == "⚪":
                logger.debug(f"Excluding {key} (neutral/unknown) from overall sentiment.")
                continue 
            
            contributing_signals += 1
            is_inverted = (key == "VIX" or key == "DXY")
            
            if (signal == "🟢" and not is_inverted) or (signal == "🔴" and is_inverted):
                bullish_count += 1
            elif (signal == "🔴" and not is_inverted) or (signal == "🟢" and is_inverted):
                bearish_count += 1

        logger.info(f"Overall sentiment calculation: Bullish={bullish_count}, Bearish={bearish_count} from {contributing_signals} contributing signals.")

        if bullish_count > bearish_count: overall_sentiment_text, overall_signal, overall_trend = "Bullish", "🟢", "bullish"
        elif bearish_count > bullish_count: overall_sentiment_text, overall_signal, overall_trend = "Bearish", "🔴", "bearish"
        else: 
             overall_sentiment_text, overall_signal, overall_trend = "Neutral", "⚪", "neutral"
             if contributing_signals == 0:
                  logger.warning("No contributing signals found for overall sentiment calculation.")

        # Add the Overall signal to the dictionary
        signals["Overall"] = {
            "trend": overall_trend,
            "signal": overall_signal,
            "price": overall_sentiment_text,
            "direction": overall_trend
        }

        logger.info(f"Market signals (from individual pages): {signals}")
        return signals

    except Exception as e:
        logger.error(f"Critical error in get_signal_status (Individual Pages): {str(e)}")
        logger.error(traceback.format_exc())
        # Return defaults on critical error
        return { 
            key: {"trend": "unknown", "signal": "⚪", "price": None, "direction": "unknown"} 
            for key in list(target_urls.keys()) + ["Overall"] # Ensure overall is included
        }

# --- decide_btc_position and confirm_with_btc_chart remain the same ---
# They now rely on the signals derived from scraped data

def decide_btc_position(signals: Dict[str, Dict[str, str]]) -> Dict[str, str]:
    # ... (no changes needed here)
    try:
        logger.info("Deciding BTC position based on market signals")
        overall_signal = signals.get("Overall", {}).get("signal", "⚪")
        if overall_signal == "🟢": decision, explanation = "BUY", "Overall market sentiment is bullish."
        elif overall_signal == "🔴": decision, explanation = "SELL", "Overall market sentiment is bearish."
        else: decision, explanation = "HOLD", "Overall market sentiment is neutral or unclear."
        logger.info(f"BTC Position Decision: {decision}")
        return {"decision": decision, "explanation": explanation}
    except Exception as e:
        logger.error(f"Error deciding BTC position: {str(e)}")
        return {"decision": "HOLD", "explanation": f"Error in decision logic: {str(e)}"}

def confirm_with_btc_chart(btc_data: pd.DataFrame, btc_analysis: Dict, decision: Dict[str, str]) -> Dict[str, str]:
    """Confirms or adjusts the initial trading decision based on BTC chart analysis.
    
    *** SIMPLIFIED VERSION - Currently bypasses detailed chart analysis ***
    """
    try:
        logger.info("Starting chart validation (Simplified: Bypassing detailed analysis)")

        # Basic check for analysis result existence
        if not btc_analysis or btc_analysis.get('error'): # Also check if analysis itself failed
            error_msg = btc_analysis.get('error', 'BTC analysis results missing') if btc_analysis else 'BTC analysis results missing'
            explanation = f"Chart validation skipped: {error_msg}"
            logger.warning(explanation)
            return {
                'decision': decision['decision'],
                'explanation': f"{decision['explanation']} ({explanation})",
                'chart_confirmed': False,
                'chart_explanation': explanation
            }

        # --- BYPASS DETAILED INDICATOR CHECKS AND POINTS ---
        logger.info("Skipping detailed RSI, MACD, Bollinger, Volume checks in simplified mode.")
        chart_explanation_str = "Detailed chart analysis disabled in current version."
        modified_decision = decision['decision'] # Keep original decision
        chart_confirmed = False # Mark as not confirmed by chart
        explanation = f"Kept initial decision ({modified_decision}). {chart_explanation_str}"
        # ---------------------------------------------------

        logger.info(f"Chart validation outcome: {modified_decision} (Initial: {decision['decision']}, Confirmed: {chart_confirmed}, Simplified Mode)")

        # Return the results
        return {
            'decision': modified_decision,
            'explanation': explanation,
            'chart_confirmed': chart_confirmed,
            'chart_explanation': chart_explanation_str
        }

    except Exception as e:
        logger.error(f"Error in simplified chart validation: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            'decision': decision['decision'], 
            'explanation': f"{decision['explanation']} (Chart validation failed: {str(e)})", 
            'chart_confirmed': False, 
            'chart_explanation': f"Error: {str(e)}"
        }

# Example usage
if __name__ == "__main__":
    signals = get_signal_status()
    print("Market Signals:", signals)
    btc_decision = decide_btc_position(signals)
    print("Initial BTC Decision:", btc_decision)
    # ... rest of example requires fetching actual BTC data ... 