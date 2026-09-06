import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

async function run() {
  console.log('=== STARTING PRAGATI BRANDING & LOGO VERIFICATION ===')

  // 1. Static file verification
  console.log('\n--- 1. Static Asset Verification ---')
  const indexHtml = fs.readFileSync('index.html', 'utf8')
  if (!indexHtml.includes('<title>PRAGATI — Farmer & Buyer Marketplace</title>')) {
    throw new Error('index.html does not contain the expected PRAGATI title tag!')
  }
  console.log('✓ index.html has updated PRAGATI title')

  const faviconSvg = fs.readFileSync('public/favicon.svg', 'utf8')
  if (!faviconSvg.includes('favLeafGrad') || !faviconSvg.includes('favArrowGrad')) {
    throw new Error('public/favicon.svg does not contain PRAGATI vector gradients!')
  }
  console.log('✓ public/favicon.svg contains PRAGATI vector gradients')

  const transContent = fs.readFileSync('src/translations.js', 'utf8')
  if (transContent.includes('Agri Marketplace') || transContent.includes("Farmer's Platform")) {
    throw new Error('translations.js still contains old generic brand references!')
  }
  console.log('✓ translations.js has zero remaining generic brand strings')

  // 2. Headless Chrome Browser Verification with Preview Server
  console.log('\n--- 2. Browser Verification (Vite Preview on port 4185) ---')
  const preview = spawn('npx', ['vite', 'preview', '--port', '4185'], {
    cwd: process.cwd(),
    shell: true,
  })

  // Wait for preview server
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200))
    try {
      const res = await fetch('http://localhost:4185/')
      if (res.status === 200) break
    } catch {}
  }
  console.log('Preview server ready at http://localhost:4185')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-brand-test-'))
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const port = 9345

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpDir}`,
    'http://localhost:4185/',
  ])

  let version = null
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300))
    try {
      const res = await fetch(`http://localhost:${port}/json/list`)
      const tabs = await res.json()
      const pageTab = tabs.find((t) => t.type === 'page' && t.url.includes('4185'))
      if (pageTab) {
        version = pageTab
        break
      }
    } catch {}
  }

  if (!version) {
    chrome.kill()
    preview.kill()
    throw new Error('Could not connect to Chrome debugging endpoint')
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl)
  let id = 1
  const pending = new Map()

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result)
      pending.delete(msg.id)
    }
  }

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const reqId = id++
      pending.set(reqId, resolve)
      ws.send(JSON.stringify({ id: reqId, method, params }))
    })

  await new Promise((r) => (ws.onopen = r))
  await send('Runtime.enable')
  await send('Page.enable')

  const evalCode = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return res?.result?.value
  }

  const setInput = async (selector, value) => {
    await evalCode(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  };

  try {
    // Check Landing Page Header & Footer
    console.log('\n--- 3. Landing Page Header & Footer Branding ---')
    await send('Page.navigate', { url: 'http://localhost:4185/' })
    await new Promise((r) => setTimeout(r, 1000))

    const brandTitle = await evalCode('document.querySelector(".brand-title")?.innerText?.trim()')
    console.log('Brand title in header:', brandTitle)
    if (brandTitle !== 'PRAGATI') {
      throw new Error(`Expected brand title to be "PRAGATI", got "${brandTitle}"`)
    }

    const hasSymbolSvg = await evalCode('document.querySelector(".brand-icon svg") !== null')
    console.log('Header has SVG symbol:', hasSymbolSvg)
    if (!hasSymbolSvg) {
      throw new Error('Header brand does not contain SVG symbol!')
    }

    const footerText = await evalCode('document.querySelector(".footer")?.innerText?.trim()')
    console.log('Footer text:', footerText)
    if (!footerText.includes('PRAGATI')) {
      throw new Error('Footer does not contain PRAGATI branding!')
    }
    console.log('✓ Header and Footer correctly render PRAGATI')

    // Test Hindi Language Mode preservation of PRAGATI
    console.log('\n--- 4. Hindi Language Toggle (Brand Name Preservation) ---')
    await evalCode('document.querySelector(".lang-toggle")?.click()')
    await new Promise((r) => setTimeout(r, 400))
    const hiBrandTitle = await evalCode('document.querySelector(".brand-title")?.innerText?.trim()')
    console.log('Brand title after switching to Hindi:', hiBrandTitle)
    if (hiBrandTitle !== 'PRAGATI') {
      throw new Error(`Brand title in Hindi should remain "PRAGATI", got "${hiBrandTitle}"`)
    }
    console.log('✓ Brand identity PRAGATI preserved in Hindi')

    // Switch back to English
    await evalCode('document.querySelector(".lang-toggle")?.click()')
    await new Promise((r) => setTimeout(r, 300))

    // Check Auth Page Branding
    console.log('\n--- 5. Auth Page Branding & Prominent Logo ---')
    await send('Page.navigate', { url: 'http://localhost:4185/auth' })
    await new Promise((r) => setTimeout(r, 1000))

    const authBannerText = await evalCode(
      'document.querySelector(".auth-brand-banner .pragati-wordmark-text")?.innerText?.trim()'
    )
    console.log('Auth banner wordmark:', authBannerText)
    if (authBannerText !== 'PRAGATI') {
      throw new Error(`Expected auth banner wordmark to be "PRAGATI", got "${authBannerText}"`)
    }

    const authSymbolPresent = await evalCode(
      'document.querySelector(".auth-header .pragati-auth-icon-wrap svg") !== null'
    )
    console.log('Auth header symbol present:', authSymbolPresent)
    if (!authSymbolPresent) {
      throw new Error('Auth header missing PRAGATI SVG symbol!')
    }

    // Switch to register tab to check heading
    await evalCode('document.querySelectorAll(".auth-tab")[1]?.click()')
    await new Promise((r) => setTimeout(r, 300))
    const registerHeading = await evalCode('document.querySelector(".auth-header h1")?.innerText?.trim()')
    console.log('Register heading text:', registerHeading)
    if (registerHeading !== 'Join PRAGATI') {
      throw new Error(`Expected register heading "Join PRAGATI", got "${registerHeading}"`)
    }
    console.log('✓ Auth page has prominent PRAGATI logo banner, symbol, and "Join PRAGATI" heading')

    // Check Admin Dashboard Console Branding
    console.log('\n--- 6. Admin Console Branding ---')
    // Switch to login tab
    await evalCode('document.querySelectorAll(".auth-tab")[0]?.click()')
    await new Promise((r) => setTimeout(r, 300))
    await setInput('#loginMobile', 'admin')
    await setInput('#loginPassword', 'admin')
    await evalCode('document.querySelector(".btn-submit-auth")?.click()')
    await new Promise((r) => setTimeout(r, 1200))

    const adminPath = await evalCode('window.location.pathname')
    console.log('Path after admin login:', adminPath)

    const adminTitle = await evalCode('document.querySelector(".admin-title")?.innerText?.trim()')
    console.log('Admin title:', adminTitle)
    if (!adminTitle?.includes('PRAGATI Admin Console')) {
      throw new Error(`Expected admin title to include "PRAGATI Admin Console", got "${adminTitle}"`)
    }
    console.log('✓ Admin dashboard displays "PRAGATI Admin Console"')

    // 7. Mobile Viewport Responsiveness (360px)
    console.log('\n--- 7. Mobile Viewport Responsiveness (360px) ---')
    await send('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 740,
      deviceScaleFactor: 2,
      mobile: true,
    })
    await send('Page.navigate', { url: 'http://localhost:4185/' })
    await new Promise((r) => setTimeout(r, 800))

    const overflowCheck = await evalCode(`(() => {
      const docWidth = document.documentElement.offsetWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      return { docWidth, scrollWidth, overflow: scrollWidth > docWidth };
    })()`)
    console.log('360px viewport overflow check:', overflowCheck)
    if (overflowCheck.overflow) {
      throw new Error(`Horizontal overflow detected at 360px! scrollWidth=${overflowCheck.scrollWidth}`)
    }

    const mobileBrandTitle = await evalCode('document.querySelector(".brand-title")?.innerText?.trim()')
    console.log('Mobile 360px brand title:', mobileBrandTitle)
    if (mobileBrandTitle !== 'PRAGATI') {
      throw new Error('Mobile header failed to render PRAGATI')
    }
    console.log('✓ Mobile 360px viewport has 0 horizontal overflow and clean PRAGATI branding')

    console.log('\n🎉 ALL PRAGATI BRANDING & LOGO VERIFICATIONS PASSED 100%!')
  } finally {
    ws.close()
    chrome.kill()
    preview.kill()
  }
}

run().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
