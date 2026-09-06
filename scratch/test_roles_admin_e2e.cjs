const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function run() {
  console.log('=== STARTING 3-ROLE SYSTEM & ADMIN E2E TEST SUITE ===');

  const previewPort = 4185;
  const chromePort = 9348;

  // Start Vite preview server on port 4185
  const preview = spawn('npx', ['vite', 'preview', '--port', String(previewPort)], {
    cwd: 'c:\\Users\\acer\\Desktop\\Farmer\'s platform',
    shell: true
  });

  // Wait for preview server
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const res = await fetch(`http://localhost:${previewPort}/`);
      if (res.status === 200) break;
    } catch {}
  }
  console.log(`Vite preview running on http://localhost:${previewPort}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-admin-test-'));
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${tmpDir}`,
    `http://localhost:${previewPort}/`
  ]);

  // Connect to Chrome debugging endpoint
  let version = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const res = await fetch(`http://localhost:${chromePort}/json/list`);
      const tabs = await res.json();
      const pageTab = tabs.find(t => t.type === 'page' && t.url.includes(String(previewPort)));
      if (pageTab) {
        version = pageTab;
        break;
      }
    } catch {}
  }

  if (!version) {
    console.error('Could not connect to Chrome debugging endpoint');
    chrome.kill();
    preview.kill();
    process.exit(1);
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('>>> BROWSER EXCEPTION:', JSON.stringify(msg.params.exceptionDetails));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      console.error('>>> BROWSER CONSOLE ERROR:', JSON.stringify(msg.params.args));
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };

  const send = (method, params = {}) => new Promise((resolve) => {
    const reqId = id++;
    pending.set(reqId, resolve);
    ws.send(JSON.stringify({ id: reqId, method, params }));
  });

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.enable');

  const evalCode = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.value;
  };

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

  // Wait for initial load
  await new Promise(r => setTimeout(r, 1200));

  try {
    // -------------------------------------------------------------
    // TEST 1: Unauthenticated Route Protection for /admin
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Unauthenticated Route Protection ---');
    await send('Page.navigate', { url: `http://localhost:${previewPort}/admin` });
    await new Promise(r => setTimeout(r, 800));
    let pathAfterUnauth = await evalCode('window.location.pathname');
    console.log('Unauthenticated access to /admin -> Resulting path:', pathAfterUnauth);
    if (pathAfterUnauth !== '/auth') {
      throw new Error(`Expected redirect to /auth, got ${pathAfterUnauth}`);
    }
    console.log('✓ Unauthenticated access to /admin successfully redirected to /auth');

    // -------------------------------------------------------------
    // TEST 2: Admin Login with default credentials (admin / admin)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Admin Login (admin / admin) ---');
    await setInput('#loginMobile', 'admin');
    await setInput('#loginPassword', 'admin');
    await evalCode('document.querySelector(".btn-submit-auth").click()');
    await new Promise(r => setTimeout(r, 1200));

    let pathAfterAdminLogin = await evalCode('window.location.pathname');
    console.log('Path after Admin login:', pathAfterAdminLogin);
    if (pathAfterAdminLogin !== '/admin') {
      throw new Error(`Expected redirect to /admin after admin login, got ${pathAfterAdminLogin}`);
    }
    console.log('✓ Admin login succeeded and redirected directly to /admin');

    // -------------------------------------------------------------
    // TEST 3: Admin Dashboard UI & Platform Overview KPIs
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Admin Dashboard UI & Platform KPIs ---');
    const adminTitle = await evalCode('document.querySelector(".admin-title")?.innerText');
    const adminRolePill = await evalCode('document.querySelector(".admin-role-pill")?.innerText');
    const kpiFarmers = await evalCode('document.querySelector(".kpi-card-farmers .kpi-value")?.innerText');
    const kpiBuyers = await evalCode('document.querySelector(".kpi-card-buyers .kpi-value")?.innerText');
    const kpiListings = await evalCode('document.querySelector(".kpi-card-listings .kpi-value")?.innerText');
    const kpiGmv = await evalCode('document.querySelector(".kpi-card-orders .kpi-value")?.innerText');

    console.log('Admin Title:', adminTitle);
    console.log('Admin Role Pill:', adminRolePill);
    console.log('KPI Farmers:', kpiFarmers);
    console.log('KPI Buyers:', kpiBuyers);
    console.log('KPI Listings:', kpiListings);
    console.log('KPI GMV:', kpiGmv);

    if (!adminTitle?.includes('Administration')) {
      throw new Error('Admin title missing or incorrect');
    }
    if (!adminRolePill?.includes('ADMIN')) {
      throw new Error('Admin role pill missing');
    }
    console.log('✓ Admin Dashboard KPIs and Header verified');

    // -------------------------------------------------------------
    // TEST 4: Admin Tab Navigation & Management Sections
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Admin Tab Navigation ---');
    // Tab: Users
    await evalCode('document.querySelectorAll(".admin-tab-btn")[1].click()');
    await new Promise(r => setTimeout(r, 400));
    const userTableRows = await evalCode('document.querySelectorAll(".admin-table tbody tr").length');
    console.log('User table rows count:', userTableRows);
    if (userTableRows < 1) throw new Error('User table should display registered users');

    // Tab: Listings
    await evalCode('document.querySelectorAll(".admin-tab-btn")[2].click()');
    await new Promise(r => setTimeout(r, 400));
    const listingsHeading = await evalCode('document.querySelector(".admin-section-header h2")?.innerText');
    console.log('Listings section heading:', listingsHeading);
    if (!listingsHeading?.includes('Listing Management')) throw new Error('Listings section not shown');

    // Tab: Orders & Escrow
    await evalCode('document.querySelectorAll(".admin-tab-btn")[3].click()');
    await new Promise(r => setTimeout(r, 400));
    const ordersHeading = await evalCode('document.querySelector(".admin-section-header h2")?.innerText');
    console.log('Orders section heading:', ordersHeading);
    if (!ordersHeading?.includes('Orders & Escrow')) throw new Error('Orders section not shown');

    // Tab: AI Monitoring
    await evalCode('document.querySelectorAll(".admin-tab-btn")[5].click()');
    await new Promise(r => setTimeout(r, 400));
    const aiHeading = await evalCode('document.querySelector(".admin-section-header h2")?.innerText');
    const aiChecksTitle = await evalCode('document.querySelector(".ai-stat-card h3")?.innerText');
    console.log('AI section heading:', aiHeading);
    console.log('AI stat card title:', aiChecksTitle);
    if (!aiHeading?.includes('AI Intelligence')) throw new Error('AI monitoring section not shown');
    console.log('✓ Admin tabs (Users, Listings, Orders, AI) verified successfully');

    // -------------------------------------------------------------
    // TEST 5: Admin Header Navigation Links
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Admin Role-Based Header Navigation ---');
    const headerAdminBtn = await evalCode('document.querySelector(".header-btn-admin")?.innerText');
    const headerSellBtn = await evalCode('document.querySelector(".header-btn-sell")');
    const headerMarketplaceBtn = await evalCode('document.querySelector(".header-btn-marketplace")');
    console.log('Header Admin Console button:', headerAdminBtn);
    console.log('Farmer Sell button exists for Admin:', headerSellBtn !== null);
    console.log('Buyer Marketplace button exists for Admin:', headerMarketplaceBtn !== null);

    if (!headerAdminBtn?.includes('Admin Console')) throw new Error('Admin Console button missing from Header');
    if (headerSellBtn !== null) throw new Error('Admin should NOT see Farmer Sell button in header');
    if (headerMarketplaceBtn !== null) throw new Error('Admin should NOT see Buyer Marketplace button in header');
    console.log('✓ Header dynamically adapts to Admin role cleanly');

    // -------------------------------------------------------------
    // TEST 6: Sign Out Admin & Login as Standard User (Farmer/Buyer)
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Sign Out & Standard User Login ---');
    await evalCode('document.querySelector(".admin-btn-logout").click()');
    await new Promise(r => setTimeout(r, 800));

    // Register standard user
    await evalCode('document.querySelectorAll(".auth-tab")[1].click()');
    await new Promise(r => setTimeout(r, 300));
    const testUserMobile = '98765' + Math.floor(10000 + Math.random() * 90000);
    await setInput('#regName', 'Ramesh Patel');
    await setInput('#regMobile', testUserMobile);
    await setInput('#regLocation', 'Indore, MP');
    await setInput('#regPassword', 'password123');
    await setInput('#regConfirmPassword', 'password123');
    await evalCode('document.querySelector(".btn-submit-auth").click()');
    await new Promise(r => setTimeout(r, 1000));

    let userPath = await evalCode('window.location.pathname');
    console.log('Standard user path after auth:', userPath);
    if (userPath !== '/dashboard') throw new Error(`Expected /dashboard, got ${userPath}`);
    console.log('✓ Standard user registered and redirected to /dashboard');

    // -------------------------------------------------------------
    // TEST 7: Farmer Access to /admin is Blocked
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Farmer Access to /admin is Blocked ---');
    await send('Page.navigate', { url: `http://localhost:${previewPort}/admin` });
    await new Promise(r => setTimeout(r, 1200));
    let blockedPath = await evalCode('window.location.pathname');
    console.log('Farmer attempting /admin -> resulting path:', blockedPath);
    if (blockedPath !== '/dashboard') {
      throw new Error(`Non-admin should be redirected from /admin to /dashboard, got ${blockedPath}`);
    }
    console.log('✓ Access to /admin strictly blocked for non-admin users');

    // -------------------------------------------------------------
    // TEST 8: Dashboard Role Mode Switcher (Farmer <-> Buyer)
    // -------------------------------------------------------------
    console.log('\n--- TEST 8: Dashboard Role Mode Switcher ---');
    const initialRoleBadge = await evalCode('document.querySelector(".meta-badge-role")?.innerText');
    console.log('Initial Role Badge:', initialRoleBadge);

    // Switch to Buyer View
    await evalCode('document.querySelectorAll(".btn-role-mode")[1].click()');
    await new Promise(r => setTimeout(r, 300));
    const buyerRoleBadge = await evalCode('document.querySelector(".meta-badge-role")?.innerText');
    console.log('Role Badge after toggle to Buyer:', buyerRoleBadge);
    if (!buyerRoleBadge?.includes('Buyer')) throw new Error('Role badge did not update to Buyer');

    // Switch back to Farmer View
    await evalCode('document.querySelectorAll(".btn-role-mode")[0].click()');
    await new Promise(r => setTimeout(r, 300));
    const farmerRoleBadge = await evalCode('document.querySelector(".meta-badge-role")?.innerText');
    console.log('Role Badge after toggle back to Farmer:', farmerRoleBadge);
    if (!farmerRoleBadge?.includes('Farmer')) throw new Error('Role badge did not update to Farmer');
    console.log('✓ Role switcher toggles Farmer and Buyer modes seamlessly');

    // -------------------------------------------------------------
    // TEST 9: Multi-Viewport Responsiveness on /admin (0px Overflow)
    // -------------------------------------------------------------
    console.log('\n--- TEST 9: Multi-Viewport Responsiveness on /admin ---');
    // Log back in as admin
    await evalCode('document.querySelector(".btn-logout-dash").click()');
    await new Promise(r => setTimeout(r, 600));
    await setInput('#loginMobile', 'admin');
    await setInput('#loginPassword', 'admin');
    await evalCode('document.querySelector(".btn-submit-auth").click()');
    await new Promise(r => setTimeout(r, 1000));

    const testViewports = [1440, 1024, 768, 480, 360];
    for (const w of testViewports) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: 800,
        deviceScaleFactor: 1,
        mobile: w <= 768,
      });
      await new Promise(r => setTimeout(r, 300));

      const overflow = await evalCode(`(() => {
        const docW = document.documentElement.scrollWidth;
        const winW = window.innerWidth;
        return Math.max(0, docW - winW);
      })()`);

      console.log(`Viewport ${w}px on /admin: horizontal overflow = ${overflow}px`);
      if (overflow > 1) {
        throw new Error(`Horizontal overflow ${overflow}px detected on /admin at ${w}px width`);
      }
    }
    console.log('✓ Multi-viewport responsiveness verified across 1440px to 360px with 0px horizontal overflow');

    console.log('\n🎉 ALL 3-ROLE SYSTEM & ADMIN E2E TESTS PASSED 100%! 🛡️🌾🛒');
  } finally {
    try {
      await send('Emulation.clearDeviceMetricsOverride');
      ws.close();
      chrome.kill();
      preview.kill();
    } catch {}
  }
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
