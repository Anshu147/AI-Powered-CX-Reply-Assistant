# AI-Powered CX Reply Assistant

An AI-assisted customer experience platform that helps support agents generate grounded, brand-specific replies to customer messages.

The system combines customer conversations, order information, brand knowledge, semantic retrieval, and LLM-generated response suggestions, while keeping the human support agent in control of the final response.

**Live demo:** https://ai-powered-cx-reply-assistant-qemo98nfk.vercel.app/
**Demo login:** _add test agent email / password here (or see [Demo Data & Test Users](#demo-data--test-users))_

---

## Table of Contents

- [Project Overview](#project-overview)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [RAG / AI Flow](#rag--ai-flow)
- [Multi-Brand Isolation](#multi-brand-isolation)
- [Setup & Installation](#setup--installation)
- [Environment Variables](#environment-variables)
- [Demo Data & Test Users](#demo-data--test-users)
- [Deployment](#deployment)
- [Demo / Examples](#demo--examples)
- [Known Limitations](#known-limitations)
- [Future Improvements](#future-improvements)
- [License](#license)

---

## Project Overview

The AI-Powered CX Reply Assistant helps customer support agents respond to customer conversations faster and more consistently.

An agent can:

- View customer conversations
- View customer and order information
- Manage brand-specific knowledge
- Generate AI-assisted replies
- View the knowledge used to generate an AI reply
- Edit or regenerate the AI suggestion
- Approve and send the final response
- Send completely manual responses
- Simulate customer messages using Customer mode
- Keep data isolated between brands

The AI acts as an assistant rather than an autonomous support agent. The human agent remains responsible for reviewing and sending the final response.

---

## Key Features

### Authentication

Agents authenticate using Supabase Auth and can access only the brands they are assigned to.

### Conversation Management

The conversation view includes:

- Customer name
- Customer contact information
- Brand
- Conversation history
- Latest customer message
- Order information
- Conversation status

### Customer / Agent Mode

The application provides two modes for testing the complete conversation loop:

```text
Customer Mode
     ↓
Send customer message
     ↓
Agent Mode
     ↓
Generate AI reply / Reply manually
```

This makes it possible to test the complete workflow without requiring an external messaging integration.

### Manual Replies

Agents can reply without using AI.

```text
Customer Message
       ↓
Agent types response
       ↓
Send
```

### AI-Assisted Replies

Agents can click **Generate AI Reply**. The system retrieves relevant brand knowledge, generates a response using an LLM, and shows the retrieved knowledge to the agent before the response is sent.

### Knowledge Base

Each brand has its own editable knowledge base. Knowledge entries support create, edit, and delete.

The demo contains the following entries for each of the two demo brands, **AquaPure** and **FreshSkin**:

- Return Policy
- Refund Policy
- Shipping Policy
- Cancellation Policy

### Human-in-the-Loop

AI responses can be reviewed, edited, regenerated, approved, and sent.

### AI Guardrails

The assistant is instructed to:

- Use retrieved brand knowledge
- Avoid inventing policies
- Avoid confidently promising unsupported outcomes
- Fall back to manual review when relevant information is unavailable

### AI Audit Logging

AI generations and their supporting knowledge sources are stored for traceability (`ai_generations` and `ai_generation_sources` tables).

---

## How It Works

The complete AI-assisted response workflow:

```text
Customer Message
       ↓
Conversation
       ↓
Identify Brand
       ↓
Load Customer + Order Context
       ↓
Generate Query Embedding
       ↓
Qdrant Semantic Search (filtered by brand_id)
       ↓
Build Grounded Prompt
       ↓
OpenRouter / LLM
       ↓
AI Suggested Reply
       ↓
Agent Reviews
       ↓
Edit / Regenerate
       ↓
Approve & Send
       ↓
Conversation History
```

The manual response path is independent of AI:

```text
Customer Message
       ↓
Agent
       ↓
Types Manual Response
       ↓
Send
```

This provides a human fallback whenever the agent does not want to use AI.

---

## Architecture

```text
                         ┌──────────────────────┐
                         │      CX Agent        │
                         │      Browser         │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │       Vercel         │
                         │ React + TypeScript   │
                         │        + Vite        │
                         └──────────┬───────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
                ▼                   ▼                   ▼
        ┌──────────────┐    ┌──────────────┐   ┌──────────────────┐
        │ Supabase     │    │ Supabase     │   │ Supabase Edge    │
        │ Auth         │    │ PostgreSQL   │   │ Functions        │
        └──────────────┘    └──────────────┘   └────────┬─────────┘
                                                        │
                                            ┌───────────┴───────────┐
                                            │                       │
                                            ▼                       ▼
                                     ┌──────────────┐       ┌──────────────┐
                                     │ Qdrant Cloud │       │  OpenRouter  │
                                     │ Vector DB    │       │     / LLM    │
                                     └──────────────┘       └──────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Routing | React Router |
| Styling | CSS |
| Authentication | Supabase Auth |
| Backend / API | Supabase Edge Functions |
| Database | PostgreSQL (Supabase) |
| Data Security | PostgreSQL Row Level Security (RLS) |
| Vector Database | Qdrant Cloud |
| Embeddings | OpenRouter + `openai/text-embedding-3-small` |
| LLM | OpenRouter (model set via `OPENROUTER_MODEL`) |
| Frontend Deployment | Vercel |
| Backend Hosting | Supabase |

---

## RAG / AI Flow

The application uses Retrieval-Augmented Generation (RAG) to ground AI responses in brand-specific knowledge.

### 1. Knowledge Indexing

When a knowledge entry is created or updated:

```text
Knowledge Base
      ↓
PostgreSQL
      ↓
index-knowledge Edge Function
      ↓
Split content into chunks
      ↓
Generate embeddings
      ↓
Qdrant
```

Each Qdrant point contains metadata such as:

```json
{
  "brand_id": "brand-uuid",
  "document_id": "document-uuid",
  "chunk_id": "chunk-uuid",
  "title": "Refund Policy",
  "category": "refund",
  "content": "..."
}
```

### 2. Query Retrieval

When an agent requests an AI reply:

```text
Customer Message
       ↓
Generate Query Embedding
       ↓
Qdrant Semantic Search
       ↓
Filter by brand_id
       ↓
Retrieve relevant knowledge
```

### 3. AI Generation

The retrieved knowledge is combined with conversation and order context:

```text
Customer Message
        +
Conversation History
        +
Customer Information
        +
Order Information
        +
Retrieved Brand Knowledge
        ↓
   Grounded Prompt
        ↓
     OpenRouter
        ↓
  AI Suggested Reply
```

The generated response and retrieved sources are stored in `ai_generations` / `ai_generation_sources` and returned to the frontend.

---

## Multi-Brand Isolation

Brand isolation is enforced at multiple layers.

### PostgreSQL RLS

Every brand-owned record contains a `brand_id`. Access is controlled through PostgreSQL Row Level Security and brand membership.

```text
Authenticated User
        ↓
brand_members
        ↓
Allowed brand_id
        ↓
PostgreSQL RLS
        ↓
Brand-owned records
```

### Server-Side Brand Resolution

The AI function receives a conversation ID. It resolves the brand from the conversation instead of trusting a brand ID supplied by the frontend.

```text
conversationId
      ↓
Conversation
      ↓
brand_id
```

### Qdrant Brand Filter

Every Qdrant search applies:

```text
brand_id = conversation.brand_id
```

So an AquaPure conversation only ever sees AquaPure vectors, and a FreshSkin conversation only ever sees FreshSkin vectors. This ensures one brand cannot accidentally access another brand's conversations, data, or knowledge.

---

## Setup & Installation

### Prerequisites

- Node.js (v18 or later recommended)
- npm
- [Supabase CLI](https://supabase.com/docs/guides/cli) (used via `npx supabase`)
- A Supabase project
- A Qdrant Cloud account and cluster
- An OpenRouter API key

### 1. Clone the repository

```bash
git clone https://github.com/Anshu147/AI-Powered-CX-Reply-Assistant.git
cd AI-Powered-CX-Reply-Assistant
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure frontend environment variables

Create `.env.local` in the project root:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
```

Both values are found in the Supabase dashboard under **Project Settings → API**.

### 4. Configure Supabase Edge Function secrets

Create `supabase/functions/.env`:

```env
QDRANT_URL=https://YOUR_QDRANT_CLUSTER_URL
QDRANT_API_KEY=YOUR_QDRANT_API_KEY

OPENROUTER_API_KEY=YOUR_OPENROUTER_API_KEY
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
```

- `OPENROUTER_MODEL` can be any chat model available on OpenRouter; the value above is only an example.
- `OPENROUTER_EMBEDDING_MODEL` must produce **1536-dimension** vectors to match the Qdrant collection below.

> **Never commit this file.**
>
> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically into deployed Supabase Edge Functions, so you do not need to add them here. The service role key must never be exposed in the frontend.

### 5. Link the Supabase project

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

### 6. Create the database schema

The main database entities are:

```text
brands
profiles
brand_members
customers
orders
conversations
messages
knowledge_documents
knowledge_chunks
ai_generations
ai_generation_sources
```

The schema also includes RLS policies and helper functions for brand-level access control.

Apply the schema from the migrations in this repository:

```bash
npx supabase db push
```

> _Note for maintainers: make sure the SQL files live in `supabase/migrations/` (or provide a single `schema.sql`) so this step is reproducible. Update this section with the exact path._

### 7. Configure Qdrant

Create a collection with these settings:

| Setting | Value |
|---|---|
| Collection name | `cx_knowledge` |
| Vector size | `1536` |
| Distance | `Cosine` |

Then create a payload index on `brand_id` with the `keyword` data type.

Example using the Qdrant REST API:

```bash
# Create the collection
curl -X PUT "$QDRANT_URL/collections/cx_knowledge" \
  -H "api-key: $QDRANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vectors": {"size": 1536, "distance": "Cosine"}}'

# Create the brand_id payload index
curl -X PUT "$QDRANT_URL/collections/cx_knowledge/index" \
  -H "api-key: $QDRANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"field_name": "brand_id", "field_schema": "keyword"}'
```

### 8. Deploy Edge Functions

Set the secrets:

```bash
npx supabase secrets set --env-file supabase/functions/.env
```

Deploy the functions:

```bash
npx supabase functions deploy index-knowledge
npx supabase functions deploy generate-reply
```

### 9. Seed demo data and create a test user

Follow [Demo Data & Test Users](#demo-data--test-users) below, then index the knowledge so Qdrant has vectors to search.

### 10. Start the frontend

```bash
npm run dev
```

The application is available at `http://localhost:5173`.

---

## Environment Variables

### Frontend (`.env.local` / Vercel)

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable / anon key |

### Backend / Edge Functions (`supabase/functions/.env`)

| Variable | Description |
|---|---|
| `QDRANT_URL` | Qdrant cluster URL |
| `QDRANT_API_KEY` | Qdrant API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_MODEL` | LLM model identifier (e.g. `anthropic/claude-3.5-sonnet`) |
| `OPENROUTER_EMBEDDING_MODEL` | Embedding model (default: `openai/text-embedding-3-small`, 1536 dimensions) |

Provided automatically by Supabase to deployed Edge Functions:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |

### Security

Never expose these in the frontend:

```text
QDRANT_API_KEY
OPENROUTER_API_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Never commit:

```text
.env
.env.local
supabase/functions/.env
```

---

## Demo Data & Test Users

To try the app you need a seeded database and at least one agent user.

1. **Create an agent user** in the Supabase dashboard under **Authentication → Users → Add user** (email + password).
2. **Seed the demo data** (brands, customers, orders, conversations, knowledge documents) by running the seed script, for example:

   ```bash
   npx supabase db reset   # applies migrations and supabase/seed.sql
   ```

   _Update this command to match the seed file in your repository._
3. **Assign the user to brands** by inserting rows into `brand_members`:

   ```sql
   insert into brand_members (brand_id, user_id)
   select b.id, 'YOUR_AUTH_USER_UUID'
   from brands b
   where b.name in ('AquaPure', 'FreshSkin');
   ```

   Assign only one brand to verify that brand isolation works.
4. **Index the knowledge** so it is searchable. Saving or editing an entry in the Knowledge Base page triggers the `index-knowledge` function; re-save each demo entry once if the seed data was inserted directly into PostgreSQL.

---

## Deployment

### Frontend (Vercel)

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

Set these Vercel environment variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The project uses `vercel.json` to rewrite all routes to `index.html`, so React Router routes keep working on a direct page refresh.

Routes:

```text
/login
/dashboard
/brands/:brandId
/brands/:brandId/knowledge
/conversations/:conversationId
```

### Backend (Supabase Edge Functions)

```text
index-knowledge
generate-reply
```

### Services overview

| Concern | Service |
|---|---|
| Frontend | Vercel |
| Authentication | Supabase Auth |
| Database | Supabase PostgreSQL |
| Backend functions | Supabase Edge Functions |
| Vector search | Qdrant Cloud |
| AI | OpenRouter |

---

## Demo / Examples

The examples below assume these demo policies:

| Brand | Return window |
|---|---|
| AquaPure | 7 days from delivery |
| FreshSkin | 30 days from delivery |

### Example 1: AI-Assisted Reply

**Customer:**

> My order was delivered but the bottle is broken. What can I do?

```text
Customer message
      ↓
AquaPure brand
      ↓
Qdrant retrieval
      ↓
Return Policy + Refund Policy
      ↓
OpenRouter
      ↓
Suggested response
```

The agent can then **Edit**, **Regenerate**, or **Approve & Send**.

### Example 2: Guardrails

AquaPure policy: _returns for damaged products are accepted within 7 days of delivery._

**Customer:**

> I received this order 20 days ago. Can I still get a refund?

The AI should not confidently promise a refund. Instead, it should explain the applicable policy and leave the final decision to the support agent.

### Example 3: Brand-Specific Retrieval

The same question, asked in two different brands:

> I received this order 20 days ago. Can I still get a refund?

```text
AquaPure   → 20 days > 7 days   → Outside the documented return window
FreshSkin  → 20 days <= 30 days → Within the documented return window
```

This demonstrates that knowledge is retrieved using the current conversation's brand.

### Example 4: No Relevant Knowledge

**Customer:**

> Do you offer compensation for inconvenience caused by a damaged order?

If no relevant compensation policy exists in the current brand's knowledge base, the assistant should not invent one. The system falls back to manual review:

```text
I don't have enough information in the current
brand knowledge base to confidently answer this request.
Please review it manually.
```

---

## Known Limitations

- No real messaging channel is connected; conversations are simulated with Customer mode.
- AI replies are returned in a single response (no streaming).
- Knowledge indexing runs synchronously inside an Edge Function (no job queue or retry handling).
- Guardrails are prompt-based; there is no automated grounding check or prompt-injection filtering yet.
- Confidence scoring is not implemented; the fallback depends on retrieval results and model instructions.

---

## Future Improvements

### Communication Channels

Integrate WhatsApp, email, web chat, and other support channels.

### Background Processing

Introduce job queues for knowledge ingestion, embedding generation, bulk document processing, and retry handling.

### AI Reliability

- Automated RAG evaluations
- Grounding checks
- Regression tests
- Better confidence scoring
- Model fallback strategies
- Prompt-injection and PII handling

### AI Cost Optimization

- Token usage tracking
- Cost dashboards
- Prompt-size monitoring
- Response caching
- Model routing
- Per-brand usage limits

### Scalability

- Database read replicas and partitioning
- Background workers
- Retrieval caching
- Rate limiting
- Dedicated ingestion and retrieval services
- Centralized observability

---
