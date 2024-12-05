/* eslint-disable @typescript-eslint/naming-convention */
import { IDisposable } from '../common/types';
import { IExportedKernelService } from '../kernelManager/vscodeJupyter';
import * as vscode from 'vscode';

const NotebookCellScheme = 'vscode-notebook-cell';
const InteractiveWindowInputBoxScheme = 'vscode-interactive-input';


export class DataTipProvider implements IDisposable {

    private _activeEditor: vscode.TextEditor | undefined;
    private _timeout: NodeJS.Timeout | undefined;

    constructor(private _kernelService: IExportedKernelService, private _context: vscode.ExtensionContext) {
        // Whenever a notebook cell opens or changes, use the kernel service to
        // get the data tip for the current cell and show it in the data tip UI.
        vscode.window.onDidChangeActiveTextEditor(editor => {
            // Make sure the active editor is a notebook cell.
            if (editor && (editor.document.uri.scheme === NotebookCellScheme || editor.document.uri.scheme === InteractiveWindowInputBoxScheme)) {
                this._activeEditor = editor;
                this._triggerUpdateDecorations();
            }
        }, null, _context.subscriptions);   
    
        vscode.workspace.onDidChangeTextDocument(event => {
            if (this._activeEditor && event.document === this._activeEditor.document) {
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
		const regEx = /\d+/g;
		const text = this._activeEditor.document.getText();
		const smallNumbers: vscode.DecorationOptions[] = [];
		const largeNumbers: vscode.DecorationOptions[] = [];
		let match;
		while ((match = regEx.exec(text))) {
			const startPos = activeEditor.document.positionAt(match.index);
			const endPos = activeEditor.document.positionAt(match.index + match[0].length);
			const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: 'Number **' + match[0] + '**', renderOptions: {} };
			if (match[0].length < 3) {
				decoration.renderOptions = {
						after: {
							contentText: ` 👈 ${match[0].length} chars`
						}
				};
				smallNumbers.push(decoration);
			} else {
				largeNumbers.push(decoration);
			}
		}
		activeEditor.setDecorations(smallNumberDecorationType, smallNumbers);
		activeEditor.setDecorations(largeNumberDecorationType, largeNumbers);
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