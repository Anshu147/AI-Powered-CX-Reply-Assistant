import {
    FormEvent,
    useEffect,
    useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type KnowledgeDocument = {
    id: string;
    title: string;
    category:
    | "return"
    | "refund"
    | "shipping"
    | "cancellation"
    | "other";
    content: string;
    updated_at: string;
};

const categories = [
    "return",
    "refund",
    "shipping",
    "cancellation",
    "other",
] as const;

export const KnowledgeBase = () => {
    const { brandId } = useParams();
    const navigate = useNavigate();

    const [brandName, setBrandName] = useState("");
    const [documents, setDocuments] = useState<
        KnowledgeDocument[]
    >([]);

    const [loading, setLoading] = useState(true);

    const [showForm, setShowForm] =
        useState(false);

    const [editingId, setEditingId] =
        useState<string | null>(null);

    const [title, setTitle] = useState("");
    const [category, setCategory] =
        useState<KnowledgeDocument["category"]>("return");
    const [content, setContent] = useState("");

    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!brandId) return;

        loadData();
    }, [brandId]);

    async function loadData() {
        if (!brandId) return;

        setLoading(true);

        const [
            { data: brand },
            { data: docs, error },
        ] = await Promise.all([
            supabase
                .from("brands")
                .select("name")
                .eq("id", brandId)
                .single(),

            supabase
                .from("knowledge_documents")
                .select(`
          id,
          title,
          category,
          content,
          updated_at
        `)
                .eq("brand_id", brandId)
                .order("created_at", {
                    ascending: true,
                }),
        ]);

        if (brand) {
            setBrandName(brand.name);
        }

        if (error) {
            console.error(error);
        }

        setDocuments(
            (docs ?? []) as KnowledgeDocument[]
        );

        setLoading(false);
    }

    function resetForm() {
        setEditingId(null);
        setTitle("");
        setCategory("return");
        setContent("");
        setShowForm(false);
    }

    function startEdit(
        document: KnowledgeDocument
    ) {
        setEditingId(document.id);
        setTitle(document.title);
        setCategory(document.category);
        setContent(document.content);
        setShowForm(true);
    }

    async function saveDocument(
        event: FormEvent
    ) {
        event.preventDefault();

        if (!brandId || !title.trim() || !content.trim()) {
            return;
        }

        setSaving(true);

        if (editingId) {
            const { error } = await supabase
                .from("knowledge_documents")
                .update({
                    title: title.trim(),
                    category,
                    content: content.trim(),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", editingId)
                .eq("brand_id", brandId);
            if (error) {
                console.error(error);
                setSaving(false);
                return;
            }
        
            const { error: indexError } =
                await supabase.functions.invoke(
                    "index-knowledge",
                    {
                        body: {
                            documentId: editingId,
                        },
                    }
                );

            if (indexError) {
                console.error(
                    "Knowledge re-indexing failed:",
                    indexError
                );

                alert(
                    "Policy updated, but AI indexing failed. Check the Edge Function logs."
                );
            }
        } else {
            const { data, error } = await supabase
                .from("knowledge_documents")
                .insert({
                    brand_id: brandId,
                    title: title.trim(),
                    category,
                    content: content.trim(),
                })
                .select("id")
                .single();

            if (error || !data) {
                console.error(error);
                setSaving(false);
                return;
            }

            const { error: indexError } =
                await supabase.functions.invoke(
                    "index-knowledge",
                    {
                        body: {
                            documentId: data.id,
                        },
                    }
                );

            if (indexError) {
                console.error(
                    "Knowledge indexing failed:",
                    indexError
                );

                alert(
                    "Policy saved, but AI indexing failed. Check the Edge Function logs."
                );
            }
        }

        await loadData();
        resetForm();
        setSaving(false);
    }

    async function deleteDocument(
        documentId: string
    ) {
        const confirmed = window.confirm(
            "Delete this knowledge entry?"
        );

        if (!confirmed || !brandId) {
            return;
        }

        const { error } = await supabase
            .from("knowledge_documents")
            .delete()
            .eq("id", documentId)
            .eq("brand_id", brandId);

        if (error) {
            console.error(error);
            return;
        }

        await loadData();
    }

    if (loading) {
        return (
            <div className="page-loading">
                Loading knowledge base...
            </div>
        );
    }

    return (
        <div className="knowledge-page">
            <header className="workspace-header">
                <div>
                    <button
                        className="back-button"
                        onClick={() =>
                            navigate(`/brands/${brandId}`)
                        }
                    >
                        ← Workspace
                    </button>

                    <h1>{brandName} Knowledge Base</h1>

                    <p>
                        Policies and information used by the AI
                        assistant.
                    </p>
                </div>

                <button
                    className="primary-button"
                    onClick={() => {
                        resetForm();
                        setShowForm(true);
                    }}
                >
                    + Add Knowledge
                </button>
            </header>

            <main className="knowledge-content">
                {showForm && (
                    <form
                        className="knowledge-form"
                        onSubmit={saveDocument}
                    >
                        <h2>
                            {editingId
                                ? "Edit Knowledge"
                                : "Add Knowledge"}
                        </h2>

                        <label>
                            Title
                            <input
                                value={title}
                                onChange={(e) =>
                                    setTitle(e.target.value)
                                }
                                placeholder="Return Policy"
                                required
                            />
                        </label>

                        <label>
                            Category
                            <select
                                value={category}
                                onChange={(e) =>
                                    setCategory(
                                        e.target.value as KnowledgeDocument["category"]
                                    )
                                }
                            >
                                {categories.map((item) => (
                                    <option
                                        value={item}
                                        key={item}
                                    >
                                        {item.charAt(0).toUpperCase() +
                                            item.slice(1)}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label>
                            Policy / Content
                            <textarea
                                rows={8}
                                value={content}
                                onChange={(e) =>
                                    setContent(e.target.value)
                                }
                                placeholder="Enter the policy or brand information..."
                                required
                            />
                        </label>

                        <div className="reply-actions">
                            <button
                                type="button"
                                className="secondary-button"
                                onClick={resetForm}
                            >
                                Cancel
                            </button>

                            <button
                                type="submit"
                                className="primary-button"
                                disabled={saving}
                            >
                                {saving
                                    ? "Saving..."
                                    : editingId
                                        ? "Update"
                                        : "Create"}
                            </button>
                        </div>
                    </form>
                )}

                <div className="knowledge-list">
                    {documents.map((document) => (
                        <article
                            className="knowledge-card"
                            key={document.id}
                        >
                            <div className="knowledge-card-header">
                                <div>
                                    <span className="knowledge-category">
                                        {document.category}
                                    </span>

                                    <h2>{document.title}</h2>
                                </div>

                                <div>
                                    <button
                                        className="secondary-button"
                                        onClick={() =>
                                            startEdit(document)
                                        }
                                    >
                                        Edit
                                    </button>

                                    <button
                                        className="danger-button"
                                        onClick={() =>
                                            deleteDocument(document.id)
                                        }
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>

                            <p>{document.content}</p>
                        </article>
                    ))}

                    {documents.length === 0 && (
                        <div className="empty-state">
                            No knowledge entries yet.
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default KnowledgeBase;