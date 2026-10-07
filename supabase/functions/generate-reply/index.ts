import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const QDRANT_COLLECTION = "cx_knowledge";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const DEFAULT_LLM_MODEL = "~openai/gpt-latest";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

const supabaseKey =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;

const qdrantUrl = Deno.env.get("QDRANT_URL")!;
const qdrantApiKey = Deno.env.get("QDRANT_API_KEY")!;
const openRouterApiKey =
  Deno.env.get("OPENROUTER_API_KEY")!;

const llmModel =
  Deno.env.get("OPENROUTER_MODEL") ??
  DEFAULT_LLM_MODEL;

const MIN_RELEVANCE_SCORE = 0.30
const MAX_SOURCES = 4;
const MAX_HISTORY_MESSAGES = 8;

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

async function createEmbedding(
  text: string
): Promise<number[]> {
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
        input: text,
        encoding_format: "float",
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Embedding request failed: ${response.status} ${errorText}`
    );
  }

  const result = await response.json();

  const embedding =
    result?.data?.[0]?.embedding;

  if (!embedding) {
    throw new Error(
      "Embedding response did not contain a vector"
    );
  }

  return embedding;
}

async function searchQdrant(
  vector: number[],
  brandId: string
) {
  const response = await fetch(
    `${qdrantUrl}/collections/${QDRANT_COLLECTION}/points/query`,
    {
      method: "POST",
      headers: {
        "api-key": qdrantApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: vector,

        filter: {
          must: [
            {
              key: "brand_id",
              match: {
                value: brandId,
              },
            },
          ],
        },

        limit: MAX_SOURCES,

        with_payload: true,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Qdrant search failed: ${response.status} ${errorText}`
    );
  }

  const result = await response.json();

  return result?.result?.points ?? [];
}

