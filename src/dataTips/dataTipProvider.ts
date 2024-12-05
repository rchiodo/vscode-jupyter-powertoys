/* eslint-disable @typescript-eslint/naming-convention */
import { IDisposable } from '../common/types';
import * as vscode from 'vscode';
import { PythonParser } from './pythonParser';
import type { Jupyter } from '@vscode/jupyter-extension';
import { VariableWatcher } from './variableWatcher';

const NotebookCellScheme = 'vscode-notebook-cell';

function getCellEditors(notebookEditor: vscode.NotebookEditor) {
    // Get the list of editors for the cells in the active notebook
    return notebookEditor.notebook.getCells().map(cell => {
        return {
            cell,
            editor: vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === cell.document.uri.toString())
        };
    });
}

export class DataTipProvider implements IDisposable, vscode.InlayHintsProvider {

    private _variablesWatcher: VariableWatcher;
    private _parser = new PythonParser();
    private _didChangeEventEmitter = new vscode.EventEmitter<void>();

    constructor(private readonly _jupyterApi: Jupyter, private _context: vscode.ExtensionContext) {
        this._variablesWatcher = new VariableWatcher(_jupyterApi, _context);
        this._variablesWatcher.onDidChangeVariables(this._triggerInlayHintsChange, this, this._context.subscriptions);
    }
    get onDidChangeInlayHints(): vscode.Event<void> | undefined {
        return this._didChangeEventEmitter.event;
    }

    provideInlayHints(document: vscode.TextDocument, range: vscode.Range, token: vscode.CancellationToken): vscode.ProviderResult<vscode.InlayHint[]> {
        // Make sure this is a notebook cell.
        if (document.uri.scheme !== NotebookCellScheme) {
            return [];
        }

        // Get the owning notebook editor
        const notebookEditor = vscode.window.visibleNotebookEditors.find(editor => getCellEditors(editor).find(e => e.editor?.document === document));
        if (!notebookEditor) {
            return [];
        }

        // See if we have any variables for this document.
        const vars = this._variablesWatcher.getVariablesForDocument(notebookEditor.notebook);
        if (vars.length === 0) {
            return [];
        }

        // Parse the document and find all variables.
        const locations = this._parser.findVariableLocations(document.getText());

        // Find the variables that match the locations.
        const hints: vscode.InlayHint[] = [];
        for (const location of locations) {
            const variable = vars.find(v => v.name === location.name);
            if (variable) {
                hints.push({
                    kind: vscode.InlayHintKind.Type,
                    position: new vscode.Position(location.startPosition.row, location.startPosition.column),
                    label: `${variable.name}: ${variable.type}`
                });
            }
        }
    }
    dispose(): void | undefined {
    }

    private _triggerInlayHintsChange() {
        this._didChangeEventEmitter.fire();
    }



}
