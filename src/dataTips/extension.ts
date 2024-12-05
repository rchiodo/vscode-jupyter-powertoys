// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DataTipProvider } from './dataTipProvider';
import type { Jupyter } from '@vscode/jupyter-extension';

export async function activate(context: vscode.ExtensionContext) {
    // This is only supported in the node version, skip if we're in the browser
    if (vscode.env.uiKind === vscode.UIKind.Web) {
        return;
    }

    const jupyterExt = vscode.extensions.getExtension<Jupyter>('ms-toolsai.jupyter');
    if (!jupyterExt) {
        return;
    }
    const api = await jupyterExt.activate();


	context.subscriptions.push(new DataTipProvider(api, context));
}

// this method is called when your extension is deactivated
export function deactivate() {}

