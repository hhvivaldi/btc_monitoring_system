#!/usr/bin/env python
# app.py
"""
Bitcoin Monitoring System - Main Application (Flask Web Server & CLI)

This script serves as the main entry point for the Bitcoin monitoring system.
It fetches market data, evaluates signals, checks the BTC chart, and provides
a final trading recommendation. Can run as a CLI or a Flask web server.
"""

import os
import sys
import logging
import pandas as pd
from datetime import datetime
import time
import argparse
from typing import Dict, Any, Optional
from flask import Flask, render_template

# Import our custom modules
from market_signals import (
    get_signal_status,
    decide_btc_position,
    confirm_with_btc_chart,
)
from data_fetcher import fetch_btc_data
from analysis import analyze_btc_data

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('btc_monitor.log')
    ]
)
logger = logging.getLogger('btc_monitor')

# Added Flask App Initialization
app = Flask(__name__)

def run_analysis() -> Dict[str, Any]:
    """
    Run the complete Bitcoin market analysis.
    Fetches market signals, decides initial position, fetches BTC data,
    analyzes BTC chart, and confirms/adjusts decision.

    Returns:
    --------
    Dict[str, Any]
        Dictionary containing the analysis results
    """
    logger.info("======== Starting Full Analysis ========")

    # 1. Get market signals
    signals = get_signal_status()
    logger.info(f"Market signals: {signals}")

    # 2. Decide initial BTC position based on signals
    btc_decision = decide_btc_position(signals)
    logger.info(f"Initial BTC decision: {btc_decision}")

    # 3. Fetch and Analyze BTC Data for Chart Validation
    btc_data: Optional[pd.DataFrame] = None
    btc_analysis: Optional[Dict[str, Any]] = None
    chart_validation: Optional[Dict[str, Any]] = None

    try:
        logger.info("Fetching latest BTC data...")
        # Using default parameters for fetch_btc_data, adjust if needed
        btc_data = fetch_btc_data()
        if btc_data is None or btc_data.empty:
            logger.error("Failed to fetch BTC data, cannot perform chart validation.")
            # Create a default chart_validation indicating failure
            chart_validation = {
                "decision": btc_decision["decision"],
                "explanation": f"{btc_decision['explanation']} (Chart validation skipped: Failed to fetch BTC data)",
                "chart_confirmed": False,
                "chart_explanation": "Failed to fetch BTC data"
            }
        else:
            logger.info(f"Fetched {len(btc_data)} rows of BTC data.")
            logger.info("Analyzing BTC data...")
            # Assuming analyze_btc_data takes the DataFrame
            btc_analysis = analyze_btc_data(btc_data)
            analysis_summary = btc_analysis.get('summary', 'No summary available')
            logger.info(f"BTC analysis results summary: {analysis_summary}")

            # 4. Validate with BTC chart
            logger.info("Validating decision with BTC chart...")
            chart_validation = confirm_with_btc_chart(btc_data, btc_analysis, btc_decision)
            logger.info(f"Chart validation result: {chart_validation}")

    except Exception as e:
        logger.error(f"Error during BTC data fetch, analysis, or chart validation: {str(e)}", exc_info=True)
        # Fallback chart_validation if any step above fails
        chart_validation = {
            "decision": btc_decision["decision"],
            "explanation": f"{btc_decision['explanation']} (Chart validation failed: {str(e)})",
            "chart_confirmed": False,
            "chart_explanation": f"Error during chart validation process: {str(e)}"
        }

    # 5. Compile results
    # Ensure chart_validation is not None before accessing its keys
    final_decision = chart_validation["decision"] if chart_validation else btc_decision["decision"]
    final_explanation = chart_validation["explanation"] if chart_validation else btc_decision["explanation"]

    results = {
        "timestamp": datetime.now().isoformat(),
        "signals": signals,
        "initial_decision": btc_decision,
        "btc_analysis_summary": btc_analysis.get('summary', 'N/A') if btc_analysis else 'N/A',
        "chart_validation": chart_validation,
        "final_decision": final_decision,
        "explanation": final_explanation
    }
    logger.info(f"======== Analysis Complete - Final Decision: {results['final_decision']} ========")
    return results

