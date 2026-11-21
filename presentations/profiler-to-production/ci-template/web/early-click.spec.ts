// Check behaviour, not milliseconds: a click on the visible button, before the rest of the page arrives, must work.
// Lighthouse scores this page 100 either way — this test is what tells the two versions apart.
import { expect, test } from '@playwright/test'

test('an early click on the visible catalog sorts it', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit' })
  await page.getByRole('button', { name: 'Price: low to high' }).click()
  // The recommendations are still loading: the click must have worked before they arrive.
  await expect(page.getByRole('status')).toHaveText('Sorted by price', { timeout: 1500 })
  await expect(page.locator('#recommendations')).toHaveCount(0)
})
