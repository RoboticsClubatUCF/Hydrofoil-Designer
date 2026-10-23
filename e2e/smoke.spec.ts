import { expect, test, type Page } from '@playwright/test';

const shots = process.env.SCREENSHOT_DIR;

async function snap(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

// these tests start from a returning visitor: no first-visit tour (see tour.spec.ts)
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hydrofoil-designer:tour', 'done'));
});

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
  await page.getByLabel('Max aspect ratio', { exact: true }).fill('5');
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

test('secondary foil: same section, then its own profile', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example (NACA 63-412)' }).click();
  await type(page, 'm', '90');
  await type(page, 'V', '5');
  await page.getByRole('switch', { name: 'Include a secondary foil' }).check();

  // the load split is assumed, both foils are sized and the craft totals appear
  await expect(page.locator('#in-Dtot')).toHaveClass(/calculated/, { timeout: 30_000 });
  await expect(page.locator('#in-share')).toHaveClass(/assumed/);
  await expect(page.locator('.planform-svg')).toHaveCount(2);
  const formFoil = page.getByRole('group', { name: 'Foil shown in the design form' });
  await formFoil.getByRole('button', { name: 'Secondary foil' }).click();
  await expect(page.locator('#in-share2')).toHaveClass(/calculated/);
  await expect(page.locator('#in-AR2')).toHaveClass(/optimised/);
  await expect(page.locator('#in-b')).toHaveCount(0);

  // typing over the optimised aspect ratio fixes it; span and chord follow
  const span = await page.locator('#in-b2').inputValue();
  await type(page, 'AR2', '6');
  await expect(page.locator('#in-AR2')).toHaveClass(/input/, { timeout: 30_000 });
  await expect
    .poll(async () => page.locator('#in-b2').inputValue(), { timeout: 30_000 })
    .not.toBe(span);
  await expect(page.locator('#in-cr2')).toHaveClass(/calculated/);
  await snap(page, 'secondary-same-section');

  // a different profile for the secondary foil
  await page.getByRole('button', { name: 'Different profile' }).click();
  await page.getByRole('button', { name: 'Load example (NACA 0012)' }).click();
  await expect(page.getByText('NACA 0012 AIRFOIL').first()).toBeVisible();
  await expect
    .poll(async () => Number(await page.locator('#in-tc2').inputValue()), { timeout: 30_000 })
    .toBeCloseTo(12, 1);
  await expect
    .poll(async () => Number(await page.locator('#in-alphaL02').inputValue()), { timeout: 30_000 })
    .toBeCloseTo(0, 2);

  // the speed sweep shows both foils and their total
  await page.getByRole('tab', { name: 'Speed sweep' }).click();
  await expect(page.locator('.legend').getByText('Both foils').first()).toBeVisible();
  await snap(page, 'secondary-own-profile');

  // switching it off returns to a single foil
  await page.getByRole('switch', { name: 'Include a secondary foil' }).uncheck();
  await expect(page.locator('#in-b')).toBeVisible();
  await expect(page.locator('#in-Dtot')).toHaveCount(0);
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

test('3D flow: flies the design and reacts to speed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example (NACA 63-412)' }).click();
  await type(page, 'm', '90');
  await type(page, 'V', '5');
  await expect(page.locator('#in-S')).toHaveClass(/calculated/, { timeout: 20_000 });

  await page.getByRole('tab', { name: '3D flow' }).click();
  await expect(page.locator('.f3-canvas')).toBeVisible({ timeout: 20_000 });
  // at the design point the foil carries the load
  await expect(page.locator('.f3-hud')).toContainText('α to flow', { timeout: 30_000 });
  await expect(page.locator('.f3-pill.ok')).toContainText('lift = load');
  // measurements and force labels over the foil
  await expect(page.locator('.f3-tag.dim').first()).toContainText('span');
  await expect(page.locator('.f3-tag.lift')).toContainText('lift');
  await expect(page.locator('.f3-tag.drag')).toContainText('drawn ×10');
  await expect(page.locator('.f3-tag.dim', { hasText: 'angle of attack' })).toContainText('°');
  await snap(page, '3d-flow');

  // the section view only moves the camera: nothing is cut away, labels stay
  await page.getByRole('button', { name: 'Section', exact: true }).click();
  await expect(
    page
      .locator('.f3-tag.dim', { hasText: 'tip' })
      .or(page.locator('.f3-tag.dim', { hasText: 'depth' })),
  ).toBeVisible();

  // slowest speed: below take-off, so it stalls
  await page.getByRole('slider', { name: 'Speed', exact: true }).fill('0');
  await expect(page.locator('.f3-pill.bad')).toContainText('below take-off speed', {
    timeout: 30_000,
  });

  // scale figure and readouts can be switched off
  await page.getByRole('checkbox', { name: 'Person', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Readouts' }).click();
  await expect(page.locator('.f3-hud')).toHaveCount(0);
  // the buttons over the view switch measurements and forces off and on
  await page.getByRole('button', { name: 'Dimensions', exact: true }).click();
  await page.getByRole('button', { name: 'Forces', exact: true }).click();
  await expect(page.locator('.f3-tag.dim').first()).toBeHidden();
  await expect(page.locator('.f3-tag.lift')).toBeHidden();
  await expect(page.getByRole('checkbox', { name: 'Forces', exact: true })).not.toBeChecked();

  // each control has its own reset
  const resetPerson = page.getByRole('button', { name: 'Reset Person' });
  await expect(resetPerson).toBeEnabled();
  await resetPerson.click();
  await expect(page.getByRole('checkbox', { name: 'Person', exact: true })).toBeChecked();
  await expect(resetPerson).toBeDisabled();
  await page.getByRole('slider', { name: 'Load', exact: true }).fill('900');
  await page.getByRole('button', { name: 'Reset Load' }).click();
  await expect(page.getByRole('button', { name: 'Reset Load' })).toBeDisabled();
});
