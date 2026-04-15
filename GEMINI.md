# IRS Helper - AI Context

IRS Helper is a privacy-focused, client-side React application designed to automate the enrichment of Portuguese tax declaration (IRS) XML files with financial data extracted from broker PDF reports (specifically XTB and Trade Republic).

## 🚀 Project Overview

- **Core Functionality**: Extracts gains, dividends, and CFD transaction data from broker PDFs and injects them into the appropriate "Anexos" (J, G) of the official Tax Authority XML.
- **Tech Stack**: React 19, TypeScript, Vite, `pdfjs-dist` (PDF parsing), `i18next` (Internationalization), `lucide-react` (Icons), `react-markdown` (Markdown rendering), `remark-gfm` (GFM support).
- **Key Features**:
  - **Automated PDF Extraction**: Uses regex patterns to identify and parse financial tables in broker reports.
  - **XML Injection**: Surgical string-based XML modification to maintain formatting and structure required by tax software.
  - **Visual Verification**: Provides an Enrichment Report and a Diff Viewer for manual auditing of changes.
  - **Privacy**: 100% client-side; no data is uploaded to any server.

## 📁 Architecture & Key Files

- `src/utils/pdfParser.ts`: Contains the regex-based extraction logic for different broker PDF formats.
- `src/utils/xmlModifier.ts`: Handles the injection of extracted data into the XML structure, including calculating sums and managing line numbers (`NLinha`).
- `src/App.tsx`: Main application flow orchestrating file uploads, processing, and state management.
- `src/locales/`: Contains `en.json` and `pt.json` for full English and Portuguese support.
- `src/types.ts`: Centralized TypeScript definitions for tax rows and data structures.

## 🛠️ Development Workflow

### Building and Running
- **Development**: `npm run dev` (Vite dev server)
- **Production Build**: `npm run build`
- **Linting**: `npm run lint`

### Testing
- **Unit & Integration**: `npx vitest` (Testing parser and modifier logic in `src/utils/*.test.ts`)
- **E2E Testing**: `npx playwright test` (Located in `e2e/`)

## 📜 Development Conventions

1.  **PDF Parsing**: Extraction relies on specific regex patterns. When adding support for new brokers or report formats, update `src/utils/pdfParser.ts` and add corresponding test cases in `pdfParser.test.ts`.
2.  **XML Modification**: The XML is modified via string manipulation to ensure compatibility with strict tax authority schemas. Always verify that `NLinha` and total sums (`Soma`) are correctly updated in `xmlModifier.ts`.
3.  **i18n**: All user-facing strings must be localized. Add new keys to both `src/locales/en.json` and `src/locales/pt.json`.
4.  **Agent Rule**: As per `.agents/rules/read-pdf.md`, always use the `view_file` tool to read PDF contents when working with the agent; do not attempt to use Python libraries for PDF analysis.
5.  **Types**: Maintain strict typing for all tax row structures in `src/types.ts` to ensure consistency between extraction and injection.

## 🔍 Known Table Mappings
- **Anexo J Quadro 9.2 A**: Capital gains (Shares/ETFs).
- **Anexo J Quadro 9.2 B**: Capital gains (Investment Funds/Other).
- **Anexo J Quadro 8 A**: Dividends and Interests.
- **Anexo G Quadro 13**: CFDs and Derivative instruments.

## 📝 Additional Technical Notes
- **Markdown Rendering**: Handled via `react-markdown` and `remark-gfm`.
