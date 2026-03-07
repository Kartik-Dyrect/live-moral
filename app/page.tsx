"use client";

import { Html5QrcodeScanner } from "html5-qrcode";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/utils/supabase";

type BrandReport = {
  ethics_score: number;
  health_score: number;
  summary: string;
  better_swaps: string[];
};

const USER_VALUES = [
  "Animal Welfare",
  "Fair Wages",
  "Carbon Neutral",
  "Plastic-Free",
  "Local Sourcing",
  "Cruelty-Free",
] as const;
const RECENT_SEARCHES_KEY = "livemoral_recent_searches";

function clampTenScale(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, value));
}

function scoreTheme(score: number): { track: string; ring: string; text: string } {
  if (score < 5.5) {
    return {
      track: "stroke-amber-200",
      ring: "stroke-amber-400",
      text: "text-amber-500",
    };
  }

  return {
    track: "stroke-emerald-200",
    ring: "stroke-emerald-600",
    text: "text-emerald-700",
  };
}

function ProgressCircle({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const size = 130;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeValue = clampTenScale(value);
  const progress = safeValue / 10;
  const dashOffset = circumference * (1 - progress);
  const style = scoreTheme(safeValue);

  return (
    <article className="rounded-3xl border border-white/50 bg-white/50 p-4 backdrop-blur-xl">
      <p className="text-sm font-medium text-zinc-600">{label}</p>
      <div className="mt-4 flex items-center justify-center">
        <div className="relative h-[130px] w-[130px]">
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeWidth={stroke}
              className={`fill-transparent ${style.track}`}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className={`fill-transparent transition-[stroke-dashoffset] duration-700 ease-out ${style.ring}`}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <p className={`text-2xl font-semibold tracking-tight ${style.text}`}>
              {safeValue.toFixed(1)}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function ScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (decodedText: string) => void;
}) {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const scanner = new Html5QrcodeScanner(
      "reader",
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
      },
      false,
    );
    scannerRef.current = scanner;

    scanner.render(
      (decodedText) => {
        if (!isMounted) return;
        isMounted = false;
        void scanner
          .clear()
          .catch(() => undefined)
          .finally(() => {
            scannerRef.current = null;
            onClose();
            onScanSuccess(decodedText);
          });
      },
      () => {
        // Ignore scan failures and continue scanning.
      },
    );

    return () => {
      isMounted = false;
      const activeScanner = scannerRef.current;
      scannerRef.current = null;
      if (activeScanner) {
        void activeScanner.clear().catch(() => undefined);
      }
    };
  }, [isOpen, onClose, onScanSuccess]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-zinc-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/40 bg-white/70 p-4 shadow-2xl backdrop-blur-xl sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Scan product barcode</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/70 bg-white/70 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-200"
          >
            Close
          </button>
        </div>
        <p className="mb-3 text-sm text-zinc-600">
          Point your camera at a barcode to auto-detect the brand.
        </p>
        <div id="reader" className="overflow-hidden rounded-2xl border border-white/70 bg-white" />
      </div>
    </div>
  );
}

