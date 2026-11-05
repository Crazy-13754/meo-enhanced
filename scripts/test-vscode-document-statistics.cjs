const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

exports.run = async () => {
  const output = process.env.MEO_STATISTICS_OUTPUT;
  assert.ok(output && path.isAbsolute(output));
  const file = path.join(output, 'workspace', 'statistics.md');
  fs.writeFileSync(file, '# MEOStatisticsSmall 世界\n\nOne two three\n\n| A | B |\n| --- | --- |\n| 中文 | word |\n');
  const result = { passed: false, cases: [] };
  let browser;
  try {
    await vscode.workspace.getConfiguration('meoEnhanced').update('language', 'en', vscode.ConfigurationTarget.Global);
    browser = await puppeteer.connect({ browserURL: process.env.MEO_STATISTICS_BROWSER_URL, defaultViewport: null });
    const control = path.join(output, 'workspace', 'statistics-control.txt');
    fs.writeFileSync(control, 'Non-MEO active-editor control');
    await vscode.window.showTextDocument(vscode.Uri.file(control), { preview: false });
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'meoEnhanced.editor');
    let frame;
    const limit = Date.now() + 30000;
    while (!frame && Date.now() < limit) {
      for (const page of await browser.pages()) for (const candidate of page.frames()) {
        if (await candidate.evaluate(() => window.frameElement?.id === 'active-frame' && !!document.querySelector('.mode-toolbar') && !!document.querySelector('.editor-root')?.textContent.includes('MEOStatisticsSmall \u4e16\u754c')).catch(() => false)) frame = candidate;
      }
      if (!frame) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(frame, 'MEO Webview must load');
    const page = frame.page(); page.setDefaultTimeout(15000);
    const ready = (target, mode) => target.waitForFunction(mode => {
      if (document.querySelector('.meo-preload-toolbar') || document.querySelector('.editor-root')?.dataset.mode !== mode) return false;
      return mode === 'preview'
        ? document.querySelector('.preview-host')?.hidden === false && !document.querySelector('.preview-host')?.inert
          && document.querySelector('.preview-loading')?.hidden === true
          && document.querySelector('.preview-frame')?.contentDocument?.documentElement.inert === false
        : document.querySelector('.editor-host')?.hidden === false && !document.querySelector('.editor-host')?.inert
          && document.querySelector('.editor-loading')?.hidden === true;
    }, {}, mode);
    const status = async pattern => {
      await page.waitForFunction(source => [...document.querySelectorAll('.statusbar-item')].some(e => e.getBoundingClientRect().width && new RegExp(source).test(e.textContent)), {}, pattern);
    };
    await ready(frame, await frame.$eval('.editor-root', e => e.dataset.mode));
    await status('Words 11'); result.cases.push('initial total');
    await frame.$eval('[data-mode="source"]', e => e.click());
    await ready(frame, 'source');
    await frame.$eval('.cm-content', e => e.focus());
    await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control');
    await page.keyboard.down('Shift'); await page.keyboard.press('End'); await page.keyboard.up('Shift');
    await status('3 selected / 11 words'); result.cases.push('source selection');
    await page.keyboard.press('ArrowRight'); await page.keyboard.type(' Extra');
    await status('Words 12'); result.cases.push('typing');
    await frame.$eval('[data-mode="preview"]', e => e.click());
    await ready(frame, 'preview');
    await status('8 lines.*Words 12'); result.cases.push('preview drops caret');
    await frame.$eval('[data-mode="live"]', e => e.click());
    await ready(frame, 'live');
    await status('Ln .*Words 12');
    await frame.waitForSelector('.meo-md-html-table');
    await frame.$eval('.meo-md-html-table tbody td', e => {
      const box = e.getBoundingClientRect();
      const options = { bubbles: true, button: 0, pointerId: 1, clientX: box.x + 8, clientY: box.y + 8 };
      e.dispatchEvent(new PointerEvent('pointerdown', options));
      e.dispatchEvent(new PointerEvent('pointerup', options)); e.click();
    });
    await frame.waitForFunction(() => document.activeElement instanceof HTMLTextAreaElement);
    // Establish the browser-owned textarea range directly: Electron's host
    // Select All binding is a separate command-routing contract.
    await frame.evaluate(() => { const input = document.activeElement; input.setSelectionRange(0, input.value.length); });
    result.table = await frame.evaluate(() => ({ value: document.activeElement?.value,
      start: document.activeElement?.selectionStart, end: document.activeElement?.selectionEnd }));
    await status('2 selected / 12 words'); result.cases.push('native table selection');
    await page.screenshot({ path: path.join(output, 'status-en.png') });
    await vscode.workspace.getConfiguration('meoEnhanced').update('language', 'zh-CN', vscode.ConfigurationTarget.Global);
    await frame.evaluate(() => { const input = document.activeElement; input.setSelectionRange(input.value.length, input.value.length); });
    await status('字数 12');
    await page.screenshot({ path: path.join(output, 'status-zh.png') });
    await frame.evaluate(() => {
      const table = document.querySelector('.meo-md-html-table');
      const first = table.querySelector('thead th'), last = table.querySelector('tbody tr:last-child td:last-child');
      const a = first.getBoundingClientRect(), b = last.getBoundingClientRect();
      first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, button: 0, clientX: a.x + a.width / 2, clientY: a.y + a.height / 2 }));
      table.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2, buttons: 1, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }));
      table.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2, button: 0, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }));
    });
    await status('选中 5 / 共 12 字'); result.cases.push('rectangular header/body selection reaches native status bar');
    await page.screenshot({ path: path.join(output, 'status-table-selection.png') });
    await frame.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })));
    await status('字数 12');
    const other = path.join(output, 'workspace', 'other.md'); fs.writeFileSync(other, '另一个文档');
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(other), 'meoEnhanced.editor', vscode.ViewColumn.Beside);
    await status('字数 5'); result.cases.push('active split');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await status('字数 12'); result.cases.push('close restores previous');
    await vscode.commands.executeCommand('workbench.action.files.save');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    const foregroundControl = await vscode.window.showTextDocument(vscode.Uri.file(control), { preview: false });
    assert.equal(foregroundControl.document.uri.toString(), vscode.Uri.file(control).toString());
    await page.waitForFunction(() => ![...document.querySelectorAll('.statusbar-item')].some(e => e.getBoundingClientRect().width && /字数|Words|selected \/.*words/.test(e.textContent)));
    result.cases.push('non-MEO active editor after close hides status');
    const largeFile = path.join(output, 'workspace', 'large.md');
    const largeText = 'MEOStatisticsLarge 世界\n' + 'Hello 世界\n'.repeat(19_999);
    fs.writeFileSync(largeFile, largeText);
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(largeFile), 'meoEnhanced.editor');
    let largeFrame;
    const largeLimit = Date.now() + 15000;
    while (!largeFrame && Date.now() < largeLimit) {
      const matching = [];
      for (const candidate of page.frames()) if (!candidate.isDetached() && await candidate.evaluate(() => window.frameElement?.id === 'active-frame' && !!document.querySelector('.editor-root')?.textContent.includes('MEOStatisticsLarge \u4e16\u754c')).catch(() => false)) matching.push(candidate);
      assert.ok(matching.length <= 1, 'The large statistics document must identify one frame');
      largeFrame = matching[0];
      if (!largeFrame) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(largeFrame);
    await largeFrame.waitForFunction(() => document.querySelector('.editor-host > .cm-editor')
      && !document.querySelector('.editor-host')?.hasAttribute('inert')
      && !document.querySelector('.mode-group [aria-busy="true"]'));
    await ready(largeFrame, await largeFrame.$eval('.editor-root', e => e.dataset.mode));
    await status('字数 60,000');
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await largeFrame.evaluate(() => {
      window.__statisticsRequests = [];
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function(data, ...args) {
        if (data && Array.isArray(data.selections)) window.__statisticsRequests.push({ fullText: data.text !== undefined });
        return post.call(this, data, ...args);
      };
      document.querySelector('.cm-content')?.focus();
    });
    await largeFrame.evaluate(() => {
      const content = document.querySelector('.cm-content'); content.focus();
      const text = document.createTreeWalker(content.querySelector('.cm-line'), NodeFilter.SHOW_TEXT).nextNode();
      document.getSelection().setBaseAndExtent(text, 0, text, Math.min(5, text.length));
    });
    await status('选中 1 / 共 60,000 字');
    const requests = await largeFrame.evaluate(() => window.__statisticsRequests);
    assert.ok(requests.length > 0 && requests.every(r => !r.fullText), 'selection changes reuse the worker index');
    result.cases.push('large document worker index reused on selection changes');
    await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
    await page.keyboard.type(' Extra');
    await status('字数 60,001');
    const largeDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(largeFile));
    assert.equal(largeDocument.getText(), largeText + ' Extra');
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    await status('字数 60,000');
    assert.equal(largeDocument.getText(), largeText);
    assert.equal(fs.readFileSync(largeFile, 'utf8'), largeDocument.getText());
    result.cases.push('large document edit and one undo update exact totals');
    await vscode.commands.executeCommand('workbench.action.files.save');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    result.passed = true;
  } catch (error) {
    result.error = String(error.stack || error);
    if (browser) {
      const pages = await browser.pages();
      result.status = await Promise.all(pages.map(p => p.evaluate(() => [...document.querySelectorAll('.statusbar-item')].map(e => e.textContent)).catch(() => [])));
      for (const p of pages) for (const f of p.frames()) if (await f.evaluate(() => window.frameElement?.id === 'active-frame' && !!document.querySelector('.editor-root')).catch(() => false)) {
        result.active = await f.evaluate(() => ({ value: document.activeElement?.value, start: document.activeElement?.selectionStart,
          end: document.activeElement?.selectionEnd, tag: document.activeElement?.outerHTML?.slice(0, 300) })).catch(() => null);
      }
    }
    throw error;
  }
  finally { browser?.disconnect(); fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); }
};
