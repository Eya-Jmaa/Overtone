// frontend/src/pages/OAuthSuccess.jsx
// REPLACE ENTIRELY

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore.js";
import * as authApi from "../services/authApi.js";

export default function OAuthSuccess() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    const run = async () => {
      // 1. Extract access token from URL hash
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      const token = params.get("token");

      if (!token) {
        navigate("/login?oauth_error=no_token", { replace: true });
        return;
      }

      // 2. Fetch the actual user profile using the token
      //    This replaces the old { id: "_pending" } placeholder
      let user;
      try {
        user = await authApi.getMe(token);
      } catch {
        // If /me fails, still set the session with minimal info
        // — the bootstrap will fix it on next page load
        user = { id: "_unknown", email: "", name: "" };
      }

      // 3. Set the full session and navigate
      setSession({ user, accessToken: token });
      window.history.replaceState({}, "", "/app");
      navigate("/app", { replace: true });
    };

    run();
  }, [navigate, setSession]);

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
      Completing sign-in…
    </div>
  );
}