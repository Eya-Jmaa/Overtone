import { useState } from "react";

export default function FieldInput({ label, type = "text", value, onChange, autoFocus, error }) {
  const [focused, setFocused] = useState(false);
  const hasValue = value && value.length > 0;

  return (
    <div>
      <div className={`field ${hasValue ? "has-value" : ""}`}>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus={autoFocus}
          autoComplete={type === "password" ? "current-password" : type === "email" ? "email" : "off"}
        />
        <label>{label}</label>
        <div className="underline" />
      </div>
      {error && (
        <div style={{
          marginTop: -16,
          marginBottom: 16,
          fontSize: 11,
          color: "var(--rose)",
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 0.3,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}