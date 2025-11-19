import * as vscode from "vscode";
import { Client } from "pg";

// ── 1. Semantic token types ──────────────────────────────────────────────

const legend = new vscode.SemanticTokensLegend(["table", "column"], []);

// Known schema (filled from DB)
const KNOWN_TABLES = new Set<string>();
const KNOWN_COLUMNS = new Set<string>(); // bare column + table.column
const TABLE_COLUMNS = new Map<string, Set<string>>(); // table → set of columns

const SQL_KEYWORDS = new Set<string>([
  "select",
  "from",
  "where",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "on",
  "group",
  "by",
  "order",
  "limit",
  "offset",
  "as",
  "and",
  "or",
  "not",
  "insert",
  "into",
  "update",
  "delete",
  "values",
  "set",
  // control / misc
  "with",
  "having",
  "union",
  "all",
  "distinct",
  "exists",
  "in",
  "like",
  "between",
  "case",
  "when",
  "then",
  "else",
  "end",
  "asc",
  "desc",
  // common aggregate / function names we don't want as identifiers
  "sum",
  "count",
  "avg",
  "min",
  "max",
]);

let schemaLoadPromise: Promise<void> | null = null;

// ── 2. Activate ──────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage("sql-semantic-tokens activated");
  console.log("sql-semantic-tokens (DB-backed) activated");

  const selector: vscode.DocumentSelector = [
    { language: "sql", scheme: "file" },
    { language: "pgsql", scheme: "file" },
    { language: "postgres", scheme: "file" },
  ];

  const provider: vscode.DocumentSemanticTokensProvider = {
    provideDocumentSemanticTokens: async (
      document: vscode.TextDocument,
      _token: vscode.CancellationToken
    ): Promise<vscode.SemanticTokens> => {
      await ensureSchemaLoaded();

      const builder = new vscode.SemanticTokensBuilder(legend);
      const aliasMap = new Map<string, string>(); // alias -> real table name

      // keep mode across lines: between SELECT and FROM we stay in "select" mode
      let mode: "none" | "select" | "from" = "none";

      for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
        const rawLine = document.lineAt(lineNumber).text;

        // Strip comments: anything after -- is treated as comment
        const commentIdx = rawLine.indexOf("--");
        const line = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;

        if (line.trim().length === 0) {
          // blank or comment-only line → skip
          continue;
        }

        let lastTableName: string | null = null; // candidate for alias on this line
        let lastWasAs = false; // track AS <alias> on this line

        const parts = line.split(/(\s+)/);
        let charIndex = 0;

        for (const rawPart of parts) {
          if (rawPart.length === 0) continue;

          if (rawPart.trim().length === 0) {
            charIndex += rawPart.length;
            continue;
          }

          // ---- Special handling for aggregate calls like SUM(o.total_amt_usd) ----
          const funcCallMatch = rawPart.match(
            /^(sum|count|avg|min|max)\s*\(([^)]+)\)/i
          );
          if (funcCallMatch) {
            const innerExpr = funcCallMatch[2]; // e.g. "o.total_amt_usd"
            const innerTrimmed = innerExpr.trim();
            const innerOffsetInRaw = rawPart.indexOf(innerTrimmed);
            const innerBaseChar =
              charIndex + (innerOffsetInRaw >= 0 ? innerOffsetInRaw : 0);

            if (innerTrimmed.length > 0) {
              // If it's something like o.total_amt_usd, treat it as dotted identifier
              const dotPosInner = innerTrimmed.indexOf(".");
              if (dotPosInner !== -1) {
                const leftRaw = innerTrimmed.slice(0, dotPosInner);
                const rightRaw = innerTrimmed.slice(dotPosInner + 1);

                const leftClean = cleanIdentifier(leftRaw);
                const rightClean = cleanIdentifier(rightRaw);

                if (/[A-Za-z_]/.test(leftClean)) {
                  // treat left as table/alias
                  const leftStart = innerBaseChar;
                  addToken(
                    builder,
                    lineNumber,
                    leftStart,
                    leftClean.length,
                    "table"
                  );
                }

                if (/[A-Za-z_]/.test(rightClean)) {
                  // treat right as column
                  const colStart = innerBaseChar + dotPosInner + 1;
                  addToken(
                    builder,
                    lineNumber,
                    colStart,
                    rightClean.length,
                    "column"
                  );
                }
              } else {
                // No dot inside SUM(...): treat as a column-like identifier
                const cleanInner = cleanIdentifier(innerTrimmed);
                if (/[A-Za-z_]/.test(cleanInner)) {
                  addToken(
                    builder,
                    lineNumber,
                    innerBaseChar,
                    cleanInner.length,
                    "column"
                  );
                }
              }
            }

            // We don't colour SUM itself, and we don't reprocess this token
            charIndex += rawPart.length;
            continue;
          }
          // ---- end aggregate call handling ----

          const cleaned = cleanIdentifier(rawPart);
          if (!cleaned) {
            charIndex += rawPart.length;
            continue;
          }
          const lower = cleaned.toLowerCase();

          // Skip pure operators/punctuation ("=", ">", "<", ">=", "<=", "<>")
          // Only treat tokens with a letter or underscore as identifiers
          if (!/[A-Za-z_]/.test(cleaned)) {
            charIndex += rawPart.length;
            continue;
          }

          // handle keywords that change mode
          if (lower === "select") {
            mode = "select";
            lastWasAs = false;
            charIndex += rawPart.length;
            continue;
          }

          if (lower === "from" || lower === "join") {
            mode = "from";
            lastWasAs = false;
            charIndex += rawPart.length;
            continue;
          }

          // mark when we see AS (in SELECT), so the next identifier is an alias
          if (lower === "as") {
            lastWasAs = true;
            charIndex += rawPart.length;
            continue;
          }

          if (SQL_KEYWORDS.has(lower)) {
            // other keyword (including sum/count/etc when they are stand-alone)
            lastWasAs = false;
            charIndex += rawPart.length;
            continue;
          }

          // alias after AS in SELECT: account_id, sales_rep_name, etc.
          if (lastWasAs && mode === "select") {
            addToken(builder, lineNumber, charIndex, rawPart.length, "column");
            lastWasAs = false;
            charIndex += rawPart.length;
            continue;
          }
          lastWasAs = false;

          // ---- Dotted identifiers like accounts.id or rt.total_sales_usd ----
          if (cleaned.includes(".")) {
            const dotPosInRaw = rawPart.indexOf(".");
            const [leftRaw, rightRaw] = cleaned.split(".", 2);

            if (leftRaw && rightRaw && dotPosInRaw !== -1) {
              const leftLower = leftRaw.toLowerCase();
              const rightLower = rightRaw.toLowerCase();

              // resolve alias to real table if known
              const realTable = aliasMap.get(leftLower) ?? leftLower;

              // table/alias part: colour even in SELECT so aliases before JOIN still look like tables
              if (
                KNOWN_TABLES.has(realTable) ||
                mode === "from" ||
                mode === "select"
              ) {
                addToken(
                  builder,
                  lineNumber,
                  charIndex,
                  leftRaw.length,
                  "table"
                );
              }

              // column part: always treat the right side of x.y as "column"
              if (/[A-Za-z_]/.test(rightLower)) {
                const colStart = charIndex + dotPosInRaw + 1;
                addToken(
                  builder,
                  lineNumber,
                  colStart,
                  rightRaw.length,
                  "column"
                );
              }

              charIndex += rawPart.length;
              continue;
            }
          }
          // ---- end dotted identifier handling ----

          // ---- Non-dotted identifiers: tables, columns, aliases ----
          let tokenType: "table" | "column" | null = null;

          // FROM/JOIN alias detection: FROM accounts a
          if (mode === "from") {
            if (KNOWN_TABLES.has(lower)) {
              // table name
              tokenType = "table";
              lastTableName = lower; // next identifier can be alias
            } else if (lastTableName && !SQL_KEYWORDS.has(lower)) {
              // alias for last table
              aliasMap.set(lower, lastTableName);
              tokenType = "table"; // colour alias like table
              lastTableName = null; // consumed
            }
          }

          // If still not classified, fall back to schema + mode
          if (!tokenType) {
            if (KNOWN_TABLES.has(lower)) {
              tokenType = "table";
            } else if (KNOWN_COLUMNS.has(lower)) {
              tokenType = "column";
            } else {
              if (mode === "from") {
                tokenType = "table";
              } else if (mode === "select") {
                tokenType = "column";
              }
            }
          }

          if (tokenType) {
            addToken(builder, lineNumber, charIndex, rawPart.length, tokenType);
          }

          charIndex += rawPart.length;
        }
      }

      return builder.build();
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      provider,
      legend
    )
  );

  // ── command: insert / update schema hint block ─────────────────────────

  const insertSchemaHintCmd = vscode.commands.registerCommand(
    "sqlSemanticTokens.insertSchemaHint",
    async () => {
      await ensureSchemaLoaded();

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor");
        return;
      }

      const lang = editor.document.languageId;
      if (!["sql", "pgsql", "postgres"].includes(lang)) {
        vscode.window.showWarningMessage("Active file is not an SQL document.");
        return;
      }

      const schemaBlock = buildSchemaHintBlock();
      await insertOrUpdateSchemaHintBlock(editor, schemaBlock);
    }
  );

  context.subscriptions.push(insertSchemaHintCmd);
}

