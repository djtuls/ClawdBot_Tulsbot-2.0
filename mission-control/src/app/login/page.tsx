"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const APPROVED_EMAILS = new Set([
  "ferro.tulio@gmail.com",
  "tulio@weareliveengine.com",
  "tuliof@creativetoolsagency.com",
  "tulsbot@gmail.com",
]);

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmail = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!APPROVED_EMAILS.has(email.toLowerCase())) {
      setError("Email not authorized.");
      return;
    }
    setStep("code");
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      setError(data.error || "Invalid code");
      setLoading(false);
      return;
    }

    const next = new URLSearchParams(window.location.search).get("next") || "/";
    router.push(next);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🦞</span>
          </div>
          <h1 className="text-2xl font-bold mb-1 text-white">Tulsbot</h1>
          <p className="text-zinc-500">Mission Control</p>
        </div>

        <div className="bg-[#141416] rounded-2xl border border-[#2A2A2E] p-6">
          {step === "email" ? (
            <form onSubmit={handleEmail} className="space-y-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-4 py-3 text-white outline-none focus:border-indigo-500"
                  placeholder="you@example.com"
                  required
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={!email}
                className="w-full bg-indigo-500 text-white py-3 rounded-lg font-medium hover:bg-indigo-600 disabled:opacity-50"
              >
                Continue
              </button>
            </form>
          ) : (
            <>
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="w-6 h-6 text-indigo-400"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" strokeWidth="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" strokeWidth="2" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-white">Verify Access</h2>
                <p className="text-zinc-500 text-sm">Enter any 6-digit code</p>
              </div>
              <form onSubmit={handleCode} className="space-y-4">
                <input
                  type="text"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                  className="w-full bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-4 py-3 text-center text-2xl font-mono text-white outline-none focus:border-indigo-500 tracking-[0.5em]"
                  placeholder="000000"
                />
                {error && <p className="text-red-400 text-sm text-center">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full bg-indigo-500 text-white py-3 rounded-lg font-medium hover:bg-indigo-600 disabled:opacity-50"
                >
                  {loading ? "Verifying..." : "Verify"}
                </button>
              </form>
              <button
                onClick={() => setStep("email")}
                className="w-full text-zinc-500 text-sm mt-4 hover:text-white"
              >
                ← Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
