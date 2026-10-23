import { expect, test } from '@playwright/test';

test('first visit offers the tour; it can be skipped, replayed and finished', async ({ page }) => {
  await page.goto('/');
  const welcome = page.getByRole('dialog', { name: 'Welcome to Hydrofoil Designer' });
  await expect(welcome).toBeVisible();

  // skipping closes it and it stays closed on the next visit
  await welcome.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Load example (NACA 63-412)' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Help opens it again; Escape closes it
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(welcome).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // starting with an empty design fills in the example
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Start the tour' }).click();
  await expect(page.getByRole('dialog', { name: 'The top bar' })).toBeVisible();
  await expect(page.locator('#in-m')).toHaveValue(/^90/);

  // walk through every step; the results steps switch tabs
  for (let n = 0; n < 40; n++) {
    if (await page.getByRole('dialog', { name: 'Results: Speed sweep' }).isVisible())
      await expect(page.getByRole('tab', { name: 'Speed sweep' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (!(await next.isVisible())) break;
    await next.click();
  }
  await expect(page.getByRole('dialog', { name: 'You are ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // back on the tab that was open before the tour
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('info buttons explain things in plain words', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hydrofoil-designer:tour', 'done'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Help: Craft mass (all-up)' }).click();
  await expect(page.getByRole('tooltip')).toContainText('total weight');
  // stays open after a click until Escape
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  // the example button fills in a design for beginners
  await page.getByRole('button', { name: 'Try an example design' }).click();
  await expect(page.locator('#in-S')).toHaveClass(/calculated/, { timeout: 20_000 });
});
