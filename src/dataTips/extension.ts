// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DataTipProvider } from './dataTipProvider';
import { JupyterAPI } from '../kernelManager/vscodeJupyter';

export async function activate(context: vscode.ExtensionContext) {
    const jupyterExt = vscode.extensions.getExtension<JupyterAPI>('ms-toolsai.jupyter');
    if (!jupyterExt) {
        return;
    }
    await jupyterExt.activate();
    const kernelService = await jupyterExt.exports.getKernelService();
    if (!kernelService) {
        return;
    }

    // This is only supported in the node version, skip if we're in the browser
    if (vscode.env.uiKind === vscode.UIKind.Web) {
        return;
    }

	context.subscriptions.push(new DataTipProvider(kernelService, context));
}

// this method is called when your extension is deactivated
export function deactivate() {}

