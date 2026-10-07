import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const QDRANT_COLLECTION = "cx_knowledge";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

const supabaseKey =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;

const qdrantUrl = Deno.env.get("QDRANT_URL")!;
const qdrantApiKey = Deno.env.get("QDRANT_API_KEY")!;
const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY")!;

if (!qdrantUrl || !qdrantApiKey || !openRouterApiKey) {
  throw new Error("Missing required environment variables");
}

type KnowledgeDocument = {
  id: string;
  brand_id: string;
  title: string;
  category: string;
  content: string;
};

type Chunk = {
  id: string;
  content: string;
  chunkIndex: number;
};

function getSupabaseClient(req: Request) {
  const authorization =
    req.headers.get("Authorization");

  if (!authorization) {
    throw new Error("Missing Authorization header");
  }

  return createClient(
    supabaseUrl,
    supabaseKey,
    {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    }
  );
}

function splitIntoChunks(
  text: string,
  chunkSize = 700,
  overlap = 100
): Chunk[] {
  const normalized = text
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  const chunks: Chunk[] = [];

  let start = 0;
  let chunkIndex = 0;

  while (start < normalized.length) {
    const end = Math.min(
      start + chunkSize,
      normalized.length
    );

    const content = normalized
      .slice(start, end)
      .trim();

    if (content) {
      chunks.push({
        id: crypto.randomUUID(),
        content,
        chunkIndex,
      });
    }

    if (end >= normalized.length) {
      break;
    }

    start = end - overlap;
    chunkIndex++;
  }

  return chunks;
}

async function createEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const response = await fetch(
    "https://openrouter.ai/api/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
        encoding_format: "float",
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Embedding API failed: ${response.status} ${errorText}`
    );
  }

  const result = await response.json();

  return result.data
    .sort(
      (a: { index: number }, b: { index: number }) =>
        a.index - b.index
    )
    .map(
      (item: { embedding: number[] }) =>
        item.embedding
    );
}

async function upsertToQdrant(
  points: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }>
) {
  const response = await fetch(
    `${qdrantUrl}/collections/${QDRANT_COLLECTION}/points`,
    {
      method: "PUT",
      headers: {
        "api-key": qdrantApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        points,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Qdrant upsert failed: ${response.status} ${errorText}`
    );
  }

  return response.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const supabase =
      getSupabaseClient(req);

    const {
      data: {
        user,
      },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json(
        {
          success: false,
          message: "Unauthorized",
        },
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }

    const body = await req.json();

    const documentId =
      body?.documentId;

    if (!documentId) {
      return Response.json(
        {
          success: false,
          message: "documentId is required",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // -----------------------------------------
    // 1. Load document using RLS
    // -----------------------------------------

    const {
      data: document,
      error: documentError,
    } = await supabase
      .from("knowledge_documents")
      .select(
        "id, brand_id, title, category, content"
      )
      .eq("id", documentId)
      .single();

    if (documentError || !document) {
      return Response.json(
        {
          success: false,
          message:
            "Knowledge document not found or access denied",
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    const typedDocument =
      document as KnowledgeDocument;

    // -----------------------------------------
    // 2. Split into chunks
    // -----------------------------------------

    const chunks = splitIntoChunks(
      typedDocument.content
    );

    if (chunks.length === 0) {
      return Response.json(
        {
          success: false,
          message:
            "Knowledge document has no content",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // -----------------------------------------
    // 3. Create embeddings
    // -----------------------------------------

    const embeddings =
      await createEmbeddings(
        chunks.map((chunk) => chunk.content)
      );

    if (embeddings.length !== chunks.length) {
      throw new Error(
        "Embedding count does not match chunk count"
      );
    }

    // -----------------------------------------
    // 4. Remove old chunks
    // -----------------------------------------

    const {
      error: deleteError,
    } = await supabase
      .from("knowledge_chunks")
      .delete()
      .eq(
        "document_id",
        typedDocument.id
      );

    if (deleteError) {
      throw new Error(
        `Failed to remove old chunks: ${deleteError.message}`
      );
    }

    // -----------------------------------------
    // 5. Insert new chunks into PostgreSQL
    // -----------------------------------------

    const chunkRows = chunks.map(
      (chunk) => ({
        id: chunk.id,
        document_id: typedDocument.id,
        brand_id: typedDocument.brand_id,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        qdrant_point_id: chunk.id,
      })
    );

    const {
      error: insertError,
    } = await supabase
      .from("knowledge_chunks")
      .insert(chunkRows);

    if (insertError) {
      throw new Error(
        `Failed to save chunks: ${insertError.message}`
      );
    }

    // -----------------------------------------
    // 6. Upsert vectors into Qdrant
    // -----------------------------------------

    const points = chunks.map(
      (chunk, index) => ({
        id: chunk.id,
        vector: embeddings[index],
        payload: {
          brand_id:
            typedDocument.brand_id,

          document_id:
            typedDocument.id,

          chunk_id: chunk.id,

          title:
            typedDocument.title,

          category:
            typedDocument.category,

          content:
            chunk.content,
        },
      })
    );

    await upsertToQdrant(points);

    return Response.json(
      {
        success: true,
        message:
          "Knowledge indexed successfully",
        documentId:
          typedDocument.id,
        brandId:
          typedDocument.brand_id,
        chunksIndexed: chunks.length,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    console.error(error);

    return Response.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Internal server error",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});