const axios = require('axios');

async function testDecision(mode) {
    console.log(`\n=== Testando modo: ${mode} ===`);
    try {
        const res = await axios.get('http://localhost:5001/api/latest-decision');
        const data = res.data;
        console.log('Resposta:', JSON.stringify(data, null, 2));
        if (mode === 'full-market') {
            if (data.mode === 'full-market' && typeof data.score_1h === 'number' && typeof data.score_15m === 'number') {
                console.log('✅ Modo full-market OK');
            } else {
                console.error('❌ Falha no modo full-market');
            }
        } else if (mode === 'crypto-only') {
            if (data.mode === 'crypto-only' && data.score_1h === data.score_15m && data.score_total === data.score_1h) {
                console.log('✅ Modo crypto-only OK');
            } else {
                console.error('❌ Falha no modo crypto-only');
            }
        }
    } catch (err) {
        console.error('Erro ao chamar /api/latest-decision:', err.message);
    }
}

async function runTests() {
    // 1. Teste full-market (simule fresh nos globais antes)
    await testDecision('full-market');

    // 2. Teste crypto-only (simule stale nos globais antes)
    await testDecision('crypto-only');
}

runTests(); 