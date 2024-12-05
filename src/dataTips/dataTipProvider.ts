/* eslint-disable @typescript-eslint/naming-convention */
import { IDisposable } from '../common/types';
import { IExportedKernelService } from '../kernelManager/vscodeJupyter';
import * as vscode from 'vscode';
import { PythonVariablesRequester } from './kernelVariableProvider';
import { DataFrameScriptGenerator } from './dataFrameScriptGenerator';
import { VariableScriptGenerator } from './variableScriptGenerator';
import { PythonParser } from './pythonParser';

const NotebookCellScheme = 'vscode-notebook-cell';
const InteractiveWindowInputBoxScheme = 'vscode-interactive-input';

function getCellEditors(notebookEditor: vscode.NotebookEditor) {
    // Get the list of editors for the cells in the active notebook
    return notebookEditor.notebook.getCells().map(cell => {
        return {
            cell,
            editor: vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === cell.document.uri.toString())
        };
    });
}

export class DataTipProvider implements IDisposable {

    private _activeEditor: vscode.NotebookEditor | undefined;
    private _timeout: NodeJS.Timeout | undefined;
    private _variablesProvider: PythonVariablesRequester;
    private _variableScriptGenerator: VariableScriptGenerator;
    private _dataFrameScriptGenerator: DataFrameScriptGenerator;
    private _parser = new PythonParser();

    constructor(private readonly _kernelService: IExportedKernelService, private _context: vscode.ExtensionContext) {
        this._variableScriptGenerator = new VariableScriptGenerator(_context);
        this._dataFrameScriptGenerator = new DataFrameScriptGenerator(_context);
        this._variablesProvider = new PythonVariablesRequester(this._variableScriptGenerator, this._dataFrameScriptGenerator);

        // Whenever a notebook cell opens or changes, use the kernel service to
        // get the data tip for the current cell and show it in the data tip UI.
        vscode.window.onDidChangeActiveNotebookEditor(editor => {
            // Make sure the active editor is a notebook cell.
            if (editor) {
                this._activeEditor = editor;
                this._triggerUpdateDecorations();
            }
        }, null, _context.subscriptions);

        vscode.workspace.onDidChangeTextDocument(event => {
            const notebookEditor = vscode.window.visibleNotebookEditors.find(editor => getCellEditors(editor).find(e => e.editor?.document === event.document));
            if (this._activeEditor && notebookEditor && notebookEditor === this._activeEditor) {
                this._triggerUpdateDecorations(true);
            }
        }, null, _context.subscriptions);

    }
    dispose(): void | undefined {
    }

    private _updateDecorations() {
		if (!this._activeEditor) {
			return;
		}

        // See if we have a kernel for the active notebook editor.
        const kernel = this._kernelService.getKernel(this._activeEditor.notebook.uri);
        if (!kernel || !kernel.connection  || !kernel.connection.kernel) {
            return;
        }

        // Get the variables for the active kernel (this may be too slow as there can be a lot of variables).
        this._variablesProvider.getVariableNamesAndTypesFromKernel(kernel.connection).then(variables => {
            // Make sure the active editor is still the same.
            if (vscode.window.activeNotebookEditor !== this._activeEditor || !this._activeEditor) {
                return;
            }

            // Get the list of variables for each cell of the active notebook.
            const cellEditors = getCellEditors(this._activeEditor);
            cellEditors.forEach(cellEditor => {
                // Get the list of variables for the current cell.
                const variablePositions = this._parser.findVariableLocations(cellEditor.cell.document.getText());

                // See if any of these variables are in the list of variables for the kernel.
                const variablesForCell = variablePositions.map(variable => {
                    return variables.find(v => v.name === variable.name);
                });

                // Add inlay hints on the line for each variable.

            });
        });
	}


	private _triggerUpdateDecorations(throttle = false) {
		if (this._timeout) {
			clearTimeout(this._timeout);
			this._timeout = undefined;
		}
		if (throttle) {
			this._timeout = setTimeout(this._updateDecorations.bind(this), 500);
		} else {
			this._updateDecorations();
		}
	}


}
