import {

    useEffect,
    useState,
} from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Customer = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
};

type Order = {
    id: string;
    order_number: string;
    product_name: string | null;
    status: string | null;
    delivered_at: string | null;
};

type Message = {
    id: string;
    sender_type:
    | "customer"
    | "agent"
    | "ai"
    | "system";
    content: string;
    created_at: string;
};

type ConversationData = {
    id: string;
    brand_id: string;
    customer_id: string;
    status: string;
    customers: Customer;
};

export const Conversation = () => {
    const { conversationId } = useParams();
    const navigate = useNavigate();

    const [conversation, setConversation] =
        useState<ConversationData | null>(null);

    const [order, setOrder] =
        useState<Order | null>(null);

    const [messages, setMessages] =
        useState<Message[]>([]);

    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(true);
    const [aiLoading, setAiLoading] = useState(false);

    const [aiSuggestion, setAiSuggestion] =
        useState<string | null>(null);
    const [activeGenerationId, setActiveGenerationId] =
        useState<string | null>(null);
    const [aiSources, setAiSources] = useState<
        {
            title: string;
            category: string;
            content: string;
            score: number;
        }[]
    >([]);

    const [aiKnowledgeMatch, setAiKnowledgeMatch] =
        useState<number | null>(null);

    const [aiFallback, setAiFallback] =
        useState(false);
    type ConversationMode = "customer" | "agent";

    const [mode, setMode] =
        useState<ConversationMode>("agent");

    const [customerMessage, setCustomerMessage] =
        useState("");

    const [sendingCustomer, setSendingCustomer] =
        useState(false);
    useEffect(() => {
        if (!conversationId) return;

        loadConversation();
    }, [conversationId]);

    async function loadConversation() {
        setLoading(true);

        const { data: conversationData, error } =
            await supabase
                .from("conversations")
                .select(`
          id,
          brand_id,
          customer_id,
          status,
          customers (
            id,
            name,
            email,
            phone
          )
        `)
                .eq("id", conversationId)
                .single();

        if (error || !conversationData) {
            console.error(error);
            setLoading(false);
            return;
        }

        const customer = Array.isArray(
            conversationData.customers
        )
            ? conversationData.customers[0]
            : conversationData.customers;

        const formattedConversation: ConversationData = {
            id: conversationData.id,
            brand_id: conversationData.brand_id,
            customer_id: conversationData.customer_id,
            status: conversationData.status,
            customers: {
                id: customer?.id ?? "",
                name: customer?.name ?? "Unknown Customer",
                email: customer?.email ?? null,
                phone: customer?.phone ?? null,
            },
        };

        setConversation(formattedConversation);

        const [
            { data: messageData },
            { data: orderData },
        ] = await Promise.all([
            supabase
                .from("messages")
                .select(`
          id,
          sender_type,
          content,
          created_at
        `)
                .eq("conversation_id", conversationId)
                .order("created_at", {
                    ascending: true,
                }),

            supabase
                .from("orders")
                .select(`
          id,
          order_number,
          product_name,
          status,
          delivered_at
        `)
                .eq(
                    "customer_id",
                    conversationData.customer_id
                )
                .order("created_at", {
                    ascending: false,
                })
                .limit(1)
                .maybeSingle(),
        ]);

        setMessages(messageData ?? []);
        setOrder(orderData);

        setLoading(false);
    }
    async function sendCustomerMessage(
        event: FormEvent
    ) {
        event.preventDefault();

        if (
            !conversationId ||
            !customerMessage.trim()
        ) {
            return;
        }

        setSendingCustomer(true);

        const { data, error } = await supabase
            .from("messages")
            .insert({
                conversation_id: conversationId,
                sender_type: "customer",
                content: customerMessage.trim(),
            })
            .select(`
      id,
      sender_type,
      content,
      created_at
    `)
            .single();

        if (error) {
            console.error(error);
            setSendingCustomer(false);
            return;
        }

        setMessages((current) => [
            ...current,
            data as Message,
        ]);

        setCustomerMessage("");
        setSendingCustomer(false);

        // Clear any old AI suggestion because the customer
        // has asked a new question.
        setAiSuggestion(null);
        setAiSources([]);
        setAiKnowledgeMatch(null);
        setAiFallback(false);
        setActiveGenerationId(null);
    }
    async function sendManualReply(
        event: FormEvent
    ) {
        event.preventDefault();

        const trimmedReply = reply.trim();

        if (!trimmedReply || !conversationId) {
            return;
        }

        setSending(true);

        const { data, error } = await supabase
            .from("messages")
            .insert({
                conversation_id: conversationId,
                sender_type: "agent",
                content: trimmedReply,
            })
            .select(`
        id,
        sender_type,
        content,
        created_at
      `)
            .single();

        if (error) {
            console.error(error);
            setSending(false);
            return;
        }

        setMessages((current) => [
            ...current,
            data as Message,
        ]);

        setReply("");
        setSending(false);
    }
    async function generateAIReply() {
        if (!conversationId) return;

        setAiLoading(true);
        setAiSuggestion(null);
        setAiSources([]);
        setAiFallback(false);

        const { data, error } =
            await supabase.functions.invoke(
                "generate-reply",
                {
                    body: {
                        conversationId,
                    },
                }
            );

        if (error) {
            console.error(
                "AI generation failed:",
                error
            );

            alert(
                "Unable to generate AI reply. Check the Edge Function logs."
            );

            setAiLoading(false);
            return;
        }

        if (!data?.success) {
            console.error(data);

            alert(
                data?.message ??
                "AI generation failed."
            );

            setAiLoading(false);
            return;
        }

        setAiSuggestion(data.reply);
        setReply(data.reply);
        setActiveGenerationId(
            data.generationId ?? null
        );
        setAiSources(
            data.sources ?? []
        );

        setAiKnowledgeMatch(
            data.knowledgeMatch ?? 0
        );

        setAiFallback(
            data.fallback ?? false
        );

        setAiLoading(false);
    }
    if (loading) {
        return (
            <div className="page-loading">
                Loading conversation...
            </div>
        );
    }

    if (!conversation) {
        return (
            <div className="page-loading">
                Conversation not found.
            </div>
        );
    }
    async function approveAndSend() {
        if (
            !conversationId ||
            !activeGenerationId ||
            !reply.trim()
        ) {
            return;
        }

        setSending(true);

        const editedResponse = reply.trim();

        const { data: insertedMessage, error: messageError } =
            await supabase
                .from("messages")
                .insert({
                    conversation_id: conversationId,
                    sender_type: "agent",
                    content: editedResponse,
                })
                .select(`
        id,
        sender_type,
        content,
        created_at
      `)
                .single();

        if (messageError) {
            console.error(messageError);
            setSending(false);
            return;
        }

        const { error: generationError } =
            await supabase
                .from("ai_generations")
                .update({
                    agent_edited_response: editedResponse,
                    final_response: editedResponse,
                    status: "sent",
                    approved_at:
                        new Date().toISOString(),
                    sent_at:
                        new Date().toISOString(),
                })
                .eq("id", activeGenerationId)
                .eq("conversation_id", conversationId);

        if (generationError) {
            console.error(generationError);
            setSending(false);
            return;
        }

        setMessages((current) => [
            ...current,
            insertedMessage as Message,
        ]);

        setReply("");
        setAiSuggestion(null);
        setAiSources([]);
        setAiKnowledgeMatch(null);
        setAiFallback(false);
        setActiveGenerationId(null);

        setSending(false);
    }
    return (
        <div className="conversation-page">
            <header className="conversation-header">
                <button
                    className="back-button"
                    onClick={() =>
                        navigate(
                            `/brands/${conversation.brand_id}`
                        )
                    }
                >
                    ← Conversations
                </button>

                <div>
                    <h1>
                        {conversation.customers.name}
                    </h1>

                    <span>
                        {conversation.customers.email}
                    </span>
                </div>
            </header>
            <div className="conversation-mode">
                <button
                    type="button"
                    className={
                        mode === "customer"
                            ? "mode-button active"
                            : "mode-button"
                    }
                    onClick={() => setMode("customer")}
                >
                    Customer
                </button>

                <button
                    type="button"
                    className={
                        mode === "agent"
                            ? "mode-button active"
                            : "mode-button"
                    }
                    onClick={() => setMode("agent")}
                >
                    Agent
                </button>
            </div>
            <div className="conversation-layout">
                {/* LEFT */}
                <section className="chat-panel">
                    <div className="chat-header">
                        <div>
                            <strong>
                                Customer Conversation
                            </strong>

                            <p>
                                {conversation.customers.name}
                            </p>
                        </div>

                        <span className="status open">
                            {conversation.status}
                        </span>
                    </div>

                    <div className="messages">
                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={`message-row ${message.sender_type}`}
                            >
                                <div className="message-bubble">
                                    <div className="message-label">
                                        {message.sender_type ===
                                            "customer" &&
                                            "Customer"}

                                        {message.sender_type ===
                                            "agent" &&
                                            "You"}

                                        {message.sender_type ===
                                            "ai" &&
                                            "AI"}

                                        {message.sender_type ===
                                            "system" &&
                                            "System"}
                                    </div>

                                    <p>{message.content}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    {aiSuggestion && (
                        <div className="ai-result-panel">
                            <div className="ai-result-header">
                                <div>
                                    <strong>
                                        AI Suggested Reply
                                    </strong>

                                    {aiFallback ? (
                                        <span className="ai-warning">
                                            Manual review required
                                        </span>
                                    ) : aiKnowledgeMatch !== null ? (
                                        <span className="ai-match">
                                            Knowledge match:{" "}
                                            {Math.round(
                                                aiKnowledgeMatch * 100
                                            )}
                                            %
                                        </span>
                                    ) : null}
                                </div>

                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={generateAIReply}
                                    disabled={aiLoading}
                                >
                                    Regenerate
                                </button>
                            </div>

                            <div className="ai-suggestion">
                                {aiSuggestion}
                            </div>

                            {aiSources.length > 0 && (
                                <div className="ai-sources">
                                    <h4>
                                        Knowledge used
                                    </h4>

                                    {aiSources.map(
                                        (source, index) => (
                                            <div
                                                key={`${source.title}-${index}`}
                                                className="source-card"
                                            >
                                                <strong>
                                                    {source.title}
                                                </strong>

                                                <span>
                                                    {source.category}
                                                </span>

                                                <p>
                                                    {source.content}
                                                </p>
                                            </div>
                                        )
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {mode === "customer" ? (
                        <form
                            onSubmit={sendCustomerMessage}
                            className="reply-box"
                        >
                            <div className="reply-mode customer-mode">
                                Customer mode
                            </div>

                            <textarea
                                value={customerMessage}
                                onChange={(e) =>
                                    setCustomerMessage(e.target.value)
                                }
                                placeholder="Type a new customer message..."
                                rows={4}
                            />

                            <div className="reply-actions">
                                <button
                                    type="submit"
                                    className="primary-button"
                                    disabled={
                                        sendingCustomer ||
                                        !customerMessage.trim()
                                    }
                                >
                                    {sendingCustomer
                                        ? "Sending..."
                                        : "Send as Customer"}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <form
                            onSubmit={sendManualReply}
                            className="reply-box"
                        >
                            {aiSuggestion ? (
                                <div className="reply-mode ai-mode">
                                    AI-assisted response — review before sending
                                </div>
                            ) : (
                                <div className="reply-mode manual-mode">
                                    Manual response
                                </div>
                            )}

                            <textarea
                                value={reply}
                                onChange={(e) =>
                                    setReply(e.target.value)
                                }
                                placeholder="Type your reply..."
                                rows={4}
                            />

                            <div className="reply-actions">
                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={generateAIReply}
                                    disabled={aiLoading || sending}
                                >
                                    {aiLoading
                                        ? "Generating..."
                                        : "Generate AI Reply"}
                                </button>

                                {aiSuggestion ? (
                                    <button
                                        type="button"
                                        className="primary-button"
                                        onClick={approveAndSend}
                                        disabled={
                                            sending ||
                                            !reply.trim() ||
                                            aiFallback
                                        }
                                    >
                                        {sending
                                            ? "Sending..."
                                            : "Approve & Send"}
                                    </button>
                                ) : (
                                    <button
                                        type="submit"
                                        className="primary-button"
                                        disabled={
                                            sending ||
                                            !reply.trim()
                                        }
                                    >
                                        {sending
                                            ? "Sending..."
                                            : "Send"}
                                    </button>
                                )}
                            </div>
                        </form>
                    )}
                </section>

                {/* RIGHT */}
                <aside className="customer-panel">
                    <div className="panel-section">
                        <h3>Customer</h3>

                        <p>
                            <strong>
                                {conversation.customers.name}
                            </strong>
                        </p>

                        <p>
                            {conversation.customers.email}
                        </p>

                        <p>
                            {conversation.customers.phone}
                        </p>
                    </div>

                    <div className="panel-section">
                        <h3>Order</h3>

                        {order ? (
                            <>
                                <p>
                                    <strong>
                                        #{order.order_number}
                                    </strong>
                                </p>

                                <p>
                                    {order.product_name}
                                </p>

                                <p>
                                    Status:{" "}
                                    <strong>
                                        {order.status}
                                    </strong>
                                </p>

                                {order.delivered_at && (
                                    <p>
                                        Delivered:{" "}
                                        {new Date(
                                            order.delivered_at
                                        ).toLocaleDateString()}
                                    </p>
                                )}
                            </>
                        ) : (
                            <p>No order found.</p>
                        )}
                    </div>

                    <div className="panel-section">
                        <h3>Brand</h3>

                        <p>
                            This conversation is securely
                            scoped to its brand.
                        </p>
                    </div>
                </aside>
            </div>
        </div>
    );
}

export default Conversation;