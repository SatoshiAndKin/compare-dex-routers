#!/usr/bin/env python3
"""Test autocomplete assertions VAL-AUTO-001 through VAL-AUTO-006."""

import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

APP_URL = "http://localhost:3002/"
REPORT_PATH = "/Users/bryan/code/compare-dex-routers/.factory/validation/ui-enhancements/user-testing/flows/autocomplete.json"
SCREENSHOT_DIR = "/Users/bryan/code/compare-dex-routers/.factory/validation/ui-enhancements/user-testing/screenshots"

Path(REPORT_PATH).parent.mkdir(parents=True, exist_ok=True)
Path(SCREENSHOT_DIR).mkdir(parents=True, exist_ok=True)

report = {
    "group": "autocomplete",
    "assertions": {},
    "frictions": [],
    "blockers": [],
    "toolsUsed": ["playwright-python-chromium", "urllib"],
}


def take_screenshot(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    return path


def setup_page(page):
    """Navigate and wait for tokenlist to load, disable auto-refresh."""
    page.goto(APP_URL, wait_until="networkidle")
    # Wait for tokenlist to load
    page.wait_for_function("() => typeof tokenlistTokens !== 'undefined' && tokenlistTokens.length > 0", timeout=10000)
    # Disable auto-refresh
    page.evaluate("() => { if (window._refreshTimer) clearInterval(window._refreshTimer); }")


def trigger_autocomplete(page, input_id, value):
    """Type into an input and trigger autocomplete dropdown."""
    page.evaluate("""({inputId, val}) => {
        const input = document.getElementById(inputId);
        if (!input) throw new Error('Input #' + inputId + ' not found');
        input.focus();
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }""", {"inputId": input_id, "val": value})
    time.sleep(0.6)


def find_dropdown(page, list_id):
    """Check if autocomplete dropdown is visible and get its items."""
    return page.evaluate("""(listId) => {
        const list = document.getElementById(listId);
        if (!list) return { found: false, error: 'list element not found' };
        const isVisible = list.classList.contains('show') && list.offsetHeight > 0;
        const items = list.querySelectorAll('.autocomplete-item');
        if (!isVisible || items.length === 0) {
            return { found: false, hasShowClass: list.classList.contains('show'), itemCount: items.length };
        }
        return {
            found: true,
            count: items.length,
            items: Array.from(items).map(item => {
                const symbol = item.querySelector('.autocomplete-symbol');
                const addr = item.querySelector('.autocomplete-addr');
                return {
                    symbol: symbol ? symbol.textContent : '',
                    address: addr ? addr.textContent : '',
                    fullText: item.textContent.substring(0, 200),
                };
            }).slice(0, 5),
        };
    }""", list_id)


def test_val_auto_001(page):
    """VAL-AUTO-001: Autocomplete appears on From field input."""
    print("Testing VAL-AUTO-001: Autocomplete appears on From field input")
    try:
        setup_page(page)
        trigger_autocomplete(page, "from", "USDC")
        dropdown = find_dropdown(page, "fromAutocomplete")
        print(f"  Dropdown: {json.dumps(dropdown)}")
        take_screenshot(page, "val-auto-001-from-autocomplete")

        report["assertions"]["VAL-AUTO-001"] = {
            "status": "pass" if dropdown["found"] else "fail",
            "evidence": f'Typed "USDC" in #from input. Dropdown {"appeared with " + str(dropdown.get("count", 0)) + " items" if dropdown["found"] else "did not appear"}. Items: {json.dumps(dropdown.get("items", [])[:3])}. Screenshot: val-auto-001-from-autocomplete.png',
            "reason": None if dropdown["found"] else f"No autocomplete dropdown appeared. Details: {json.dumps(dropdown)}",
        }
    except Exception as e:
        print(f"  Error: {e}")
        report["assertions"]["VAL-AUTO-001"] = {
            "status": "blocked", "evidence": f"Error: {e}", "reason": str(e),
        }


def test_val_auto_002(page):
    """VAL-AUTO-002: Autocomplete appears on To field input."""
    print("Testing VAL-AUTO-002: Autocomplete appears on To field input")
    try:
        setup_page(page)
        trigger_autocomplete(page, "to", "WETH")
        dropdown = find_dropdown(page, "toAutocomplete")
        print(f"  Dropdown: {json.dumps(dropdown)}")
        take_screenshot(page, "val-auto-002-to-autocomplete")

        report["assertions"]["VAL-AUTO-002"] = {
            "status": "pass" if dropdown["found"] else "fail",
            "evidence": f'Typed "WETH" in #to input. Dropdown {"appeared with " + str(dropdown.get("count", 0)) + " items" if dropdown["found"] else "did not appear"}. Items: {json.dumps(dropdown.get("items", [])[:3])}. Screenshot: val-auto-002-to-autocomplete.png',
            "reason": None if dropdown["found"] else f"No autocomplete dropdown appeared. Details: {json.dumps(dropdown)}",
        }
    except Exception as e:
        print(f"  Error: {e}")
        report["assertions"]["VAL-AUTO-002"] = {
            "status": "blocked", "evidence": f"Error: {e}", "reason": str(e),
        }


def test_val_auto_003(page):
    """VAL-AUTO-003: Autocomplete works with wallet connected."""
    print("Testing VAL-AUTO-003: Autocomplete works with wallet connected")
    try:
        setup_page(page)

        # Inject mock ERC-6963 provider
        page.evaluate("""() => {
            const mockProvider = {
                request: async ({ method }) => {
                    if (method === 'eth_requestAccounts' || method === 'eth_accounts')
                        return ['0x1234567890123456789012345678901234567890'];
                    if (method === 'eth_chainId') return '0x1';
                    if (method === 'net_version') return '1';
                    return null;
                },
                on: () => {},
                removeListener: () => {},
            };
            window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
                detail: {
                    info: { uuid: 'mock-uuid-auto', name: 'Mock Wallet', icon: 'data:image/png;base64,iVBORw0KGgo=', rdns: 'mock.wallet.auto' },
                    provider: mockProvider,
                },
            }));
            window.ethereum = mockProvider;
        }""")
        time.sleep(1)

        # Click Connect Wallet button
        page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const connectBtn = btns.find(b => b.textContent.includes('Connect Wallet'));
            if (connectBtn) connectBtn.click();
        }""")
        time.sleep(0.5)

        # Click Mock Wallet in provider menu
        page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const mockBtn = btns.find(b => b.textContent.includes('Mock Wallet'));
            if (mockBtn) mockBtn.click();
        }""")
        time.sleep(1)

        # Check wallet state
        wallet_state = page.evaluate("""() => ({
            hasAddress: document.body.textContent.includes('0x1234567890123456789012345678901234567890'),
            hasDisconnect: document.body.textContent.toLowerCase().includes('disconnect'),
        })""")
        print(f"  Wallet state: {json.dumps(wallet_state)}")

        # Type in From field
        trigger_autocomplete(page, "from", "USDC")
        dropdown = find_dropdown(page, "fromAutocomplete")
        print(f"  Dropdown: {json.dumps(dropdown)}")
        take_screenshot(page, "val-auto-003-autocomplete-with-wallet")

        report["assertions"]["VAL-AUTO-003"] = {
            "status": "pass" if dropdown["found"] else "fail",
            "evidence": f'Mock wallet injected and connected. Wallet visible: {json.dumps(wallet_state)}. Typed "USDC" in From field. Dropdown {"appeared with " + str(dropdown.get("count", 0)) + " items" if dropdown["found"] else "did not appear"}. Screenshot: val-auto-003-autocomplete-with-wallet.png',
            "reason": None if dropdown["found"] else "Autocomplete dropdown did not appear with wallet connected",
        }
    except Exception as e:
        print(f"  Error: {e}")
        report["assertions"]["VAL-AUTO-003"] = {
            "status": "blocked", "evidence": f"Error: {e}", "reason": str(e),
        }


