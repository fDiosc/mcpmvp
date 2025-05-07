const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3333/');

  // Envie uma mensagem no chat
  await page.type('#input', 'Crie uma nota chamada Teste Puppeteer');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000); // Aguarde a resposta do agente

  // Capture o conteúdo do chat
  const chatContent = await page.$eval('#chat', el => el.innerText);
  console.log('Chat:\n', chatContent);

  // Clique em atualizar notas e capture as notas
  await page.click('#notas button');
  await page.waitForTimeout(1000);
  const notas = await page.$eval('#lista-notas', el => el.innerText);
  console.log('Notas:\n', notas);

  await browser.close();
})(); 