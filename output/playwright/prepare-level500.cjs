async page => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.route('**/api/**', route => route.fulfill({ status: 503, body: '{}' }));
  await page.evaluate(() => {
    localStorage.setItem('slova\\onboarding.done.v1', '1');
    localStorage.setItem('slova\\levels.progress', JSON.stringify({ world: 'world7', currentLevel: 500, completed: [499] }));
  });
  await page.goto('http://localhost:8083/game');
}
