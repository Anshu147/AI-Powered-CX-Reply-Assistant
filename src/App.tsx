import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Workspace from "./pages/Workspace";
import Conversation from "./pages/Conversation";
import KnowledgeBase from "./pages/KnowledgeBase";


function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={<Login />}
        />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={
            <Navigate
              to="/dashboard"
              replace
            />
          }
        />
        <Route
          path="/brands/:brandId"
          element={
            <ProtectedRoute>
              <Workspace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/conversations/:conversationId"
          element={
            <ProtectedRoute>
              <Conversation />
            </ProtectedRoute>
          }
        />
        <Route
          path="/brands/:brandId/knowledge"
          element={
            <ProtectedRoute>
              <KnowledgeBase />
            </ProtectedRoute>
          }
        />
      </Routes></BrowserRouter>
  );
}