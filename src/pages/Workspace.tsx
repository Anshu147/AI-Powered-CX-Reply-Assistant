import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Conversation = {
  id: string;
  status: "open" | "closed";
  updated_at: string;
  customers: {
    name: string;
    email: string | null;
  };
};

export const Workspace = () => {
  const { brandId } = useParams();
  const navigate = useNavigate();

  const [brandName, setBrandName] = useState("");
  const [conversations, setConversations] = useState<
    Conversation[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!brandId) return;

    loadWorkspace();
  }, [brandId]);

  async function loadWorkspace() {
    setLoading(true);

    const [
      { data: brand },
      { data: conversationData, error },
    ] = await Promise.all([
      supabase
        .from("brands")
        .select("name")
        .eq("id", brandId)
        .single(),

      supabase
        .from("conversations")
        .select(`
          id,
          status,
          updated_at,
          customers (
            name,
            email
          )
        `)
        .eq("brand_id", brandId)
        .order("updated_at", {
          ascending: false,
        }),
    ]);

    if (brand) {
      setBrandName(brand.name);
    }

    if (error) {
      console.error(error);
    }

    const formattedConversations: Conversation[] =
      (conversationData ?? []).map((conversation: any) => {
        const customer = Array.isArray(
          conversation.customers
        )
          ? conversation.customers[0]
          : conversation.customers;

        return {
          id: conversation.id,
          status: conversation.status,
          updated_at: conversation.updated_at,
          customers: {
            name: customer?.name ?? "Unknown Customer",
            email: customer?.email ?? null,
          },
        };
      });

    setConversations(formattedConversations);

    setLoading(false);
  }

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  return (
    <div className="workspace">
      <header className="workspace-header">
        <div>
          <button
            className="back-button"
            onClick={() => navigate("/dashboard")}
          >
            ← Back
          </button>

          <h1>{brandName}</h1>
          <p>Customer conversations</p>
        </div>
        <button
          className="secondary-button"
          onClick={() =>
            navigate(`/brands/${brandId}/knowledge`)
          }
        >
          Knowledge Base
        </button>
      </header>

      <main className="conversation-list">
        {conversations.length === 0 ? (
          <div className="empty-state">
            No conversations found.
          </div>
        ) : (
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              className="conversation-card"
              onClick={() =>
                navigate(
                  `/conversations/${conversation.id}`
                )
              }
            >
              <div className="conversation-avatar">
                {conversation.customers.name
                  .charAt(0)
                  .toUpperCase()}
              </div>

              <div className="conversation-info">
                <div className="conversation-top">
                  <strong>
                    {conversation.customers.name}
                  </strong>

                  <span
                    className={`status ${conversation.status}`}
                  >
                    {conversation.status}
                  </span>
                </div>

                <span>
                  {conversation.customers.email}
                </span>
              </div>

              <span className="conversation-arrow">
                →
              </span>
            </button>
          ))
        )}
      </main>
    </div>
  );
}

export default Workspace;