// ── 3. Schema loading ────────────────────────────────────────────────────

async function ensureSchemaLoaded(): Promise<void> {
  if (!schemaLoadPromise) {
    console.log("sql-semantic-tokens: schema not loaded yet, loading now...");
    schemaLoadPromise = loadSchemaFromDatabase().catch((err) => {
      console.error("sql-semantic-tokens: failed to load schema:", err);
    });
  } else {
    console.log("sql-semantic-tokens: schema already loading/loaded");
  }
  return schemaLoadPromise;
}

async function loadSchemaFromDatabase(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("sqlSemanticTokens");

  const host = cfg.get<string>("dbHost") ?? "localhost";
  const port = cfg.get<number>("dbPort") ?? 5432;
  const user = cfg.get<string>("dbUser") ?? "postgres";
  const password = cfg.get<string>("dbPassword") ?? "";
  const database = cfg.get<string>("dbName") ?? "postgres";
  const schema = cfg.get<string>("dbSchema") ?? "public";

  console.log(
    `sql-semantic-tokens: loading schema from ${host}:${port}/${database} schema=${schema}`
  );

  const client = new Client({ host, port, user, password, database });
  await client.connect();

  try {
    KNOWN_TABLES.clear();
    KNOWN_COLUMNS.clear();
    TABLE_COLUMNS.clear();

    const tablesRes = await client.query(
      `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
              AND table_schema = $1
            `,
      [schema]
    );

    for (const row of tablesRes.rows) {
      const t = String(row.table_name).toLowerCase();
      KNOWN_TABLES.add(t);
      TABLE_COLUMNS.set(t, new Set<string>());
    }

    const colsRes = await client.query(
      `
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = $1
            `,
      [schema]
    );

    for (const row of colsRes.rows) {
      const tableName = String(row.table_name).toLowerCase();
      const columnName = String(row.column_name).toLowerCase();

      KNOWN_COLUMNS.add(columnName);
      KNOWN_COLUMNS.add(`${tableName}.${columnName}`);

      let set = TABLE_COLUMNS.get(tableName);
      if (!set) {
        set = new Set<string>();
        TABLE_COLUMNS.set(tableName, set);
      }
      set.add(columnName);
    }

    console.log(
      `sql-semantic-tokens: loaded ${KNOWN_TABLES.size} tables, ${KNOWN_COLUMNS.size} column keys`
    );
  } finally {
    await client.end();
  }
}

