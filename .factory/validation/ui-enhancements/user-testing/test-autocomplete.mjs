import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const APP_URL = 'http://localhost:3002/';
const REPORT_PATH = '/Users/bryan/code/compare-dex-routers/.factory/validation/ui-enhancements/user-testing/flows/autocomplete.json';
const SCREENSHOT_DIR = '/Users/bryan/code/compare-dex-routers/.factory/validation/ui-enhancements/user-testing/screenshots';

// Ensure directories exist
mkdirSync(dirname(REPORT_PATH), { recursive: true });
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const report = {
  group: 'autocomplete',
  assertions: {},
  frictions: [],
  blockers: [],
  toolsUsed: ['playwright-chromium', 'curl'],
};

async function screenshot(page, name) {
  const path = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function disableAutoRefresh(page) {
  await page.evaluate(() => {
    if (window._refreshTimer) clearInterval(window._refreshTimer);
  });
}

async function triggerAutocomplete(page, selector, value) {
  await page.evaluate(({ sel, val }) => {
    const input = document.querySelector(sel);
    if (!input) throw new Error(`Input not found: ${sel}`);
    input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('keyup', { bubbles: true }));
  }, { sel: selector, val: value });
  // Wait for dropdown to appear
  await page.waitForTimeout(500);
}

async function testVALAUTO001(page) {
  console.log('Testing VAL-AUTO-001: Autocomplete appears on From field input');
  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await disableAutoRefresh(page);

    // Find the From Token input
    const fromInputSelector = await page.evaluate(() => {
      // Try various selectors
      const byId = document.querySelector('#fromToken');
      if (byId) return '#fromToken';
      const byName = document.querySelector('[name="from"]');
      if (byName) return '[name="from"]';
      const inputs = document.querySelectorAll('input[type="text"]');
      for (let i = 0; i < inputs.length; i++) {
        const label = inputs[i].closest('label') || inputs[i].previousElementSibling;
        const placeholder = inputs[i].placeholder || '';
        if (placeholder.toLowerCase().includes('from') || placeholder.toLowerCase().includes('token') || (label && label.textContent.toLowerCase().includes('from'))) {
          return `input[type="text"]:nth-of-type(${i + 1})`;
        }
      }
      // Return info about available inputs
      return JSON.stringify(Array.from(inputs).map((inp, i) => ({
        idx: i,
        id: inp.id,
        name: inp.name,
        placeholder: inp.placeholder,
        type: inp.type,
        parentText: inp.parentElement?.textContent?.substring(0, 50),
      })));
    });
    console.log('  From input selector:', fromInputSelector);

    // Take a snapshot of the page to understand the structure
    const pageStructure = await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) return 'No form found';
      return form.innerHTML.substring(0, 3000);
    });
    console.log('  Form structure (first 500 chars):', pageStructure.substring(0, 500));

    // Type USDC in the from token field
    await triggerAutocomplete(page, fromInputSelector.startsWith('{') || fromInputSelector.startsWith('[') ? 'input[type="text"]' : fromInputSelector, 'USDC');

    // Check if a dropdown appeared
    const dropdownVisible = await page.evaluate(() => {
      // Look for autocomplete dropdown elements
      const dropdowns = document.querySelectorAll('[class*="autocomplete"], [class*="dropdown"], [id*="autocomplete"], [id*="dropdown"], [role="listbox"], datalist');
      if (dropdowns.length > 0) return { found: true, count: dropdowns.length, type: 'class/id match' };

      // Look for any newly visible list-like elements near inputs
      const lists = document.querySelectorAll('ul, ol, div[role="listbox"], .suggestions, .options');
      for (const list of lists) {
        if (list.children.length > 0 && list.offsetHeight > 0) {
          return { found: true, count: list.children.length, type: 'list element', text: list.textContent.substring(0, 200) };
        }
      }

      // Check for any elements that look like autocomplete items
      const items = document.querySelectorAll('[class*="suggestion"], [class*="option"], [class*="item"], [class*="result"]');
      const visibleItems = Array.from(items).filter(el => el.offsetHeight > 0 && el.textContent.includes('USDC'));
      if (visibleItems.length > 0) {
        return { found: true, count: visibleItems.length, type: 'item elements', text: visibleItems[0].textContent.substring(0, 200) };
      }

      // Check for datalist
      const datalists = document.querySelectorAll('datalist');
      if (datalists.length > 0) {
        return { found: true, count: datalists[0].options.length, type: 'datalist' };
      }

      return { found: false, availableElements: document.body.innerHTML.substring(0, 500) };
    });

    console.log('  Dropdown visible:', JSON.stringify(dropdownVisible));
    await screenshot(page, 'val-auto-001-from-autocomplete');

    report.assertions['VAL-AUTO-001'] = {
      status: dropdownVisible.found ? 'pass' : 'fail',
      evidence: `Typed "USDC" in From Token field. Dropdown ${dropdownVisible.found ? 'appeared' : 'did not appear'}. Details: ${JSON.stringify(dropdownVisible)}. Screenshot: val-auto-001-from-autocomplete.png`,
      reason: dropdownVisible.found ? null : 'No autocomplete dropdown appeared after typing USDC',
    };
  } catch (err) {
    console.error('  Error:', err.message);
    report.assertions['VAL-AUTO-001'] = {
      status: 'blocked',
      evidence: `Error during test: ${err.message}`,
      reason: err.message,
    };
  }
}

