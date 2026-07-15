import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AmbientWave from "./AmbientWave.jsx";

const QUOTES_LOGIN = [
  { text: "The conversation you're avoiding is the one you most need to have.", who: "Susan Scott" },
  { text: "Between stimulus and response there is a space. In that space is our power.", who: "Viktor Frankl" },
  { text: "We don't rise to the level of our intentions. We fall to the level of our preparation.", who: "Archilochus" },
  { text: "What you practice grows stronger.", who: "Shauna Shapiro" },
];
const QUOTES_REGISTER = [
  { text: "Start where you are. Use what you have. Do what you can.", who: "Arthur Ashe" },
  { text: "The cave you fear to enter holds the treasure you seek.", who: "Joseph Campbell" },
  { text: "Tell me, what is it you plan to do with your one wild and precious life?", who: "Mary Oliver" },
  { text: "The first step toward change is awareness.", who: "Nathaniel Branden" },
];

export default function AuthCard({ variant = "login", title, eyebrow, children, footer }) {
  const quotes = variant === "register" ? QUOTES_REGISTER : QUOTES_LOGIN;
  const [qIdx, setQIdx] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setQIdx((i) => (i + 1) % quotes.length);
        setFading(false);
      }, 320);
    }, 8000);
    return () => clearInterval(interval);
  }, [quotes.length]);

  const quote = quotes[qIdx];

  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
      background: "var(--ink)",
    }}>
      {/* LEFT — ambient + quote */}
      <div style={{
        position: "relative",
        overflow: "hidden",
        background: "var(--ink)",
        borderRight: "1px solid var(--whisper-2)",
        display: "flex",
        flexDirection: "column",
        padding: "40px 56px",
      }}>
        <AmbientWave />

        {/* Wordmark top-left */}
        <div style={{ position: "relative", zIndex: 2 }}>
          <div className="wordmark">coach<span>.</span></div>
        </div>

        {/* Centered headline + quote */}
        <div style={{
          position: "relative",
          zIndex: 2,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          maxWidth: 540,
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: 2.5,
            color: "var(--gold)",
            textTransform: "uppercase",
            marginBottom: 20,
            opacity: 0,
            animation: "fadeUp 700ms cubic-bezier(.2,.7,.2,1) 200ms forwards",
          }}>
            Practice · Reflect · Improve
          </div>

          <h1
            className="display"
            style={{
              marginBottom: 48,
              opacity: 0,
              animation: "fadeUp 800ms cubic-bezier(.2,.7,.2,1) 320ms forwards",
            }}
          >
            {variant === "register" ? (
              <>The hard conversation,<br /><em>rehearsed</em>.</>
            ) : (
              <>Step into the room<br />before <em>the room</em>.</>
            )}
          </h1>

          <div style={{
            opacity: 0,
            animation: "fadeUp 800ms cubic-bezier(.2,.7,.2,1) 480ms forwards",
            borderLeft: "1px solid var(--whisper-2)",
            paddingLeft: 20,
          }}>
            <p style={{
              fontFamily: "'Fraunces', serif",
              fontStyle: "italic",
              fontSize: 17,
              lineHeight: 1.55,
              color: "var(--bone-dim)",
              margin: 0,
              transition: "opacity 320ms",
              opacity: fading ? 0 : 1,
            }}>
              "{quote.text}"
            </p>
            <p style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: "var(--bone-faint)",
              marginTop: 10,
              letterSpacing: 0.5,
              transition: "opacity 320ms",
              opacity: fading ? 0 : 1,
            }}>
              — {quote.who}
            </p>
          </div>
        </div>

        {/* Bottom hint */}
        <div style={{
          position: "relative",
          zIndex: 2,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          letterSpacing: 1.5,
          color: "var(--bone-faint)",
          textTransform: "uppercase",
        }}>
          {variant === "register" ? "01 / new account" : "01 / sign in"}
        </div>
      </div>

      {/* RIGHT — form */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 48px",
      }}>
        <div style={{ width: "100%", maxWidth: 380 }} className="auth-stagger">
          {eyebrow && (
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              letterSpacing: 2,
              color: "var(--gold)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}>
              {eyebrow}
            </div>
          )}
          <h2 style={{
            fontFamily: "'Fraunces', serif",
            fontWeight: 500,
            fontSize: 30,
            lineHeight: 1.1,
            letterSpacing: -0.5,
            margin: "0 0 32px 0",
            color: "var(--bone)",
          }}>
            {title}
          </h2>

          {children}

          {footer && (
            <div style={{
              marginTop: 28,
              paddingTop: 22,
              borderTop: "1px solid var(--whisper-2)",
              fontSize: 13,
              color: "var(--bone-dim)",
            }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { Link };