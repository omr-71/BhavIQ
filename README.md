 <div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:071713,45:123D30,100:20A477&height=230&section=header&text=BHAVIQ&fontSize=82&fontColor=FFFFFF&fontAlignY=38&desc=INTELLIGENT%20RETAIL%20%26%20MARKET%20INTELLIGENCE&descSize=14&descAlignY=60&animation=fadeIn" width="100%" alt="BHAVIQ banner"/>

### Understand your business. Make smarter decisions.

<img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=16&duration=2800&pause=900&color=42D6A0&center=true&vCenter=true&width=650&lines=Retail+Management%2C+Reimagined.;From+inventory+to+intelligence.;Better+visibility.+Smarter+decisions." alt="Animated tagline"/>

<br/>

[![Repository](https://img.shields.io/badge/GitHub-BhavIQ-181717?style=for-the-badge&logo=github)](https://github.com/omr-71/BhavIQ)
[![Platform](https://img.shields.io/badge/Platform-Desktop-123D30?style=for-the-badge&logo=windows)](#)
[![Built with](https://img.shields.io/badge/Built%20with-Tauri%20%7C%20React-20A477?style=for-the-badge)](#)

</div>

---

## Overview

**BHAVIQ** is an intelligent retail management and market intelligence application designed to bring essential shop operations and business insights into one unified workspace.

It aims to connect everyday retail workflows with better visibility into inventory, billing, purchasing, supplier activity and market information.

The idea is simple: give retailers a clearer picture of their business so they can make more informed decisions.

## Core Capabilities

| Module | Description |
|---|---|
| Overview | A central view of business activity |
| Billing | Manage billing and invoice workflows |
| Products & Inventory | Organise products and stock information |
| Khata | Manage customer account records |
| Purchases & Suppliers | Track purchases and supplier information |
| Market Intelligence | Explore commodity and market information |
| Reports & Expenses | Review business records and expenses |
| Settings | Manage application preferences |

## Market Intelligence

BHAVIQ brings market information into the retail workflow.

Its market intelligence experience includes features such as:

- Rate Explorer
- Price Calculator
- Market Alerts
- Supplier Quote Logging
- Market Observation Logging
- Official AGMARKNET data integration

Market information should be interpreted with its source and reporting date in mind.

## Technology

BHAVIQ's application architecture uses a combination of:

- **React** — User interface
- **TypeScript** — Type-safe application development
- **Vite** — Development and build tooling
- **Tauri** — Desktop application framework
- **Rust** — Native desktop integration
- **Supabase** — Backend and database services
- **Firebase** — Configured Firebase services

## Getting Started

### Requirements

- Node.js
- npm
- Rust toolchain
- Tauri prerequisites for your operating system

### 1. Clone the repository

```bash
git clone https://github.com/omr-71/BhavIQ.git
cd BhavIQ
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create your local environment file using `.env.example`.

Add the required credentials for your configured services, such as Supabase and Gemini, according to the project's environment configuration.

**Never commit real credentials, API keys or private service files.**

### 4. Start the development server

```bash
npm run dev
```

### 5. Launch the desktop application

```bash
npx tauri dev
```

### 6. Create a production build

```bash
npm run build
```

For a desktop release build:

```bash
npx tauri build
```

## Project Structure

```text
BHAVIQ/
├── public/              # Static assets
├── server/              # Server-side modules
├── src/
│   ├── components/      # Reusable UI components
│   ├── lib/             # Application utilities
│   └── pages/           # Application pages
├── src-tauri/           # Native desktop application
├── supabase/
│   └── migrations/      # Database migrations
├── data/                # Project data
├── docs/                # Documentation
├── server.ts            # Server entry point
├── package.json
└── README.md
```

## Design Philosophy

**Clarity over complexity.** Business information should be easy to understand.

**Intelligence with context.** Market data is more useful when presented with its source and context.

**Practical by design.** Every feature should serve a real retail workflow.

**Built for reliability.** Business operations need dependable tools and carefully handled data.

## Development

BHAVIQ is an evolving project. Features, integrations and application capabilities may change as development progresses.

Contributions, suggestions and constructive feedback are welcome.

## Connect

<div align="center">

**BHAVIQ**

*Intelligent Retail Management & Market Intelligence*

Developed by **Om Labhade**

[GitHub Repository](https://github.com/omr-71/BhavIQ)

</div>

---

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:20A477,50:123D30,100:071713&height=100&section=footer" width="100%" alt="Footer"/>

**BHAVIQ · THINK BEYOND RETAIL.**

</div>
