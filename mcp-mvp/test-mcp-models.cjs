const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3333/chat';
const jiraAuth = {
  baseUrl: 'https://merxcarbon.atlassian.net',
  username: 'jean.minzon@merx.tech',
  apiToken: ''
};
const productLabUserId = 'cm9d38wi30000qt0d0dan25dg'; // se necessário

async function testModel(model, message) {
  const start = Date.now();
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        message,
        jiraAuth,
        productLabUserId
      })
    });
    const data = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);

    // Tenta pegar tokens do backend (ajuste a chave conforme sua resposta)
    const tokens = data.tokens || (data.usage && data.usage.total_tokens) || 'N/A';

    if (res.ok && data.response) {
      console.log(`[OK] ${model}:`, data.response.slice(0, 80) + '...');
      console.log(`Tempo: ${elapsed}s | Tokens: ${tokens}`);
      return { ok: true, elapsed, tokens };
    } else {
      console.error(`[FAIL] ${model}:`, data.error || 'No response');
      console.log(`Tempo: ${elapsed}s | Tokens: ${tokens}`);
      return { ok: false, elapsed, tokens };
    }
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    console.error(`[ERROR] ${model}:`, err.message);
    console.log(`Tempo: ${elapsed}s | Tokens: N/A`);
    return { ok: false, elapsed, tokens: 'N/A' };
  }
}

(async () => {
  console.log('Testando integração com Claude...');
  const claude = await testModel('anthropic', 'Teste automático Claude: Me entregue detalhes da issue GAC 1918');

  console.log('Testando integração com OpenAI...');
  const openai = await testModel('openai', 'Teste automático OpenAI: Me entregue detalhes da issue GAC 1918');

  if (claude.ok && openai.ok) {
    console.log('\n✅ Todos os testes passaram!');
  } else {
    console.error('\n❌ Algum teste falhou!');
  }
  console.log(`Resumo:\nClaude: ${claude.elapsed}s, tokens: ${claude.tokens}\nOpenAI: ${openai.elapsed}s, tokens: ${openai.tokens}`);
  process.exit((claude.ok && openai.ok) ? 0 : 1);
})();