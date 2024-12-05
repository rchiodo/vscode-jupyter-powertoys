import { VariableScriptGenerator } from './variableScriptGenerator';
import { CancellationToken, Uri } from 'vscode';
import type { Kernel, Output } from '@vscode/jupyter-extension';

/**
 * This code was copied from strip-ansi (https://github.com/chalk/strip-ansi/blob/main/index.js)
 * because it wasn't loading in mocha. Since it was so simple, we just moved it here.
 * @param str
 * @returns
 */
export function stripAnsi(str: string) {
    if (typeof str !== 'string') {
        throw new TypeError(`Expected a \`string\`, got \`${typeof str}\``);
    }

    var ansiRegex = require('ansi-regex');

    // Special case ansiregex for running on test machines. Seems to not have a 'default'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ansiRegexFunc = ansiRegex as any;
    if (ansiRegexFunc.default) {
        ansiRegexFunc = ansiRegexFunc.default;
    }

    return str.replace(ansiRegexFunc(), '');
}

interface Variable {
    /** The variable's name. */
    name: string;

    /** The variable's value.
        This can be a multi-line text, e.g. for a function the body of a function.
        For structured variables (which do not have a simple value), it is recommended to provide a one-line representation of the structured object.
        This helps to identify the structured object in the collapsed state when its children are not yet visible.
        An empty string can be used if no value should be shown in the UI.
    */
    value: string;

    /** The code that represents how the variable would be accessed in the runtime environment */
    expression?: string;

    /** The type of the variable's value */
    type?: string;

    /** The interfaces or contracts that the type satisfies */
    interfaces?: string[];

    /** The language of the variable's value */
    language?: string;
}

export interface IVariableDescription extends Variable {
    /** The name of the variable at the root scope */
    root: string;
    /** How to look up the specific property of the root variable */
    propertyChain: (string | number)[];
    /** The number of children for collection types */
    count?: number;
    /** Names of children */
    hasNamedChildren?: boolean;
    /** A method to get the children of this variable */
    getChildren?: (start: number, token: CancellationToken) => Promise<IVariableDescription[]>;
}

// Get variables from the currently running active Jupyter server or debugger
// Note: This definition is used implicitly by getJupyterVariableValue.py file
// Changes here may need to be reflected there as well
export interface IJupyterVariable {
    name: string;
    value: string | undefined;
    executionCount?: number;
    supportsDataExplorer: boolean;
    type: string;
    fullType?: string;
    size: number;
    shape: string;
    dataDimensionality?: number;
    count: number;
    truncated: boolean;
    columns?: { key: string; type: string }[];
    rowCount?: number;
    indexColumn?: string;
    maximumRowChunkSize?: number;
    fileName?: Uri;
    frameId?: number;
}

// Options for error reporting from kernel silent execution
export type SilentExecutionErrorOptions = {
    // Setting this will log jupyter errors from silent execution as errors as opposed to warnings
    traceErrors?: boolean;
    // This optional message will be displayed as a prefix for the error or warning message
    traceErrorsMessage?: string;
};

async function executeSilently(kernel: Kernel, code: string, token: CancellationToken): Promise<Output[]> {
    const execution = kernel.executeCode(code, token);
    const outputs: Output[] = [];
    for await (const output of execution) {
        outputs.push(output);
    }
    return outputs;
}

async function safeExecuteSilently(
    kernel: Kernel,
    { code, initializeCode, cleanupCode }: { code: string; initializeCode?: string; cleanupCode?: string },
    token: CancellationToken
): Promise<Output[]> {
    if (kernel.status === 'dead') {
        return [];
    }
    try {
        if (initializeCode) {
            await executeSilently(kernel, initializeCode, token);
        }
        return await executeSilently(kernel, code, token);
    } catch (ex) {
        throw ex;
    } finally {
        if (cleanupCode) {
            await executeSilently(kernel, cleanupCode, token);
        }
    }
}

export class PythonVariablesRequester {
    constructor(
        private readonly varScriptGenerator: VariableScriptGenerator,
    ) {}

    public async getVariableNamesAndTypesFromKernel(
        kernel: Kernel,
        token: CancellationToken
    ): Promise<IJupyterVariable[]> {
        if (kernel) {
            // VariableTypesFunc takes in list of vars and the corresponding var names
            const { code, cleanupCode, initializeCode } = await this.varScriptGenerator.generateCodeToGetVariableTypes({
                isDebugging: false
            });
            const results = await safeExecuteSilently(kernel, { code, cleanupCode, initializeCode }, token);

            if (kernel.status === 'dead') {
                return [];
            }
            const variables = this.deserializeJupyterResult(results) as {
                name: string;
                type: string;
                fullType: string;
            }[];

            const vars = [];
            for (const variable of variables) {
                const v: IJupyterVariable = {
                    ...variable,
                    value: undefined,
                    supportsDataExplorer: false,
                    size: 0,
                    shape: '',
                    count: 0,
                    truncated: true
                };
                vars.push(v);
            }
            return vars;
        }

        return [];
    }

    public async getFullVariable(
        targetVariable: IJupyterVariable,
        kernel: Kernel,
        token: CancellationToken
    ): Promise<IJupyterVariable> {
        // Then execute a call to get the info and turn it into JSON
        const { code, cleanupCode, initializeCode } = await this.varScriptGenerator.generateCodeToGetVariableInfo({
            isDebugging: false,
            variableName: targetVariable.name
        });
        const results = await safeExecuteSilently(kernel, { code, cleanupCode, initializeCode }, token);

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results)
        };
    }
    private extractJupyterResultText(outputs: Output[]): string {
        // Verify that we have the correct cell type and outputs
        if (outputs.length > 0) {
            const codeCellOutput = outputs[0].items[0];
            if (codeCellOutput && codeCellOutput.mime === 'text/plain') {
                return Buffer.from(codeCellOutput.data).toString('utf8');
            }
        }

        throw new Error('Bad response from Jupyter');
    }

    // Pull our text result out of the Jupyter cell
    private deserializeJupyterResult<T>(outputs: Output[]): T {
        const text = this.extractJupyterResultText(outputs);
        return JSON.parse(text) as T;
    }
}