export default function Home() {
  const supabase = useMemo(() => createClient(), []);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [report, setReport] = useState<BrandReport | null>(null);
  const [compareReport, setCompareReport] = useState<BrandReport | null>(null);
  const [brandSearched, setBrandSearched] = useState("");
  const [compareBrandSearched, setCompareBrandSearched] = useState("");
  const [isComparing, setIsComparing] = useState(false);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 5);
    } catch {
      return [];
    }
  });
  const [toastMessage, setToastMessage] = useState("");
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  function showToast(message: string) {
    setToastMessage(message);
  }

  const pushRecentSearch = useCallback((brandName: string) => {
    setRecentSearches((prev) => {
      const normalized = brandName.trim();
      const next = [normalized, ...prev.filter((item) => item !== normalized)].slice(0, 5);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const runSearch = useCallback(
    async (brandName: string, preferences?: string[], isComparison = false) => {
      const normalizedQuery = brandName.trim();
      if (!normalizedQuery) return;

      setLoading(true);
      setErrorMessage("");
      if (!isComparison) {
        setReport(null);
        setCompareReport(null);
        setCompareBrandSearched("");
        setIsComparing(false);
      }

      const userPreferences = (preferences ?? selectedValues)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      const { data, error } = await supabase.functions.invoke("research-brand", {
        body: { brandName: normalizedQuery, userPreferences },
      });

      if (error) {
        const backendError =
          typeof data?.error === "string" && data.error.trim().length > 0
            ? data.error
            : "";
        setErrorMessage(
          backendError ||
            "Our agent couldn't find recent data for this brand. Try another!",
        );
        setLoading(false);
        return;
      }

      const payload = data?.data;
      const ethics = Number(payload?.ethics_score);
      const health = Number(payload?.health_score);
      const summary =
        typeof payload?.summary === "string" ? payload.summary.trim() : "";
      const swaps = Array.isArray(payload?.better_swaps)
        ? payload.better_swaps.filter(
            (item: unknown): item is string => typeof item === "string",
          )
        : [];

      const hasValidContent =
        Number.isFinite(ethics) &&
        Number.isFinite(health) &&
        summary.length > 0;

      if (!hasValidContent) {
        setErrorMessage(
          "Our agent couldn't find recent data for this brand. Try another!",
        );
        setLoading(false);
        return;
      }

      pushRecentSearch(normalizedQuery);
      const nextReport = {
        ethics_score: clampTenScale(ethics),
        health_score: clampTenScale(health),
        summary,
        better_swaps: swaps,
      };

      if (isComparison) {
        setCompareBrandSearched(normalizedQuery);
        setCompareReport(nextReport);
        setIsComparing(true);
      } else {
        setBrandSearched(normalizedQuery);
        setReport(nextReport);
      }

      setLoading(false);
    },
    [pushRecentSearch, selectedValues, supabase.functions],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch(query);
  }

  async function handleShareReport() {
    if (!report || !brandSearched) return;

    const shareText =
      `LiveMoral Report: ${brandSearched}\n` +
      `Ethics Score: ${report.ethics_score.toFixed(1)}/10\n` +
      `Health Score: ${report.health_score.toFixed(1)}/10\n` +
      `Active Values: ${selectedValues.length > 0 ? selectedValues.join(", ") : "None"}\n` +
      `Summary: ${report.summary}`;

    try {
      await navigator.clipboard.writeText(shareText);
      showToast("Report copied to clipboard.");
    } catch {
      showToast("Clipboard access blocked on this browser.");
    }
  }

  const closeScanner = useCallback(() => {
    setIsScannerOpen(false);
  }, []);

  const closeComparison = useCallback(() => {
    setIsComparing(false);
    setCompareReport(null);
    setCompareBrandSearched("");
  }, []);

  const handleBarcode = useCallback(
    async (barcode: string) => {
      const normalizedBarcode = barcode.trim();
      if (!normalizedBarcode) {
        showToast("Invalid barcode.");
        return;
      }

      try {
        const response = await fetch(
          `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(normalizedBarcode)}.json?fields=product_name,brands`,
        );

        if (!response.ok) {
          showToast("Could not fetch brand from barcode.");
          return;
        }

        const payload = (await response.json()) as {
          product?: { brands?: string };
        };
        const brands =
          typeof payload.product?.brands === "string" ? payload.product.brands.trim() : "";

        if (!brands) {
          showToast("No brand found for this barcode.");
          return;
        }

        const brandName = brands
          .split(",")
          .map((part) => part.trim())
          .find((part) => part.length > 0);

        if (!brandName) {
          showToast("No valid brand found for this barcode.");
          return;
        }

        setQuery(brandName);
        await runSearch(brandName);
      } catch {
        showToast("Barcode lookup failed. Try again.");
      }
    },
    [runSearch],
  );

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ecfdf5_0%,#f4f4f5_45%,#f8fafc_100%)] px-4 py-6 text-zinc-900 sm:px-6 sm:py-8">
      <main className="mx-auto w-full max-w-7xl space-y-4 sm:space-y-5">
        <header className="rounded-3xl border border-white/50 bg-white/55 px-5 py-4 shadow-[0_16px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">LiveMoral</h1>
              <p className="text-sm text-zinc-500">Ethics intelligence dashboard</p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-700 backdrop-blur">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-600" />
              Live AI Agent Active
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-3">
          <article className="rounded-3xl border border-white/50 bg-white/55 p-4 shadow-[0_14px_36px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:p-5 lg:col-span-2">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="brand-search" className="text-sm font-medium text-zinc-600">
                  Search a brand
                </label>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                  <input
                    id="brand-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Nike, Zara, Shein..."
                    className="h-14 w-full rounded-2xl border border-white/70 bg-white/70 px-4 text-base outline-none transition-shadow placeholder:text-zinc-400 focus:border-emerald-500 focus:shadow-[0_0_0_3px_rgba(5,150,105,0.15)]"
                  />
                  <button
                    type="button"
                    onClick={() => setIsScannerOpen(true)}
                    aria-label="Open barcode scanner"
                    className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/70 bg-white/70 text-zinc-600 transition hover:border-emerald-200 hover:text-emerald-700"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="h-5 w-5"
                      aria-hidden="true"
                    >
                      <path d="M4 7V5a1 1 0 0 1 1-1h2" />
                      <path d="M20 7V5a1 1 0 0 0-1-1h-2" />
                      <path d="M4 17v2a1 1 0 0 0 1 1h2" />
                      <path d="M20 17v2a1 1 0 0 1-1 1h-2" />
                      <circle cx="12" cy="12" r="2.6" />
                    </svg>
                  </button>
                  <button
                    type="submit"
                    disabled={loading || query.trim().length === 0}
                    className="h-14 rounded-2xl bg-emerald-600 px-6 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Search
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Personal values
                </p>
                <div className="flex snap-x gap-2 overflow-x-auto pb-1">
                  {USER_VALUES.map((value) => {
                    const selected = selectedValues.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setSelectedValues((prev) =>
                            prev.includes(value)
                              ? prev.filter((item) => item !== value)
                              : [...prev, value],
                          )
                        }
                        className={`snap-start whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                          selected
                            ? "border-emerald-800 bg-emerald-100 text-emerald-900"
                            : "border-white/70 bg-white/70 text-zinc-600 hover:border-emerald-200 hover:text-emerald-700"
                        }`}
                      >
                        {selected ? `Active: ${value}` : value}
                      </button>
                    );
                  })}
                </div>
              </div>
            </form>
          </article>

          <aside className="rounded-3xl border border-white/50 bg-white/55 p-4 shadow-[0_14px_36px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
              Recent Searches
            </h2>
            <div className="mt-3 space-y-2">
              {recentSearches.length > 0 ? (
                recentSearches.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setQuery(item);
                      void runSearch(item);
                    }}
                    className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-left text-sm font-medium text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-700"
                  >
                    {item}
                  </button>
                ))
              ) : (
                <p className="text-sm text-zinc-500">Your last 5 searches will appear here.</p>
              )}
            </div>
          </aside>
        </section>

        {loading && (
          <section className="space-y-4 rounded-3xl border border-white/50 bg-white/55 p-5 backdrop-blur-xl">
            <p className="text-sm font-medium text-zinc-700">
              Searching the web
              <span className="inline-flex">
                <span className="animate-bounce [animation-delay:-0.3s]">.</span>
                <span className="animate-bounce [animation-delay:-0.15s]">.</span>
                <span className="animate-bounce">.</span>
              </span>
            </p>
            <div className="space-y-3">
              <div className="h-24 animate-pulse rounded-2xl bg-zinc-100/70" />
              <div className="h-4 w-11/12 animate-pulse rounded bg-zinc-100/70" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-zinc-100/70" />
              <div className="h-10 w-2/3 animate-pulse rounded-full bg-zinc-100/70" />
            </div>
          </section>
        )}

        {!loading && errorMessage && (
          <section className="rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm font-medium text-amber-700">
            {errorMessage}
          </section>
        )}

        {!loading && report && !isComparing && (
          <section className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-3">
            <article className="rounded-3xl border border-white/50 bg-white/55 p-5 shadow-[0_14px_36px_rgba(15,23,42,0.06)] backdrop-blur-xl lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight capitalize">
                    {brandSearched}
                  </h2>
                  <p className="text-sm text-zinc-500">
                    Active values:{" "}
                    {selectedValues.length > 0 ? selectedValues.join(", ") : "None selected"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-600">
                    AI Analysis
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleShareReport()}
                    className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800"
                  >
                    Share Report
                  </button>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <p className="text-sm font-semibold text-zinc-700">Summary</p>
                <p className="text-sm leading-6 text-zinc-600">{report.summary}</p>
              </div>

              <div className="mt-5 space-y-2">
                <p className="text-sm font-semibold text-zinc-700">Better Alternatives</p>
                <div className="flex flex-wrap gap-2">
                  {report.better_swaps.length > 0 ? (
                    report.better_swaps.map((swap) => (
                      <button
                        key={swap}
                        type="button"
                        onClick={() => {
                          setQuery(swap);
                          void runSearch(swap, undefined, true);
                        }}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                      >
                        {swap}
                      </button>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-500">No alternatives returned yet.</p>
                  )}
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-white/50 bg-white/55 p-4 shadow-[0_14px_36px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                Enhanced Scores
              </h3>
              <div className="mt-4 space-y-4">
                <ProgressCircle label="Ethics Score" value={report.ethics_score} />
                <ProgressCircle label="Health Score" value={report.health_score} />
              </div>
            </article>
          </section>
        )}

        {!loading && report && isComparing && compareReport && (
          <section className="relative grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-2">
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/90 bg-zinc-900 text-sm font-semibold text-white shadow-lg">
                Vs
              </span>
            </div>

            <article
              className={`rounded-3xl bg-white/55 p-5 shadow-[0_14px_36px_rgba(15,23,42,0.06)] backdrop-blur-xl ${
                report.ethics_score > compareReport.ethics_score
                  ? "border border-amber-300"
                  : "border border-white/50"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Original Brand
                  </p>
                  <h2 className="text-xl font-semibold tracking-tight capitalize">
                    {brandSearched}
                  </h2>
                </div>
                {report.ethics_score > compareReport.ethics_score && (
                  <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                    Best Choice
                  </span>
                )}
              </div>

              <div className="mt-5 space-y-2">
                <p className="text-sm font-semibold text-zinc-700">Summary</p>
                <p className="text-sm leading-6 text-zinc-600">{report.summary}</p>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ProgressCircle label="Ethics Score" value={report.ethics_score} />
                <ProgressCircle label="Health Score" value={report.health_score} />
              </div>
            </article>

            <article
              className={`rounded-3xl bg-white/55 p-5 shadow-[0_14px_36px_rgba(15,23,42,0.06)] backdrop-blur-xl ${
                compareReport.ethics_score > report.ethics_score
                  ? "border border-amber-300"
                  : "border border-white/50"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Alternative Brand
                  </p>
                  <h2 className="text-xl font-semibold tracking-tight capitalize">
                    {compareBrandSearched}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {compareReport.ethics_score > report.ethics_score && (
                    <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                      Best Choice
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={closeComparison}
                    className="rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-200"
                  >
                    Close Comparison
                  </button>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <p className="text-sm font-semibold text-zinc-700">Summary</p>
                <p className="text-sm leading-6 text-zinc-600">{compareReport.summary}</p>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ProgressCircle label="Ethics Score" value={compareReport.ethics_score} />
                <ProgressCircle label="Health Score" value={compareReport.health_score} />
              </div>
            </article>
          </section>
        )}
      </main>

      {toastMessage && (
        <div className="pointer-events-none fixed inset-x-4 bottom-4 z-20 mx-auto max-w-md rounded-2xl border border-white/60 bg-zinc-900/90 px-4 py-3 text-sm font-medium text-white shadow-lg backdrop-blur md:inset-x-auto md:right-5 md:mx-0">
          {toastMessage}
        </div>
      )}

      <ScannerModal
        isOpen={isScannerOpen}
        onClose={closeScanner}
        onScanSuccess={(decodedText) => {
          void handleBarcode(decodedText);
        }}
      />
    </div>
  );
}
