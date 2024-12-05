import * as Parser from 'tree-sitter';
import Python from 'tree-sitter-python';

export class PythonParser {
    private parser: Parser;
    constructor() {
        this.parser = new Parser();
        this.parser.setLanguage(Python);
    }
    public findVariableLocations(code: string) {
        const tree = this.parser.parse(code);
        return this._findVariableLocationsImpl(tree.rootNode);
    }

    private _findVariableLocationsImpl(node: Parser.SyntaxNode, variables: { name: string, startPosition: Parser.Point, endPosition: Parser.Point }[] = []) {
        if (node.type === 'identifier') {
            variables.push({
                name: node.text,
                startPosition: node.startPosition,
                endPosition: node.endPosition
            });
        }

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child !== null) {
                this._findVariableLocationsImpl(child, variables);
            }
        }

        return variables;
    }
}