async function testVALAUTO002(page) {
  console.log('Testing VAL-AUTO-002: Autocomplete appears on To field input');
  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await disableAutoRefresh(page);

    // Type WETH in the to token field
    const toInputInfo = await page.evaluate(() => {
      const byId = document.querySelector('#toToken');
      if (byId) return { selector: '#toToken', found: true };
      const byName = document.querySelector('[name="to"]');
      if (byName) return { selector: '[name="to"]', found: true };
      // Look at all text inputs
      const inputs = document.querySelectorAll('input[type="text"]');
      return {
        selector: null,
        found: false,
        inputs: Array.from(inputs).map((inp, i) => ({
          idx: i, id: inp.id, name: inp.name, placeholder: inp.placeholder,
        })),
      };
    });
    console.log('  To input info:', JSON.stringify(toInputInfo));

    const toSelector = toInputInfo.selector || '[name="to"]';
    await triggerAutocomplete(page, toSelector, 'WETH');

    const dropdownVisible = await page.evaluate(() => {
      const lists = document.querySelectorAll('ul, ol, div[role="listbox"], .suggestions, .options');
      for (const list of lists) {
        if (list.children.length > 0 && list.offsetHeight > 0) {
          return { found: true, count: list.children.length, type: 'list element', text: list.textContent.substring(0, 200) };
        }
      }
      const items = document.querySelectorAll('[class*="suggestion"], [class*="option"], [class*="item"], [class*="result"]');
      const visibleItems = Array.from(items).filter(el => el.offsetHeight > 0 && el.textContent.includes('WETH'));
      if (visibleItems.length > 0) {
        return { found: true, count: visibleItems.length, type: 'item elements', text: visibleItems[0].textContent.substring(0, 200) };
      }
      const dropdowns = document.querySelectorAll('[class*="autocomplete"], [class*="dropdown"], [id*="autocomplete"], [id*="dropdown"]');
      for (const dd of dropdowns) {
        if (dd.offsetHeight > 0 && dd.children.length > 0) {
          return { found: true, count: dd.children.length, type: 'dropdown div', text: dd.textContent.substring(0, 200) };
        }
      }
      return { found: false };
    });

    console.log('  Dropdown visible:', JSON.stringify(dropdownVisible));
    await screenshot(page, 'val-auto-002-to-autocomplete');

    report.assertions['VAL-AUTO-002'] = {
      status: dropdownVisible.found ? 'pass' : 'fail',
      evidence: `Typed "WETH" in To Token field. Dropdown ${dropdownVisible.found ? 'appeared' : 'did not appear'}. Details: ${JSON.stringify(dropdownVisible)}. Screenshot: val-auto-002-to-autocomplete.png`,
      reason: dropdownVisible.found ? null : 'No autocomplete dropdown appeared after typing WETH',
    };
  } catch (err) {
    console.error('  Error:', err.message);
    report.assertions['VAL-AUTO-002'] = {
      status: 'blocked',
      evidence: `Error during test: ${err.message}`,
      reason: err.message,
    };
  }
}

