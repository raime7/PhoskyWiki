import { PasswordResetForm } from "@/components/password-reset-form";
export const dynamic = "force-dynamic";
export const metadata = { title: "恢复账号", referrer: "no-referrer" as const };
export default function ResetPasswordPage() {
  return <main className="mx-auto w-full max-w-sm flex-1 px-4 py-16"><h1 className="mb-6 text-2xl font-bold">恢复账号</h1><PasswordResetForm /></main>;
}
