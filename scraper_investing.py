#!/usr/bin/env python
# scraper_investing.py
"""
Scraper for fetching indices futures data from Investing.com using Selenium and BeautifulSoup.

Requires Selenium and a WebDriver (e.g., chromedriver) installed.
Warning: Relies on the specific HTML structure of the page,
which can change without notice, breaking the scraper.
Check Investing.com's Terms of Service regarding scraping.
"""

import requests # Still potentially useful for other things, but not main fetch
from bs4 import BeautifulSoup
import pandas as pd
import logging
import re
from typing import Optional, List, Dict, Union
import time
import traceback

# Selenium imports
from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService 
# Use Service object for newer Selenium versions
# from webdriver_manager.chrome import ChromeDriverManager # Optional: Auto-manages chromedriver
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import WebDriverException, TimeoutException

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('investing_selenium_scraper')

URL = "https://www.investing.com/indices/indices-futures"

# Mimic browser headers (less critical with Selenium, but can keep)
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
}

def clean_value(value_str: Optional[str]) -> Optional[Union[float, str]]:
    """Clean number strings (remove commas, %, parentheses) and convert to float if possible."""
    if value_str is None:
        return None
    try:
        cleaned = value_str.strip().replace('%', '').replace('+', '').replace(',', '').replace('(', '').replace(')', '')
        if cleaned == '-' or not cleaned:
            return None
        return float(cleaned)
    except ValueError:
        logger.warning(f"Could not convert cleaned string '{cleaned}' to float. Original: '{value_str}'")
        return value_str.strip()
    except AttributeError:
         return value_str

def get_selenium_driver() -> Optional[webdriver.Chrome]:
    """Initializes and returns a headless Selenium Chrome WebDriver."""
    try:
        chrome_options = Options()
        chrome_options.add_argument("--headless") # Run headless
        chrome_options.add_argument("--no-sandbox") # Often needed in restricted environments
        chrome_options.add_argument("--disable-dev-shm-usage") # Overcome limited resource problems
        chrome_options.add_argument("--disable-gpu") # Applicable to Windows os only
        chrome_options.add_argument(f"user-agent={HEADERS['User-Agent']}") # Set user agent
        chrome_options.add_argument("window-size=1920,1080") # Specify window size

        # --- WebDriver Setup --- 
        # Option 1: Assume chromedriver is in PATH or specify path directly
        # driver = webdriver.Chrome(options=chrome_options)
        
        # Option 2: Use webdriver-manager (install with: pip install webdriver-manager)
        # Automatically downloads and manages the correct chromedriver version
        # Uncomment the next two lines and the webdriver_manager import if using this
        # service = ChromeService(ChromeDriverManager().install())
        # driver = webdriver.Chrome(service=service, options=chrome_options)

        # *** Fallback to manual path if Option 1/2 fails or preferred ***
        # Replace 'PATH_TO_YOUR_CHROMEDRIVER' with the actual path if needed
        # Example: service = ChromeService(executable_path='C:/path/to/chromedriver.exe')
        # If chromedriver is in PATH, this might just work:
        service = ChromeService() 
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        logger.info("Selenium WebDriver initialized successfully (Headless Chrome).")
        return driver
    except WebDriverException as e:
        logger.error(f"Failed to initialize Selenium WebDriver: {e}")
        logger.error("Ensure WebDriver (e.g., chromedriver) is installed and accessible in PATH, or specify executable_path.")
        logger.error(traceback.format_exc())
        return None
    except Exception as e:
         logger.error(f"Unexpected error during WebDriver initialization: {e}")
         logger.error(traceback.format_exc())
         return None