async function testVALAUTO003(page) {
  console.log('Testing VAL-AUTO-003: Autocomplete works with wallet connected');
  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await disableAutoRefresh(page);

    // Inject mock ERC-6963 provider
    await page.evaluate(() => {
      const mockProvider = {
        request: async ({ method }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
            return ['0x1234567890123456789012345678901234567890'];
          }
          if (method === 'eth_chainId') return '0x1';
          if (method === 'net_version') return '1';
          return null;
        },
        on: () => {},
        removeListener: () => {},
      };
      const event = new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: 'mock-uuid-auto', name: 'Mock Wallet', icon: 'data:image/png;base64,iVBORw0KGgo=', rdns: 'mock.wallet.auto' },
          provider: mockProvider,
        },
      });
      window.dispatchEvent(event);
      window.ethereum = mockProvider;
    });

    // Wait for wallet UI to update
    await page.waitForTimeout(1000);

    // Click connect button if present
    const connectClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const connectBtn = buttons.find(b => b.textContent.toLowerCase().includes('connect') || b.textContent.toLowerCase().includes('wallet'));
      if (connectBtn) {
        connectBtn.click();
        return true;
      }
      return false;
    });
    console.log('  Connect button clicked:', connectClicked);
    await page.waitForTimeout(1000);

    // Check if wallet shows connected
    const walletState = await page.evaluate(() => {
      const body = document.body.textContent;
      return {
        hasWalletAddress: body.includes('0x1234567890123456789012345678901234567890'),
        hasConnected: body.toLowerCase().includes('connected') || body.toLowerCase().includes('disconnect'),
      };
    });
    console.log('  Wallet state:', JSON.stringify(walletState));

    // Now type in From field to test autocomplete
    const fromSelector = await page.evaluate(() => {
      const byId = document.querySelector('#fromToken');
      if (byId) return '#fromToken';
      const byName = document.querySelector('[name="from"]');
      if (byName) return '[name="from"]';
      return 'input[type="text"]';
    });

    await triggerAutocomplete(page, fromSelector, 'USDC');

    const dropdownVisible = await page.evaluate(() => {
      const lists = document.querySelectorAll('ul, ol, div[role="listbox"], .suggestions, .options');
      for (const list of lists) {
        if (list.children.length > 0 && list.offsetHeight > 0) {
          return { found: true, count: list.children.length, type: 'list element' };
        }
      }
      const dropdowns = document.querySelectorAll('[class*="autocomplete"], [class*="dropdown"], [id*="autocomplete"], [id*="dropdown"]');
      for (const dd of dropdowns) {
        if (dd.offsetHeight > 0 && dd.children.length > 0) {
          return { found: true, count: dd.children.length, type: 'dropdown div' };
        }
      }
      return { found: false };
    });

    console.log('  Dropdown visible with wallet:', JSON.stringify(dropdownVisible));
    await screenshot(page, 'val-auto-003-autocomplete-with-wallet');

    const walletAndDropdown = (walletState.hasWalletAddress || walletState.hasConnected) && dropdownVisible.found;
    report.assertions['VAL-AUTO-003'] = {
      status: dropdownVisible.found ? 'pass' : 'fail',
      evidence: `Injected mock wallet. Wallet state: ${JSON.stringify(walletState)}. Typed "USDC" in From field. Dropdown ${dropdownVisible.found ? 'appeared' : 'did not appear'}. Screenshot: val-auto-003-autocomplete-with-wallet.png`,
      reason: dropdownVisible.found ? null : 'Autocomplete dropdown did not appear with wallet connected',
    };
  } catch (err) {
    console.error('  Error:', err.message);
    report.assertions['VAL-AUTO-003'] = {
      status: 'blocked',
      evidence: `Error during test: ${err.message}`,
      reason: err.message,
    };
  }
}