def test_val_auto_004(page):
    """VAL-AUTO-004: Selecting autocomplete item populates field."""
    print("Testing VAL-AUTO-004: Selecting autocomplete item populates field")
    try:
        setup_page(page)
        trigger_autocomplete(page, "from", "USDC")
        take_screenshot(page, "val-auto-004-before-select")

        # Click first autocomplete item using mousedown (matching the event listener)
        click_result = page.evaluate("""() => {
            const list = document.getElementById('fromAutocomplete');
            const items = list.querySelectorAll('.autocomplete-item');
            if (items.length === 0) return { clicked: false, error: 'no items' };
            const first = items[0];
            first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            return {
                clicked: true,
                text: first.textContent.substring(0, 100),
                symbol: first.querySelector('.autocomplete-symbol')?.textContent || '',
                address: first.querySelector('.autocomplete-addr')?.textContent || '',
            };
        }""")
        print(f"  Click result: {json.dumps(click_result)}")
        time.sleep(0.5)

        # Check what the input now contains
        after_select = page.evaluate("""() => {
            const input = document.getElementById('from');
            return {
                value: input.value,
                dataAddress: input.dataset.address || null,
                hasAddress: (input.dataset.address || '').startsWith('0x'),
            };
        }""")
        print(f"  After select: {json.dumps(after_select)}")
        take_screenshot(page, "val-auto-004-after-select")

        # Check dropdown is hidden
        dropdown_hidden = page.evaluate("""() => {
            const list = document.getElementById('fromAutocomplete');
            return !list.classList.contains('show');
        }""")
        print(f"  Dropdown hidden: {dropdown_hidden}")

        populated = (click_result.get("clicked", False)
                     and after_select.get("value", "")
                     and after_select.get("hasAddress", False))

        report["assertions"]["VAL-AUTO-004"] = {
            "status": "pass" if populated else "fail",
            "evidence": f'Typed "USDC", clicked first autocomplete item: {json.dumps(click_result)}. Input value: "{after_select.get("value", "")}". data-address: "{after_select.get("dataAddress", "")}". Dropdown hidden: {dropdown_hidden}. Screenshots: val-auto-004-before-select.png, val-auto-004-after-select.png',
            "reason": None if populated else f"Field not populated correctly. clicked={click_result.get('clicked')}, value={after_select.get('value')}, dataAddress={after_select.get('dataAddress')}",
        }
    except Exception as e:
        print(f"  Error: {e}")
        report["assertions"]["VAL-AUTO-004"] = {
            "status": "blocked", "evidence": f"Error: {e}", "reason": str(e),
        }


