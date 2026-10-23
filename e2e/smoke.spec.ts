import { expect, test, type Page } from '@playwright/test';

const shots = process.env.SCREENSHOT_DIR;

async function snap(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function type(page: Page, id: string, value: string) {
  const el = page.locator(`#in-${id}`);
  await el.fill(value);
  await el.blur();
}

test('load example, enter what we know, see calculated values explained', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example (NACA 63-412)' }).click();
  await expect(page.getByText('NACA 63-412 AIRFOIL').first()).toBeVisible();
  await expect(page.locator('.badge.estimate').first()).toBeVisible();

  await type(page, 'm', '90');
  await type(page, 'V', '5');
  await type(page, 'b', '0.8');

  // chord, area and aspect ratio become calculated/optimised and locked or greyed
  await expect(page.locator('#in-S')).toHaveClass(/calculated/, { timeout: 15_000 });
  await expect(page.locator('#in-cr')).toHaveClass(/calculated/);
  await expect(page.locator('#in-cr')).toHaveAttribute('readonly', '');
  await expect(page.locator('#in-AR')).toHaveClass(/optimised/);

  // "how?" shows the worked formula
  await page.locator('#field-S .how').click();
  await expect(page.locator('#deriv-S .katex').first()).toBeVisible();
  await snap(page, 'desktop-light');

  // requirement changes the design
  const before = await page.locator('#in-AR').inputValue();
  await page.getByLabel('Max aspect ratio').fill('5');
  await expect
    .poll(async () => page.locator('#in-AR').inputValue(), { timeout: 15_000 })
    .not.toBe(before);
  expect(Number(await page.locator('#in-AR').inputValue())).toBeLessThanOrEqual(5.01);

  // tabs render charts
  for (const tab of ['Section', 'Span & structure', 'Speed sweep', 'Calculations', 'Export']) {
    await page.getByRole('tab', { name: tab }).click();
    if (tab !== 'Calculations' && tab !== 'Export')
      await expect(page.locator('.chart').first()).toBeVisible();
    if (shots)
      await page
        .locator('section[aria-label="Results"]')
        .screenshot({ path: `${shots}/tab-${tab.replace(/\W+/g, '-')}.png` });
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .dxf' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.dxf$/);

  // unit system switch converts the display
  await page.getByRole('button', { name: 'US', exact: true }).click();
  await expect(page.locator('#field-b select.unit')).toHaveValue('ft');
  await expect(page.locator('#in-b')).toHaveValue(/2\.62/);
});

test('dark theme and phone width render', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example (NACA 63-412)' }).click();
  await type(page, 'm', '90');
  await type(page, 'V', '5');
  await expect(page.locator('#in-S')).toHaveClass(/calculated/, { timeout: 20_000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await snap(page, 'phone-light');
  await page.getByRole('button', { name: /Theme/ }).click();
  await page.getByRole('button', { name: /Theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await snap(page, 'phone-dark');
});
