// frontend/src/App.jsx
// REPLACE ENTIRELY

import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.jsx";
import { useAuthStore } from "./stores/authStore.js";
import { useThemeStore } from "./stores/themeStore.js";

function BootstrapLoader() {
  // Full-screen loader shown while checking if the user has a valid session
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--ink)",
      color: "var(--bone-dim)",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      letterSpacing: 1.5,
      textTransform: "uppercase",
    }}>
      Restoring session…
    </div>
  );
}

export default function App() {
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const initTheme = useThemeStore((s) => s.init);

  useEffect(() => {
    bootstrap();
    initTheme();
  }, [bootstrap, initTheme]);

  // While bootstrap is running, show a loading screen instead of
  // flashing the login page and then redirecting to /app
  if (isBootstrapping) return <BootstrapLoader />;

  return <RouterProvider router={router} />;
}