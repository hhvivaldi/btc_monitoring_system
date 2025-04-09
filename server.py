#!/usr/bin/env python
# server.py
"""
Flask server for the Bitcoin monitoring system.
This script serves a web interface to display real-time market data and analysis results.
"""

import os
import json
import time
import traceback
from datetime import datetime
from flask import Flask, render_template, jsonify
import pandas as pd
import threading
import logging
import requests
from requests.exceptions import RequestException

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('btc_monitor.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('server')

try:
    # Import our modules
    from market_signals import (
        get_signal_status, 
        decide_btc_position, 
        confirm_with_btc_chart
    )
    from data_fetcher import fetch_btc_data
    from analysis import analyze_btc_data
    logger.info("Successfully imported all required modules")
except Exception as e:
    logger.error(f"Failed to import required modules: {str(e)}")
    logger.error(f"Traceback: {traceback.format_exc()}")
    raise

app = Flask(__name__)

# Create templates directory if it doesn't exist
os.makedirs('templates', exist_ok=True)

# Global variables to store the analysis state
last_analysis_results = None
last_analysis_time = None
analysis_lock = threading.Lock()
analysis_status = {
    "status": "initializing",
    "progress": 0,
    "error": None,
    "last_update": None
}

def background_analysis():
    """Run analysis in the background and update the global results."""
    global last_analysis_results, last_analysis_time, analysis_status
    
    try:
        with analysis_lock:
            analysis_status["status"] = "running"
            analysis_status["progress"] = 0
            analysis_status["error"] = None
            analysis_status["last_update"] = datetime.now().isoformat()
        
        logger.info("Starting background analysis")
        
        # Get market signals with timeout
        try:
            with analysis_lock:
                analysis_status["progress"] = 10
                analysis_status["last_update"] = datetime.now().isoformat()
            
            signals = get_signal_status()
            logger.info(f"Market signals: {signals}")
            
            with analysis_lock:
                analysis_status["progress"] = 30
                analysis_status["last_update"] = datetime.now().isoformat()
            
            # Get BTC decision
            btc_decision = decide_btc_position(signals)
            logger.info(f"BTC decision: {btc_decision}")
            
            with analysis_lock:
                analysis_status["progress"] = 50
                analysis_status["last_update"] = datetime.now().isoformat()
            
            # Validate with chart analysis
            try:
                logger.info("Fetching BTC data for chart validation")
                btc_data = fetch_btc_data()
                btc_analysis = analyze_btc_data(btc_data)
                
                with analysis_lock:
                    analysis_status["progress"] = 70
                    analysis_status["last_update"] = datetime.now().isoformat()
                
                logger.info("Validating decision with BTC chart")
                chart_validation = confirm_with_btc_chart(btc_data, btc_analysis, btc_decision)
                logger.info(f"Chart validation: {chart_validation}")
            except Exception as e:
                logger.error(f"Error in chart validation: {str(e)}")
                logger.error(f"Traceback: {traceback.format_exc()}")
                chart_validation = {
                    "decision": btc_decision["decision"],
                    "explanation": f"{btc_decision['explanation']} (Chart validation failed: {str(e)})",
                    "chart_confirmed": False,
                    "chart_explanation": f"Error during chart validation: {str(e)}"
                }
            
            # Compile results
            results = {
                "timestamp": datetime.now().isoformat(),
                "signals": signals,
                "btc_decision": btc_decision,
                "chart_validation": chart_validation,
                "final_decision": chart_validation["decision"] if chart_validation else btc_decision["decision"],
                "explanation": chart_validation["explanation"] if chart_validation else btc_decision["explanation"]
            }
            
            with analysis_lock:
                last_analysis_results = results
                last_analysis_time = datetime.now()
                analysis_status["status"] = "completed"
                analysis_status["progress"] = 100
                analysis_status["last_update"] = datetime.now().isoformat()
                logger.info("Background analysis completed successfully")
            
        except RequestException as e:
            logger.error(f"Network error in market signals: {str(e)}")
            raise
            
    except Exception as e:
        logger.error(f"Error in background analysis: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        with analysis_lock:
            last_analysis_results = {"error": str(e)}
            last_analysis_time = datetime.now()
            analysis_status["status"] = "error"
            analysis_status["error"] = str(e)
            analysis_status["last_update"] = datetime.now().isoformat()

# Start the background analysis thread
analysis_thread = threading.Thread(target=background_analysis)
analysis_thread.daemon = True
analysis_thread.start()

@app.route('/')
def index():
    """Render the main page with Bitcoin monitoring data."""
    try:
        # Check if we have results from the background analysis
        with analysis_lock:
            results = last_analysis_results
            analysis_time = last_analysis_time
            status = analysis_status
        
        # If no results yet, show a loading message with progress
        if results is None:
            return render_template('index.html', 
                                loading=True,
                                status=status,
                                timestamp=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
        
        # If there was an error in the analysis
        if isinstance(results, dict) and "error" in results:
            return render_template('index.html', 
                                error=results["error"],
                                status=status,
                                timestamp=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
        
        return render_template('index.html',
                            results=results,
                            status=status,
                            timestamp=analysis_time.strftime('%Y-%m-%d %H:%M:%S'))
    
    except Exception as e:
        logger.error(f"Error in index route: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return render_template('index.html', error=f"Error: {str(e)}")

@app.route('/api/data')
def get_data():
    """API endpoint to get the analysis data as JSON."""
    try:
        # Check if we have results from the background analysis
        with analysis_lock:
            results = last_analysis_results
            analysis_time = last_analysis_time
            status = analysis_status
        
        # If no results yet, return the current status
        if results is None:
            return jsonify({
                "status": "loading",
                "progress": status["progress"],
                "message": "Analysis in progress",
                "last_update": status["last_update"]
            })
        
        # If there was an error in the analysis
        if isinstance(results, dict) and "error" in results:
            return jsonify({
                "status": "error",
                "error": results["error"],
                "last_update": status["last_update"]
            })
        
        # Return the results
        return jsonify({
            "status": "completed",
            "results": results,
            "last_update": status["last_update"]
        })
    
    except Exception as e:
        logger.error(f"Error in API route: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({"error": str(e)})

@app.route('/api/status')
def get_status():
    """API endpoint to get the current analysis status."""
    with analysis_lock:
        return jsonify(analysis_status)

if __name__ == "__main__":
    # Enable threading to handle background tasks and web requests concurrently
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True) 