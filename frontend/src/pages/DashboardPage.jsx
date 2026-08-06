import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { useAuthStore } from "../stores/authStore.js";
import { getAnalyticsOverview } from "../services/analyticsApi.js";

const EMOTION_ORDER = ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"];
const EMOTION_COLORS_DARK = {
  neutral: "#3987e5", happy: "#d95926", sad: "#199e70", angry: "#c98500",
  fearful: "#d55181", disgust: "#008300", surprised: "#9085e9",
};
const EMOTION_COLORS_LIGHT = {
  neutral: "#2a78d6", happy: "#eb6834", sad: "#1baf7a", angry: "#eda100",
  fearful: "#e87ba4", disgust: "#008300", surprised: "#4a3aa7",
};

const isLightNow = () => {
  const el = document.documentElement;
  return el.getAttribute("data-theme") === "light" || el.classList.contains("light");
};

function useIsLight() {
  const [light, setLight] = useState(isLightNow);
  useEffect(() => {
    const obs = new MutationObserver(() => setLight(isLightNow()));
    obs.observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-theme", "class"],
    });
    return () => obs.disconnect();
  }, []);
  return light;
}

const card = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 20,
  boxShadow: "var(--edge-light), var(--shadow-sm)",
};

const sectionTitle = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  letterSpacing: 1.6,
  textTransform: "uppercase",
  color: "var(--text-faint)",
  marginBottom: 14,
};

function useCountUp(value, ms = 900) {
  const numeric = typeof value === "number" && Number.isFinite(value);
  const [shown, setShown] = useState(() => (numeric ? 0 : value));
  const rafRef = useRef(0);

  useEffect(() => {
    if (!numeric) { setShown(value); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value); return;
    }
    const dp = (String(value).split(".")[1] || "").length;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Number((value * eased).toFixed(dp)));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    const settle = setTimeout(() => {
      cancelAnimationFrame(rafRef.current);
      setShown(value);
    }, ms + 150);

    return () => { cancelAnimationFrame(rafRef.current); clearTimeout(settle); };
  }, [value, numeric, ms]);

  return shown;
}

function Sparkline({ points, color = "var(--accent)", height = 30 }) {
  const clean = (points || []).filter((p) => p != null && Number.isFinite(p));
  if (clean.length < 2) return null;
  const W = 96, H = height;
  const min = Math.min(...clean), max = Math.max(...clean);
  const span = max - min || 1;
  const step = W / (clean.length - 1);
  const xy = clean.map((p, i) => [i * step, H - 3 - ((p - min) / span) * (H - 6)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const [lx, ly] = xy[xy.length - 1];
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line} fill="none" stroke={color} strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ strokeDasharray: 400, "--dash": 400, animation: "drawLine 1.1s var(--ease-out) both" }}
      />
      <circle cx={lx} cy={ly} r="2.6" fill={color} />
    </svg>
  );
}

function StatTile({ label, value, sub, delay = 0, spark, sparkColor, accent = "var(--accent)" }) {
  const animated = useCountUp(value);
  return (
    <div
      className="dash-card hover-lift sheen"
      style={{ ...card, animation: `dashIn 520ms ${delay}ms both cubic-bezier(.2,.7,.3,1)` }}
    >
      <span aria-hidden="true" style={{
        position: "absolute", top: 0, left: 14, right: 14, height: 2, borderRadius: 2,
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        opacity: 0.7,
      }} />
      <div style={sectionTitle}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <div style={{
          fontFamily: "'Fraunces', serif",
          fontSize: 32,
          lineHeight: 1.05,
          color: "var(--text-base)",
          letterSpacing: -0.5,
          fontVariantNumeric: "tabular-nums",
        }}>
          {animated}
        </div>
        {spark && <Sparkline points={spark} color={sparkColor || accent} />}
      </div>
      {sub && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>{sub}</div>
      )}
    </div>
  );
}

