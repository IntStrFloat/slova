async page => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    localStorage.setItem('slova\\levels.progress', JSON.stringify({ world: 'world7', currentLevel: 460, completed: [] }));
    for (const key of ['game.current', 'game.current.normal']) localStorage.removeItem('slova\\' + key);
  });
  await page.goto('http://localhost:8083/game');
  const board = page.getByTestId('game-board-scroll');
  await board.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const wheelBefore = await page.getByTestId('letter-disk').boundingBox();
  await board.hover();
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => document.querySelector('[data-testid="game-board-scroll"]').scrollTop > 0);
  const scroll = await board.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, contentHeight: el.scrollHeight }));
  const wheelAfter = await page.getByTestId('letter-disk').boundingBox();
  if (wheelAfter.y !== wheelBefore.y || wheelAfter.width < 280) throw new Error('The wheel moved or shrank while scrolling the board');
  await page.screenshot({ path: 'output/playwright/tall-board-scrolled-320x568.png' });
  return { scroll, wheel: wheelAfter };
}
