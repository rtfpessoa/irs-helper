# IRS Helper

IRS Helper is a web-based tool designed to simplify the process of filling out tax declarations by automating the enrichment of XML declaration files with financial data extracted from broker PDF reports.

## 🚀 Features

- **Automated PDF Extraction**: Extracts gains and dividends data from PDF reports provided by brokers such as **XTB** and **Trade Republic**.
- **XML Enrichment**: Intelligently inserts extracted financial data into the corresponding sections of an XML tax declaration.
- **Visual Verification**:
  - **Enrichment Report**: A summary of the data extracted and added to the declaration.
  - **Diff Viewer**: A side-by-side comparison of the original and enriched XML files to ensure accuracy.
- **Internationalization**: Full support for **English** and **Portuguese** languages.
- **Client-Side Processing**: All file processing happens locally in the browser for maximum privacy and security.

## 🛠️ Tech Stack

- **Framework**: [React 19](https://react.dev/) with [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **PDF Parsing**: [`pdfjs-dist`](https://mozilla.github.io/pdf.js/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **i18n**: [i18next](https://www.i18next.com/)
- **Testing**: 
  - [Playwright](https://playwright.dev/) for End-to-End (E2E) testing.
  - [Vitest](https://vitest.dev/) and [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) for unit and integration tests.

## 🏁 Getting Started

### Prerequisites

- Node.js (Latest LTS recommended)
- npm

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd irs-helper
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Development

Run the development server:
```bash
npm run dev
```
The application will be available at `http://localhost:5173`.

### Building for Production

Create an optimized production build:
```bash
npm run build
```

### Linting

Check for code style and type errors:
```bash
npm run lint
```

## 🧪 Testing

### Unit Tests
Run tests for PDF parsing and XML modification utilities:
```bash
npx vitest
```

### E2E Tests
Run end-to-end tests using Playwright:
```bash
npx playwright test
```
