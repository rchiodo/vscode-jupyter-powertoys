import * as nbformat from '@jupyterlab/nbformat';
import { VariableScriptGenerator } from './variableScriptGenerator';
import { DataFrameScriptGenerator } from './dataFrameScriptGenerator';
import { Kernel, Session } from '@jupyterlab/services';
import { CancellationToken, Uri } from 'vscode';

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

export async function executeSilently(
    kernelConnection: Kernel.IKernelConnection,
    code: string,
    errorOptions?: SilentExecutionErrorOptions
): Promise<nbformat.IOutput[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

    const request = kernelConnection.requestExecute(
        {
            code: code.replace(/\r\n/g, '\n'),
            silent: false,
            stop_on_error: false,
            allow_stdin: true,
            store_history: false
        },
        true
    );
    const outputs: nbformat.IOutput[] = [];
    request.onIOPub = (msg) => {
        if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
            if (
                outputs.length > 0 &&
                outputs[outputs.length - 1].output_type === 'stream' &&
                outputs[outputs.length - 1].name === msg.content.name
            ) {
                const streamOutput = outputs[outputs.length - 1] as nbformat.IStream;
                streamOutput.text += msg.content.text;
            } else {
                const streamOutput: nbformat.IStream = {
                    name: msg.content.name,
                    text: msg.content.text,
                    output_type: 'stream'
                };
                outputs.push(streamOutput);
            }
        } else if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
            const output: nbformat.IExecuteResult = {
                data: msg.content.data,
                execution_count: msg.content.execution_count,
                metadata: msg.content.metadata,
                output_type: 'execute_result'
            };
            outputs.push(output);
        } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
            const output: nbformat.IDisplayData = {
                data: msg.content.data,
                metadata: msg.content.metadata,
                output_type: 'display_data'
            };
            outputs.push(output);
        } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
            if (errorOptions?.traceErrors) {
                const errorMessage = `${
                    errorOptions.traceErrorsMessage || 'Failed to execute (silent) code against the kernel'
                }, \nCode = ${code}\nError details: `;
                console.error(errorMessage, msg.content);
            }
            const output: nbformat.IError = {
                ename: msg.content.ename,
                evalue: msg.content.evalue,
                traceback: msg.content.traceback,
                output_type: 'error'
            };
            outputs.push(output);
        }
    };
    await request.done;

    return outputs;
}

function hasKernel(session: Session.ISessionConnection | undefined): session is Session.ISessionConnection & { kernel: NonNullable<Session.ISessionConnection['kernel']> } {
    return !!session && !!session.kernel;
}

async function safeExecuteSilently(
    session: Session.ISessionConnection,
    { code, initializeCode, cleanupCode }: { code: string; initializeCode?: string; cleanupCode?: string },
    errorOptions?: SilentExecutionErrorOptions
): Promise<nbformat.IOutput[]> {
    if (!hasKernel(session)) {
        return [];
    }
    try {
        if (initializeCode) {
            await executeSilently(session.kernel, initializeCode, errorOptions);
        }
        return await executeSilently(session.kernel, code, errorOptions);
    } catch (ex) {
        throw ex;
    } finally {
        if (cleanupCode) {
            await executeSilently(session.kernel, cleanupCode, errorOptions);
        }
    }
}

export type DataFrameSplitFormat = {
    index: (number | string)[];
    columns: string[];
    data: Record<string, unknown>[];
};

export function parseDataFrame(df: DataFrameSplitFormat) {
    const rowIndexValues = df.index;
    const columns = df.columns;
    const rowData = df.data;
    const data = rowData.map((row, index) => {
        const rowData: Record<string, unknown> = {
            index: rowIndexValues[index]
        };
        columns.forEach((column, columnIndex) => {
            rowData[column] = row[columnIndex];
        });
        return rowData;
    });
    return { data };
}



