    // Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { joinPath } from '../vscode-path/resources';
import { ParentOptions } from './types';
import * as vscode from 'vscode';
import * as fs from 'fs-extra';

// eslint-disable-next-line @typescript-eslint/naming-convention
const VariableFunc = '_VSCODE_getVariable';
const cleanupCode = `
try:
    del _VSCODE_getVariable
except:
    pass
`;

/**
 * Provides utilities to extract python scripts from the extension installation. These scripts can then be used to query variable information in the kernel.
 */
export class VariableScriptGenerator {
    static contentsOfScript: string | undefined;
    static contentsOfVariablesScript: string | undefined;
    constructor(private readonly _context: vscode.ExtensionContext
    ) {}
    async generateCodeToGetVariableInfo(options: { isDebugging: boolean; variableName: string }) {
        const initializeCode = await this.getContentsOfScript();
        const isDebugging = options.isDebugging ? 'True' : 'False';
        const code = `${VariableFunc}("info", ${isDebugging}, ${options.variableName})`;
        if (options.isDebugging) {
            // When debugging, the code is evaluated in the debugger, so we need to initialize the script.
            // We cannot send complex code to the debugger, it has to be a simple expression that produces a value.
            // Hence the need to split the code into initialization, real code & finalization.
            return {
                initializeCode,
                code,
                cleanupCode
            };
        } else {
            return {
                code: `${initializeCode}\n\n${code}\n\n${cleanupCode}`
            };
        }
    }
    async generateCodeToGetVariableProperties(options: {
        isDebugging: boolean;
        variableName: string;
        stringifiedAttributeNameList: string;
    }) {
        const initializeCode = await this.getContentsOfScript();
        const isDebugging = options.isDebugging ? 'True' : 'False';
        const code = `${VariableFunc}("properties", ${isDebugging}, ${options.variableName}, ${options.stringifiedAttributeNameList})`;
        if (options.isDebugging) {
            return {
                initializeCode,
                code,
                cleanupCode
            };
        } else {
            return {
                code: `${initializeCode}\n\n${code}\n\n${cleanupCode}`
            };
        }
    }

    async generateCodeToGetAllVariableDescriptions(parentOptions: ParentOptions | undefined) {
        let scriptCode = await this.getContentsOfVariablesScript();
        if (parentOptions) {
            scriptCode =
                scriptCode +
                `\n\nreturn _VSCODE_getAllChildrenDescriptions(\'${parentOptions.root}\', ${JSON.stringify(
                    parentOptions.propertyChain
                )}, ${parentOptions.startIndex})`;
        } else {
            scriptCode = scriptCode + '\n\nvariables= %who_ls\nreturn _VSCODE_getVariableDescriptions(variables)';
        }
        return scriptCode;
    }

    async generateCodeToGetVariableTypes(options: { isDebugging: boolean }) {
        const scriptCode = await this.getContentsOfScript();
        const initializeCode = `${scriptCode}\n\n_VSCODE_rwho_ls = %who_ls\n`;
        const isDebugging = options.isDebugging ? 'True' : 'False';
        const cleanupWhoLsCode = `
try:
    del _VSCODE_rwho_ls
except:
    pass
`;

        const code = `${VariableFunc}("types", ${isDebugging}, _VSCODE_rwho_ls)`;
        if (options.isDebugging) {
            return {
                initializeCode,
                code,
                cleanupCode: `${cleanupCode}\n${cleanupWhoLsCode}`
            };
        } else {
            return {
                code: `${initializeCode}${code}\n\n${cleanupCode}\n${cleanupWhoLsCode}`
            };
        }
    }
    async generateCodeToGetVariableValueSummary(variableName: string) {
        let scriptCode = await this.getContentsOfVariablesScript();
        scriptCode = scriptCode + `\n\nvariables= %who_ls\nreturn _VSCODE_getVariableSummary(${variableName})`;
        return scriptCode;
    }
    /**
     * Script content is static, hence read the contents once.
     */
    private async getContentsOfScript() {
        if (VariableScriptGenerator.contentsOfScript) {
            return VariableScriptGenerator.contentsOfScript;
        }
        const scriptPath = joinPath(
            this._context.extensionUri,
            'scripts',
            'getVariableInfo',
            'vscodeGetVariableInfo.py'
        );
        const contents = await fs.readFile(scriptPath.fsPath, 'utf-8');
        VariableScriptGenerator.contentsOfScript = contents;
        return contents;
    }

    private async getContentsOfVariablesScript() {
        if (VariableScriptGenerator.contentsOfVariablesScript) {
            return VariableScriptGenerator.contentsOfVariablesScript;
        }
        const scriptPath = joinPath(
            this._context.extensionUri,
            'scripts',
            'getVariableInfo',
            'vscodeGetVariablesForProvider.py'
        );
        const contents = await fs.readFile(scriptPath.fsPath, 'utf-8');
        VariableScriptGenerator.contentsOfVariablesScript = contents;
        return contents;
    }
}