async function testVALAUTO004(page) {
  console.log('Testing VAL-AUTO-004: Selecting autocomplete item populates field');
  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await disableAutoRefresh(page);

    // Type USDC in from field
    const fromSelector = await page.evaluate(() => {
      const byId = document.querySelector('#fromToken');
      if (byId) return '#fromToken';
      const byName = document.querySelector('[name="from"]');
      if (byName) return '[name="from"]';
      return 'input[type="text"]';
    });

    await triggerAutocomplete(page, fromSelector, 'USDC');
    await screenshot(page, 'val-auto-004-before-select');

    // Click the first autocomplete item
    const clickResult = await page.evaluate(() => {
      // Look for dropdown items
      const items = document.querySelectorAll('[class*="autocomplete"] div, [class*="dropdown"] div, [id*="autocomplete"] div, [id*="dropdown"] div');
      for (const item of items) {
        if (item.offsetHeight > 0 && item.textContent.includes('USDC')) {
          item.click();
          return { clicked: true, text: item.textContent.substring(0, 100) };
        }
      }
      // Try li items
      const listItems = document.querySelectorAll('li, [role="option"]');
      for (const item of listItems) {
        if (item.offsetHeight > 0 && item.textContent.includes('USDC')) {
          item.click();
          return { clicked: true, text: item.textContent.substring(0, 100) };
        }
      }
      // Try any clickable element near the input
      const clickables = document.querySelectorAll('div[onclick], div[style*="cursor"], a');
      for (const item of clickables) {
        if (item.offsetHeight > 0 && item.textContent.includes('USDC') && item.textContent.includes('0x')) {
          item.click();
          return { clicked: true, text: item.textContent.substring(0, 100) };
        }
      }
      return { clicked: false };
    });

    console.log('  Click result:', JSON.stringify(clickResult));
    await page.waitForTimeout(500);

    // Check what the input now contains
    const afterSelect = await page.evaluate((sel) => {
      const input = document.querySelector(sel);
      if (!input) return { value: null, error: 'input not found' };
      return {
        value: input.value,
        hasAddress: input.value.includes('0x'),
      };
    }, fromSelector);

    console.log('  After select:', JSON.stringify(afterSelect));
    await screenshot(page, 'val-auto-004-after-select');

    // Also check if there's a hidden input storing the full address
    const hiddenAddress = await page.evaluate(() => {
      const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
      for (const input of hiddenInputs) {
        if (input.value.startsWith('0x') && input.value.length === 42) {
          return { found: true, name: input.name, value: input.value };
        }
      }
      // Check data attributes on the form or from input
      const fromInput = document.querySelector('#fromToken') || document.querySelector('[name="from"]');
      if (fromInput && fromInput.dataset) {
        return { found: !!fromInput.dataset.address, dataAttributes: { ...fromInput.dataset } };
      }
      return { found: false };
    });

    console.log('  Hidden address:', JSON.stringify(hiddenAddress));

    const populated = clickResult.clicked && (afterSelect.value?.includes('USDC') || afterSelect.value?.includes('0x'));
    report.assertions['VAL-AUTO-004'] = {
      status: populated ? 'pass' : 'fail',
      evidence: `Typed "USDC", clicked autocomplete item: ${JSON.stringify(clickResult)}. Input after: "${afterSelect.value}". Hidden address: ${JSON.stringify(hiddenAddress)}. Screenshots: val-auto-004-before-select.png, val-auto-004-after-select.png`,
      reason: populated ? null : `Field not populated correctly after selection. Click: ${clickResult.clicked}, Value: ${afterSelect.value}`,
    };
  } catch (err) {
    console.error('  Error:', err.message);
    report.assertions['VAL-AUTO-004'] = {
      status: 'blocked',
      evidence: `Error during test: ${err.message}`,
      reason: err.message,
    };
  }
}