export class PythonVariablesRequester {
    constructor(
        private readonly varScriptGenerator: VariableScriptGenerator,
        private readonly dfScriptGenerator: DataFrameScriptGenerator
    ) {}

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        session: Session.ISessionConnection,
        expression: string
    ): Promise<IJupyterVariable> {
        // Then execute a call to get the info and turn it into JSON
        const { code, cleanupCode, initializeCode } = await this.dfScriptGenerator.generateCodeToGetDataFrameInfo({
            isDebugging: false,
            variableName: expression
        });
        const results = await safeExecuteSilently(
            session,
            { code, cleanupCode, initializeCode },
            {
                traceErrors: true,
                traceErrorsMessage: 'Failure in execute_request for getDataFrameInfo',
            }
        );

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results),
        };
    }

    public async getDataFrameRows(
        start: number,
        end: number,
        session: Session.ISessionConnection,
        expression: string
    ): Promise<{ data: Record<string, unknown>[] }> {
        // Then execute a call to get the rows and turn it into JSON
        const { code, cleanupCode, initializeCode } = await this.dfScriptGenerator.generateCodeToGetDataFrameRows({
            isDebugging: false,
            variableName: expression,
            startIndex: start,
            endIndex: end
        });
        const results = await safeExecuteSilently(
            session,
            { code, cleanupCode, initializeCode },
            {
                traceErrors: true,
                traceErrorsMessage: 'Failure in execute_request for getDataFrameRows',
            }
        );
        if (results.length === 0) {
            return { data: [] };
        }
        return parseDataFrame(this.deserializeJupyterResult<DataFrameSplitFormat>(results));
    }

    public async getVariableProperties(
        word: string,
        _cancelToken: CancellationToken | undefined,
        matchingVariable: IJupyterVariable | undefined
    ): Promise<{ [attributeName: string]: string }> {
        let result: { [attributeName: string]: string } = {};
        if (matchingVariable && matchingVariable.value) {
            result[`${word}`] = matchingVariable.value;
        }
        return result;
    }

    public async getVariableNamesAndTypesFromKernel(
        session: Session.ISessionConnection,
        _token?: CancellationToken
    ): Promise<IJupyterVariable[]> {
        if (session) {
            // VariableTypesFunc takes in list of vars and the corresponding var names
            const { code, cleanupCode, initializeCode } = await this.varScriptGenerator.generateCodeToGetVariableTypes({
                isDebugging: false
            });
            const results = await safeExecuteSilently(
                session,
                { code, cleanupCode, initializeCode },
                {
                    traceErrors: true,
                    traceErrorsMessage: 'Failure in execute_request for getVariableNamesAndTypesFromKernel',
                }
            );

            if (session.disposed) {
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
        session: Session.ISessionConnection,
        _token?: CancellationToken
    ): Promise<IJupyterVariable> {
        // Then execute a call to get the info and turn it into JSON
        const { code, cleanupCode, initializeCode } = await this.varScriptGenerator.generateCodeToGetVariableInfo({
            isDebugging: false,
            variableName: targetVariable.name
        });
        const results = await safeExecuteSilently(
            session,
            { code, cleanupCode, initializeCode },
            {
                traceErrors: true,
                traceErrorsMessage: 'Failure in execute_request for getFullVariable',
            }
        );

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results)
        };
    }
    private extractJupyterResultText(outputs: nbformat.IOutput[]): string {
        // Verify that we have the correct cell type and outputs
        if (outputs.length > 0) {
            const codeCellOutput = outputs[0] as nbformat.IOutput;
            if (
                codeCellOutput &&
                codeCellOutput.output_type === 'stream' &&
                codeCellOutput.name === 'stderr' &&
                codeCellOutput.hasOwnProperty('text')
            ) {
                const resultString = codeCellOutput.text as string;
                // See if this the IOPUB data rate limit problem
                if (resultString.includes('iopub_data_rate_limit')) {
                    throw new Error("Hit data rate limit");
                } else {
                    const error = "Error in getting variable data: " + resultString;
                    console.error(error);
                    throw new Error(error);
                }
            }
            if (codeCellOutput && codeCellOutput.output_type === 'execute_result') {
                const data = codeCellOutput.data;
                if (data && data.hasOwnProperty('text/plain')) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (data as any)['text/plain'];
                }
            }
            if (codeCellOutput && codeCellOutput.output_type === 'stream' && codeCellOutput.hasOwnProperty('text')) {
                return codeCellOutput.text as string;
            }
            if (
                codeCellOutput &&
                codeCellOutput.output_type === 'error' &&
                codeCellOutput.hasOwnProperty('traceback')
            ) {
                const traceback: string[] = codeCellOutput.traceback as string[];
                const stripped = traceback.map(stripAnsi).join('\r\n');
                const error = "Execution error getting variables" + stripped;
                console.error(error);
                throw new Error(error);
            }
        }

        throw new Error("Bad response from Jupyter");
    }

    // Pull our text result out of the Jupyter cell
    private deserializeJupyterResult<T>(outputs: nbformat.IOutput[]): T {
        const text = this.extractJupyterResultText(outputs);
        return JSON.parse(text) as T;
    }
}