def print_results(results: Dict[str, Any]) -> None:
    """
    Print the analysis results in a formatted way.
    
    Parameters:
    -----------
    results : Dict[str, Any]
        Dictionary containing the analysis results
    """
    print("\n" + "="*80)
    print(f"BITCOIN MARKET ANALYSIS - {datetime.fromisoformat(results['timestamp']).strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    # Print market signals
    print("\nMARKET SIGNALS:")
    print("-"*80)
    for indicator, data in results["signals"].items():
        if indicator != "Overall":
            print(f"{indicator:<10}: {data['signal']} ({data['trend']})")
    
    print(f"\nOVERALL: {results['signals']['Overall']['signal']}")
    
    # Print initial BTC decision
    print("\nINITIAL BTC DECISION:")
    print("-"*80)
    print(f"Decision: {results['initial_decision']['decision']}")
    print(f"Explanation: {results['initial_decision']['explanation']}")
    
    # Print chart validation if available
    if results["chart_validation"]:
        print("\nCHART VALIDATION:")
        print("-"*80)
        print(f"Chart Confirmed: {'Yes' if results['chart_validation']['chart_confirmed'] else 'No'}")
        if 'chart_explanation' in results['chart_validation']:
            print(f"Chart Analysis: {results['chart_validation']['chart_explanation']}")
    
    # Print final recommendation
    print("\nFINAL RECOMMENDATION:")
    print("-"*80)
    print(f"Action: {results['final_decision']}")
    print(f"Reason: {results['explanation']}")
    print("="*80)

def save_results(results: Dict[str, Any], filename: str = "btc_analysis_results.json") -> None:
    """
    Save the analysis results to a JSON file.
    
    Parameters:
    -----------
    results : Dict[str, Any]
        Dictionary containing the analysis results
    filename : str, default "btc_analysis_results.json"
        Name of the file to save the results to
    """
    try:
        # Convert DataFrame to dict for JSON serialization
        serializable_results = results.copy()
        
        # Save to file
        with open(filename, 'w') as f:
            import json
            json.dump(serializable_results, f, indent=2)
        
        logger.info(f"Results saved to {filename}")
    except Exception as e:
        logger.error(f"Error saving results: {str(e)}")

def main():
    """Main function to run the Bitcoin monitoring system."""
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Bitcoin Market Monitoring System')
    parser.add_argument('--no-chart', action='store_true', help='Skip BTC chart validation')
    parser.add_argument('--save', action='store_true', help='Save results to a JSON file')
    parser.add_argument('--output', type=str, default='btc_analysis_results.json', 
                        help='Output filename for saved results')
    args = parser.parse_args()
    
    # Run the analysis
    results = run_analysis()
    
    # Print the results
    print_results(results)
    
    # Save the results if requested
    if args.save:
        save_results(results, args.output)

# Added Flask Route
@app.route('/get-decision')
def get_decision_route():
    logger.info("Received request for /get-decision route")
    try:
        start_time = time.time()
        results = run_analysis()
        end_time = time.time()
        duration = round(end_time - start_time, 2)
        logger.info(f"Request processed in {duration} seconds.")
        results['processing_time'] = duration
        return render_template('decision.html', results=results)
    except Exception as e:
        logger.error(f"Critical error processing /get-decision route: {e}", exc_info=True)
        return f"<h1>An internal error occurred</h1><p>Details: {e}</p><p>Check server logs for more information.</p>", 500

if __name__ == "__main__":
    # Check if script is run with arguments (likely for CLI)
    # or without (assume we want to run the server)
    # A simple check: if any args other than the script name exist.
    if len(sys.argv) > 1:
        # Allow running the CLI version with arguments like --save
        main()
    else:
        # Run the Flask web server
        logger.info("Starting Flask development server...")
        # Use 0.0.0.0 to make it accessible on the network
        # Use a specific port, e.g., 5001
        app.run(debug=True, host='0.0.0.0', port=5001) 