# --- NEW Generalized Instrument Page Scraper ---
def scrape_instrument_page(url: str) -> Optional[Dict[str, float]]:
    """
    Scrapes a specific Investing.com instrument page using Selenium.
    Attempts to find the last price and percentage change.

    Args:
        url (str): The URL of the instrument page to scrape.

    Returns:
    --------
    Optional[Dict[str, float]]
        A dictionary like {'Last': price, 'Chg. %': chg_pct} if successful,
        or None if scraping fails.
    """
    driver = None
    instrument_data = None
    
    try:
        logger.info(f"Attempting to scrape instrument page: {url}")
        driver = get_selenium_driver()
        if not driver:
            return None # Failed to get driver

        logger.info(f"Navigating to URL: {url}")
        driver.get(url)

        # Wait for page elements to potentially load
        wait_time = 7 # seconds (Adjust as needed)
        logger.info(f"Waiting {wait_time} seconds for page content...")
        time.sleep(wait_time)

        logger.info("Getting page source...")
        html = driver.page_source

        if not html:
            logger.error(f"Failed to get page source from Selenium for {url}.")
            return None

        logger.info("Parsing page source with BeautifulSoup...")
        soup = BeautifulSoup(html, 'lxml')

        # --- Find Price and Change % Elements ---        
        price_element = soup.find('div', {'data-test': 'instrument-price-last'})
        
        # --- Find Change Percentage Element (Corrected based on user HTML) --- 
        change_pct_element = soup.find('span', {'data-test': 'instrument-price-change-percent'})
        
        # Fallback: If the above fails, try the div wrapper (less likely based on snippet)
        if not change_pct_element:
            logger.debug("Primary span selector failed for change %, trying div wrapper...")
            change_pct_element = soup.find('div', {'data-test': 'instrument-price-change-percent'})
            
        # Fallback: Try the other span data-test just in case structure varies
        if not change_pct_element:
             logger.debug("Div wrapper selector failed for change %, trying span[percentage]...")
             change_pct_element = soup.find('span', {'data-test': 'instrument-price-change-percentage'})
             
        # Fallback: Try class regex (least reliable)
        if not change_pct_element:
             logger.debug("Span[percentage] selector failed for change %, trying class regex...")
             change_pct_element = soup.find('span', class_=re.compile(r'pid-\d+-pcp'))
             if change_pct_element:
                 logger.info("Found change % element using class regex fallback.")
        # ---------------------------------------------------------------------
            
        last_price = None
        change_pct = None

        if price_element:
            last_price = clean_value(price_element.get_text(strip=True))
            logger.info(f"Found potential Price: {last_price}")
        else:
            logger.warning(f"Could not find price element using selector [data-test=instrument-price-last] on {url}")

        if change_pct_element:
            change_pct = clean_value(change_pct_element.get_text(strip=True))
            logger.info(f"Found potential Change %: {change_pct}")
        else:
            logger.warning(f"Could not find change % element using several selectors on {url}.")
            
        # Check if we got both values and they are floats
        if isinstance(last_price, float) and isinstance(change_pct, float):
            instrument_data = {
                'Last': last_price,
                'Chg. %': change_pct
            }
            logger.info(f"Successfully extracted data for {url}: {instrument_data}")
        else:
            logger.error(f"Failed to extract valid price and change % from {url}.")
            instrument_data = None
            
        return instrument_data

    except TimeoutException:
        logger.error(f"Timeout occurred while loading page {url} with Selenium.")
        return None
    except Exception as e:
        logger.error(f"An unexpected error occurred during instrument scraping ({url}): {e}")
        logger.error(traceback.format_exc())
        return None
    finally:
        if driver:
            logger.info(f"Closing Selenium WebDriver for {url}.")
            driver.quit()
# --- END NEW FUNCTION ---


# --- Main execution block for testing (Optional: Update to test new function) ---
if __name__ == "__main__":
    test_url = "https://www.investing.com/indices/usdollar?cid=1224074" # Example: Test DXY page
    logger.info(f"Running single instrument scraper test for URL: {test_url}")
    data = scrape_instrument_page(test_url)

    if data:
        print("\n--- Scraped Data ---")
        print(f"Last: {data.get('Last', 'N/A')}, Change %: {data.get('Chg. %', 'N/A')}")
    else:
        print("\nScraping failed or returned no data.")

# --- Ensure helper functions are still present ---
# def clean_value(): ... # Keep this helper
# def get_selenium_driver(): ... # Keep this helper