# Project Mnemosyne

**Project Mnemosyne** is a personal AI memory system. It ingests your data (notes, Gmail, Calendar, Contacts, voice recordings), structures it into a queryable semantic memory graph (comprising episodes, facts, entities, and relationships), and exposes it via grounded Q&A, interactive 3D relationship tracking, and proactive agent briefings.

Its guiding principle: **"Build the memory, not the notebook — discipline to forget, humility to cite, courage to interrupt."**

---

## 🏗️ System Architecture

The following diagram illustrates how the system components connect:

```mermaid
flowchart LR

    %% ── User ──
    User(("🧠 User"))

    subgraph VERCEL ["☁️ Vercel Edge Network"]
        direction TB
        Dashboard["📊 Dashboard"]
        Graph3D["🌐 3D Force Graph"]
        VoiceUI["🎙️ Voice Capture"]
        ChatUI["💬 Ask / Q&A Panel"]
        AuthUI["🔐 OAuth Login"]
    end

    subgraph VPC ["🔒 AWS VPC · us-east-1"]
        direction TB

        subgraph COMPUTE ["⚡ Public Subnet A · us-east-1a"]
            direction TB
            API["🚀 Fastify API Server\nport 3000"]
            Workers["⚙️ BullMQ Workers"]
        end

        subgraph QUEUE ["📨 Task Queue"]
            Redis[("🔴 Redis 7\nBroker")]
        end

        subgraph DATA ["💾 DB Subnet Group"]
            Aurora[("🐘 Amazon Aurora\nPostgreSQL 16 + pgvector")]
        end
    end

    subgraph AWS_SVC ["☁️ AWS Services"]
        S3[("📦 Amazon S3\nArtifact Storage")]
    end

    subgraph AI ["🤖 AI & Integrations"]
        Gemini["✨ Gemini API"]
        Qwen["🧪 Qwen LLM"]
        Google["📧 Google Workspace"]
        MSFT["📅 Microsoft Graph"]
    end

    %% ── User → Frontend ──
    User -- "opens app" --> Dashboard
    User -- "speaks" --> VoiceUI
    User -- "asks question" --> ChatUI
    User -- "explores graph" --> Graph3D
    User -- "signs in" --> AuthUI

    %% ── Frontend → API ──
    Dashboard -- "HTTPS / JWT" --> API
    VoiceUI -- "audio upload" --> API
    ChatUI -- "search query" --> API
    Graph3D -- "fetch nodes" --> API
    AuthUI -- "OAuth tokens" --> API

    %% ── API ↔ Data Stores ──
    API <-- "Kysely SQL\nrelational + vector" --> Aurora
    API <-- "enqueue jobs" --> Redis
    API -- "read/write files" --> S3

    %% ── Workers ↔ Everything ──
    Redis -- "dequeue" --> Workers
    Workers <-- "write facts,\nentities, edges" --> Aurora
    Workers -- "store raw audio" --> S3
    Workers -- "embeddings\n& extraction" --> Gemini
    Workers -- "summarization" --> Qwen
    Workers -- "ingest mail\n& calendar" --> Google
    Workers -- "ingest contacts\n& events" --> MSFT

    %% ── Node Styling ──
    classDef user fill:#6d28d9,stroke:#a78bfa,stroke-width:3px,color:#f8fafc,font-weight:bold
    classDef frontend fill:#0c4a6e,stroke:#38bdf8,stroke-width:2px,color:#e0f2fe
    classDef compute fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#d1fae5
    classDef queue fill:#78350f,stroke:#fbbf24,stroke-width:2px,color:#fef3c7
    classDef db fill:#1e3a5f,stroke:#7dd3fc,stroke-width:2px,color:#e0f2fe
    classDef aws fill:#4a2600,stroke:#ff9900,stroke-width:2px,color:#fff7ed
    classDef ai fill:#3b0764,stroke:#c084fc,stroke-width:2px,color:#f3e8ff

    class User user
    class Dashboard,Graph3D,VoiceUI,ChatUI,AuthUI frontend
    class API,Workers compute
    class Redis queue
    class Aurora db
    class S3 aws
    class Gemini,Qwen,Google,MSFT ai

    %% ── Subgraph Styling ──
    style VERCEL fill:#0c4a6e,stroke:#0284c7,stroke-width:3px,color:#e0f2fe,stroke-dasharray:6 3
    style VPC fill:#0f2b1c,stroke:#10b981,stroke-width:3px,color:#d1fae5,stroke-dasharray:8 4
    style COMPUTE fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#d1fae5
    style QUEUE fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#fef3c7
    style DATA fill:#0c2d48,stroke:#38bdf8,stroke-width:2px,color:#e0f2fe
    style AWS_SVC fill:#431407,stroke:#ff9900,stroke-width:3px,color:#fff7ed,stroke-dasharray:6 3
    style AI fill:#2e1065,stroke:#a855f7,stroke-width:3px,color:#f3e8ff,stroke-dasharray:6 3

    %% ── Link Styling ──
    linkStyle 0,1,2,3,4 stroke:#a78bfa,stroke-width:2px
    linkStyle 5,6,7,8,9 stroke:#38bdf8,stroke-width:2.5px
    linkStyle 10,11,12 stroke:#34d399,stroke-width:2.5px
    linkStyle 13,14,15,16,17,18,19 stroke:#c084fc,stroke-width:2px,stroke-dasharray:5 3
```

---

## 📦 Project Layout

Project Mnemosyne is split into two self-contained packages:

*   📁 **[`app/`](app/README.md) (Frontend)**: A Next.js 16 (App Router) + React 19 web interface utilizing Tailwind CSS v4 and an interactive 3D Force-Directed Graph (Three.js) to display your relationship network.
*   📁 **[`services/`](services/README.md) (Backend)**: A Node.js + TypeScript Fastify API server and BullMQ background task worker running on PostgreSQL 16 + pgvector and Redis.

---

## 🚀 Quick Start (Running Locally)

To spin up the entire project locally, follow these steps:

### 1. Backend Setup
1. Change into the backend directory and configure the environment:
    ```bash
    cd services
    cp .env.example .env
    ```
2. Start the local database and redis containers:
    ```bash
    pnpm infra:up
    ```
3. Initialize the PostgreSQL schema:
    ```bash
    pnpm db:reset
    ```
4. Start the API and Worker processes in separate terminals:
    ```bash
    pnpm api      # Starts Fastify API on http://localhost:3000
    pnpm worker   # Starts BullMQ worker processors
    ```

### 2. Frontend Setup
1. In another terminal, navigate to the frontend directory:
    ```bash
    cd app
    cp .env.example .env.local
    ```
2. Install dependencies and start the dev server:
    ```bash
    pnpm install
    pnpm dev      # Starts Next.js frontend on http://localhost:3001
    ```

Open your browser to [http://localhost:3001](http://localhost:3001) to interact with the application.
