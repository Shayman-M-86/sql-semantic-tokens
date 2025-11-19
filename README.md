# SQL Semantic Tokens for VS Code

<div align="center">

<img src="docs/images/banner.png" width="100%" />

**Database-aware semantic highlighting for SQL in VS Code.**  
Deep, accurate table & column coloring powered by your live PostgreSQL schema.

![GitHub last commit](https://img.shields.io/github/last-commit/Shayman-M-86/sql-semantic-tokens)
![VSIX size](https://img.shields.io/badge/VSIX-~30KB-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

## Contents

- [Demo](#-demo)
- [Features](#-features)
- [Configuration](#%EF%B8%8F-configuration)
- [Development](#-development)
- [Automated Releases](#-automated-releases)
- [License](#-license)

---

## 🎥 Demo

See SQL Semantic Tokens running inside VS Code:

![SQL Semantic Tokens Demo](docs/images/demo.png)

---

## ✨ Features

### 🎨 Database-aware semantic highlighting
Traditional TextMate grammar highlighting guesses the meaning of identifiers. This extension streams **true semantic tokens** from your PostgreSQL schema, so tables, columns, aliases, qualified identifiers (`a.id`, `sr.region_id`), and CTE outputs (`rep_totals.rt_column`) always reflect real metadata.

### 🔌 PostgreSQL schema introspection
The extension connects to PostgreSQL, loads the schema you choose (tables, columns, schema-qualified columns, and table→alias mappings), and keeps the cache up to date for accurate, zero-configuration coloring.

### 🤖 Copilot-friendly schema hints
Run **SQL Semantic Tokens: Insert Schema Hint** to auto-generate a comment block with the latest schema so AI tools have the same context you do:

```sql
-- accounts(id, name, website)
-- orders(id, account_id, total_amt_usd)
-- sales_reps(id, name, region_id)
```

---

## ⚙️ Configuration

Set up two things:

1. **Database connection** – how the extension reaches your PostgreSQL schema.
2. **Semantic token colors** – how VS Code visually distinguishes the new tokens.

### 1. Database connection

**GUI**

1. Open **Settings** in VS Code.
2. Search **SQL Semantic Tokens**.
3. Fill in the fields below.

| Setting | Description |
| --- | --- |
| **dbHost** | PostgreSQL host (default `localhost`). |
| **dbPort** | Port (default `5432`). |
| **dbUser** | PostgreSQL username. |
| **dbPassword** | Password for that user. |
| **dbName** | Database to connect to. |
| **dbSchema** | Schema to introspect (default `public`). |

**settings.json**

1. `Ctrl+Shift+P` → **Preferences: Open Settings (JSON)**.
2. Add the configuration block:

```jsonc
{
  "sqlSemanticTokens.dbHost": "localhost",
  "sqlSemanticTokens.dbPort": 5432,
  "sqlSemanticTokens.dbUser": "postgres",
  "sqlSemanticTokens.dbPassword": "your_password",
  "sqlSemanticTokens.dbName": "postgres",
  "sqlSemanticTokens.dbSchema": "public"
}
```

### 2. Semantic token colors

VS Code does not color custom semantic tokens until you define rules. Add the snippet below to `settings.json` (global or workspace) and tweak colors to fit your theme:

```jsonc
{
  "editor.semanticTokenColorCustomizations": {
    "enabled": true,
    "rules": {
      "table": {
        "foreground": "#4FC3F7",
        "fontStyle": "bold"
      },
      "column": {
        "foreground": "#F06292"
      }
    }
  }
}
```

#### Theme-safe overrides

If your theme already controls semantic tokens, switch to the `overrides` key so your SQL colors always win without suppressing other theme logic:

```jsonc
{
  "editor.semanticTokenColorCustomizations": {
    "enabled": true,
    "overrides": {
      "table": {
        "foreground": "#4FC3F7",
        "fontStyle": "bold"
      },
      "column": {
        "foreground": "#F06292"
      }
    }
  }
}
```

---

## 🛠 Development

```bash
npm install
npm run bundle
vsce package
```

---

## 🚀 Automated Releases

Tag and push a version to trigger the release workflow:

```bash
git tag v0.0.2
git push origin v0.0.2
```

GitHub Actions will bundle, package, and upload the `.vsix` automatically.

---

## 📜 License

MIT
