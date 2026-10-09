async page => {
  const results = [];
  const cases = [
    { level: 501, width: 360, height: 640 },
    { level: 999, width: 360, height: 640 },
    { level: 1000, width: 320, height: 568 },
    { level: 1000, width: 393, height: 852 },
    { level: 460, width: 320, height: 568 },
  ];
  for (const entry of cases) {
    await page.setViewportSize(entry);
    await page.evaluate(({ level }) => {
      localStorage.setItem('slova\\levels.progress', JSON.stringify({ world: 'world7', currentLevel: level, completed: Array.from({ length: level - 1 }, (_, i) => i + 1) }));
      localStorage.setItem('slova\\currency.v1', JSON.stringify({ coins: 123456 }));
      for (const key of ['game.current', 'game.current.normal']) localStorage.removeItem('slova\\' + key);
    }, entry);
    await page.goto('http://localhost:8083/game');
    const title = page.getByText(`Уровень ${entry.level}`, { exact: true });
    await title.waitFor();
    await page.getByTestId('game-board-scroll').waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const wheel = await page.getByTestId('letter-disk').boundingBox();
    const board = await page.getByTestId('game-board-scroll').boundingBox();
    const header = await title.evaluate(el => ({ width: el.clientWidth, contentWidth: el.scrollWidth, height: el.clientHeight, contentHeight: el.scrollHeight }));
    const bounds = { ...entry, wheel, board, header };
    if (wheel.width < 280 || wheel.x < 0 || wheel.y + wheel.height > entry.height || board.y + board.height > wheel.y + 1 || header.contentWidth > header.width || header.contentHeight > header.height) {
      throw new Error(JSON.stringify(bounds));
    }
    results.push(bounds);
    await page.screenshot({ path: `output/playwright/level${entry.level}-${entry.width}x${entry.height}.png` });
  }
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(() => localStorage.setItem('slova\\levels.progress', JSON.stringify({ world: 'world14', currentLevel: 1001, completed: Array.from({ length: 1000 }, (_, i) => i + 1) })));
  await page.goto('http://localhost:8083/');
  await page.getByText('Уровень 1000', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'output/playwright/home-complete1000-360x640.png' });
  return results;
}