function EmotionDonut({ data, size = 132 }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!total) return null;
  const r = size / 2 - 11;
  const C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={`Emotion mix: ${data.map((d) => `${d.emotion} ${d.pct}%`).join(", ")}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="var(--border)" strokeWidth="12" opacity="0.5" />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {data.map((d, i) => {
          const frac = d.count / total;
          const dash = `${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}`;
          const offset = -acc * C;
          acc += frac;
          return (
            <circle
              key={d.emotion}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={d.fill} strokeWidth="12" strokeLinecap="butt"
              strokeDasharray={dash} strokeDashoffset={offset}
              style={{ animation: `donutArc 480ms ${120 + i * 90}ms var(--ease-out) both` }}
            >
              <title>{`${d.emotion}: ${d.count} (${d.pct}%)`}</title>
            </circle>
          );
        })}
      </g>
      <text x="50%" y="47%" textAnchor="middle"
        style={{ fill: "var(--text-base)", fontFamily: "'Fraunces', serif", fontSize: 21 }}>
        {total}
      </text>
      <text x="50%" y="62%" textAnchor="middle"
        style={{ fill: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, letterSpacing: 1.2 }}>
        TURNS
      </text>
    </svg>
  );
}

function TooltipShell({ children }) {
  return (
    <div style={{
      background: "var(--bg-elevated)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "10px 12px",
      fontSize: 12,
      color: "var(--text-base)",
      boxShadow: "0 8px 28px rgba(0,0,0,.35)",
    }}>
      {children}
    </div>
  );
}

function EmotionTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TooltipShell>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: d.fill }} />
        <strong style={{ textTransform: "capitalize" }}>{d.emotion}</strong>
      </div>
      <div style={{ color: "var(--text-muted)" }}>
        {d.count} turn{d.count === 1 ? "" : "s"} · {d.pct}% of measured
      </div>
    </TooltipShell>
  );
}

function SessionTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TooltipShell>
      <div style={{ marginBottom: 6 }}>
        <strong>{d.title || `Session ${d.n}`}</strong>
      </div>
      <div style={{ color: "var(--text-muted)", lineHeight: 1.7 }}>
        {d.avg_fillers == null
          ? "No filler measurement"
          : <>Avg fillers/turn: <strong style={{ color: "var(--text-base)" }}>{d.avg_fillers}</strong></>}
        <br />
        {d.turns} turn{d.turns === 1 ? "" : "s"}
        {d.measured_filler_turns < d.turns && (
          <> · {d.measured_filler_turns} measured</>
        )}
        {d.dominant_emotion && <><br />Mostly {d.dominant_emotion}</>}
        {d.mode && <><br /><span style={{ opacity: .7 }}>{d.mode}</span></>}
      </div>
    </TooltipShell>
  );
}

function ChannelSwitch({ value, onChange, textTurns, voiceTurns }) {
  const opts = [
    { id: "text", label: "Words", n: textTurns, hint: "Read from what you wrote or said" },
    { id: "voice", label: "Voice", n: voiceTurns, hint: "Heard in how you sounded (spoken turns)" },
  ];
  return (
    <div className="chan-switch" role="tablist" aria-label="Emotion channel">
      {opts.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={`chan-btn${value === o.id ? " is-on" : ""}`}
        >
          {o.label}
          <span className="chan-count">{o.n}</span>
        </button>
      ))}
    </div>
  );
}

function AgreementCard({ agreement, colors }) {
  const { both_measured: n, agreed, disagreed, agreement_pct: pct } = agreement;
  const top = agreement.top_disagreements || [];
  const thin = n < 5;
  return (
    <div className="dash-card hover-lift" style={{
      ...card, marginTop: 12,
      animation: "dashIn 520ms 460ms both cubic-bezier(.2,.7,.3,1)",
    }}>
      <div style={sectionTitle}>Voice vs words</div>
      <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{
            fontFamily: "'Fraunces', serif", fontSize: 30, color: "var(--text-base)",
            lineHeight: 1.05, fontVariantNumeric: "tabular-nums",
          }}>
            {pct == null ? "—" : `${pct}%`}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 5 }}>
            agreed on {agreed} of {n} turn{n === 1 ? "" : "s"} measured both ways
          </div>
        </div>

        <div style={{ flex: "1 1 200px", minWidth: 180 }}>
          <div style={{
            display: "flex", height: 12, borderRadius: 999, overflow: "hidden",
            border: "1px solid var(--border)",
          }}>
            <div style={{
              width: `${n ? (agreed / n) * 100 : 0}%`, background: "var(--sage)",
              transition: "width 700ms var(--ease-out)",
            }} />
            <div style={{
              width: `${n ? (disagreed / n) * 100 : 0}%`, background: "var(--accent)",
              transition: "width 700ms var(--ease-out)",
            }} />
          </div>
          <div style={{
            display: "flex", gap: 14, marginTop: 8, fontSize: 11.5, color: "var(--text-muted)",
          }}>
            <span><Dot color="var(--sage)" /> agreed {agreed}</span>
            <span><Dot color="var(--accent)" /> differed {disagreed}</span>
          </div>
        </div>
      </div>

      {top.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ ...sectionTitle, marginBottom: 9 }}>Most common gaps</div>
          <div className="stagger" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {top.map((d) => (
              <div key={`${d.text}->${d.voice}`} className="shift-chip"
                title={`Words read ${d.text} while voice read ${d.voice}, ${d.count} time${d.count === 1 ? "" : "s"}`}
                style={{
                  background: `linear-gradient(100deg,
                    color-mix(in srgb, ${colors[d.text] || "var(--text-faint)"} 16%, var(--bg-elevated)),
                    color-mix(in srgb, ${colors[d.voice] || "var(--text-faint)"} 16%, var(--bg-elevated)))`,
                }}>
                <Dot color={colors[d.text]} />
                <span style={{ textTransform: "capitalize" }}>{d.text}</span>
                <span style={{ color: "var(--text-faint)", fontSize: 10.5 }}>words</span>
                <span className="shift-arrow" aria-hidden="true">/</span>
                <Dot color={colors[d.voice]} />
                <span style={{ textTransform: "capitalize" }}>{d.voice}</span>
                <span style={{ color: "var(--text-faint)", fontSize: 10.5 }}>voice</span>
                <strong style={{ color: "var(--text-base)", marginLeft: 2 }}>×{d.count}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{
        marginTop: 14, fontSize: 12, color: "var(--text-faint)", lineHeight: 1.65,
      }}>
        {thin
          ? "Too few turns measured both ways to read anything into yet — this fills in as you record more spoken turns."
          : "A gap isn’t a mistake. It usually means your delivery carried something your wording didn’t, which is worth noticing before a real conversation."}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const token = useAuthStore((s) => s.accessToken);
  const isLight = useIsLight();
  const colors = isLight ? EMOTION_COLORS_LIGHT : EMOTION_COLORS_DARK;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const [channel, setChannel] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!token) return;
    setLoading(true);
    getAnalyticsOverview(token)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    if (!data || channel !== null) return;
    const t = data.totals?.measured_text_emotion_turns ?? 0;
    const v = data.totals?.measured_emotion_turns ?? 0;
    setChannel(t >= v ? "text" : "voice");
  }, [data, channel]);

  const activeChannel = channel ?? "text";
  const isText = activeChannel === "text";

  const emotionData = useMemo(() => {
    if (!data) return [];
    const src = isText
      ? data.text_emotion_distribution || []
      : data.emotion_distribution || [];
    const byLabel = Object.fromEntries(src.map((d) => [d.emotion, d]));
    return EMOTION_ORDER
      .filter((e) => byLabel[e])
      .map((e) => ({
        emotion: e,
        count: byLabel[e].count,
        pct: byLabel[e].pct,
        fill: colors[e] || "var(--text-faint)",
      }));
  }, [data, colors, isText]);

  const shiftData = useMemo(
    () => (isText ? data?.text_shifts : data?.shifts) || [],
    [data, isText]
  );

  const sessionData = useMemo(() => {
    if (!data) return [];
    return data.sessions.map((s, i) => ({ ...s, n: i + 1 }));
  }, [data]);

  const fillerTrend = useMemo(() => sessionData.map((s) => s.avg_fillers), [sessionData]);
  const turnsTrend = useMemo(() => sessionData.map((s) => s.turns), [sessionData]);

  const axis = {
    stroke: "var(--border)",
    tick: { fill: "var(--text-faint)", fontSize: 11 },
  };

  if (loading) {
    return (
      <Shell>
        <style>{DASH_CSS}</style>
        <div className="shimmer" style={{ width: 180, height: 30, marginBottom: 10 }} />
        <div className="shimmer" style={{ width: 300, height: 14, marginBottom: 26, opacity: .7 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 18 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="shimmer" style={{ height: 118, borderRadius: 14 }} />)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          {[0, 1].map((i) => <div key={i} className="shimmer" style={{ height: 250, borderRadius: 14 }} />)}
        </div>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell>
        <div className="anim-rise" style={{ ...card, borderColor: "var(--rose)", maxWidth: 460 }}>
          <div style={{ ...sectionTitle, color: "var(--rose)" }}>Couldn’t load analytics</div>
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>{error}</div>
        </div>
      </Shell>
    );
  }

  const t = data.totals;
  const nothingMeasured =
    t.measured_emotion_turns === 0 &&
    t.measured_filler_turns === 0 &&
    (t.measured_text_emotion_turns ?? 0) === 0;
  const voiceOnlyMissing =
    !nothingMeasured &&
    t.measured_emotion_turns === 0 &&
    (t.measured_text_emotion_turns ?? 0) > 0;

  return (
    <Shell>
      <style>{DASH_CSS}</style>

      <header style={{ marginBottom: 24, animation: "dashIn 520ms both cubic-bezier(.2,.7,.3,1)" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 10,
          padding: "5px 12px 5px 9px", borderRadius: 999,
          border: "1px solid var(--border)", background: "var(--bg-surface)",
          boxShadow: "var(--edge-light)",
        }}>
          <span className="dash-live-dot" aria-hidden="true" />
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
            letterSpacing: 1.8, color: "var(--text-muted)",
          }}>
            {t.conversations} SESSION{t.conversations === 1 ? "" : "S"} ANALYSED
          </span>
        </div>
        <h1 style={{
          fontFamily: "'Fraunces', serif", fontSize: 30,
          color: "var(--text-base)", letterSpacing: -0.6, margin: 0,
        }}>
          Your <em style={{ color: "var(--accent)", fontStyle: "italic" }}>patterns</em>
        </h1>
        <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 7, maxWidth: 520, lineHeight: 1.6 }}>
          Measured from your spoken turns — vocal emotion and filler words.
        </p>
      </header>

      {nothingMeasured && (
        <div style={{ ...card, marginBottom: 18, borderStyle: "dashed" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>
            Nothing measured yet. Emotion is read from your{" "}
            <strong style={{ color: "var(--text-base)" }}>words</strong> on every
            turn — typed or spoken — and from your{" "}
            <strong style={{ color: "var(--text-base)" }}>voice</strong> on spoken
            turns. Have a conversation and these will fill in.
          </div>
        </div>
      )}

      {voiceOnlyMissing && (
        <div style={{ ...card, marginBottom: 18, borderStyle: "dashed" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>
            These readings come from your{" "}
            <strong style={{ color: "var(--text-base)" }}>words</strong>. Vocal
            tone and filler counts need <strong style={{ color: "var(--text-base)" }}>spoken</strong>{" "}
            turns — start a voice session to fill in the Voice channel and unlock
            the voice-vs-words comparison.
          </div>
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: 12, marginBottom: 18,
      }}>
        <StatTile label="Sessions" value={t.conversations} delay={0}
          spark={turnsTrend}
          sub={`${t.analysed_turns} spoken turn${t.analysed_turns === 1 ? "" : "s"}`} />
        <StatTile label="Avg fillers / turn" delay={70}
          value={t.avg_fillers ?? "—"}
          accent="var(--sage)"
          spark={fillerTrend} sparkColor="var(--sage)"
          sub={t.measured_filler_turns ? `${t.total_fillers} across ${t.measured_filler_turns} measured` : "not measured yet"} />
        <StatTile label="Your words read as" delay={140}
          value={<span style={{ textTransform: "capitalize" }}>{t.dominant_text_emotion ?? "—"}</span>}
          accent={colors[t.dominant_text_emotion] || "var(--accent)"}
          sub={t.measured_text_emotion_turns
            ? `${t.measured_text_emotion_turns} turns read`
            : "not measured yet"} />
        <StatTile label="Your voice read as" delay={210}
          value={<span style={{ textTransform: "capitalize" }}>{t.dominant_emotion ?? "—"}</span>}
          accent={colors[t.dominant_emotion] || "var(--azure)"}
          sub={t.measured_emotion_turns
            ? `${t.measured_emotion_turns} spoken turns heard`
            : "spoken turns only"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <div className="dash-card hover-lift" style={{ ...card, animation: "dashIn 520ms 280ms both cubic-bezier(.2,.7,.3,1)" }}>
          <div style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: 12, flexWrap: "wrap",
          }}>
            <div style={sectionTitle}>Emotion mix</div>
            <ChannelSwitch
              value={activeChannel}
              onChange={setChannel}
              textTurns={t.measured_text_emotion_turns ?? 0}
              voiceTurns={t.measured_emotion_turns ?? 0}
            />
          </div>
          <div style={{
            fontSize: 11.5, color: "var(--text-faint)", marginTop: -6, marginBottom: 12,
            lineHeight: 1.5,
          }}>
            {isText
              ? `Read from your words — typed and spoken turns. ${t.measured_text_emotion_turns ?? 0} measured.`
              : `Heard in your voice — spoken turns only. ${t.measured_emotion_turns ?? 0} measured.`}
          </div>
          {emotionData.length === 0 ? (
            <Empty>
              {isText
                ? "No wording emotion measured yet — turns need a few words before they can be read."
                : "No vocal emotion measured yet. This channel only fills in from spoken turns."}
            </Empty>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <EmotionDonut data={emotionData} />
              <div style={{ flex: "1 1 190px", minWidth: 180 }}>
                <ResponsiveContainer width="100%" height={Math.max(170, emotionData.length * 30)}>
                  <BarChart data={emotionData} layout="vertical" margin={{ left: 4, right: 34, top: 4, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke="var(--border)" strokeOpacity={0.5} />
                    <XAxis type="number" {...axis} allowDecimals={false} />
                    <YAxis
                      type="category" dataKey="emotion" width={70} {...axis}
                      tick={{ fill: "var(--text-muted)", fontSize: 11, textTransform: "capitalize" }}
                    />
                    <Tooltip content={<EmotionTooltip />} cursor={{ fill: "var(--bg-elevated)", fillOpacity: 0.5 }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14} animationDuration={900} animationEasing="ease-out">
                      {emotionData.map((d) => <Cell key={d.emotion} fill={d.fill} />)}
                      <LabelList dataKey="count" position="right"
                        style={{ fill: "var(--text-muted)", fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        <div className="dash-card hover-lift" style={{ ...card, animation: "dashIn 520ms 350ms both cubic-bezier(.2,.7,.3,1)" }}>
          <div style={sectionTitle}>Filler words per session</div>
          {sessionData.filter((s) => s.avg_fillers != null).length < 2 ? (
            <Empty>Needs at least two measured sessions to show a trend.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={228}>
              <AreaChart data={sessionData} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                <defs>
                  <linearGradient id="fillerFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                <XAxis dataKey="n" {...axis} />
                <YAxis {...axis} allowDecimals={true} width={34} />
                <Tooltip content={<SessionTooltip />} cursor={{ stroke: "var(--text-faint)", strokeDasharray: "3 3" }} />
                <Area
                  type="monotone" dataKey="avg_fillers"
                  stroke="var(--accent)" strokeWidth={2}
                  fill="url(#fillerFill)"
                  dot={{ r: 3.5, fill: "var(--accent)", stroke: "var(--bg-surface)", strokeWidth: 2 }}
                  activeDot={{ r: 6, stroke: "var(--bg-surface)", strokeWidth: 2 }}
                  connectNulls animationDuration={1000} animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="dash-card" style={{ ...card, marginTop: 12, animation: "dashIn 520ms 420ms both cubic-bezier(.2,.7,.3,1)" }}>
        <div style={sectionTitle}>
          Emotional shifts · {isText ? "wording" : "voice"}
        </div>
        {shiftData.length === 0 ? (
          <Empty>No shifts recorded — that means consecutive measured turns held the same emotion.</Empty>
        ) : (
          <div className="stagger" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {shiftData.map((s) => (
              <div
                key={`${s.from}->${s.to}`}
                className="shift-chip"
                title={`${s.from} → ${s.to}, ${s.count} time${s.count === 1 ? "" : "s"}`}
                style={{
                  background: `linear-gradient(100deg,
                    color-mix(in srgb, ${colors[s.from] || "var(--text-faint)"} 16%, var(--bg-elevated)),
                    color-mix(in srgb, ${colors[s.to] || "var(--text-faint)"} 16%, var(--bg-elevated)))`,
                }}
              >
                <Dot color={colors[s.from]} /> <span style={{ textTransform: "capitalize" }}>{s.from}</span>
                <span className="shift-arrow" aria-hidden="true">→</span>
                <Dot color={colors[s.to]} /> <span style={{ textTransform: "capitalize" }}>{s.to}</span>
                <strong style={{ color: "var(--text-base)", marginLeft: 2 }}>×{s.count}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      {(data.modality_agreement?.both_measured ?? 0) > 0 && (
        <AgreementCard agreement={data.modality_agreement} colors={colors} />
      )}

      <div className="dash-card" style={{ ...card, marginTop: 12, animation: "dashIn 520ms 480ms both cubic-bezier(.2,.7,.3,1)" }}>
        <button
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          className="dash-toggle"
        >
          <span aria-hidden="true" style={{
            display: "inline-block",
            transform: showTable ? "rotate(90deg)" : "none",
            transition: "transform 220ms var(--ease)",
          }}>›</span>
          {showTable ? "Hide" : "Show"} data table
        </button>
        {showTable && (
          <div style={{ overflowX: "auto", marginTop: 14, animation: "riseIn 340ms var(--ease-out) both" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "var(--text-faint)", textAlign: "left" }}>
                  {["#", "Session", "Mode", "Turns", "Avg fillers", "Words", "Voice"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessionData.map((s) => (
                  <tr key={s.conversation_id} className="dash-row" style={{ color: "var(--text-muted)" }}>
                    <td style={td}>{s.n}</td>
                    <td style={{ ...td, color: "var(--text-base)" }}>{s.title || "Untitled"}</td>
                    <td style={td}>{s.mode}</td>
                    <td style={td}>{s.turns}</td>
                    <td style={td}>{s.avg_fillers ?? "—"}</td>
                    <td style={{ ...td, textTransform: "capitalize" }}>{s.dominant_text_emotion ?? "—"}</td>
                    <td style={{ ...td, textTransform: "capitalize" }}>{s.dominant_emotion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}

const td = { padding: "8px 10px", borderBottom: "1px solid var(--border)" };

function Dot({ color }) {
  return <span style={{ width: 8, height: 8, borderRadius: 2, background: color || "var(--text-faint)", display: "inline-block" }} />;
}

function Empty({ children }) {
  return <div style={{ color: "var(--text-faint)", fontSize: 12.5, padding: "18px 2px", lineHeight: 1.7 }}>{children}</div>;
}

function Shell({ children }) {
  return (
    <div className="aurora" style={{
      height: "100%", overflowY: "auto",
      background: "radial-gradient(110% 60% at 50% 0%, var(--bg-sunken), var(--bg-base) 58%)",
    }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "34px 24px 60px" }}>
        {children}
      </div>
    </div>
  );
}

const DASH_CSS = `
@keyframes dashIn { from { opacity:0; transform: translateY(12px) } to { opacity:1; transform:none } }
@keyframes donutArc { from { opacity: 0; stroke-width: 3; } to { opacity: 1; stroke-width: 12; } }

.dash-card { position: relative; overflow: hidden; }

.dash-live-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--sage); flex-shrink: 0;
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--sage) 60%, transparent);
  animation: dashPing 2.4s ease-out infinite;
}
@keyframes dashPing {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sage) 55%, transparent); }
  70%  { box-shadow: 0 0 0 7px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

.shift-chip {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--border); border-radius: 999px;
  padding: 7px 12px; font-size: 12px;
  color: var(--text-muted); cursor: default;
  box-shadow: var(--edge-light);
  transition: transform 200ms var(--ease), border-color 200ms, box-shadow 200ms;
}
.shift-chip:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--edge-light), var(--shadow-md);
}
.shift-arrow { color: var(--text-faint); transition: transform 220ms var(--ease); }
.shift-chip:hover .shift-arrow { transform: translateX(3px); }

