import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../stores/authStore.js";
import { useConvStore } from "../stores/convStore.js";
import { endSession, getReport } from "../services/reportApi.js";
import ScoreGrid from "../components/report/ScoreGrid.jsx";
import CoachingSection from "../components/report/CoachingSection.jsx";
import ReportSkeleton from "../components/report/ReportSkeleton.jsx";

const MODE_COLORS = {
  psy: "#a78bfa",
  professional: "var(--gold)",
  sport: "#34d399",
};

export default function ReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.accessToken);
  const conversations = useConvStore((s) => s.conversations);
  const conversation = conversations.find((c) => String(c.id) === id);

  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const shouldGenerate = !!location.state?.generate;

  const startedRef = useRef(false);

  useEffect(() => {
    if (!id || !token || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const existing = await getReport(id, token).catch(() => null);
        if (existing) {
          setReport(existing);
          return;
        }

        if (!shouldGenerate) {
          setError("No report yet. End the session to generate one.");
          return;
        }

        const { coaching_report } = await endSession(id, token);
        if (!coaching_report) throw new Error("The report came back empty.");
        setReport(coaching_report);
      } catch (e) {
        setError(e.message || "Could not load the report.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, token, shouldGenerate]);

  if (loading) return <ReportSkeleton />;

  const mode = conversation?.mode || "professional";
  const accent = MODE_COLORS[mode] || "var(--gold)";
  const metrics = report?.metrics || {};
  const drill = metrics.practice_drill;
  const sources = metrics.sources || [];

  return (
    <div style={{
      maxWidth: 720, margin: "0 auto", padding: "32px 24px 80px",
      color: "var(--bone)", minHeight: "100vh", overflowY: "auto",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <button
        onClick={() => navigate(`/app/${id}`)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "8px 14px", background: "transparent",
          border: "1px solid var(--whisper-2)", borderRadius: 8,
          color: "var(--bone-dim)", fontSize: 13, cursor: "pointer",
          marginBottom: 24, fontFamily: "inherit",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--bone)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--bone-dim)"; }}
      >
        ← Back to conversation
      </button>

      {error && !report ? (
        <ErrorState message={error} onRetry={() => navigate(`/app/${id}`)} />
      ) : report ? (
        <>
          <header style={{
            marginBottom: 32, paddingBottom: 24,
            borderBottom: "1px solid var(--whisper-2)",
          }}>
            <h1 className="display" style={{
              fontSize: 28, fontWeight: 500, margin: "0 0 12px 0",
              letterSpacing: "-0.02em",
            }}>
              {conversation?.title || "Coaching report"}
            </h1>
            <div style={{
              display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
              fontSize: 12, color: "var(--bone-faint)",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              <span style={{ color: accent, textTransform: "capitalize" }}>{mode}</span>
              <span>
                {new Date(report.created_at).toLocaleDateString(undefined, {
                  month: "short", day: "numeric", year: "numeric",
                })}
              </span>
            </div>
          </header>

          <section style={{ marginBottom: 36 }}>
            <p style={{
              fontSize: 14.5, lineHeight: 1.7,
              color: "var(--bone-dim)", margin: 0,
            }}>
              {report.summary}
            </p>
          </section>

          <section style={{ marginBottom: 36 }}>
            <h2 style={{
              fontFamily: "'Fraunces', serif", fontSize: 18,
              fontWeight: 500, margin: "0 0 16px 0",
            }}>
              Session metrics
            </h2>
            <ScoreGrid scoreGrid={metrics.score_grid || {}} />
          </section>

          <CoachingSection
            title="What went well"
            items={report.strengths}
            variant="well"
          />

          <CoachingSection
            title="Moments to improve"
            items={report.areas_for_growth}
            variant="improve"
          />

          {drill && (
            <section style={{ marginBottom: 36 }}>
              <h2 style={{
                fontFamily: "'Fraunces', serif", fontSize: 18,
                fontWeight: 500, margin: "0 0 16px 0",
              }}>
                Practice this next
              </h2>
              <div style={{
                padding: "18px 20px",
                background: "var(--gold-soft)",
                border: "1px solid color-mix(in srgb, var(--gold) 35%, transparent)",
                borderRadius: 12,
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
                }}>
                  <h3 style={{
                    fontSize: 15, fontWeight: 600,
                    color: "var(--bone)", margin: 0,
                  }}>
                    {drill.title}
                  </h3>
                  {drill.duration_minutes != null && (
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10, letterSpacing: 1,
                      color: "var(--gold)", marginLeft: "auto",
                    }}>
                      {drill.duration_minutes} MIN
                    </span>
                  )}
                </div>
                <p style={{
                  fontSize: 13, lineHeight: 1.65,
                  color: "var(--bone-dim)", margin: 0,
                }}>
                  {drill.detail}
                </p>
              </div>
            </section>
          )}

          {sources.length > 0 && (
            <footer style={{
              paddingTop: 20, borderTop: "1px solid var(--whisper-2)",
              fontSize: 11.5, color: "var(--bone-faint)", lineHeight: 1.7,
            }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10, letterSpacing: 1.5,
                textTransform: "uppercase", marginBottom: 7,
              }}>
                Grounded in
              </div>
              {sources.join(" · ")}
            </footer>
          )}
        </>
      ) : null}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div style={{
      padding: "28px 24px", textAlign: "center",
      border: "1px solid var(--whisper-2)", borderRadius: 12,
      background: "var(--ink-2)",
    }}>
      <p style={{ color: "var(--bone-dim)", fontSize: 14, margin: "0 0 18px 0" }}>
        {message}
      </p>
      <button
        onClick={onRetry}
        style={{
          padding: "9px 20px", borderRadius: 8, border: "none",
          background: "var(--gold)", color: "var(--ink)",
          fontSize: 13, fontWeight: 600, cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Back to conversation
      </button>
    </div>
  );
}
