import { createHash } from "crypto";

import { LRUCache } from "lru-cache";
import Parser from "web-tree-sitter";

import { IDE } from "../../..";
import { getQueryForFile } from "../../../util/treeSitter";
import { AstPath } from "../../util/ast";
import { ImportDefinitionsService } from "../ImportDefinitionsService";
import { AutocompleteSnippet } from "../ranking";

function getSyntaxTreeString(
  node: Parser.SyntaxNode,
  indent: string = "",
): string {
  let result = "";
  const nodeInfo = `${node.type} [${node.startPosition.row}:${node.startPosition.column} - ${node.endPosition.row}:${node.endPosition.column}]`;
  result += `${indent}${nodeInfo}\n`;

  for (const child of node.children) {
    result += getSyntaxTreeString(child, indent + "  ");
  }

  return result;
}

export class RootPathContextService {
  private cache = new LRUCache<string, AutocompleteSnippet[]>({
    max: 100,
  });

  constructor(
    private readonly importDefinitionsService: ImportDefinitionsService,
    private readonly ide: IDE,
  ) {}

  private static getNodeId(node: Parser.SyntaxNode): string {
    return `${node.startIndex}`;
  }

  private static TYPES_TO_USE = new Set([
    "arrow_function",
    "program",
    "function_declaration",
    "function_definition",
    "method_definition",
    "method_declaration",
    "class_declaration",
    "class_definition",
  ]);

  /**
   * Key comes from hash of parent key and node type and node id.
   */
  private static keyFromNode(
    parentKey: string,
    astNode: Parser.SyntaxNode,
  ): string {
    return createHash("sha256")
      .update(parentKey)
      .update(astNode.type)
      .update(RootPathContextService.getNodeId(astNode))
      .digest("hex");
  }

  private async getSnippetsForNode(
    filepath: string,
    node: Parser.SyntaxNode,
  ): Promise<AutocompleteSnippet[]> {
    const snippets: AutocompleteSnippet[] = [];

    let query: Parser.Query | undefined;
    switch (node.type) {
      case "program":
        this.importDefinitionsService.get(filepath);
        break;
      default:
        // const type = node.type;
        // debugger;
        // console.log(getSyntaxTreeString(node));

        query = await getQueryForFile(
          filepath,
          `root-path-context-queries/${node.type}`,
        );
        break;
    }
    const type = node.type;

    if (!query) {
      return snippets;
    }

    const queries = query.matches(node).map(async (match) => {
      for (const item of match.captures) {
        const endPosition = item.node.endPosition;
        const newSnippets = await this.getSnippets(filepath, endPosition);
        snippets.push(...newSnippets);
      }
    });

    await Promise.all(queries);

    return snippets;
  }

  private async getSnippets(
    filepath: string,
    endPosition: Parser.Point,
  ): Promise<AutocompleteSnippet[]> {
    const definitions = await this.ide.gotoDefinition({
      filepath,
      position: {
        line: endPosition.row,
        character: endPosition.column,
      },
    });
    const newSnippets = await Promise.all(
      definitions.map(async (def) => ({
        ...def,
        contents: await this.ide.readRangeInFile(def.filepath, def.range),
      })),
    );

    return newSnippets;
  }

  async getContextForPath(
    filepath: string,
    astPath: AstPath,
    // cursorIndex: number,
  ): Promise<AutocompleteSnippet[]> {
    const snippets: AutocompleteSnippet[] = [];

    let parentKey = filepath;
    for (const astNode of astPath.filter((node) =>
      RootPathContextService.TYPES_TO_USE.has(node.type),
    )) {
      const key = RootPathContextService.keyFromNode(parentKey, astNode);
      // const type = astNode.type;
      // debugger;

      const foundInCache = this.cache.get(key);
      const newSnippets =
        foundInCache ?? (await this.getSnippetsForNode(filepath, astNode));
      snippets.push(...newSnippets);

      if (!foundInCache) {
        this.cache.set(key, newSnippets);
      }

      parentKey = key;
    }

    return snippets;
  }
}
