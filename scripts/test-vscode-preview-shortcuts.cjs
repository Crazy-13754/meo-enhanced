// Real workbench commands from Preview, using only the runner's disposable profile.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

exports.run = async () => {
  const output = process.env.MEO_SHORTCUT_OUTPUT;
  assert.ok(output && path.isAbsolute(output));
  const workspace = path.join(output, 'workspace');
  assert.equal(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.toLowerCase(), workspace.toLowerCase());
  const file = path.join(workspace, 'preview-shortcuts.md');
  const text = '# Reading\n\nSelect and copy this paragraph.\n\n' + 'More content.\n\n'.repeat(40);
  fs.writeFileSync(file, text);
  const report = { vscode: vscode.version, runs: [], passed: false };
  let browser;
  try {
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    report.phase = 'connect';
    browser = await puppeteer.connect({ browserURL: process.env.MEO_SHORTCUT_BROWSER_URL, defaultViewport: null });
    report.phase = 'open';
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'meoEnhanced.editor');
    report.phase = 'find-webview';
    let frame;
    const deadline = Date.now() + 30000;
    while (!frame && Date.now() < deadline) {
      const pages = await browser.pages();
      for (const page of pages) for (const candidate of page.frames()) {
        if (!candidate.url().includes('/fake.html')) continue;
        try {
          if (await candidate.evaluate(() => !!document.querySelector('.editor-host .cm-content'))) frame = candidate;
        } catch (error) {
          if (!/detached|Execution context was destroyed|Cannot find context/i.test(String(error))) throw error;
        }
      }
      if (!frame) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(frame, 'MEO webview did not open');
    await frame.waitForFunction(() => !document.querySelector('.editor-wrapper')?.classList.contains('meo-preload-editor-shell'));
    // Wait for VS Code's active content frame before exercising host shortcuts.
    await frame.waitForFunction(() => window.frameElement?.id === 'active-frame');
    report.phase = 'baseline';
    const page = frame.page();
    const chord = async (key, alt = false) => {
      await page.keyboard.down('Control');
      if (alt) await page.keyboard.down('Alt');
      try { await page.keyboard.press(key); }
      finally { if (alt) await page.keyboard.up('Alt'); await page.keyboard.up('Control'); }
    };
    const expectQuickInput = async (surface, gesture, commands) => {
      await page.waitForFunction(() => {
        const widget = document.querySelector('.quick-input-widget');
        return widget && widget.getBoundingClientRect().height > 0 && getComputedStyle(widget).display !== 'none';
      }, { timeout: 4000 });
      const value = await page.$eval('.quick-input-widget input', input => input.value);
      assert.equal(value.startsWith('>'), commands, `${surface}: ${gesture} opened the wrong workbench UI (${value})`);
      report.runs.push({ surface, gesture, value });
      if (surface === 'preview' && gesture === 'Ctrl+Alt+P') await page.screenshot({ path: path.join(output, 'command-center.png') });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => {
        const widget = document.querySelector('.quick-input-widget');
        return !widget || getComputedStyle(widget).display === 'none' || widget.getBoundingClientRect().height === 0;
      }, { timeout: 4000 });
    };
    // A toolbar/editor baseline proves the profile binding and native test input work.
    await frame.$eval('[data-mode="live"]', button => button.click());
    await frame.$eval('.editor-host .cm-content', content => content.focus({ preventScroll: true }));
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await chord('p', true);
    await expectQuickInput('live', 'Ctrl+Alt+P', true);
    for (const surface of ['preview', 'side']) {
      report.phase = surface;
      await frame.$eval(`[data-mode="${surface === 'preview' ? 'preview' : 'source'}"]`, button => button.click());
      if (surface === 'side') await frame.$eval('.source-preview-button', button => button.click());
      await frame.waitForFunction(() => document.querySelector('.preview-status')?.hidden === true
        && !!document.querySelector('.preview-frame')?.contentDocument?.getElementById('reading'));
      const preview = await (await frame.$('.preview-frame')).contentFrame();
      assert.ok(preview);
      for (const gesture of ['Ctrl+Alt+P', 'F1', 'Ctrl+Alt+O', 'Ctrl+K Ctrl+M']) {
        await preview.evaluate(() => { document.body.tabIndex = -1; document.body.focus({ preventScroll: true }); });
        if (gesture === 'F1') await page.keyboard.press('F1');
        else if (gesture === 'Ctrl+K Ctrl+M') { await chord('k'); await chord('m'); }
        else await chord(gesture === 'Ctrl+Alt+P' ? 'p' : 'o', true);
        await expectQuickInput(surface, gesture, gesture !== 'Ctrl+Alt+O');
      }
    }
    assert.equal(fs.readFileSync(file, 'utf8'), text, 'Host shortcuts must not change the document');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    assert.equal(document.getText(), text, 'Host shortcuts must not change the in-memory document');
    assert.equal(document.isDirty, false, 'Host shortcuts must not leave pending edits');
    report.passed = true;
  } catch (error) {
    report.error = String(error.stack || error);
    if (browser) {
      try { await (await browser.pages())[0]?.screenshot({ path: path.join(output, 'failure.png') }); }
      catch (captureError) { report.captureError = String(captureError); }
    }
    throw error;
  } finally {
    browser?.disconnect();
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  }
};
