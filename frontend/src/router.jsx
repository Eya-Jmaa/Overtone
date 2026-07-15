import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import AppLayout from "./layouts/AppLayout.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import OAuthSuccess from "./pages/OAuthSuccess.jsx";
import ConversationPage from "./pages/ConversationPage.jsx";
import NewConversationPage from "./pages/NewConversationPage.jsx";
import ReportPage from "./pages/ReportPage.jsx";
import { useAuthStore } from "./stores/authStore.js";

function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);

  if (isBootstrapping) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--ink)",
          color: "var(--bone-faint)",
          fontSize: 13,
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 1,
        }}
      >
        Restoring session…
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function EmptyState() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        color: "var(--bone-faint)",
      }}
    >
      <span
        style={{
          fontFamily: "'Fraunces', serif",
          fontSize: 20,
          color: "var(--bone-dim)",
          letterSpacing: -0.3,
        }}
      >
        coach.
      </span>
      <span style={{ fontSize: 13 }}>
        Select a conversation or start a new one
      </span>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/register", element: <Register /> },
  { path: "/oauth-success", element: <OAuthSuccess /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: "/app",
        element: <AppLayout />,
        children: [
          { index: true, element: <NewConversationPage /> },
          { path: "new", element: <NewConversationPage /> },
          { path: ":id", element: <ConversationPage /> },
        ],
      },
      { path: "/report/:id", element: <ReportPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/login" replace /> },
]);