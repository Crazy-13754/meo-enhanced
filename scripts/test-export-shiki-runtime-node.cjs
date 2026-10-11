const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const builtRuntimePath = path.join(repoRoot, 'dist', 'export-runtime.js');
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meo-export-installed-'));
  const installedRuntimePath = path.join(installRoot, 'extension', 'dist', 'export-runtime.js');
  const installedAssetsRoot = path.join(installRoot, 'extension', 'webview', 'dist');
  fs.mkdirSync(path.dirname(installedRuntimePath), { recursive: true });
  fs.copyFileSync(builtRuntimePath, installedRuntimePath);
  fs.cpSync(path.join(repoRoot, 'webview', 'dist'), installedAssetsRoot, { recursive: true });

  const originalExistsSync = fs.existsSync;
  fs.existsSync = (candidate) => {
    if (
      String(candidate).endsWith('shiki-language-assets.json')
      && !path.resolve(String(candidate)).startsWith(`${installedAssetsRoot}${path.sep}`)
    ) {
      return false;
    }
    return originalExistsSync(candidate);
  };

  try {
    const importedRuntime = await import(pathToFileURL(installedRuntimePath).href);
    let current = importedRuntime;
    let runtime = null;
    for (let depth = 0; depth < 5; depth += 1) {
      if (current && typeof current.renderExportHtmlDocument === 'function') {
        runtime = current;
        break;
      }
      if (!current || typeof current !== 'object' || !('default' in current)) break;
      current = current.default;
    }
    assert.ok(runtime, 'installed export runtime did not expose renderExportHtmlDocument in Node');

    const preview = runtime.renderPreviewDocument({
      markdownText: 'first\nsecond\n\n<!-- hidden -->', sourceDocumentPath: 'C:/tmp/preset.md', uiLanguage: 'en',
      preset: 'github-readme', contentWidth: 'reference',
      styleEnvironment: { previewFontFamily: 'Georgia', previewShowComments: true }
    });
    assert.equal(preview.preset, 'github-readme');
    assert.ok(preview.styles.light.includes('.markdown-body') && preview.styles.light.includes('max-width: 1076px'));
    assert.ok(preview.styles.dark.includes('background: #0d1117'));
    assert.ok(!preview.styles.light.includes('Georgia'));
    assert.ok(!preview.html.includes('<br') && !preview.html.includes('hidden'));

    const renderOptions = {
      readingSnapshot: {
        snapshotId: 'export-shiki-runtime-node',
        text: [
          '```ts',
          'const answer: number = 42;',
          '```',
          '',
          '```zig',
          'const answer: u8 = 42;',
          '```',
          '',
          '```wolfram',
          'Plot[x^2, {x, 0, 1}]',
          '```',
          '',
          '```html-derivative',
          '<div>HTML</div>',
          '```',
          '',
          '```markdown',
          '</table>',
          '',
          '## Recovered heading',
          '```'
        ].join('\n'),
        appearance: 'dark',
        uiLanguage: 'en',
        environment: {
          previewFontFamily: '',
          editorBackgroundColor: '#1e1e1e',
          editorForegroundColor: '#d4d4d4',
          codeBlockBackgroundColor: '#1e1e1e',
          sideBarBackgroundColor: '#252526',
          panelBorderColor: '#454545',
          previewSourceColoring: true
        }
      },
      sourceDocumentPath: 'C:/tmp/source.md',
      outputFilePath: 'C:/tmp/export.html',
      target: 'html',
      mermaidRuntimeSrc: '',
      baseHref: 'file:///C:/tmp/',
      title: 'Export Shiki Node runtime',
      shikiLanguageAssetsRoot: installedAssetsRoot
    };
    const rendered = await runtime.renderExportHtmlDocument(renderOptions);
    const github = await runtime.renderExportHtmlDocument({
      ...renderOptions,
      readingSnapshot: { ...renderOptions.readingSnapshot, preset: 'github-readme', environment: { previewFontFamily: 'Georgia', previewSourceColoring: false, previewShowComments: true } }
    });
    assert.ok(github.htmlDocument.includes('class="meo-export-doc markdown-body"'));
    assert.ok(github.htmlDocument.includes('background: #0d1117'));
    assert.ok(!github.htmlDocument.includes('Georgia'));
    assert.ok(github.htmlDocument.includes('color:#FF7B72'), 'GitHub code colors must load in the installed runtime');

    assert.equal((rendered.htmlDocument.match(/<div class="meo-export-code-block-wrap/g) ?? []).length, 5);
    assert.match(rendered.htmlDocument, /style="[^"]*font-weight:bold[^"]*">## Recovered heading/,
      'Installed export must recover Markdown heading syntax after HTML and a blank line');
    assert.ok(
      (rendered.htmlDocument.match(/<span style="color:/g) ?? []).length >= 3,
      'installed Node export runtime must highlight common and uncommon languages through relocated assets'
    );
    await assert.rejects(
      runtime.renderExportHtmlDocument({
        ...renderOptions,
        shikiLanguageAssetsRoot: path.join(installRoot, 'missing-assets')
      }),
      /Missing Shiki language asset manifest/,
      'installed export runtime must fail explicitly instead of importing source-only dependencies'
    );
    assert.equal(
      fs.readFileSync(installedRuntimePath, 'utf8').includes(JSON.stringify(repoRoot).slice(1, -1)),
      false,
      'export runtime must not embed the build checkout path'
    );
    console.log('Installed Export Shiki Node runtime passed');
  } finally {
    fs.existsSync = originalExistsSync;
    fs.rmSync(installRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