async function generateWithLLM({
  brandName,
  customerName,
  order,
  customerMessage,
  history,
  sources,
}: {
  brandName: string;
  customerName: string;
  order: {
    order_number: string;
    product_name: string | null;
    status: string | null;
    delivered_at: string | null;
  } | null;
  customerMessage: string;
  history: {
    sender_type: string;
    content: string;
  }[];
  sources: {
    title: string;
    category: string;
    content: string;
    score: number;
  }[];
}) {
  const sourceContext = sources
    .map(
      (source, index) =>
        `[Source ${index + 1}]
Title: ${source.title}
Category: ${source.category}
Content: ${source.content}`
    )
    .join("\n\n");

  const conversationHistory = history
    .map(
      (message) =>
        `${message.sender_type.toUpperCase()}: ${message.content}`
    )
    .join("\n");

  const orderContext = order
    ? `
Order Number: ${order.order_number}
Product: ${order.product_name ?? "Unknown"}
Status: ${order.status ?? "Unknown"}
Delivered At: ${order.delivered_at ?? "Unknown"
    }
`
    : "No order information available.";

  const systemPrompt = `
You are an AI customer-support reply assistant for the brand "${brandName}".

Your job is to draft a helpful response for a human support agent.

STRICT RULES:

1. Use only the provided brand knowledge.
2. Never invent a refund, return, shipping, cancellation,
   compensation, warranty, or other policy.
3. Do not use knowledge from outside the supplied sources.
4. If the sources do not contain enough information,
   clearly say that the information is unavailable.
5. Do not promise an outcome that is not supported by the sources.
6. The response should be polite, concise, and customer-friendly.
7. You are drafting a response for an AGENT, not directly
   communicating as an autonomous support bot.
8. Do not mention "RAG", "Qdrant", "embedding", "source",
   "system prompt", or internal implementation details.
9. If the customer is asking about something outside the available
   knowledge, recommend manual review rather than inventing an answer.

Return only the suggested customer-facing reply.
`;

  const userPrompt = `
Customer:
${customerName}

Order:
${orderContext}

Recent conversation:
${conversationHistory}

Latest customer message:
${customerMessage}

Brand knowledge:
${sourceContext}
`;

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: llmModel,

        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],

        temperature: 0.2,
        max_completion_tokens: 300,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `LLM request failed: ${response.status} ${errorText}`
    );
  }

  const result = await response.json();

  const reply =
    result?.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    throw new Error(
      "LLM response did not contain text"
    );
  }

  return {
    reply,
    model:
      result?.model ?? llmModel,
    usage:
      result?.usage ?? null,
  };
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

    // ----------------------------------------
    // 1. Authenticate
    // ----------------------------------------

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

    const conversationId =
      body?.conversationId;

    if (!conversationId) {
      return Response.json(
        {
          success: false,
          message:
            "conversationId is required",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // ----------------------------------------
    // 2. Load conversation
    // RLS ensures the user can only access
    // conversations from brands they belong to.
    // ----------------------------------------

    const {
      data: conversation,
      error: conversationError,
    } = await supabase
      .from("conversations")
      .select(`
        id,
        brand_id,
        customer_id,
        customers (
          id,
          name,
          email,
          phone
        )
      `)
      .eq("id", conversationId)
      .single();

    if (
      conversationError ||
      !conversation
    ) {
      return Response.json(
        {
          success: false,
          message:
            "Conversation not found or access denied",
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // ----------------------------------------
    // 3. Load brand
    // ----------------------------------------

    const {
      data: brand,
      error: brandError,
    } = await supabase
      .from("brands")
      .select("id, name")
      .eq("id", conversation.brand_id)
      .single();

    if (brandError || !brand) {
      throw new Error(
        "Brand not found"
      );
    }

    // ----------------------------------------
    // 4. Load latest customer message
    // ----------------------------------------

    const {
      data: customerMessages,
      error: customerMessageError,
    } = await supabase
      .from("messages")
      .select(`
        id,
        sender_type,
        content,
        created_at
      `)
      .eq(
        "conversation_id",
        conversationId
      )
      .eq(
        "sender_type",
        "customer"
      )
      .order("created_at", {
        ascending: false,
      })
      .limit(1);

    if (customerMessageError) {
      throw new Error(
        customerMessageError.message
      );
    }

    const latestCustomerMessage =
      customerMessages?.[0];

    if (!latestCustomerMessage) {
      return Response.json(
        {
          success: false,
          message:
            "No customer message found",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // ----------------------------------------
    // 5. Recent conversation history
    // ----------------------------------------

    const {
      data: recentMessages,
    } = await supabase
      .from("messages")
      .select(
        "sender_type, content, created_at"
      )
      .eq(
        "conversation_id",
        conversationId
      )
      .order("created_at", {
        ascending: false,
      })
      .limit(MAX_HISTORY_MESSAGES);

    const history = [
      ...(recentMessages ?? []),
    ].reverse();

    // ----------------------------------------
    // 6. Order information
    // ----------------------------------------

    const {
      data: order,
    } = await supabase
      .from("orders")
      .select(`
        order_number,
        product_name,
        status,
        delivered_at
      `)
      .eq(
        "customer_id",
        conversation.customer_id
      )
      .eq(
        "brand_id",
        conversation.brand_id
      )
      .order("created_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    // ----------------------------------------
    // 7. Create question embedding
    // ----------------------------------------

    const queryVector =
      await createEmbedding(
        latestCustomerMessage.content
      );

    // ----------------------------------------
    // 8. Search Qdrant
    // IMPORTANT:
    // brand_id is a hard filter.
    // ----------------------------------------

    const searchResults =
      await searchQdrant(
        queryVector,
        conversation.brand_id
      );
   
    const usableResults =
      searchResults
        .filter(
          (point: any) =>
            typeof point.score === "number" &&
            point.score >= MIN_RELEVANCE_SCORE &&
            point.payload
        )
        .sort(
          (a: any, b: any) =>
            b.score - a.score
        )
        .slice(0, 3);
    // ----------------------------------------
    // 9. Fallback if KB doesn't contain
    // enough relevant information.
    // ----------------------------------------

    if (usableResults.length === 0) {
      const fallbackText =
        "I don't have enough information in the current brand knowledge base to confidently answer this request. Please review it manually.";

      const {
        data: generation,
        error: generationError,
      } = await supabase
        .from("ai_generations")
        .insert({
          conversation_id: conversationId,
          message_id:
            latestCustomerMessage.id,
          brand_id:
            conversation.brand_id,
          input_message:
            latestCustomerMessage.content,
          generated_response:
            fallbackText,
          model: llmModel,
          status: "fallback",
          confidence: 0,
        })
        .select("id")
        .single();

      if (generationError) {
        throw new Error(
          generationError.message
        );
      }

      return Response.json(
        {
          success: true,
          fallback: true,
          generationId:
            generation.id,
          reply: fallbackText,
          sources: [],
          knowledgeMatch: 0,
        },
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    }

    // ----------------------------------------
    // 10. Convert Qdrant payloads
    // ----------------------------------------

    const sources =
      usableResults
        .slice(0, MAX_SOURCES)
        .map((point: any) => ({
          title:
            point.payload.title ?? "Untitled",
          category:
            point.payload.category ?? "other",
          content:
            point.payload.content ?? "",
          score:
            Number(point.score ?? 0),
          documentId:
            point.payload.document_id,
          chunkId:
            point.payload.chunk_id,
        }));

    const knowledgeMatch =
      Math.max(
        0,
        Math.min(
          1,
          Number(sources[0]?.score ?? 0)
        )
      );

    // ----------------------------------------
    // 11. Generate LLM response
    // ----------------------------------------

    const {
      reply,
      model,
      usage,
    } =
      await generateWithLLM({
        brandName: brand.name,
        customerName:
          conversation.customers.name,
        order,
        customerMessage:
          latestCustomerMessage.content,
        history,
        sources,
      });

    // ----------------------------------------
    // 12. Save AI generation
    // ----------------------------------------

    const {
      data: generation,
      error: generationError,
    } = await supabase
      .from("ai_generations")
      .insert({
        conversation_id: conversationId,
        message_id:
          latestCustomerMessage.id,
        brand_id:
          conversation.brand_id,
        input_message:
          latestCustomerMessage.content,
        generated_response: reply,
        model,
        status: "generated",
        confidence: knowledgeMatch,
      })
      .select("id")
      .single();

    if (generationError) {
      throw new Error(
        generationError.message
      );
    }

    // ----------------------------------------
    // 13. Save retrieved sources
    // ----------------------------------------

    const sourceRows =
      sources.map((source) => ({
        ai_generation_id:
          generation.id,
        knowledge_document_id:
          source.documentId,
        knowledge_chunk_id:
          source.chunkId,
        relevance_score:
          source.score,
      }));

    if (sourceRows.length > 0) {
      const {
        error: sourceError,
      } = await supabase
        .from(
          "ai_generation_sources"
        )
        .insert(sourceRows);

      if (sourceError) {
        console.error(
          "Source logging failed:",
          sourceError
        );
      }
    }

    return Response.json(
      {
        success: true,
        fallback: false,
        generationId:
          generation.id,
        reply,
        sources,
        knowledgeMatch,
        model,
        usage,
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