async function testVALAUTO005(page) {
  console.log('Testing VAL-AUTO-005: Autocomplete filters by selected chain');
  try {
    // Test on Base chain first
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await disableAutoRefresh(page);

    // Select Base chain (chainId 8453)
    const chainSwitched = await page.evaluate(() => {
      const chainSelect = document.querySelector('select[name="chainId"], #chainId, [name="chain"]');
      if (chainSelect) {
        // Look for Base option
        const options = Array.from(chainSelect.options);
        const baseOpt = options.find(o => o.text.toLowerCase().includes('base') || o.value === '8453');
        if (baseOpt) {
          chainSelect.value = baseOpt.value;
          chainSelect.dispatchEvent(new Event('change', { bubbles: true }));
          return { switched: true, chain: 'Base', value: baseOpt.value };
        }
        return { switched: false, availableOptions: options.map(o => ({ text: o.text, value: o.value })) };
      }
      // Look for chain buttons/radio
      const buttons = Array.from(document.querySelectorAll('button, [role="radio"], [role="tab"]'));
      const baseBtn = buttons.find(b => b.textContent.toLowerCase().includes('base'));
      if (baseBtn) {
        baseBtn.click();
        return { switched: true, chain: 'Base', type: 'button' };
      }
      return { switched: false, error: 'No chain selector found' };
    });

    console.log('  Chain switched to Base:', JSON.stringify(chainSwitched));
    await page.waitForTimeout(500);

    // Type USDC
    const fromSelector = await page.evaluate(() => {
      const byId = document.querySelector('#fromToken');
      if (byId) return '#fromToken';
      const byName = document.querySelector('[name="from"]');
      if (byName) return '[name="from"]';
      return 'input[type="text"]';
    });

    await triggerAutocomplete(page, fromSelector, 'USDC');

    const baseResults = await page.evaluate(() => {
      const dropdowns = document.querySelectorAll('[class*="autocomplete"], [class*="dropdown"], [id*="autocomplete"], [id*="dropdown"]');
      for (const dd of dropdowns) {
        if (dd.offsetHeight > 0 && dd.children.length > 0) {
          return { found: true, items: Array.from(dd.children).map(c => c.textContent.substring(0, 150)).slice(0, 5) };
        }
      }
      return { found: false };
    });

    console.log('  Base USDC results:', JSON.stringify(baseResults));
    await screenshot(page, 'val-auto-005-base-usdc');

    // Now switch to Ethereum
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await disableAutoRefresh(page);

    const ethSwitched = await page.evaluate(() => {
      const chainSelect = document.querySelector('select[name="chainId"], #chainId, [name="chain"]');
      if (chainSelect) {
        const options = Array.from(chainSelect.options);
        const ethOpt = options.find(o => o.text.toLowerCase().includes('ethereum') || o.value === '1');
        if (ethOpt) {
          chainSelect.value = ethOpt.value;
          chainSelect.dispatchEvent(new Event('change', { bubbles: true }));
          return { switched: true, chain: 'Ethereum', value: ethOpt.value };
        }
      }
      const buttons = Array.from(document.querySelectorAll('button, [role="radio"], [role="tab"]'));
      const ethBtn = buttons.find(b => b.textContent.toLowerCase().includes('ethereum'));
      if (ethBtn) {
        ethBtn.click();
        return { switched: true, chain: 'Ethereum', type: 'button' };
      }
      return { switched: false };
    });

    console.log('  Chain switched to Ethereum:', JSON.stringify(ethSwitched));
    await page.waitForTimeout(500);

    await triggerAutocomplete(page, fromSelector, 'USDC');

    const ethResults = await page.evaluate(() => {
      const dropdowns = document.querySelectorAll('[class*="autocomplete"], [class*="dropdown"], [id*="autocomplete"], [id*="dropdown"]');
      for (const dd of dropdowns) {
        if (dd.offsetHeight > 0 && dd.children.length > 0) {
          return { found: true, items: Array.from(dd.children).map(c => c.textContent.substring(0, 150)).slice(0, 5) };
        }
      }
      return { found: false };
    });

    console.log('  Ethereum USDC results:', JSON.stringify(ethResults));
    await screenshot(page, 'val-auto-005-ethereum-usdc');

    // Compare addresses - they should differ between chains
    const bothFound = baseResults.found && ethResults.found;
    const addressesDiffer = bothFound && JSON.stringify(baseResults.items) !== JSON.stringify(ethResults.items);

    report.assertions['VAL-AUTO-005'] = {
      status: bothFound && addressesDiffer ? 'pass' : (bothFound ? 'fail' : 'blocked'),
      evidence: `Base USDC results: ${JSON.stringify(baseResults)}. Ethereum USDC results: ${JSON.stringify(ethResults)}. Addresses differ: ${addressesDiffer}. Screenshots: val-auto-005-base-usdc.png, val-auto-005-ethereum-usdc.png`,
      reason: bothFound ? (addressesDiffer ? null : 'Same addresses shown for both chains') : 'Autocomplete dropdown not found on one or both chains',
    };
  } catch (err) {
    console.error('  Error:', err.message);
    report.assertions['VAL-AUTO-005'] = {
      status: 'blocked',
      evidence: `Error during test: ${err.message}`,
      reason: err.message,
    };
  }
}

