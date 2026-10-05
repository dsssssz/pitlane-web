import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const OUT = '/workspace/home-shots'
const BASE = process.env.PITLANE_URL || 'http://127.0.0.1:5173'
fs.mkdirSync(OUT, { recursive: true })

async function shot(page, name) {
  const file = path.join(OUT, `pitlane-web-${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log('wrote', file)
}

async function login(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' })
  await page.fill('input[type=email]', email)
  await page.click('button[type=submit]')
  await page.waitForSelector('.magic-box button')
  await page.click('.magic-box button')
  await page.waitForURL(/garage|profile|session/, { timeout: 15000 })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await shot(page, '01-home')

await login(page, 'demo@pitlane.local')
await shot(page, '02-garage')

await page.goto(`${BASE}/session/new`, { waitUntil: 'networkidle' })
await shot(page, '03-session-new')

// open first demo session via API list is hard; go tops + crew + duel
await page.goto(`${BASE}/tops`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await shot(page, '04-tops')

await page.goto(`${BASE}/crew`, { waitUntil: 'networkidle' })
await page.fill('input[placeholder=DEMOCREW], form:nth-of-type(2) input, .duel-grid form:last-child input', 'DEMOCREW').catch(() => {})
// join demo crew if needed
const codeInput = page.locator('.duel-grid form').nth(1).locator('input')
await codeInput.fill('DEMOCREW')
await page.locator('.duel-grid form').nth(1).locator('button').click()
await page.waitForTimeout(800)
await shot(page, '05-crew')

await page.goto(`${BASE}/duel`, { waitUntil: 'networkidle' })
const selects = page.locator('select')
const opts = await selects.nth(0).locator('option').allTextContents()
if (opts.length > 1) {
  await selects.nth(0).selectOption({ index: 1 })
  await selects.nth(1).selectOption({ index: Math.min(2, opts.length - 1) })
  await page.click('button[type=submit]')
  await page.waitForTimeout(600)
}
await shot(page, '06-duel')

// analysis: fetch demo example session id from API
const example = await page.evaluate(async () => {
  const r = await fetch('/api/demo/example')
  return r.json()
})
if (example?.example?.session?.id) {
  await page.goto(`${BASE}/session/${example.example.session.id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await shot(page, '07-analysis')
}

await page.setViewportSize({ width: 390, height: 844 })
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await shot(page, '08-home-mobile')

await browser.close()
console.log('done')
