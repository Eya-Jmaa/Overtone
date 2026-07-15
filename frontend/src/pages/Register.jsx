import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore.js";
import * as authApi from "../services/authApi.js";
import AuthCard from "../components/auth/AuthCard.jsx";
import FieldInput from "../components/auth/FieldInput.jsx";
import CodeInput from "../components/auth/CodeInput.jsx";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C41.4 35.2 44 30 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

export default function Register() {
  const navigate = useNavigate();
  const { accessToken, setSession } = useAuthStore();

  const [step, setStep] = useState(1); // 1: email, 2: code, 3: name+password
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [signupToken, setSignupToken] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (accessToken) navigate("/app", { replace: true });
  }, [accessToken, navigate]);

  // Resend cooldown ticker
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleGoogle = () => {
    window.location.href = authApi.googleLoginUrl();
  };

  // ── Step 1: send code ──
  const handleSendCode = async (e) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.sendCode(email);
      setStep(2);
      setResendCooldown(30);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: verify code ──
  const handleVerifyCode = async (e) => {
    e?.preventDefault();
    if (code.length !== 6) {
      setError("Enter all 6 digits.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { signup_token } = await authApi.verifyCode(email, code);
      setSignupToken(signup_token);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: complete signup ──
  const handleCompleteSignup = async (e) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { user, accessToken } = await authApi.completeSignup(signupToken, name, password);
      setSession({ user, accessToken });
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── render helpers ──
  const eyebrowFor = (s) => `Step ${s} of 3`;
  const titleFor = (s) =>
    s === 1 ? "What's your email?" :
    s === 2 ? "Enter the 6-digit code." :
    "Finish setting up.";

  return (
    <AuthCard
      variant="register"
      eyebrow={eyebrowFor(step)}
      title={titleFor(step)}
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" style={{
            color: "var(--gold)",
            textDecoration: "none",
            fontWeight: 500,
            borderBottom: "1px solid var(--gold-soft)",
            paddingBottom: 1,
          }}>
            Sign in
          </Link>
        </>
      }
    >
      {/* ── STEP 1: email ── */}
      {step === 1 && (
        <>
          <form onSubmit={handleSendCode} noValidate>
            <FieldInput
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoFocus
              error={error}
            />
            <button type="submit" className="cta" disabled={loading || !email}>
              {loading ? "Sending code…" : "Send verification code"}
            </button>
          </form>

          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            margin: "24px 0 16px",
          }}>
            <div style={{ flex: 1, height: 1, background: "var(--whisper-2)" }} />
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: 2,
              color: "var(--bone-faint)", textTransform: "uppercase",
            }}>or</span>
            <div style={{ flex: 1, height: 1, background: "var(--whisper-2)" }} />
          </div>

          <button type="button" className="google-btn" onClick={handleGoogle}>
            <GoogleIcon /> Sign up with Google
          </button>
        </>
      )}

      {/* ── STEP 2: code ── */}
      {step === 2 && (
        <form onSubmit={handleVerifyCode} noValidate>
          <p style={{
            fontSize: 13,
            color: "var(--bone-dim)",
            margin: "0 0 24px 0",
            lineHeight: 1.6,
          }}>
            We sent a code to <strong style={{ color: "var(--bone)" }}>{email}</strong>.
            {" "}
            <button
              type="button"
              onClick={() => { setStep(1); setCode(""); setError(null); }}
              style={{
                background: "transparent", border: "none", padding: 0,
                color: "var(--gold)", cursor: "pointer", fontSize: 13,
                fontFamily: "inherit", borderBottom: "1px solid var(--gold-soft)",
              }}
            >
              Change
            </button>
          </p>

          <div style={{ marginBottom: 20 }}>
            <CodeInput value={code} onChange={setCode} autoFocus error={error} />
          </div>

          <button type="submit" className="cta" disabled={loading || code.length !== 6}>
            {loading ? "Verifying…" : "Verify code"}
          </button>

          <div style={{
            marginTop: 18, textAlign: "center",
            fontSize: 12, color: "var(--bone-dim)",
          }}>
            Didn't get it?{" "}
            <button
              type="button"
              onClick={handleSendCode}
              disabled={resendCooldown > 0 || loading}
              style={{
                background: "transparent", border: "none", padding: 0,
                color: resendCooldown > 0 ? "var(--bone-faint)" : "var(--gold)",
                cursor: resendCooldown > 0 ? "default" : "pointer",
                fontSize: 12, fontFamily: "inherit",
                borderBottom: resendCooldown > 0 ? "none" : "1px solid var(--gold-soft)",
              }}
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}

      {/* ── STEP 3: name + password ── */}
      {step === 3 && (
        <form onSubmit={handleCompleteSignup} noValidate>
          <p style={{
            fontSize: 13, color: "var(--bone-dim)",
            margin: "0 0 24px 0", lineHeight: 1.6,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 18, height: 18, borderRadius: "50%",
              background: "var(--gold-soft)", color: "var(--gold)",
              fontSize: 11, fontWeight: 700,
            }}>✓</span>
            <span><strong style={{ color: "var(--bone)" }}>{email}</strong> verified.</span>
          </p>

          <FieldInput label="Your name" value={name} onChange={setName} autoFocus />
          <FieldInput
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            error={error}
          />

          <button
            type="submit"
            className="cta"
            disabled={loading || !name || password.length < 6}
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}