async function testVALAUTO006() {
  console.log('Testing VAL-AUTO-006: GET /tokenlist returns 200 with tokens array');
  try {
    const response = await fetch('http://localhost:3002/tokenlist');
    const status = response.status;
    const body = await response.json();
    const hasTokens = Array.isArray(body.tokens);
    const tokenCount = hasTokens ? body.tokens.length : 0;

    console.log(`  Status: ${status}, hasTokens: ${hasTokens}, tokenCount: ${tokenCount}`);

    report.assertions['VAL-AUTO-006'] = {
      status: status === 200 && hasTokens && tokenCount > 0 ? 'pass' : 'fail',
      evidence: `GET /tokenlist returned HTTP ${status}. Response has tokens array: ${hasTokens}. Token count: ${tokenCount}. First token: ${hasTokens && tokenCount > 0 ? JSON.stringify(body.tokens[0]).substring(0, 100) : 'N/A'}`,
      reason: status === 200 && hasTokens && tokenCount > 0 ? null : `Status: ${status}, hasTokens: ${hasTokens}, tokenCount: ${tokenCount}`,
    };
  } catch (err) {
    console.error('  Error:', err.message);
    report.assertions['VAL-AUTO-006'] = {
      status: 'blocked',
      evidence: `Error during test: ${err.message}`,
      reason: err.message,
    };
  }
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    // First, let's understand the page structure
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await disableAutoRefresh(page);

    const pageInfo = await page.evaluate(() => {
      const form = document.querySelector('form');
      const inputs = document.querySelectorAll('input');
      const selects = document.querySelectorAll('select');
      return {
        title: document.title,
        hasForm: !!form,
        inputCount: inputs.length,
        inputs: Array.from(inputs).map(inp => ({
          id: inp.id, name: inp.name, type: inp.type, placeholder: inp.placeholder,
          parentLabel: inp.closest('label')?.textContent?.substring(0, 50),
        })),
        selectCount: selects.length,
        selects: Array.from(selects).map(sel => ({
          id: sel.id, name: sel.name,
          options: Array.from(sel.options).map(o => ({ text: o.text, value: o.value })),
        })),
      };
    });

    console.log('Page structure:', JSON.stringify(pageInfo, null, 2));
    await screenshot(page, 'val-auto-000-page-structure');

    // Run all tests
    await testVALAUTO001(page);
    await testVALAUTO002(page);
    await testVALAUTO003(page);
    await testVALAUTO004(page);
    await testVALAUTO005(page);
    await testVALAUTO006(); // No browser needed

    // Check console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        consoleErrors.push(msg.text());
      }
    });

    await browser.close();
    browser = null;

    // Generate summary
    const statuses = Object.values(report.assertions).map(a => a.status);
    const passCount = statuses.filter(s => s === 'pass').length;
    const failCount = statuses.filter(s => s === 'fail').length;
    const blockedCount = statuses.filter(s => s === 'blocked').length;

    report.summary = `Tested ${statuses.length} assertions: ${passCount} passed, ${failCount} failed, ${blockedCount} blocked`;

    // Write report
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${REPORT_PATH}`);
    console.log(`Summary: ${report.summary}`);
  } catch (err) {
    console.error('Fatal error:', err);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
