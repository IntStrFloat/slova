async page => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(() => {
    localStorage.setItem('slova\\levels.progress', JSON.stringify({ world: 'world14', currentLevel: 1000, completed: Array.from({ length: 999 }, (_, i) => i + 1) }));
    localStorage.setItem('slova\\currency.v1', JSON.stringify({ coins: 200 }));
    for (const key of ['collection.v1', 'progression.milestones.v1', 'currency.reward-ledger.v1', 'levels.reward-ledger.v1']) localStorage.removeItem('slova\\' + key);
    for (const key of ['game.current', 'game.current.normal']) localStorage.removeItem('slova\\' + key);
  });
  await page.goto('http://localhost:8083/game');
  const disk = page.getByTestId('letter-disk');
  await disk.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const words = ['бордовый', 'добро', 'выбор', 'обрыв', 'боров', 'роды'];
  for (const word of words) {
    const bounds = await disk.boundingBox();
    const tiles = await disk.locator('svg text').evaluateAll(nodes => nodes.map(node => ({
      letter: node.textContent.toLowerCase(),
      x: Number(node.getAttribute('x')),
      y: Number(node.getAttribute('y')),
    })));
    const tileRadius = Math.max(21, Math.min(34, bounds.width * 0.106));
    const used = new Set();
    for (let index = 0; index < word.length; index += 1) {
      const tileIndex = tiles.findIndex((tile, i) => tile.letter === word[index] && !used.has(i));
      if (tileIndex < 0) throw new Error(`Missing ${word[index]} for ${word}`);
      used.add(tileIndex);
      const tile = tiles[tileIndex];
      await page.mouse.move(bounds.x + tile.x, bounds.y + tile.y - tileRadius * 0.33);
      if (index === 0) await page.mouse.down();
    }
    await page.mouse.up();
  }
  await page.getByText('Глава завершена!', { exact: true }).waitFor();
  await page.getByText('Вы прошли 1000 уровней! Возвращайтесь за пазлом дня.', { exact: true }).waitFor();
  // Let the existing completion entrance animation finish before capture.
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'output/playwright/level1000-complete-360x640.png' });
  await page.getByRole('button', { name: /На карту путешествия/ }).click();
  await page.waitForURL('http://localhost:8083/');
  await page.getByText('Маршрут 1000/1000', { exact: true }).waitFor();
  const saved = await page.evaluate(() => ({
    progress: JSON.parse(localStorage.getItem('slova\\levels.progress')),
    currency: JSON.parse(localStorage.getItem('slova\\currency.v1')),
    collection: JSON.parse(localStorage.getItem('slova\\collection.v1')),
  }));
  if (saved.progress.currentLevel !== 1001 || saved.progress.completed.length !== 1000 || saved.currency.coins !== 400 || !saved.collection.opened.includes('spb-palacebridge-route2')) {
    throw new Error(JSON.stringify(saved));
  }
  return { solvedWords: words, completionTitle: 'Глава завершена!', currentLevel: saved.progress.currentLevel, coins: saved.currency.coins, collection: saved.collection };
}
