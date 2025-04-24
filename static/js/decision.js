// Funding Score calculation and display
function updateFundingScore() {
    fetch('/api/funding')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            const fundingRateElement = document.getElementById('funding-score');
            const fundingRateCard = document.getElementById('funding-score-card');
            const lastUpdatedElement = document.getElementById('funding-last-updated');
            
            if (fundingRateElement && lastUpdatedElement) {
                // Calculate weighted funding score
                let totalScore = 0;
                let weightSum = 0;
                
                // Weights for different timeframes
                const weights = {
                    'next_funding': 5,
                    'predicted_funding': 3,
                    'current_funding': 1
                };
                
                // Calculate weighted score
                for (const [exchange, fundingData] of Object.entries(data)) {
                    for (const [timeframe, value] of Object.entries(fundingData)) {
                        if (timeframe in weights && !isNaN(value)) {
                            totalScore += (value * 100) * weights[timeframe]; // Convert to percentage
                            weightSum += weights[timeframe];
                        }
                    }
                }
                
                // Calculate final score
                const finalScore = weightSum > 0 ? (totalScore / weightSum).toFixed(4) : "N/A";
                
                // Display the score
                fundingRateElement.textContent = finalScore + '%';
                
                // Update class based on value
                fundingRateElement.classList.remove('positive', 'negative', 'neutral');
                fundingRateCard.classList.remove('pulse');
                
                if (finalScore !== "N/A") {
                    const scoreValue = parseFloat(finalScore);
                    if (scoreValue > 0.01) {
                        fundingRateElement.classList.add('positive');
                    } else if (scoreValue < -0.01) {
                        fundingRateElement.classList.add('negative');
                        fundingRateCard.classList.add('pulse'); // Add pulse animation for negative values
                    } else {
                        fundingRateElement.classList.add('neutral');
                    }
                } else {
                    fundingRateElement.classList.add('neutral');
                }
                
                // Update timestamp
                const now = new Date();
                lastUpdatedElement.textContent = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
            }
        })
        .catch(error => {
            console.error('Error fetching funding data:', error);
            const alertBanner = document.querySelector('.alert-banner');
            if (alertBanner) {
                alertBanner.textContent = 'Error loading funding data. Please refresh the page.';
                alertBanner.style.display = 'block';
            }
        });
}

// Initial calls to update data
document.addEventListener('DOMContentLoaded', function() {
    // Create alert banner if it doesn't exist
    if (!document.querySelector('.alert-banner')) {
        const alertBanner = document.createElement('div');
        alertBanner.className = 'alert-banner';
        document.body.insertBefore(alertBanner, document.body.firstChild);
    }
    
    updateMarketData();
    updateWhaleActivity();
    updateFundingScore(); // Initialize funding score
    
    // Set up interval updates
    setInterval(updateMarketData, 60000); // Every minute
    setInterval(updateWhaleActivity, 300000); // Every 5 minutes
    setInterval(updateFundingScore, 180000); // Every 3 minutes
}); 