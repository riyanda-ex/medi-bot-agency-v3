import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">Halaman tidak ditemukan</h2>
        <p className="mt-2 text-sm text-slate-600">
          Halaman yang Anda cari tidak tersedia atau telah dipindahkan.
        </p>
        <Link className="mt-4 inline-block text-sm text-sky-700 underline" href="/dashboard">
          Kembali ke dashboard
        </Link>
      </div>
    </div>
  );
}
