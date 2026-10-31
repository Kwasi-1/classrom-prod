import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Classroom", description: "Coding assignments on GitHub" };

// Self-hosted Mona Sans; exposed as --font-mona-sans and mapped to Tailwind's font-sans in globals.css.
const monaSans = localFont({
  src: [
    { path: "../fonts/MonaSans-ExtraLight.woff2", weight: "200", style: "normal" },
    { path: "../fonts/MonaSans-Light.woff2", weight: "300", style: "normal" },
    { path: "../fonts/MonaSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/MonaSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/MonaSans-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../fonts/MonaSans-Bold.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-mona-sans",
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <html lang="en" className={monaSans.variable}>
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
