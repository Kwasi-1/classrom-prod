import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (!error && (await currentUser())) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-3xl font-bold">Coding assignments on GitHub</h1>
      <p className="mt-3 text-slate-600">
        Distribute assignments as private repositories, collect submissions on every push, and autograde with hidden tests.
      </p>
      {error && <p className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <a href="/api/auth/login" className="btn mt-8">
        Sign in with GitHub
      </a>
    </div>
  );
}
