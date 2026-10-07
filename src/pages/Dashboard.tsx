import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";

type Brand = {
    id: string;
    name: string;
    slug: string;
};
export const Dashboard = () => {
    const { user, signOut } = useAuth();

    const [brands, setBrands] = useState<Brand[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        loadBrands();
    }, [user]);

    async function loadBrands() {
        const { data, error } = await supabase
            .from("brand_members")
            .select(
                `
        brand_id,
        brands (
          id,
          name,
          slug
        )
        `
            )
            .eq("user_id", user?.id);

        if (error) {
            console.error(error);
            setLoading(false);
            return;
        }

        const formattedBrands =
            data
                ?.map((item: any) => item.brands)
                .filter(Boolean) ?? [];

        setBrands(formattedBrands);
        setLoading(false);
    }

    return (
        <div className="dashboard">
            <header className="dashboard-header">
                <div>
                    <h1>CX Reply Assistant</h1>

                    <p>
                        {user?.email}
                    </p>
                </div>

                <button onClick={signOut}>
                    Sign out
                </button>
            </header>

            <main className="dashboard-content">
                <h2>Your Brands</h2>

                {loading && (
                    <p>Loading brands...</p>
                )}

                {!loading && brands.length === 0 && (
                    <div>
                        <p>
                            You are not assigned to any brand yet.
                        </p>

                        <p>
                            Add your user to the brand_members
                            table in Supabase.
                        </p>
                    </div>
                )}

                <div className="brand-grid">
                    {brands.map((brand) => (
                        <div
                            key={brand.id}
                            className="brand-card"
                        >
                            <h3>{brand.name}</h3>

                            <p>
                                Manage conversations and
                                customer support.
                            </p>

                            <Link
                                to={`/brands/${brand.id}`}
                                className="workspace-button"
                            >
                                Open Workspace
                            </Link>
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
}

export default Dashboard;