import * as vscode from 'vscode';
import { IJupyterVariable, PythonVariablesRequester } from './kernelVariableProvider';
import { VariableScriptGenerator } from './variableScriptGenerator';
import type { Jupyter, Kernel } from '@vscode/jupyter-extension';

export class VariableWatcher {
    private _activeEditor: vscode.NotebookEditor | undefined;
    private _variablesProvider: PythonVariablesRequester;
    private _variableScriptGenerator: VariableScriptGenerator;
    private _variableCache: Map<string, IJupyterVariable[]> = new Map();
    private _currentTokenSource: vscode.CancellationTokenSource | undefined;
    private _onDidChangeVariables = new vscode.EventEmitter<vscode.NotebookDocument>();

    constructor(private readonly _api: Jupyter, private _context: vscode.ExtensionContext) {
        this._variableScriptGenerator = new VariableScriptGenerator(_context);
        this._variablesProvider = new PythonVariablesRequester(this._variableScriptGenerator);

        // Keep track of the active notebook, it's the only one we want
        // to watch for variable changes.
        vscode.window.onDidChangeActiveNotebookEditor(
            async (e) => {
                this._activeEditor = e;
                if (e) {
                    const kernel = await _api.kernels.getKernel(e.notebook.uri);
                    if (kernel) {
                        this._updateVariables(e.notebook, kernel);
                    }
                }
            },
            null,
            _context.subscriptions
        );

        // Whenever a new notebook is changed, update the variable list for this notebook.
        vscode.workspace.onDidChangeNotebookDocument(async (e) => {
            const kernel = await _api.kernels.getKernel(e.notebook.uri);
            if (kernel && e.notebook === this._activeEditor?.notebook) {
                let updated = false;
                e.cellChanges.forEach((c: vscode.NotebookDocumentCellChange) => {
                    if (!updated && c.executionSummary !== undefined) {
                        updated = true;
                        this._updateVariables(e.notebook, kernel);
                    }
                });
            }
        });
    }

    public get onDidChangeVariables(): vscode.Event<vscode.NotebookDocument> {
        return this._onDidChangeVariables.event;
    }

    public getVariablesForDocument(document: vscode.NotebookDocument): IJupyterVariable[] {
        return this._variableCache.get(document.uri.toString()) || [];
    }

    private _updateVariables(notebook: vscode.NotebookDocument, kernel: Kernel) {
        // Cancel any previous requests.
        if (this._currentTokenSource) {
            this._currentTokenSource.cancel();
        }
        this._currentTokenSource = new vscode.CancellationTokenSource();

        // Schedule a refresh of the variables.
        this._variablesProvider
            .getVariableNamesAndTypesFromKernel(kernel, this._currentTokenSource.token)
            .then((variables) => {
                this._variableCache.set(notebook.uri.toString(), variables);

                // Fire our event indicating we have new variables.
                this._onDidChangeVariables.fire(notebook);
            });
    }
}
