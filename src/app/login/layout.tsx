export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-8 sm:px-6">
      {children}
    </div>
  );
}
