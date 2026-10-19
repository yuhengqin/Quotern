import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import ts from 'typescript';

/** Resolve HeroUI import aliases so renaming Select cannot bypass the policy. */
function directSelectionPopovers(source: string): number[] {
  const ast = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hosts = new Set<string>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== '@heroui/react') continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      if (['Select', 'Autocomplete'].includes((specifier.propertyName ?? specifier.name).text)) hosts.add(specifier.name.text);
    }
  }
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isPropertyAccessExpression(node.tagName)
      && ts.isIdentifier(node.tagName.expression) && hosts.has(node.tagName.expression.text) && node.tagName.name.text === 'Popover') {
      lines.push(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return lines;
}

it('recognizes direct and aliased HeroUI popovers without flagging project components', () => {
  assert.deepEqual(directSelectionPopovers(`import { Select as Picker, Autocomplete } from '@heroui/react';
    const x = <><Picker.Popover /><Autocomplete.Popover>options</Autocomplete.Popover></>;`), [2, 2]);
  assert.deepEqual(directSelectionPopovers(`import { Select } from './ProjectSelect';
    const x = <Select.Popover />;`), []);
  assert.deepEqual(directSelectionPopovers(`import { Select } from '@heroui/react';
    const x = <Select><FilterSelectPopover /></Select>;`), []);
});

it('routes selection menus through the shared UI entry in both renderers', () => {
  const roots = [
    ['dashboard', fileURLToPath(new URL('../', import.meta.url))],
    ['desktop', fileURLToPath(new URL('../../../../apps/desktop/src/renderer/', import.meta.url))],
  ] as const;
  // UI guide exceptions: these are persisted, Desktop-only settings, not filters.
  const allowed = new Set([
    'dashboard/components/FilterMenu.tsx',
    'desktop/components/SettingsPanel.tsx',
    'desktop/components/QuotaSettings.tsx',
  ]);
  const violations: string[] = [];
  for (const [client, root] of roots) {
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.tsx')) {
          const key = `${client}/${relative(root, path).replaceAll('\\', '/')}`;
          if (!allowed.has(key)) for (const line of directSelectionPopovers(readFileSync(path, 'utf8'))) violations.push(`${key}:${line}`);
        }
      }
    };
    walk(root);
  }
  assert.deepEqual(violations, [], 'Use FilterSelectPopover / FilterAutocompletePopover; document any exception in docs/ui-guidelines.md.');
});