.dash-toggle {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text-muted); font-size: 12px; padding: 7px 13px; cursor: pointer;
  font-family: inherit;
  box-shadow: var(--edge-light);
  transition: border-color 180ms, color 180ms, transform 180ms var(--ease);
}
.dash-toggle:hover { border-color: var(--border-strong); color: var(--text-base); transform: translateY(-1px); }

.chan-switch {
  display: inline-flex; gap: 3px; padding: 3px;
  background: var(--bg-base); border: 1px solid var(--border); border-radius: 999px;
}
.chan-btn {
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: transparent; cursor: pointer;
  font-family: inherit; font-size: 11.5px; font-weight: 500;
  color: var(--text-muted); padding: 5px 11px; border-radius: 999px;
  transition: background 180ms, color 180ms, box-shadow 180ms;
}
.chan-btn:hover { color: var(--text-base); }
.chan-btn.is-on {
  background: var(--bg-elevated); color: var(--text-base);
  box-shadow: var(--edge-light), var(--shadow-sm);
}
.chan-count {
  font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
  color: var(--text-faint); background: var(--bg-surface);
  border: 1px solid var(--border); border-radius: 999px; padding: 0 5px;
  font-variant-numeric: tabular-nums;
}
.chan-btn.is-on .chan-count { color: var(--accent); border-color: var(--accent); }

.dash-row { transition: background 160ms; }
.dash-row:hover { background: var(--bg-elevated); }

/* Recharts paints axis/grid strokes inline; these keep them on-token. */
.recharts-cartesian-axis-line, .recharts-cartesian-axis-tick-line { stroke: var(--border); }

@media (prefers-reduced-motion: reduce) {
  .dash-live-dot { animation: none; }
  .shift-chip:hover, .dash-toggle:hover { transform: none; }
}
`;