// ── 4. Schema hint block for AI / Copilot ────────────────────────────────

function buildSchemaHintBlock(): string {
  const lines: string[] = [];
  lines.push("-- SCHEMA HINT FOR AI (AUTO-GENERATED, DO NOT EDIT MANUALLY)");
  lines.push(
    "-- This lists tables and columns so autocomplete tools know what exists."
  );
  lines.push("--");

  const sortedTables = Array.from(TABLE_COLUMNS.keys()).sort();

  for (const table of sortedTables) {
    const cols = Array.from(TABLE_COLUMNS.get(table) ?? []).sort();
    const colsStr = cols.join(", ");
    lines.push(`-- ${table}(${colsStr})`);
  }

  lines.push("--");
  return lines.join("\n");
}

async function insertOrUpdateSchemaHintBlock(
  editor: vscode.TextEditor,
  block: string
): Promise<void> {
  const doc = editor.document;
  const totalLines = doc.lineCount;

  const marker = "-- SCHEMA HINT FOR AI (AUTO-GENERATED, DO NOT EDIT MANUALLY)";

  let startLine = -1;
  let endLine = -1;

  const maxScan = Math.min(totalLines, 80); // scan first 80 lines

  for (let i = 0; i < maxScan; i++) {
    const text = doc.lineAt(i).text;
    if (text.startsWith(marker)) {
      startLine = i;
      break;
    }
    if (text.trim().length > 0 && !text.startsWith("--")) {
      // first non-comment non-empty line; stop scanning
      break;
    }
  }

  if (startLine !== -1) {
    // existing block: find end
    endLine = startLine + 1;
    while (endLine < totalLines) {
      const text = doc.lineAt(endLine).text;
      if (!text.startsWith("--") || text.trim().length === 0) {
        break;
      }
      endLine++;
    }

    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, 0)
    );

    await editor.edit((editBuilder) => {
      editBuilder.replace(range, block + "\n\n");
    });
  } else {
    // no existing block: insert at top
    await editor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(0, 0), block + "\n\n");
    });
  }
}

// ── 5. Helpers ────────────────────────────────────────────────────────────

function cleanIdentifier(text: string): string {
  return text
    .replace(/[,;()]/g, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}

function addToken(
  builder: vscode.SemanticTokensBuilder,
  line: number,
  startChar: number,
  length: number,
  type: "table" | "column"
) {
  const tokenTypeIndex = legend.tokenTypes.indexOf(type);
  if (tokenTypeIndex === -1) return;

  builder.push(line, startChar, length, tokenTypeIndex, 0);
}

export function deactivate() {}
