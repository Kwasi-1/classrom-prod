import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Classroom", description: "Coding assignments on GitHub" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href={user ? "/dashboard" : "/"} className="font-semibold">
              Classroom
            </Link>
            {user ? (
              <div className="flex items-center gap-3 text-sm">
                {user.avatarUrl && <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" />}
                <span>{user.githubLogin}</span>
                <form action="/api/auth/logout" method="post">
                  <button className="text-slate-500 hover:text-slate-900">Sign out</button>
                </form>
              </div>
            ) : (
              <a href="/api/auth/login" className="text-sm">
                Sign in
              </a>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
