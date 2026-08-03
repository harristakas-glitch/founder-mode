import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const App = lazy(() => import("../App"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Founder Mode — Startup Simulator Game" },
      {
        name: "description",
        content:
          "Run a startup week by week: hire your team, ship product, chase growth, and raise your next round in Founder Mode.",
      },
      { property: "og:title", content: "Founder Mode — Startup Simulator Game" },
      {
        property: "og:description",
        content:
          "Run a startup week by week: hire, ship, grow, and raise in this browser startup simulator.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-bg" />}>
      <Suspense fallback={<div className="min-h-screen bg-bg" />}>
        <App />
      </Suspense>
    </ClientOnly>
  );
}