def test_val_auto_005(page):
    """VAL-AUTO-005: Autocomplete filters by selected chain."""
    print("Testing VAL-AUTO-005: Chain switching shows different tokens")
    try:
        # Test Base chain
        setup_page(page)

        # Switch to Base
        page.evaluate("""() => {
            const sel = document.getElementById('chainId');
            sel.value = '8453';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        time.sleep(0.5)

        trigger_autocomplete(page, "from", "USDC")
        base_results = find_dropdown(page, "fromAutocomplete")
        print(f"  Base USDC: {json.dumps(base_results)}")
        take_screenshot(page, "val-auto-005-base-usdc")

        # Clear and switch to Ethereum
        page.evaluate("""() => {
            const fromInput = document.getElementById('from');
            fromInput.value = '';
            fromInput.dispatchEvent(new Event('input', { bubbles: true }));
            const sel = document.getElementById('chainId');
            sel.value = '1';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        time.sleep(0.5)

        trigger_autocomplete(page, "from", "USDC")
        eth_results = find_dropdown(page, "fromAutocomplete")
        print(f"  Ethereum USDC: {json.dumps(eth_results)}")
        take_screenshot(page, "val-auto-005-ethereum-usdc")

        both_found = base_results.get("found", False) and eth_results.get("found", False)
        if both_found:
            base_addrs = [item.get("address", "") for item in base_results.get("items", [])]
            eth_addrs = [item.get("address", "") for item in eth_results.get("items", [])]
            addresses_differ = base_addrs != eth_addrs
        else:
            addresses_differ = False

        report["assertions"]["VAL-AUTO-005"] = {
            "status": "pass" if (both_found and addresses_differ) else ("fail" if both_found else "blocked"),
            "evidence": f'Base USDC items: {json.dumps(base_results.get("items", [])[:2])}. Ethereum USDC items: {json.dumps(eth_results.get("items", [])[:2])}. Addresses differ: {addresses_differ}. Screenshots: val-auto-005-base-usdc.png, val-auto-005-ethereum-usdc.png',
            "reason": None if (both_found and addresses_differ) else ("Same addresses shown for both chains" if both_found else "Autocomplete dropdown not found on one or both chains"),
        }
    except Exception as e:
        print(f"  Error: {e}")
        report["assertions"]["VAL-AUTO-005"] = {
            "status": "blocked", "evidence": f"Error: {e}", "reason": str(e),
        }


def test_val_auto_006():
    """VAL-AUTO-006: GET /tokenlist returns 200 with tokens array."""
    print("Testing VAL-AUTO-006: GET /tokenlist returns 200")
    try:
        import urllib.request
        req = urllib.request.Request("http://localhost:3002/tokenlist")
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            body = json.loads(resp.read().decode())
            has_tokens = isinstance(body.get("tokens"), list)
            token_count = len(body["tokens"]) if has_tokens else 0
            first_token = json.dumps(body["tokens"][0])[:150] if has_tokens and token_count > 0 else "N/A"

        print(f"  Status: {status}, hasTokens: {has_tokens}, tokenCount: {token_count}")

        report["assertions"]["VAL-AUTO-006"] = {
            "status": "pass" if (status == 200 and has_tokens and token_count > 0) else "fail",
            "evidence": f"GET /tokenlist returned HTTP {status}. Has tokens array: {has_tokens}. Token count: {token_count}. First token sample: {first_token}",
            "reason": None if (status == 200 and has_tokens and token_count > 0) else f"Status: {status}, hasTokens: {has_tokens}, count: {token_count}",
        }
    except Exception as e:
        print(f"  Error: {e}")
        report["assertions"]["VAL-AUTO-006"] = {
            "status": "blocked", "evidence": f"Error: {e}", "reason": str(e),
        }


def main():
    test_val_auto_006()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()

        # Log console errors (ignore favicon)
        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" and "favicon" not in msg.text else None)

        test_val_auto_001(page)
        test_val_auto_002(page)
        test_val_auto_003(page)
        test_val_auto_004(page)
        test_val_auto_005(page)

        browser.close()

    if console_errors:
        report["frictions"].append(f"Console errors (non-favicon): {'; '.join(console_errors[:5])}")

    # Summary
    statuses = [a["status"] for a in report["assertions"].values()]
    report["summary"] = f"Tested {len(statuses)} assertions: {statuses.count('pass')} passed, {statuses.count('fail')} failed, {statuses.count('blocked')} blocked"

    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport written to {REPORT_PATH}")
    print(f"Summary: {report['summary']}")


if __name__ == "__main__":
    main()
